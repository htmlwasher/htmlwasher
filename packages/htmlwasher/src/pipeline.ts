// SPDX-License-Identifier: Apache-2.0
// Orchestrates the two pillars into the public wash() API:
//   metadata (sidecar) + boilerplate(mode) → wash(level).
//
// For any boilerplate mode other than `none`, the @htmlwasher/native Rust core
// classifies the page (3-stage cascade) and routes extraction through the
// matching per-type profile internally, returning the preserve-markup content
// HTML (UNSANITIZED — the washing stage owns sanitization) plus the page type +
// confidence. `none` bypasses the FFI call entirely (no extraction, no
// classification) and washes the whole document. wash() is async: the native
// module loads lazily (first non-`none` call), the Rust extraction runs on the
// libuv threadpool, and the washing formatter loads lazily. A native failure
// (extract() rejection or an unloadable binding) degrades to whole-document
// washing with a warning rather than rejecting wash().

import { extractMetadata } from './metadata/index.js';
import {
  type BoilerplateMode,
  DEFAULT_BOILERPLATE_MODE,
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_WASHING_LEVEL,
  isBoilerplateMode,
  isWashingLevel,
  type Message,
  type Metadata,
  type PageType,
  sanitizeConfigError,
  type WashOptions,
  type WashResult,
} from './types.js';
import { washHtml } from './washing/wash.js';

/** The `@htmlwasher/native` module surface (type-only — the module loads lazily). */
type NativeModule = typeof import('@htmlwasher/native');

// Lazy-loaded native binding: `boilerplate: 'none'`, metadata-only use, and any
// platform without a loadable prebuilt .node must never require the FFI module
// at package load. The resolved module is ALSO cached synchronously so warmed
// calls dispatch extract() to the threadpool before wash()'s synchronous
// metadata parse runs (see the overlap note in wash()).
let native: NativeModule | undefined;
let nativeLoad: Promise<NativeModule> | undefined;

function loadNative(): Promise<NativeModule> {
  nativeLoad ??= import('@htmlwasher/native').then((mod) => {
    native = mod;
    return mod;
  });
  return nativeLoad;
}

interface BoilerplateOutcome {
  html: string;
  pageType?: PageType;
  confidence?: number;
}

/**
 * Run the boilerplate-removal stage via the @htmlwasher/native Rust core: it
 * classifies the page and routes extraction through the matching per-type
 * profile internally, returning the preserve-markup content HTML plus the
 * detected page type + confidence. The public `wash()` never passes a `pageType`
 * override (the classifier always auto-runs). The returned `contentHtml` is
 * UNSANITIZED — the caller MUST flow it through `washHtml`. When extraction
 * yields no content, keep the whole document and warn. When the native call
 * fails (extract() rejection or an unloadable binding), degrade the same way:
 * warn and wash the whole document (pageType/confidence omitted).
 */
async function runBoilerplate(
  html: string,
  mode: BoilerplateMode,
  url: string | undefined,
  messages: Message[],
): Promise<BoilerplateOutcome> {
  if (mode === 'none') return { html }; // wash the whole document (no extraction, no FFI)

  try {
    // Once `none` is handled, `mode` IS the Rust core's focus union.
    const mod = native ?? (await loadNative());
    const r = await mod.extract(html, { focus: mode, url });
    // Surface the core's non-fatal diagnostics. `fallbackUsed` gets no message of
    // its own: every fallback/rescue result already carries one of the warnings
    // ('body-fallback-used', 'json-ld-rescue', or 'baseline-rescue').
    for (const warning of r.warnings) {
      messages.push({ type: 'warning', text: `boilerplate: ${warning}` });
    }
    if (r.contentHtml === '') {
      messages.push({
        type: 'warning',
        text: 'boilerplate removal produced no content; washing the whole document',
      });
      return { html, pageType: r.pageType, confidence: r.confidence };
    }
    return { html: r.contentHtml, pageType: r.pageType, confidence: r.confidence };
  } catch (error) {
    messages.push({
      type: 'warning',
      text: `boilerplate removal failed: ${error instanceof Error ? error.message : String(error)}; washing the whole document`,
    });
    return { html };
  }
}

