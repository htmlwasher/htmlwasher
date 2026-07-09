// SPDX-License-Identifier: Apache-2.0
// Metadata extraction orchestrator. Faithful port of trafilatura/metadata.py
// `extract_metadata`: examine_meta (OpenGraph → meta tags) → drop a space-less
// author → JSON-LD → title → author → url → hostname → date → sitename →
// categories → tags → license → clean_and_trim.
//
// Per-field merge (NOT a blanket override): meta/OpenGraph (examine_meta) fill
// first, then JSON-LD fills empty title/categories/pageType, APPENDS authors
// (normalizeAuthors), and conditionally replaces sitename (isPlausibleSitename)
// — it does NOT override an already-set title and never touches description.
// DOM/XPath then fills any remaining empties.

import type { Metadata } from '../types.js';
import { extractAuthor } from './author-dom.js';
import { checkAuthors } from './authors.js';
import { extractCatsTags } from './catstags.js';
import { extractDate } from './date.js';
import { type HDocument, parseDocument } from './dom.js';
import { extractJsonLd } from './json-ld.js';
import { extractLicense } from './license.js';
import { examineMeta } from './meta-tags.js';
import { normalizeSitename } from './sitename.js';
import { lineProcessing, unescapeHtml } from './text.js';
import { extractTitle } from './title.js';
import { extractDomain, extractUrl } from './url.js';

/** The string-valued Metadata fields clean_and_trim normalizes. */
const STRING_FIELDS = [
  'title',
  'author',
  'url',
  'hostname',
  'description',
  'sitename',
  'date',
  'license',
] as const;

/**
 * Faithful port of `Document.clean_and_trim` (trafilatura/settings.py:300-309),
 * the final step of `extract_metadata`. For every string field: cap the length
 * to 10000 chars FIRST, THEN run `line_processing(unescape(value))` — order
 * matters. This decodes HTML entities and normalizes whitespace (it does NOT
 * strip tags, matching canonical) and bounds field length (brief Security).
 * `lineProcessing` returns undefined for an all-whitespace result.
 */
function cleanAndTrim(metadata: Metadata): void {
  for (const key of STRING_FIELDS) {
    let value = metadata[key];
    if (typeof value !== 'string') continue;
    if (value.length > 10000) value = `${value.slice(0, 9999)}…`;
    metadata[key] = lineProcessing(unescapeHtml(value));
  }
}

/** Drop empty-string and empty-array fields so the result is a clean sidecar. */
function pruneEmpty(metadata: Metadata): Metadata {
  const out: Metadata = {};
  if (metadata.title) out.title = metadata.title;
  if (metadata.author) out.author = metadata.author;
  if (metadata.url) out.url = metadata.url;
  if (metadata.hostname) out.hostname = metadata.hostname;
  if (metadata.description) out.description = metadata.description;
  if (metadata.sitename) out.sitename = metadata.sitename;
  if (metadata.date) out.date = metadata.date;
  if (metadata.categories && metadata.categories.length > 0) out.categories = metadata.categories;
  if (metadata.tags && metadata.tags.length > 0) out.tags = metadata.tags;
  if (metadata.image) out.image = metadata.image;
  if (metadata.pageType) out.pageType = metadata.pageType;
  if (metadata.license) out.license = metadata.license;
  return out;
}

/**
 * Extract metadata from an already-parsed document. `url` is the previously
 * known/default URL (context only — never fetched). Faithful port of
 * `extract_metadata`'s field order and precedence.
 */
function extractMetadataFromDocument(
  doc: HDocument,
  url?: string,
  authorBlacklist?: ReadonlySet<string>,
): Metadata {
  // meta tags (OpenGraph bootstrap + name/property/itemprop passes)
  const metadata = examineMeta(doc);

  // drop a single-word author (likely a site/section, not a person)
  if (metadata.author && !metadata.author.includes(' ')) {
    metadata.author = undefined;
  }

  // JSON-LD: fill-if-empty title/categories/pageType, append authors,
  // conditionally replace sitename; never throws on malformed input.
  try {
    extractJsonLd(doc, metadata);
  } catch {
    // bugs in JSON metadata extraction are non-fatal (LOGGER.warning upstream)
  }

  // title
  if (!metadata.title) {
    metadata.title = extractTitle(doc);
  }

  // author (with optional blacklist re-checks around the DOM fallback)
  if (metadata.author && authorBlacklist && authorBlacklist.size > 0) {
    metadata.author = checkAuthors(metadata.author, authorBlacklist);
  }
  if (!metadata.author) {
    metadata.author = extractAuthor(doc);
  }
  if (metadata.author && authorBlacklist && authorBlacklist.size > 0) {
    metadata.author = checkAuthors(metadata.author, authorBlacklist);
  }

  // url
  if (!metadata.url) {
    metadata.url = extractUrl(doc, url);
  }

  // hostname
  if (metadata.url) {
    metadata.hostname = extractDomain(metadata.url);
  }

  // date (reduced htmldate equivalent)
  metadata.date = extractDate(doc, metadata.url);

  // sitename (normalize / backfill from URL host)
  metadata.sitename = normalizeSitename(doc, metadata.sitename, metadata.url);

  // categories
  if (!metadata.categories || metadata.categories.length === 0) {
    metadata.categories = extractCatsTags('category', doc);
  }

  // tags
  if (!metadata.tags || metadata.tags.length === 0) {
    metadata.tags = extractCatsTags('tag', doc);
  }

  // license
  metadata.license = extractLicense(doc);

  // clean_and_trim: cap each string field then unescape + line-process.
  cleanAndTrim(metadata);

  return pruneEmpty(metadata);
}

/** Parse `html` and extract metadata. Convenience wrapper over `parseDocument`. */
export function extractMetadata(
  html: string,
  url?: string,
  authorBlacklist?: ReadonlySet<string>,
): Metadata {
  const doc = parseDocument(html);
  return extractMetadataFromDocument(doc, url, authorBlacklist);
}
