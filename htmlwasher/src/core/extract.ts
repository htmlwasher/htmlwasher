// SPDX-License-Identifier: Apache-2.0
// Orchestrates the boilerplate-removal core: parse → clean → select main content
// → prune link-dense sections → postCleaning → whitelist re-serialize. Emits the
// kept content AS an HTML subtree (never text/markdown/XML). Mirrors the shared
// go-trafilatura / rs-trafilatura pipeline, using the filter-serialize emit path
// the brief sanctions (§5 Phase 2).

import { cleanDocument } from './clean.js';
import { type HElement, parseDocument, trim } from './dom.js';
import { findContentNode, pruneUnwantedSections } from './main-content.js';
import { type CoreOptions, resolveCoreOptions } from './options.js';
import { postCleaning, renderFilteredHTML } from './serialize-filtered.js';

/** Below this many chars of extracted text we try the whole-body fallback. */
const MIN_EXTRACTED_TEXT = 200;

export interface CoreExtractResult {
  /** Whitelisted main-content HTML (may be empty when nothing extractable). */
  html: string;
  /** Trimmed text length (chars) of the extracted content. */
  textLength: number;
  /** True when the selector/scoring pass came up short and the body was used. */
  fallbackUsed: boolean;
}

function textLenOf(html: string): number {
  // Cheap text-length estimate from the serialized HTML (strip tags).
  return [...trim(html.replace(/<[^>]+>/g, ' '))].length;
}

function extractFrom(node: HElement, opts: CoreOptions): { html: string; textLength: number } {
  const clone = node.cloneNode(true);
  pruneUnwantedSections(clone, opts);
  postCleaning(clone);
  const html = renderFilteredHTML(clone, opts);
  return { html, textLength: textLenOf(html) };
}

/**
 * Extract the main content of an HTML document as a cleaned HTML subtree.
 *
 * Note: the `none` boilerplate mode (wash the whole document) is handled by the
 * orchestrating pipeline, NOT here — this function always extracts.
 */
export function extractContentHTML(
  html: string,
  options?: Partial<CoreOptions>,
): CoreExtractResult {
  const opts = resolveCoreOptions(options);
  const doc = parseDocument(html);
  const body = doc.body ?? doc.documentElement;
  if (!body) return { html: '', textLength: 0, fallbackUsed: false };

  // Clean the whole document (remove nav/aside/footer/script/etc.) before selecting.
  cleanDocument(body, opts);

  const content = findContentNode(body, opts);
  const primary = extractFrom(content, opts);

  // Short-extraction fallback: if the selected node yielded little and it was not
  // already the body, re-run over the whole (cleaned) body and keep the larger.
  if (primary.textLength < MIN_EXTRACTED_TEXT && content !== body) {
    const fallback = extractFrom(body, opts);
    if (fallback.textLength > primary.textLength) {
      return { html: fallback.html, textLength: fallback.textLength, fallbackUsed: true };
    }
  }

  return { html: primary.html, textLength: primary.textLength, fallbackUsed: false };
}
