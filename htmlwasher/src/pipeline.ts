// SPDX-License-Identifier: Apache-2.0
// Orchestrates the two pillars into the public wash() API:
//   metadata (sidecar) + classify → profile → boilerplate(mode) → wash(level).
//
// For any boilerplate mode other than `none`, the page is classified (3-stage
// cascade) and extraction is routed through the matching per-type profile
// (content selectors, preserved tags, boilerplate selectors, comments-as-content).
// `none` bypasses extraction (and classification) and washes the whole document.
// wash() is async: the classifier (ONNX) and the washing formatter load lazily.

import { classifyPage } from './classifier/index.js';
import { extractContentHTML } from './core/extract.js';
import type { CoreOptions, ExtractFocus } from './core/options.js';
import { extractMetadata } from './metadata/index.js';
import { getProfile } from './profiles/index.js';
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

const MODE_TO_FOCUS: Record<Exclude<BoilerplateMode, 'none'>, ExtractFocus> = {
  precision: 'precision',
  balanced: 'balanced',
  recall: 'recall',
};

interface BoilerplateOutcome {
  html: string;
  pageType?: PageType;
  confidence?: number;
}

/**
 * Run the boilerplate-removal stage: classify the page, select its extraction
 * profile, and extract the main content. Returns the content HTML to wash plus
 * the classification. Falls back to the default (article) profile if the
 * classifier is unavailable.
 */
async function runBoilerplate(
  html: string,
  mode: BoilerplateMode,
  url: string | undefined,
  messages: Message[],
): Promise<BoilerplateOutcome> {
  if (mode === 'none') return { html }; // wash the whole document (no extraction)

  const focus = MODE_TO_FOCUS[mode];
  let coreOptions: Partial<CoreOptions> = { focus, originalUrl: url };
  let pageType: PageType | undefined;
  let confidence: number | undefined;

  try {
    const classified = await classifyPage(html, url);
    pageType = classified.pageType;
    confidence = classified.confidence;
    const profile = getProfile(pageType);
    coreOptions = {
      focus,
      originalUrl: url,
      contentSelectors: profile.contentSelectors,
      preserveTags: profile.preserveTags,
      boilerplateSelectors: profile.boilerplateSelectors,
      commentsAsContent: profile.commentsAreContent,
    };
  } catch (error) {
    messages.push({
      type: 'warning',
      text: `page-type classification unavailable; using the default profile: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const result = extractContentHTML(html, coreOptions);
  if (result.html === '') {
    messages.push({
      type: 'warning',
      text: 'boilerplate removal produced no content; washing the whole document',
    });
    return { html, pageType, confidence };
  }
  return { html: result.html, pageType, confidence };
}

function hasMetadata(meta: Metadata): boolean {
  return Object.values(meta).some((v) => v !== undefined && (!Array.isArray(v) || v.length > 0));
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

  const boilerplate = await runBoilerplate(html, mode, options.url, messages);
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
