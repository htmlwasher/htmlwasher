// SPDX-License-Identifier: Apache-2.0
// JSON-LD extraction ported from trafilatura/json_metadata.py (extract_json,
// process_parent, extract_json_parse_error, the schema sets, and is_plausible_sitename)
// plus the orchestrator's extract_meta_json (metadata.py) — Apache-2.0.

import type { HDocument } from '../core/dom.js';
import type { Metadata, PageType } from '../types.js';
import { normalizeAuthors } from './authors.js';
import { normalizeJson } from './text.js';

const JSON_ARTICLE_SCHEMA = new Set([
  'article',
  'backgroundnewsarticle',
  'blogposting',
  'medicalscholarlyarticle',
  'newsarticle',
  'opinionnewsarticle',
  'reportagenewsarticle',
  'scholarlyarticle',
  'socialmediaposting',
  'liveblogposting',
]);

const JSON_OGTYPE_SCHEMA = new Set([
  'aboutpage',
  'checkoutpage',
  'collectionpage',
  'contactpage',
  'faqpage',
  'itempage',
  'medicalwebpage',
  'profilepage',
  'qapage',
  'realestatelisting',
  'searchresultspage',
  'webpage',
  'website',
  'article',
  'advertisercontentarticle',
  'newsarticle',
  'analysisnewsarticle',
  'askpublicnewsarticle',
  'backgroundnewsarticle',
  'opinionnewsarticle',
  'reportagenewsarticle',
  'reviewnewsarticle',
  'report',
  'satiricalarticle',
  'scholarlyarticle',
  'medicalscholarlyarticle',
  'socialmediaposting',
  'blogposting',
  'liveblogposting',
  'discussionforumposting',
  'techarticle',
  'blog',
  'jobposting',
]);

const JSON_PUBLISHER_SCHEMA = new Set([
  'newsmediaorganization',
  'organization',
  'webpage',
  'website',
]);

const AUTHOR_ATTRS = ['givenName', 'additionalName', 'familyName'] as const;

const JSON_SCHEMA_ORG = /^https?:\/\/schema\.org/i;

// Regex-fallback patterns (extract_json_parse_error) for malformed JSON-LD.
const JSON_AUTHOR_1 =
  /"author":[^}[]+?"name?\\?": ?\\?"([^"\\]+)|"author"[^}[]+?"names?"[\s\S]+?"([^"]+)/;
const JSON_AUTHOR_2 = /"[Pp]erson"[^}]+?"names?"[\s\S]+?"([^"]+)/;
const JSON_AUTHOR_REMOVE =
  /,?(?:"\w+":?[:|,[])?\{?"@type":"(?:[Ii]mageObject|[Oo]rganization|[Ww]eb[Pp]age)",[^}[]+\}[\]|}]?/g;
const JSON_PUBLISHER = /"publisher":[^}]+?"name?\\?": ?\\?"([^"\\]+)/;
const JSON_TYPE = /"@type"\s*:\s*"([^"]*)"/;
const JSON_CATEGORY = /"articleSection": ?"([^"\\]+)/;
const JSON_NAME = /"@type":"[Aa]rticle", ?"name": ?"([^"\\]+)/;
const JSON_HEADLINE = /"headline": ?"([^"\\]+)/;

// JSON_MINIFY: collapse whitespace outside string literals (metadata.py JSON_MINIFY).
const JSON_MINIFY = /("(?:\\.|[^"\\])*")|\s/g;

type JsonValue = unknown;
interface JsonObject {
  [key: string]: JsonValue;
}

function isObject(v: JsonValue): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: JsonValue): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** is_plausible_sitename: decide whether `candidate` should replace the sitename. */
function isPlausibleSitename(
  current: string | undefined,
  candidate: JsonValue,
  contentType?: string,
): candidate is string {
  if (typeof candidate === 'string' && candidate) {
    if (!current || (current.length < candidate.length && contentType !== 'webpage')) {
      return true;
    }
    if (current.startsWith('http') && !candidate.startsWith('http')) {
      return true;
    }
  }
  return false;
}

