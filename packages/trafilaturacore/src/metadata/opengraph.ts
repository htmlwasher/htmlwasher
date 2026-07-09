// SPDX-License-Identifier: Apache-2.0
// OpenGraph extraction ported from trafilatura/metadata.py (extract_opengraph,
// OG_PROPERTIES, OG_AUTHOR) — Apache-2.0.

import { normalizeAuthors } from './authors.js';
import type { HDocument } from './dom.js';
import { isValidUrl } from './url.js';

/** Fields the OpenGraph pass can populate (mirrors the bootstrap dict). */
interface OpenGraphResult {
  title?: string;
  author?: string;
  url?: string;
  description?: string;
  sitename?: string;
  image?: string;
  pagetype?: string;
}

/** og: property → metadata field (trafilatura OG_PROPERTIES). */
const OG_PROPERTIES: Record<string, keyof OpenGraphResult> = {
  'og:title': 'title',
  'og:description': 'description',
  'og:site_name': 'sitename',
  'og:image': 'image',
  'og:image:url': 'image',
  'og:image:secure_url': 'image',
  'og:type': 'pagetype',
};

const OG_AUTHOR = new Set(['og:author', 'og:article:author']);

/**
 * Search head meta tags following the OpenGraph guidelines (https://ogp.me/).
 * Faithful port of `extract_opengraph`. Selector translates the XPath
 * `.//head/meta[starts-with(@property, "og:")]` to `head meta[property^="og:"]`.
 */
export function extractOpenGraph(doc: HDocument): OpenGraphResult {
  const result: OpenGraphResult = {};
  const head = doc.head;
  if (!head) return result;

  for (const elem of head.querySelectorAll('meta[property^="og:"]')) {
    const propertyName = elem.getAttribute('property');
    const content = elem.getAttribute('content');
    if (!propertyName || content === null || content.trim().length === 0) continue;

    const field = OG_PROPERTIES[propertyName];
    if (field) {
      result[field] = content;
    } else if (propertyName === 'og:url' && isValidUrl(content)) {
      result.url = content;
    } else if (OG_AUTHOR.has(propertyName)) {
      result.author = normalizeAuthors(undefined, content);
    }
  }
  return result;
}
