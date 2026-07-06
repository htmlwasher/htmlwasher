// SPDX-License-Identifier: Apache-2.0
// Meta-tag extraction ported from trafilatura/metadata.py (examine_meta, the
// METANAME_* / PROPERTY_AUTHOR / METANAME_IMAGE / TWITTER_ATTRS sets, normalize_tags)
// — Apache-2.0. The OpenGraph bootstrap lives in opengraph.ts.

import type { HDocument } from '../core/dom.js';
import type { Metadata } from '../types.js';
import { normalizeAuthors } from './authors.js';
import { extractOpenGraph } from './opengraph.js';
import { stripHtmlTags, trim, unescapeHtml } from './text.js';
import { isValidUrl } from './url.js';

const METANAME_AUTHOR = new Set([
  'article:author',
  'atc-metaauthor',
  'author',
  'authors',
  'byl',
  'citation_author',
  'creator',
  'dc.creator',
  'dc.creator.aut',
  'dc:creator',
  'dcterms.creator',
  'dcterms.creator.aut',
  'dcsext.author',
  'parsely-author',
  'rbauthors',
  'sailthru.author',
  'shareaholic:article_author_name',
]);
const METANAME_DESCRIPTION = new Set([
  'dc.description',
  'dc:description',
  'dcterms.abstract',
  'dcterms.description',
  'description',
  'sailthru.description',
  'twitter:description',
]);
const METANAME_PUBLISHER = new Set([
  'article:publisher',
  'citation_journal_title',
  'copyright',
  'dc.publisher',
  'dc:publisher',
  'dcterms.publisher',
  'publisher',
  'sailthru.publisher',
  'rbpubname',
  'twitter:site',
]);
const METANAME_TAG = new Set([
  'citation_keywords',
  'dcterms.subject',
  'keywords',
  'parsely-tags',
  'shareaholic:keywords',
  'tags',
]);
const METANAME_TITLE = new Set([
  'citation_title',
  'dc.title',
  'dcterms.title',
  'fb_title',
  'headline',
  'parsely-title',
  'sailthru.title',
  'shareaholic:title',
  'rbtitle',
  'title',
  'twitter:title',
]);
const METANAME_IMAGE = new Set([
  'image',
  'og:image',
  'og:image:url',
  'og:image:secure_url',
  'twitter:image',
  'twitter:image:src',
]);
const PROPERTY_AUTHOR = new Set(['author', 'article:author']);
const TWITTER_ATTRS = new Set(['twitter:site', 'application-name']);

const CLEAN_META_TAGS = /["']/g;

/** normalize_tags: strip quote characters and rejoin non-empty comma parts. */
function normalizeTags(tags: string): string {
  const trimmed = trim(unescapeHtml(tags));
  if (!trimmed) return '';
  const cleaned = trimmed.replace(CLEAN_META_TAGS, '');
  return cleaned
    .split(', ')
    .filter((t) => t)
    .join(', ');
}

/**
 * examine_meta: bootstrap from OpenGraph, then walk every `<head> meta[content]`
 * tag and fill title/author/description/sitename/image/tags from property,
 * name, and itemprop attributes. Faithful port of `examine_meta`; returns the
 * accumulated metadata plus the collected tags.
 */
export function examineMeta(doc: HDocument): Metadata {
  const og = extractOpenGraph(doc);
  const metadata: Metadata = {};
  if (og.title) metadata.title = og.title;
  if (og.author) metadata.author = og.author;
  if (og.url) metadata.url = og.url;
  if (og.description) metadata.description = og.description;
  if (og.sitename) metadata.sitename = og.sitename;
  if (og.image) metadata.image = og.image;
  // og:type (pagetype) is consumed only via JSON-LD/normalize in trafilatura; the
  // og pagetype string is not a PageType, so it is intentionally not assigned here.

  // Short-circuit when every meta-derived field is already filled.
  if (
    metadata.title &&
    metadata.author &&
    metadata.url &&
    metadata.description &&
    metadata.sitename &&
    metadata.image
  ) {
    metadata.tags = [];
    return metadata;
  }

  const tags: string[] = [];
  let backupSitename: string | undefined;
  const head = doc.head;
  if (!head) {
    metadata.tags = tags;
    return metadata;
  }

  for (const elem of head.querySelectorAll('meta[content]')) {
    const contentAttr = stripHtmlTags(elem.getAttribute('content') ?? '').trim();
    if (!contentAttr) continue;

    if (elem.hasAttribute('property')) {
      const property = (elem.getAttribute('property') ?? '').toLowerCase();
      if (property.startsWith('og:')) continue;
      if (property === 'article:tag') {
        tags.push(normalizeTags(contentAttr));
      } else if (PROPERTY_AUTHOR.has(property)) {
        metadata.author = normalizeAuthors(metadata.author, contentAttr);
      } else if (property === 'article:publisher') {
        metadata.sitename = metadata.sitename || contentAttr;
      } else if (METANAME_IMAGE.has(property)) {
        metadata.image = metadata.image || contentAttr;
      }
    } else if (elem.hasAttribute('name')) {
      const name = (elem.getAttribute('name') ?? '').toLowerCase();
      if (METANAME_AUTHOR.has(name)) {
        metadata.author = normalizeAuthors(metadata.author, contentAttr);
      } else if (METANAME_TITLE.has(name)) {
        metadata.title = metadata.title || contentAttr;
      } else if (METANAME_DESCRIPTION.has(name)) {
        metadata.description = metadata.description || contentAttr;
      } else if (METANAME_PUBLISHER.has(name)) {
        metadata.sitename = metadata.sitename || contentAttr;
      } else if (METANAME_IMAGE.has(name)) {
        metadata.image = metadata.image || contentAttr;
      } else if (TWITTER_ATTRS.has(name) || name.includes('twitter:app:name')) {
        backupSitename = contentAttr;
      } else if (name === 'twitter:url' && !metadata.url && isValidUrl(contentAttr)) {
        metadata.url = contentAttr;
      } else if (METANAME_TAG.has(name)) {
        tags.push(normalizeTags(contentAttr));
      }
    } else if (elem.hasAttribute('itemprop')) {
      const itemprop = (elem.getAttribute('itemprop') ?? '').toLowerCase();
      if (itemprop === 'author') {
        metadata.author = normalizeAuthors(metadata.author, contentAttr);
      } else if (itemprop === 'description') {
        metadata.description = metadata.description || contentAttr;
      } else if (itemprop === 'headline') {
        metadata.title = metadata.title || contentAttr;
      }
    }
  }

  metadata.sitename = metadata.sitename || backupSitename;
  metadata.tags = tags;
  return metadata;
}
