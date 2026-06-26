// SPDX-License-Identifier: Apache-2.0
// Category/tag extraction ported from trafilatura/metadata.py (extract_catstags)
// plus CATEGORIES_XPATHS / TAGS_XPATHS from trafilatura/xpaths.py — Apache-2.0.
// The XPaths are translated to a faithful CSS-selector subset; the regex
// `starts-with`/`re:test` class predicates are approximated with attribute
// substring/prefix selectors. The href filter regex is kept verbatim.

import type { HDocument } from '../core/dom.js';
import { dedupeOrdered, lineProcessing } from './text.js';

type MetaType = 'category' | 'tag';

// CATEGORIES_XPATHS → CSS (descendant `a[href]` of meta/postmeta containers).
const CATEGORIES_SELECTORS: string[] = [
  'div[class^="post-info" i] a[href], div[class^="postinfo" i] a[href], ' +
    'div[class^="post-meta" i] a[href], div[class^="postmeta" i] a[href], ' +
    'div[class^="meta" i] a[href], div[class^="entry-meta" i] a[href], ' +
    'div[class^="entry-info" i] a[href], div[class^="entry-utility" i] a[href], ' +
    'div[id^="postpath"] a[href]',
  'p[class^="postmeta"] a[href], p[class^="entry-categories"] a[href], ' +
    'p[class="postinfo"] a[href], p[id="filedunder"] a[href]',
  'footer[class^="entry-meta"] a[href], footer[class^="entry-footer"] a[href]',
  'li[class="post-category"] a[href], li[class="postcategory"] a[href], ' +
    'li[class="entry-category"] a[href], li[class*="cat-links" i] a[href], ' +
    'span[class="post-category"] a[href], span[class="postcategory"] a[href], ' +
    'span[class="entry-category"] a[href], span[class*="cat-links" i] a[href]',
  'header[class="entry-header"] a[href]',
  'div[class="row"] a[href], div[class="tags"] a[href]',
];

// TAGS_XPATHS → CSS.
const TAGS_SELECTORS: string[] = [
  'div[class="tags"] a[href]',
  'p[class^="entry-tags"] a[href]',
  'div[class="row"] a[href], div[class="jp-relatedposts"] a[href], ' +
    'div[class="entry-utility"] a[href], div[class^="tag" i] a[href], ' +
    'div[class^="postmeta" i] a[href], div[class^="meta" i] a[href]',
  '[class="entry-meta"] a[href], [class*="topics" i] a[href], [class*="tags-links" i] a[href]',
];

// CATEGORY fallback: //head//meta[@property="article:section" or contains(@name,"subject")][@content]
const CATEGORY_FALLBACK_SELECTOR =
  'head meta[property="article:section"][content], head meta[name*="subject" i][content]';

/**
 * extract_catstags: collect category/tag link text whose href matches the
 * `/category(?:y|ies|s)?/` (or `/tag…/`) pattern; for categories, fall back to
 * the article:section / subject meta tags. Faithful port of `extract_catstags`.
 */
export function extractCatsTags(metaType: MetaType, doc: HDocument): string[] {
  const root = doc.body ?? doc.documentElement;
  const head = doc.head;
  const results: string[] = [];

  // "/" + metatype.rstrip("y") + "(?:y|ies|s)?/"  → /categor(?:y|ies|s)?/ , /tag(?:y|ies|s)?/
  const stem = metaType.replace(/y$/, '');
  const hrefRegex = new RegExp(`/${stem}(?:y|ies|s)?/`);
  const selectors = metaType === 'category' ? CATEGORIES_SELECTORS : TAGS_SELECTORS;

  if (root) {
    for (const selector of selectors) {
      for (const elem of root.querySelectorAll(selector)) {
        const href = elem.getAttribute('href') ?? '';
        if (hrefRegex.test(href)) {
          results.push(elem.textContent);
        }
      }
      if (results.length > 0) break;
    }
  }

  // Category fallback via meta tags.
  if (metaType === 'category' && results.length === 0 && head) {
    for (const element of head.querySelectorAll(CATEGORY_FALLBACK_SELECTOR)) {
      const content = element.getAttribute('content');
      if (content) results.push(content);
    }
  }

  const processed = results
    .map((x) => (x ? lineProcessing(x) : undefined))
    .filter((x): x is string => !!x);
  return dedupeOrdered(processed);
}
