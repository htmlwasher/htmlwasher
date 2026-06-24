// SPDX-License-Identifier: Apache-2.0
// Main-content selection. Tries the ported go-trafilatura content selectors
// (constants.CONTENT_RULES), then the semantic <article>/<main>/[role=main]
// fallbacks, then a readability-style scoring pass (the dom-distiller-style
// cascade the brief calls for). Returns the chosen content element.

import { deleteByLinkDensity, linkDensityTest } from './clean.js';
import { CONTENT_RULES, type ContentRule } from './constants.js';
import {
  childElements,
  getElementsByTagName,
  type HElement,
  tagOf,
  textLength,
  trim,
} from './dom.js';
import type { CoreOptions } from './options.js';

/** Minimum text length (chars) for a selector match to win outright (rs guard). */
const MIN_SELECTOR_CONTENT = 100;

function matchesRule(el: HElement, rule: ContentRule): boolean {
  const tag = tagOf(el);
  if (!rule.tags.has(tag)) {
    // bareTag (e.g. <main>) matches on tag alone; otherwise this rule misses.
    return rule.bareTag?.includes(tag) ?? false;
  }
  const className = el.className || '';
  const id = el.id || '';
  const clsLower = className.toLowerCase();
  const idLower = id.toLowerCase();

  if (rule.equals?.class?.includes(className)) return true;
  if (rule.equals?.id?.includes(id)) return true;
  if (rule.equals?.role?.includes(el.getAttribute('role') ?? '')) return true;
  if (rule.contains?.class?.some((s) => className.includes(s))) return true;
  if (rule.contains?.id?.some((s) => id.includes(s))) return true;
  if (rule.containsLower?.class?.some((s) => clsLower.includes(s.toLowerCase()))) return true;
  if (rule.containsLower?.id?.some((s) => idLower.includes(s.toLowerCase()))) return true;
  if (rule.itemprop?.includes(el.getAttribute('itemprop') ?? '')) return true;
  if (rule.startsWith?.class?.some((s) => className.startsWith(s))) return true;
  if (rule.startsWith?.id?.some((s) => id.startsWith(s))) return true;
  if (rule.startsWith?.role?.some((s) => (el.getAttribute('role') ?? '').startsWith(s))) {
    return true;
  }
  return false;
}

/** Try the profile's own content selectors first (in order). */
function findByProfileSelectors(body: HElement, selectors: readonly string[]): HElement | null {
  for (const selector of selectors) {
    let match: HElement | null = null;
    try {
      match = body.querySelector(selector);
    } catch {
      continue; // skip selectors linkedom cannot parse
    }
    if (match && textLength(match) >= MIN_SELECTOR_CONTENT) return match;
  }
  return null;
}

/** Find the content root via the ported selector rules. */
function findBySelectors(body: HElement): HElement | null {
  const all = getElementsByTagName(body, '*');
  let best: HElement | null = null;
  let bestLen = 0;
  for (const rule of CONTENT_RULES) {
    for (const el of all) {
      if (!matchesRule(el, rule)) continue;
      const len = textLength(el);
      if (len >= MIN_SELECTOR_CONTENT) return el;
      if (len > bestLen) {
        best = el;
        bestLen = len;
      }
      break; // first match for this rule, like the Go `[1]`
    }
  }
  return best;
}

/** Semantic fallbacks: <article>, <main>, [role=main] (longest by text). */
function findBySemantic(body: HElement): HElement | null {
  for (const selector of ['article', 'main', '[role="main"]']) {
    const matches = getElementsByTagName(body, selector);
    let best: HElement | null = null;
    let bestLen = 0;
    for (const el of matches) {
      const len = textLength(el);
      if (len > bestLen) {
        best = el;
        bestLen = len;
      }
    }
    if (best && bestLen >= MIN_SELECTOR_CONTENT) return best;
  }
  return null;
}

/**
 * Readability/dom-distiller-style scoring fallback: score block containers by the
 * length of their paragraph text discounted by link density, and return the best.
 */
function findByScoring(body: HElement, opts: CoreOptions): HElement | null {
  const candidates = getElementsByTagName(body, 'div, section, article, main, td');
  let best: HElement | null = null;
  let bestScore = 0;

  for (const el of candidates) {
    const paragraphs = getElementsByTagName(el, 'p');
    if (paragraphs.length === 0) continue;

    let paraText = 0;
    for (const p of paragraphs) paraText += textLength(p);
    if (paraText === 0) continue;

    const { highDensity } = linkDensityTest(el, opts);
    const total = textLength(el);
    const linkRatio = total > 0 ? 1 - paraText / total : 1;
    const score = paraText * (highDensity ? 0.2 : 1) * (1 - Math.min(linkRatio, 0.9));

    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Prune link-dense sections from the chosen subtree (go pruneUnwantedSections,
 * simplified): remove link-heavy lists, headings, and quotes.
 */
export function pruneUnwantedSections(subTree: HElement, opts: CoreOptions): void {
  deleteByLinkDensity(subTree, opts, false, 'ul', 'ol', 'dl');
  deleteByLinkDensity(subTree, opts, true, 'div');
  deleteByLinkDensity(subTree, opts, false, 'h1', 'h2', 'h3', 'h4', 'h5', 'h6');
  deleteByLinkDensity(subTree, opts, false, 'blockquote', 'q');
}

/**
 * Select the main-content element. Cascade: ported content selectors → semantic
 * elements → scoring → the whole body. Never returns null (body is the floor).
 */
export function findContentNode(body: HElement, opts: CoreOptions): HElement {
  if (opts.contentSelectors && opts.contentSelectors.length > 0) {
    const byProfile = findByProfileSelectors(body, opts.contentSelectors);
    if (byProfile) return byProfile;
  }

  const bySelector = findBySelectors(body);
  if (bySelector && textLength(bySelector) >= MIN_SELECTOR_CONTENT) return bySelector;

  const bySemantic = findBySemantic(body);
  if (bySemantic) return bySemantic;

  const byScoring = findByScoring(body, opts);
  if (byScoring) return byScoring;

  // Last resort: the longest selector match, else the body itself.
  return bySelector ?? body;
}

/** Whether a content node has a plausible amount of extractable text. */
export function hasSufficientText(el: HElement): boolean {
  return [...trim(el.textContent)].length > 0 && childElements(el).length >= 0;
}