// Map a JSON-LD schema `@type` token (lowercased) to one of the 7 PageType
// values. trafilatura stores the raw schema string in `metadata.pagetype` and
// leaves the 7-way mapping to its downstream classifier; htmlwasher's Metadata
// only carries the 7 PageType values, so we collapse the schema tokens here.
// The forum / product / collection / documentation buckets follow the structured-
// data signals rs-trafilatura's page_type classifier uses (CollectionPage →
// collection, DiscussionForumPosting → forum, ItemPage → product, TechArticle →
// documentation); everything else in JSON_OGTYPE_SCHEMA is an article-ish page.
const SCHEMA_PAGETYPE: Record<string, PageType> = {
  collectionpage: 'collection',
  searchresultspage: 'collection',
  discussionforumposting: 'forum',
  qapage: 'forum',
  itempage: 'product',
  techarticle: 'documentation',
  jobposting: 'service',
  realestatelisting: 'listing',
};

/** Map a JSON-LD pagetype token (already lowercased) to a PageType, if recognized. */
function toPageType(token: string): PageType | undefined {
  if (token === 'collection') return 'collection';
  return SCHEMA_PAGETYPE[token] ?? (isArticleToken(token) ? 'article' : undefined);
}

/** Whether a schema token represents an article-style page. */
function isArticleToken(token: string): boolean {
  return JSON_OGTYPE_SCHEMA.has(token) && !(token in SCHEMA_PAGETYPE);
}

/** process_parent: extract metadata fields from a flat list of JSON-LD objects. */
function processParent(parents: JsonValue[], metadata: Metadata): void {
  for (const content of parents) {
    if (!isObject(content)) continue;

    const publisher = content.publisher;
    if (isObject(publisher) && isPlausibleSitename(metadata.sitename, publisher.name)) {
      metadata.sitename = publisher.name as string;
    }

    const typeRaw = content['@type'];
    if (typeRaw === undefined || typeRaw === null || typeRaw === '') continue;

    const typeValue = Array.isArray(typeRaw) ? typeRaw[0] : typeRaw;
    const contentType = asString(typeValue)?.toLowerCase();
    if (!contentType) continue;

    if (JSON_OGTYPE_SCHEMA.has(contentType) && !metadata.pageType) {
      const mapped = toPageType(normalizeJson(contentType));
      if (mapped) metadata.pageType = mapped;
    }

    if (JSON_PUBLISHER_SCHEMA.has(contentType)) {
      const candidate = content.name ?? content.legalName ?? content.alternateName;
      if (isPlausibleSitename(metadata.sitename, candidate, contentType)) {
        metadata.sitename = candidate;
      }
    } else if (contentType === 'person') {
      const name = asString(content.name);
      if (name && !name.startsWith('http')) {
        metadata.author = normalizeAuthors(metadata.author, name);
      }
    } else if (JSON_ARTICLE_SCHEMA.has(contentType)) {
      processArticleAuthors(content, metadata);

      if (!metadata.categories && 'articleSection' in content) {
        const section = content.articleSection;
        if (typeof section === 'string') {
          metadata.categories = [section];
        } else if (Array.isArray(section)) {
          metadata.categories = section.filter((x): x is string => typeof x === 'string' && !!x);
        }
      }

      if (!metadata.title) {
        if (contentType === 'article' && typeof content.name === 'string') {
          metadata.title = content.name;
        } else if (typeof content.headline === 'string') {
          metadata.title = content.headline;
        }
      }
    }
  }
}

/** The author/person sub-branch of an article object in process_parent. */
function processArticleAuthors(content: JsonObject, metadata: Metadata): void {
  if (!('author' in content)) return;
  let listAuthors = content.author as JsonValue;

  if (typeof listAuthors === 'string') {
    const asText = listAuthors;
    try {
      listAuthors = JSON.parse(asText) as JsonValue;
    } catch {
      // Not JSON — treat the raw string as a normal author name.
      metadata.author = normalizeAuthors(metadata.author, asText);
    }
  }

  const authors = Array.isArray(listAuthors) ? listAuthors : [listAuthors];
  for (const entry of authors) {
    const author: JsonValue = typeof entry === 'string' ? { name: entry } : entry;
    if (!isObject(author)) continue;
    if ('@type' in author && author['@type'] !== 'Person') continue;

    let authorName: string | undefined;
    if ('name' in author) {
      const name = author.name;
      if (Array.isArray(name)) {
        authorName = name.filter((x): x is string => typeof x === 'string').join('; ');
        authorName = authorName.replace(/^;\s*|\s*;$/g, '');
      } else if (isObject(name) && typeof name.name === 'string') {
        authorName = name.name;
      } else if (typeof name === 'string') {
        authorName = name;
      }
    } else if ('givenName' in author && 'familyName' in author) {
      authorName = AUTHOR_ATTRS.map((k) => author[k])
        .filter((x): x is string => typeof x === 'string')
        .join(' ');
    }

    if (typeof authorName === 'string') {
      metadata.author = normalizeAuthors(metadata.author, authorName);
    }
  }
}

