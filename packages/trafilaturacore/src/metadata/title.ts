// SPDX-License-Identifier: Apache-2.0
// Title extraction ported from trafilatura/metadata.py (extract_title,
// examine_title_element, extract_metainfo, HTMLTITLE_REGEX) and TITLE_XPATHS
// from trafilatura/xpaths.py — Apache-2.0.

import { type HDocument, trim } from './dom.js';
import { selectMetaInfo } from './xpath-css.js';

// HTMLTITLE_REGEX: split "Article — Site" style titles into the two parts.
const HTMLTITLE_REGEX = /^(.+)?\s+[–•·—|⁄*⋆~‹«<›»>:-]\s+(.+)$/;

/** examine_title_element result: the full title and the two split parts. */
interface TitleParts {
  title: string;
  first?: string;
  second?: string;
}

/** examine_title_element: pull text segments out of the main `<head><title>`. */
export function examineTitleElement(doc: HDocument): TitleParts {
  const titleElement = doc.querySelector('head title') ?? doc.querySelector('title');
  if (titleElement) {
    const title = trim(titleElement.textContent);
    const match = HTMLTITLE_REGEX.exec(title);
    if (match) {
      return { title, first: match[1], second: match[2] };
    }
    return { title };
  }
  return { title: '' };
}

// TITLE_XPATHS translated to CSS-selector + predicate pairs (see xpath-css.ts).
// Faithful subset; the regex-heavy class tests are approximated with substring
// matches plus the explicit class/id token cases trafilatura lists.
const TITLE_SELECTORS: string[] = [
  // //*[self::h1 or self::h2][re:test(@class,'(?:post-|entry-|article-|post__)title|headline')
  //   or contains(@id,'headline') or contains(@itemprop,'headline')]
  'h1[class*="title" i], h2[class*="title" i], h1[class*="headline" i], h2[class*="headline" i], ' +
    'h1[id*="headline" i], h2[id*="headline" i], h1[itemprop*="headline" i], h2[itemprop*="headline" i]',
  // //*[@class='entry-title' or @class='post-title']
  '[class="entry-title"], [class="post-title"]',
  // //*[self::h1 or self::h2 or self::h3][contains(@class,'title') or contains(@id,'title')]
  'h1[class*="title" i], h2[class*="title" i], h3[class*="title" i], ' +
    'h1[id*="title" i], h2[id*="title" i], h3[id*="title" i]',
];

/** extract_title: faithful port of `extract_title`. */
export function extractTitle(doc: HDocument): string | undefined {
  const root = doc.body ?? doc.documentElement;
  if (!root) return undefined;

  const h1Results = Array.from(root.querySelectorAll('h1'));

  // Only one h1: take it.
  if (h1Results.length === 1) {
    const only = h1Results[0];
    const title = only ? trim(only.textContent) : '';
    if (title) return title;
  }

  // Extract using the title selectors.
  const viaSelectors = selectMetaInfo(doc, TITLE_SELECTORS, 200);
  if (viaSelectors) return viaSelectors;

  // Extract using the <title> tag, preferring a dot-free segment.
  const { title, first, second } = examineTitleElement(doc);
  for (const t of [first, second, title]) {
    if (t && !t.includes('.')) return t;
  }

  // First non-empty h1.
  for (const h1 of h1Results) {
    const t = trim(h1.textContent);
    if (t) return t;
  }

  // First h2.
  const h2 = root.querySelector('h2');
  const h2Title = h2 ? trim(h2.textContent) : '';
  return h2Title || title || undefined;
}
