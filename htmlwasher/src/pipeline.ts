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
  DEFAULT_WASHING_LEVEL,
  type Message,
  type Metadata,
  type PageType,
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
 * `'standard'`). `minify` (default `false`) emits minified rather than
 * prettier-formatted HTML. `url` is optional context (never fetched).
 */
export async function wash(html: string, options: WashOptions = {}): Promise<WashResult> {
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
  const washed = await washHtml(boilerplate.html, level, { minify });
  messages.push(...washed.messages);

  const result: WashResult = { html: washed.html, messages };
  if (metadata) result.metadata = metadata;
  if (boilerplate.pageType) {
    result.pageType = boilerplate.pageType;
    result.confidence = boilerplate.confidence;
  }
  return result;
}
