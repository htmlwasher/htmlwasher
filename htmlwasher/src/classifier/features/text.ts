// SPDX-License-Identifier: Apache-2.0
// `title_meta_text` — the ONLY TF-IDF input, a deliberately simplified `title_meta`
// (see `training/extract_features.py::title_meta_text`). It is `<title>` text +
// the first present meta description, joined by a single space. The TS runtime MUST
// reproduce THIS simplified logic (not the full metadata extractor) so the TF-IDF
// vocabulary matches what the model was trained on.

import { type HDocument, parseDocumentSpec } from '../../core/dom.js';
import { nodeText } from './dom-query.js';

// meta-tag routing keys (rs-trafilatura metadata/meta_tags.rs, first-wins per group).
const DESCRIPTION_KEYS = [
  'description',
  'og:description',
  'twitter:description',
  'dc.description',
  'excerpt',
] as const;

const OG_TYPE_KEY = 'og:type';

/**
 * Resolve first-wins meta values keyed by `name||property||itemprop||http-equiv`
 * (lowercased). Empty key/content rows are skipped; the FIRST meta in document
 * order wins per key. Mirrors the Python `_scan_meta`.
 */
export function scanMeta(doc: HDocument): Map<string, string> {
  const out = new Map<string, string>();
  for (const meta of doc.querySelectorAll('meta')) {
    const key = (
      meta.getAttribute('name') ??
      meta.getAttribute('property') ??
      meta.getAttribute('itemprop') ??
      meta.getAttribute('http-equiv') ??
      ''
    ).toLowerCase();
    const content = meta.getAttribute('content') ?? '';
    if (!key || !content) continue;
    if (!out.has(key)) out.set(key, content);
  }
  return out;
}

/** Raw `og:type` content, lowercased (Python `_og_type`); empty string when absent. */
export function ogType(doc: HDocument): string {
  return (scanMeta(doc).get(OG_TYPE_KEY) ?? '').toLowerCase();
}

/**
 * Compute `title_meta_text` from a parsed document — the simplified `title_meta`.
 * `title` is the `<title>` element text (trimmed); `description` is the first
 * present meta value among DESCRIPTION_KEYS (trimmed).
 */
export function titleMetaTextFromDoc(doc: HDocument): string {
  const titleNode = doc.querySelector('title');
  const title = titleNode ? nodeText(titleNode).trim() : '';

  const meta = scanMeta(doc);
  let description = '';
  for (const key of DESCRIPTION_KEYS) {
    const value = meta.get(key);
    if (value !== undefined) {
      description = value.trim();
      break;
    }
  }

  return `${title} ${description}`;
}

/** Return `"{title} {description}"` from raw HTML — the only TF-IDF input. */
export function titleMetaText(html: string): string {
  return titleMetaTextFromDoc(parseDocumentSpec(html));
}
