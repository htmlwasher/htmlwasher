// SPDX-License-Identifier: Apache-2.0
// Stage-1 URL heuristics — `classify_url` (rs-trafilatura page_type/mod.rs), ordered
// first-match-wins. Empty URL → article. The constant lists are the mod.rs lists in
// `./url-constants.ts` (NOT web-page-classifier's divergent url_heuristics.rs).

import type { PageType } from '../types.js';
import {
  ARTICLE_PATHS,
  BLOG_SLUG_PATTERNS,
  CATEGORY_PATHS,
  containsAny,
  DOCS_DOMAINS,
  DOCS_PATHS,
  extractDomainPath,
  FORUM_DOMAINS,
  FORUM_PATHS,
  FORUM_URL_PATTERNS,
  LISTING_PATH_CONTAINS,
  LISTING_PATH_ENDINGS,
  PRODUCT_DOMAINS,
  PRODUCT_PATHS,
  SERVICE_PATHS,
  SERVICE_SLUG_PATTERNS,
} from './url-constants.js';

function trimEnd(s: string, ch: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === ch) end -= 1;
  return s.slice(0, end);
}

/**
 * Stage-1 classification from the URL alone. Ordered checks, first match wins.
 * Returns the wire string `'collection'` for the rs-trafilatura `Category` variant.
 */
export function classifyUrl(url: string): PageType {
  if (url === '') return 'article';

  const urlLower = url.toLowerCase();
  const { domain, path } = extractDomainPath(urlLower);

  // Forum.
  if (
    containsAny(domain, FORUM_DOMAINS) ||
    containsAny(path, FORUM_PATHS) ||
    containsAny(urlLower, FORUM_URL_PATTERNS)
  ) {
    return 'forum';
  }

  // Documentation (before article, so `/docs/guide/` is docs).
  if (containsAny(domain, DOCS_DOMAINS) || containsAny(path, DOCS_PATHS)) {
    return 'documentation';
  }

  // Product (before category). Stage-1 uses PRODUCT_DOMAINS too.
  if (containsAny(path, PRODUCT_PATHS) || containsAny(domain, PRODUCT_DOMAINS)) {
    return 'product';
  }

  // Category → wire string "collection".
  if (containsAny(path, CATEGORY_PATHS)) {
    return 'collection';
  }

  // Service.
  if (containsAny(path, SERVICE_PATHS) || containsAny(urlLower, SERVICE_SLUG_PATTERNS)) {
    return 'service';
  }

  // Listing (suffix endings on trimmed path, or contains patterns).
  const pathTrimmed = trimEnd(path, '/');
  if (
    LISTING_PATH_ENDINGS.some((p) => pathTrimmed.endsWith(p)) ||
    containsAny(path, LISTING_PATH_CONTAINS)
  ) {
    return 'listing';
  }

  // Article.
  if (containsAny(path, ARTICLE_PATHS) || containsAny(urlLower, BLOG_SLUG_PATTERNS)) {
    return 'article';
  }

  // Default.
  return 'article';
}
