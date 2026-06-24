// SPDX-License-Identifier: Apache-2.0
// DOM-fallback author extraction ported from trafilatura/metadata.py
// (extract_author) plus AUTHOR_XPATHS / AUTHOR_DISCARD_XPATHS from
// trafilatura/xpaths.py — Apache-2.0. The XPaths are translated to a faithful
// CSS-selector subset; regex class/id predicates are approximated with
// `[attr*=… i]` substring selectors plus the explicit token cases.

import { type HDocument, type HElement, trim } from '../core/dom.js';
import { normalizeAuthors } from './authors.js';

// AUTHOR_DISCARD_XPATHS → CSS. Drops comment/sidebar/quote/figure/time blocks
// before author probing so bylines inside them are not picked up.
//   .//*[self::a or self::div or self::section or self::span][
//       @id='comments' or @class='comments' or @class='title' or @class='date' or
//       re:test(@id,'^comments|comment-?list|ProductReviews') or
//       re:test(@class,'^[Cc]omments|commentlist|comments-list|sidebar|is-hidden|quote|...') or
//       contains(@data-component,'Figure')]
//   //time|//figure
const AUTHOR_DISCARD_SELECTORS: string[] = [
  'a[id="comments"], div[id="comments"], section[id="comments"], span[id="comments"]',
  'a[class="comments"], div[class="comments"], section[class="comments"], span[class="comments"]',
  'a[class="title"], div[class="title"], section[class="title"], span[class="title"]',
  'a[class="date"], div[class="date"], section[class="date"], span[class="date"]',
  '[id*="comment" i], [id*="ProductReviews" i]',
  '[class*="comment" i], [class*="sidebar" i], [class*="is-hidden" i], [class*="quote" i], ' +
    '[class*="embedly-instagram" i], [class*="article-share" i], [class*="article-support" i], ' +
    '[class*="print" i], [class*="category" i], [class*="meta-date" i], [class*="meta-reviewer" i]',
  '[data-component*="Figure" i]',
  'time, figure',
];

// AUTHOR_XPATHS → CSS, in priority order (specific → generic).
const AUTHOR_SELECTORS: string[] = [
  // specific and almost specific
  'a[rel="author" i], address[rel="author" i], div[rel="author" i], link[rel="author" i], ' +
    'p[rel="author" i], span[rel="author" i], strong[rel="author" i], ' +
    'a[id="author"], div[id="author"], p[id="author"], span[id="author"], strong[id="author"], ' +
    'a[class="author"], div[class="author"], p[class="author"], span[class="author"], strong[class="author"], ' +
    '[itemprop="author name"], [data-testid="AuthorCard"], [data-testid="AuthorURL"], ' +
    'a[class*="author-name" i], a[class*="authorname" i], ' +
    'span[class*="author-name" i], span[class*="authorname" i], ' +
    'div[class*="author-name" i], p[class*="author-name" i], strong[class*="author-name" i], author',
  // almost generic and generic
  'a[class="byline"], div[class="byline"], h3[class="byline"], h4[class="byline"], ' +
    'p[class="byline"], span[class="byline"], [class="username"], [class="byl"], [class="BBL"], ' +
    '[itemprop*="author" i], [id*="author" i], [class*="author" i], [class*="channel-name" i], ' +
    '[class*="submitted-by" i], [class*="posted-by" i], [class*="journalist-name" i]',
  // last resort: any element
  '[data-component*="Byline" i], [itemprop*="author" i], [id*="author" i], ' +
    '[class*="author" i], [class*="screenname" i], [class*="writer" i], [class*="byline" i]',
];

/** prune_unwanted_nodes: remove AUTHOR_DISCARD matches from a clone before probing. */
function pruneAuthorDiscards(root: HElement): void {
  for (const selector of AUTHOR_DISCARD_SELECTORS) {
    for (const el of Array.from(root.querySelectorAll(selector))) {
      el.remove();
    }
  }
}

/**
 * extract_author: clone the tree, prune discard sections, then probe the author
 * selectors in order for the first short text (2 < len < 120), normalize it.
 * Faithful port of `extract_author` + `extract_metainfo(len_limit=120)`.
 */
export function extractAuthor(doc: HDocument): string | undefined {
  const root = doc.body ?? doc.documentElement;
  if (!root) return undefined;
  const clone = root.cloneNode(true);
  pruneAuthorDiscards(clone);

  for (const selector of AUTHOR_SELECTORS) {
    for (const elem of clone.querySelectorAll(selector)) {
      const content = trim(elem.textContent);
      if (content && content.length > 2 && content.length < 120) {
        return normalizeAuthors(undefined, content);
      }
    }
  }
  return undefined;
}
