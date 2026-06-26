// SPDX-License-Identifier: Apache-2.0
// Orchestrates the boilerplate-removal core: parse → clean → select main content
// → prune link-dense sections → postCleaning → whitelist re-serialize. Emits the
// kept content AS an HTML subtree (never text/markdown/XML). Mirrors the shared
// go-trafilatura / rs-trafilatura pipeline, using the filter-serialize emit path
// the brief sanctions (§5 Phase 2).

import { cleanDocument } from './clean.js';
import { getElementsByTagName, type HElement, parseDocument, trim } from './dom.js';
import { findContentNode, pruneUnwantedSections } from './main-content.js';
import { type CoreOptions, resolveCoreOptions } from './options.js';
import {
  isAlwaysExcludedName,
  isBoilerplateNamed,
  postCleaning,
  renderFilteredHTML,
} from './serialize-filtered.js';

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

/**
 * Remove boilerplate-named DESCENDANTS (by class/id) of the content root. This
 * must run BEFORE postCleaning, which strips `id`/`class` (ALWAYS_DROP_ATTRS)
 * and so blinds the serializer's `isBoilerplateNamed` guard. We never remove the
 * root itself (it was already chosen) — only its descendants. Iterate a snapshot
 * in reverse document order so removing an already-detached child is a no-op.
 */
function removeBoilerplateNamed(root: HElement, opts: CoreOptions): void {
  const els = getElementsByTagName(root, '*');
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (el && isBoilerplateNamed(el, opts)) el.remove();
  }
}

/**
 * Remove UNCONDITIONALLY-excluded descendants (rs `is_always_excluded_name`
 * class/id substrings AND any `itemtype`*=`breadcrumblist` node). Mirrors rs
 * push_filtered_html_children, where these checks run OUTSIDE the
 * `filter_named_boilerplate` gate — so they fire even on the §10 backoff path,
 * unlike the gated `removeBoilerplateNamed`. Like that pass, this MUST run before
 * postCleaning, which strips id/class/itemtype and would blind the check.
 */
function removeAlwaysExcludedNamed(root: HElement, opts: CoreOptions): void {
  const els = getElementsByTagName(root, '*');
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (el && isAlwaysExcludedName(el, opts)) el.remove();
  }
}

function renderClone(
  node: HElement,
  opts: CoreOptions,
  dropBoilerplateNamed: boolean,
): { html: string; textLength: number } {
  const clone = node.cloneNode(true);
  pruneUnwantedSections(clone, opts);
  // Always-excluded names + BreadcrumbList microdata are dropped UNCONDITIONALLY
  // (both branches, including the §10 backoff where dropBoilerplateNamed is false),
  // matching rs. The recall-able boilerplate-token list is gated below.
  removeAlwaysExcludedNamed(clone, opts);
  if (dropBoilerplateNamed) removeBoilerplateNamed(clone, opts);
  postCleaning(clone);
  const html = renderFilteredHTML(clone, opts);
  return { html, textLength: textLenOf(html) };
}

function extractFrom(node: HElement, opts: CoreOptions): { html: string; textLength: number } {
  const filtered = renderClone(node, opts, true);
  if (filtered.textLength > 0) return filtered;
  // Name-based boilerplate removal emptied the content — the whole node lives in
  // boilerplate-named containers (typical of collection/listing pages). Back off
  // to the unfiltered extraction rather than emit nothing (go-trafilatura's
  // "do not delete all the content" rule).
  const unfiltered = renderClone(node, opts, false);
  return unfiltered.textLength > 0 ? unfiltered : filtered;
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
