// SPDX-License-Identifier: Apache-2.0
// Orchestrates the two pillars into the public clean() API:
//   metadata (sidecar) + boilerplate(mode) → clean(level).
//
// For any boilerplate mode other than `none`, the @trafilaturacore/native Rust core
// classifies the page (3-stage cascade) and routes extraction through the
// matching per-type profile internally, returning the preserve-markup content
// HTML (UNSANITIZED — the cleaning stage owns sanitization) plus the page type +
// confidence. `none` bypasses the FFI call entirely (no extraction, no
// classification) and cleans the whole document. clean() is async: the native
// module loads lazily (first non-`none` call), the Rust extraction runs on the
// libuv threadpool, and the cleaning formatter loads lazily. A native failure
// (extract() rejection or an unloadable binding) degrades to whole-document
// cleaning with a warning rather than rejecting clean().

import { cleanHtml } from './cleaning/clean.js';
import { extractMetadata } from './metadata/index.js';
import {
  type BoilerplateMode,
  type CleanOptions,
  type CleanResult,
  cleanConfigError,
  DEFAULT_BOILERPLATE_MODE,
  DEFAULT_CLEANING_LEVEL,
  DEFAULT_MAX_INPUT_BYTES,
  isBoilerplateMode,
  isCleaningLevel,
  type Message,
  type Metadata,
  type PageType,
} from './types.js';

/** The `@trafilaturacore/native` module surface (type-only — the module loads lazily). */
type NativeModule = typeof import('@trafilaturacore/native');

// Lazy-loaded native binding: `boilerplate: 'none'`, metadata-only use, and any
// platform without a loadable prebuilt .node must never require the FFI module
// at package load. The resolved module is ALSO cached synchronously so warmed
// calls dispatch extract() to the threadpool before clean()'s synchronous
// metadata parse runs (see the overlap note in clean()).
let native: NativeModule | undefined;
let nativeLoad: Promise<NativeModule> | undefined;

function loadNative(): Promise<NativeModule> {
  nativeLoad ??= import('@trafilaturacore/native').then((mod) => {
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
 * Run the boilerplate-removal stage via the @trafilaturacore/native Rust core: it
 * classifies the page and routes extraction through the matching per-type
 * profile internally, returning the preserve-markup content HTML plus the
 * detected page type + confidence. The public `clean()` never passes a `pageType`
 * override (the classifier always auto-runs). The returned `contentHtml` is
 * UNSANITIZED — the caller MUST flow it through `cleanHtml`. When extraction
 * yields no content, keep the whole document and warn. When the native call
 * fails (extract() rejection or an unloadable binding), degrade the same way:
 * warn and clean the whole document (pageType/confidence omitted).
 */
async function runBoilerplate(
  html: string,
  mode: BoilerplateMode,
  url: string | undefined,
  messages: Message[],
): Promise<BoilerplateOutcome> {
  if (mode === 'none') return { html }; // clean the whole document (no extraction, no FFI)

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
        text: 'boilerplate removal produced no content; cleaning the whole document',
      });
      return { html, pageType: r.pageType, confidence: r.confidence };
    }
    return { html: r.contentHtml, pageType: r.pageType, confidence: r.confidence };
  } catch (error) {
    messages.push({
      type: 'warning',
      text: `boilerplate removal failed: ${error instanceof Error ? error.message : String(error)}; cleaning the whole document`,
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
 * `'none'` cleans the whole document) and the cleaning `level` (default
 * `'standard'`) — or a fully-custom `config` (a {@link import('./types.js').CleanConfig}),
 * which takes precedence over `level`. `minify` (default `false`) emits minified
 * rather than prettier-formatted HTML. `url` is optional context (never fetched).
 *
 * @throws {TypeError} if `html` is not a string, if `options.boilerplate` /
 *   `options.level` is provided but invalid, or if `options.config` is provided
 *   but is not a valid CleanConfig.
 * @throws {RangeError} if the input HTML exceeds `options.maxInputBytes`
 *   (default {@link DEFAULT_MAX_INPUT_BYTES}, 10 MB) UTF-8 bytes.
 */
export async function clean(html: string, options: CleanOptions = {}): Promise<CleanResult> {
  // Validate the custom config at the boundary (same guard the CLI uses).
  if (options.config !== undefined) {
    const error = cleanConfigError(options.config);
    if (error !== null) throw new TypeError(`Invalid cleaning config: ${error}`);
  }

  // Validate the remaining boundary inputs (after the config guard, to keep the
  // config-invalid message first, as before).
  if (typeof html !== 'string') {
    throw new TypeError(`clean() expects \`html\` to be a string, received ${typeof html}`);
  }
  if (options.boilerplate !== undefined && !isBoilerplateMode(options.boilerplate)) {
    throw new TypeError(`Invalid boilerplate mode: ${String(options.boilerplate)}`);
  }
  if (options.level !== undefined && !isCleaningLevel(options.level)) {
    throw new TypeError(`Invalid cleaning level: ${String(options.level)}`);
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
  const level = options.level ?? DEFAULT_CLEANING_LEVEL;
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
  const cleaned = await cleanHtml(boilerplate.html, level, { minify, config: options.config });
  messages.push(...cleaned.messages);

  const result: CleanResult = { html: cleaned.html, messages };
  if (metadata) result.metadata = metadata;
  if (boilerplate.pageType) {
    result.pageType = boilerplate.pageType;
    result.confidence = boilerplate.confidence;
  }
  return result;
}