/** `extractMetadata` returns a pruneEmpty()-ed sidecar, so any key means real data. */
function hasMetadata(meta: Metadata): boolean {
  return Object.keys(meta).length > 0;
}

/**
 * Clean a page: HTML in → cleaned HTML out (+ an optional metadata sidecar and,
 * when extraction runs, the detected page type and confidence).
 *
 * Two orthogonal knobs: the boilerplate-removal `mode` (default `'balanced'`;
 * `'none'` washes the whole document) and the washing `level` (default
 * `'standard'`) — or a fully-custom `config` (a {@link import('./types.js').SanitizeConfig}),
 * which takes precedence over `level`. `minify` (default `false`) emits minified
 * rather than prettier-formatted HTML. `url` is optional context (never fetched).
 *
 * @throws {TypeError} if `html` is not a string, if `options.boilerplate` /
 *   `options.level` is provided but invalid, or if `options.config` is provided
 *   but is not a valid SanitizeConfig.
 * @throws {RangeError} if the input HTML exceeds `options.maxInputBytes`
 *   (default {@link DEFAULT_MAX_INPUT_BYTES}, 10 MB) UTF-8 bytes.
 */
export async function wash(html: string, options: WashOptions = {}): Promise<WashResult> {
  // Validate the custom config at the boundary (same guard the CLI uses).
  if (options.config !== undefined) {
    const error = sanitizeConfigError(options.config);
    if (error !== null) throw new TypeError(`Invalid washing config: ${error}`);
  }

  // Validate the remaining boundary inputs (after the config guard, to keep the
  // config-invalid message first, as before).
  if (typeof html !== 'string') {
    throw new TypeError(`wash() expects \`html\` to be a string, received ${typeof html}`);
  }
  if (options.boilerplate !== undefined && !isBoilerplateMode(options.boilerplate)) {
    throw new TypeError(`Invalid boilerplate mode: ${String(options.boilerplate)}`);
  }
  if (options.level !== undefined && !isWashingLevel(options.level)) {
    throw new TypeError(`Invalid washing level: ${String(options.level)}`);
  }

  // Bound resource use: reject oversized input at the boundary.
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const inputBytes = Buffer.byteLength(html, 'utf8');
  if (inputBytes > maxInputBytes) {
    throw new RangeError(
      `Input HTML is ${inputBytes} bytes, exceeding the limit of ${maxInputBytes} bytes`,
    );
  }

  const mode = options.boilerplate ?? DEFAULT_BOILERPLATE_MODE;
  const level = options.level ?? DEFAULT_WASHING_LEVEL;
  const minify = options.minify ?? false;
  const messages: Message[] = [];

  // Start the boilerplate stage FIRST so the Rust threadpool work overlaps the
  // synchronous linkedom metadata parse below (both consume the raw html).
  // Message order is preserved: the metadata warning is pushed synchronously,
  // while runBoilerplate's warnings land only once its promise is awaited.
  const boilerplatePromise = runBoilerplate(html, mode, options.url, messages);

  let metadata: Metadata | undefined;
  try {
    const meta = extractMetadata(html, options.url);
    if (hasMetadata(meta)) metadata = meta;
  } catch (error) {
    messages.push({
      type: 'warning',
      text: `metadata extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const boilerplate = await boilerplatePromise;
  const washed = await washHtml(boilerplate.html, level, { minify, config: options.config });
  messages.push(...washed.messages);

  const result: WashResult = { html: washed.html, messages };
  if (metadata) result.metadata = metadata;
  if (boilerplate.pageType) {
    result.pageType = boilerplate.pageType;
    result.confidence = boilerplate.confidence;
  }
  return result;
}
