// SPDX-License-Identifier: Apache-2.0
// Thin DOM-query helpers for the feature extractor. These mirror the selectolax /
// dom_query semantics that the Python `extract_features.py` relies on, so the TS
// numeric features match byte-for-byte.
//
// Parity notes (verified against linkedom 0.18):
// - `document.querySelectorAll` and `element.querySelectorAll` both match
//   DESCENDANTS ONLY and EXCLUDE the queried node itself — exactly dom_query's
//   `Selection::select`. So `descendantCount` is a plain `querySelectorAll().length`
//   (no self-filter needed, unlike selectolax's `node.css`).
// - `[class*='x']` is a case-sensitive attribute-substring match.
// - `element.textContent` is pure descendant-text concatenation with no separator
//   (includes <script>/<style> text), matching `node.text(deep=True, separator="")`.
// - `element.children` excludes comment/text nodes (element-only), matching
//   dom_query `Selection::children` and the Python `_element_children` walk.

import type { HDocument, HElement } from '../../core/dom.js';

/** UTF-8 BYTE length — every `len()`/`_blen` in the Python extractor is a byte count. */
export function blen(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * Split a comma-union CSS selector into its sub-selectors.
 *
 * All selectors used here only use commas as separators (no commas inside
 * `[attr]`/quotes/`:is()`), so a plain split is safe.
 */
function splitUnion(sel: string): string[] {
  return sel
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Match a comma-union against descendants of `root` (excludes `root`), returning
 * matches in DOCUMENT ORDER with one entry per matching sub-selector.
 *
 * PARITY-CRITICAL: selectolax/lexbor `node.css("a, b")` walks the tree once in
 * document order and emits a node ONCE PER MATCHING SUB-SELECTOR (a node matching
 * both `a` and `b` appears twice, consecutively) — it does NOT deduplicate the way
 * linkedom's `querySelectorAll` union does. We replicate that: a single sub-selector
 * uses `querySelectorAll` directly (already document order, no possible dup); a
 * multi-sub union walks the deduped descendant set in document order and counts each
 * element once per matching sub-selector.
 */
function matchUnion(root: HDocument | HElement, sel: string): HElement[] {
  const subs = splitUnion(sel);
  if (subs.length <= 1) {
    return Array.from(root.querySelectorAll(sel));
  }
  // Deduped descendant union in document order, then expand by sub-selector hits.
  const candidates = root.querySelectorAll(subs.join(', '));
  const out: HElement[] = [];
  for (const el of candidates) {
    for (const sub of subs) {
      if (el.matches(sub)) out.push(el);
    }
  }
  return out;
}

/** Document-wide select → array of matched elements (Python `tree.css(sel)`, non-deduped). */
export function select(doc: HDocument, sel: string): HElement[] {
  return matchUnion(doc, sel);
}

/** Number of matched elements document-wide (one count per matching sub-selector). */
export function selectLen(doc: HDocument, sel: string): number {
  return matchUnion(doc, sel).length;
}

/**
 * Count descendants of `node` matching `sel` (excludes `node` itself), counting each
 * descendant once per matching sub-selector to match selectolax `node.css`.
 */
export function descendantCount(node: HElement, sel: string): number {
  return matchUnion(node, sel).length;
}

/**
 * Pure descendant-text concatenation, matching dom_query `Selection::text` /
 * selectolax `node.text(deep=True, separator="")`.
 */
export function nodeText(node: HElement): string {
  return node.textContent ?? '';
}

/** Concatenated text across all matched nodes (Python `_selection_text`). */
export function selectionText(nodes: readonly HElement[]): string {
  let out = '';
  for (const n of nodes) out += nodeText(n);
  return out;
}

/** Direct ELEMENT children (element-only; excludes comment/text), Python `_element_children`. */
export function elementChildren(node: HElement): HElement[] {
  return Array.from(node.children);
}