/** extract_json: unwrap @graph / liveBlogUpdate, gate on @context = schema.org, process once. */
function extractJson(schema: JsonValue, metadata: Metadata): void {
  const blocks = Array.isArray(schema) ? schema : [schema];
  const parents: JsonValue[] = [];

  for (const parent of blocks) {
    if (!isObject(parent)) continue;
    const context = parent['@context'];
    if (typeof context !== 'string' || !JSON_SCHEMA_ORG.test(context)) continue;

    if ('@graph' in parent) {
      const graph = parent['@graph'];
      if (Array.isArray(graph)) parents.push(...graph);
      else parents.push(graph);
    } else if (
      typeof parent['@type'] === 'string' &&
      parent['@type'].toLowerCase().includes('liveblogposting') &&
      'liveBlogUpdate' in parent
    ) {
      const updates = parent.liveBlogUpdate;
      if (Array.isArray(updates)) parents.push(...updates);
      else parents.push(updates);
    } else {
      parents.push(parent);
    }
  }

  processParent(parents, metadata);
}

/** Crudely extract author names from malformed JSON-LD text (extract_json_author). */
function extractJsonAuthor(elemText: string, regex: RegExp): string | undefined {
  let authors: string | undefined;
  let text = elemText;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  let match = re.exec(text);
  while (match) {
    const name = match.slice(1).find((g) => g);
    if (!name?.includes(' ')) break;
    authors = normalizeAuthors(authors, name);
    // Remove the first occurrence and re-search (mirrors sub(count=1)).
    text = text.replace(match[0], '');
    re.lastIndex = 0;
    match = re.exec(text);
  }
  return authors ?? undefined;
}

/** extract_json_parse_error: regex fallback when the JSON does not parse. */
function extractJsonParseError(elem: string, metadata: Metadata): void {
  const elemTextAuthor = elem.replace(JSON_AUTHOR_REMOVE, '');
  const author =
    extractJsonAuthor(elemTextAuthor, JSON_AUTHOR_1) ??
    extractJsonAuthor(elemTextAuthor, JSON_AUTHOR_2);
  if (author) metadata.author = author;

  if (elem.includes('@type')) {
    const match = JSON_TYPE.exec(elem);
    if (match?.[1]) {
      const candidate = normalizeJson(match[1].toLowerCase());
      if (JSON_OGTYPE_SCHEMA.has(candidate)) {
        const mapped = toPageType(candidate);
        if (mapped) metadata.pageType = mapped;
      }
    }
  }

  if (elem.includes('"publisher"')) {
    const match = JSON_PUBLISHER.exec(elem);
    if (match?.[1] && !match[1].includes(',')) {
      const candidate = normalizeJson(match[1]);
      if (isPlausibleSitename(metadata.sitename, candidate)) {
        metadata.sitename = candidate;
      }
    }
  }

  if (elem.includes('"articleSection"')) {
    const match = JSON_CATEGORY.exec(elem);
    if (match?.[1]) {
      metadata.categories = [normalizeJson(match[1])];
    }
  }

  for (const [key, regex] of [
    ['"name"', JSON_NAME],
    ['"headline"', JSON_HEADLINE],
  ] as const) {
    if (elem.includes(key) && !metadata.title) {
      const match = regex.exec(elem);
      if (match?.[1]) {
        metadata.title = normalizeJson(match[1]);
        break;
      }
    }
  }
}

/**
 * Parse and extract metadata from every JSON-LD script in the document, mutating
 * `metadata` in place (JSON-LD OVERRIDES OpenGraph/meta per trafilatura). Faithful
 * port of `extract_meta_json`. Malformed blocks fall back to the regex path; a
 * single bad block never throws.
 */
export function extractJsonLd(doc: HDocument, metadata: Metadata): void {
  const scripts = doc.querySelectorAll(
    'script[type="application/ld+json" i], script[type="application/settings+json" i]',
  );
  for (const elem of scripts) {
    const raw = elem.textContent;
    if (!raw) continue;
    const minified = raw.replace(JSON_MINIFY, (_m, str?: string) => str ?? '');
    const elementText = normalizeJson(minified);
    try {
      const schema = JSON.parse(minified) as JsonValue;
      extractJson(schema, metadata);
    } catch {
      extractJsonParseError(elementText, metadata);
    }
  }
}
