// SPDX-License-Identifier: Apache-2.0
// The 89 numeric features f[0..89], a byte-for-byte port of
// `training/extract_features.py::extract_numeric_features`. Read that file (and
// FEATURES.md) for the per-index spec; every documented quirk is replicated here.
//
// PARITY RULES (honored throughout):
// - Every length is a UTF-8 BYTE length (`blen`), never JS UTF-16 `.length`.
// - The 500_000-byte body-text gate is a strict `>` early return leaving f[63..89] = 0.
// - `[class*='x']` is a case-sensitive attribute-substring match (linkedom honors this).
// - DOM text is pure descendant-text concatenation (`textContent`, no separator).

import { type HDocument, type HElement, parseDocumentSpec } from '../../core/dom.js';
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
  PRODUCT_PATHS,
  SERVICE_PATHS,
  SERVICE_SLUG_PATTERNS,
} from '../url-constants.js';
import {
  blen,
  descendantCount,
  elementChildren,
  nodeText,
  select,
  selectionText,
  selectLen,
} from './dom-query.js';
import { ogType } from './text.js';

export const N_NUMERIC = 89;

// f[84]: regex matched against the lowercased body text.
const PRODUCT_COUNT_RE = /\d+\s*(results|items|products|pieces)/;

// Vocabulary-density word lists (f[75..78]).
const COMMERCIAL_WORDS = [
  'price',
  'buy',
  'cart',
  'shop',
  'order',
  'shipping',
  'delivery',
  'stock',
  'sale',
  'discount',
  'offer',
  'deal',
  'checkout',
  'payment',
  'warranty',
  'returns',
  'refund',
] as const;
const CONTENT_WORDS = [
  'posted',
  'author',
  'published',
  'updated',
  'comments',
  'share',
  'tweet',
  'read',
  'article',
  'blog',
  'opinion',
  'editor',
  'journalist',
  'source',
  'according',
] as const;
const TECH_WORDS = [
  'api',
  'function',
  'parameter',
  'returns',
  'example',
  'syntax',
  'reference',
  'deprecated',
  'version',
  'module',
  'class',
  'method',
  'interface',
  'configuration',
  'install',
] as const;
const FORUM_WORDS = [
  'reply',
  'thread',
  'post',
  'member',
  'joined',
  'reputation',
  'moderator',
  'admin',
  'quote',
  'likes',
  'views',
  'topic',
  'answered',
  'solution',
  'vote',
  'upvote',
] as const;
const DOM_SIG_KEYWORDS = [
  'item',
  'card',
  'product',
  'post',
  'entry',
  'result',
  'row',
  'cell',
] as const;
const CTA_PHRASES = [
  'get started',
  'free trial',
  'contact us',
  'sign up',
  'try free',
  'get pricing',
  'book a',
  'schedule',
] as const;

// CPython's whitespace set for `str.split()`/`str.strip()` with no arg. It is NOT
// the JS `\s` / `String.trim()` set: CPython treats U+001C..U+001F and U+0085 as
// whitespace (JS does not), and JS treats U+FEFF (the BOM) as whitespace (CPython
// does NOT). We enumerate the exact codepoints by char code (never a literal exotic
// glyph) and use this ONE class for split + strip in both numeric.ts and
// html-signals.ts so tokenization stays byte-for-byte with the Python extractor.
// Codepoints: tab, newline, U+000B, U+000C, CR, U+001C..U+001F, space, U+0085,
// U+00A0, U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000.
const PY_WS_CODEPOINTS = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000,
] as const;

/** Shared CPython-whitespace regex character-class body (no surrounding `[]`). */
export const PY_WS_CLASS = PY_WS_CODEPOINTS.map(
  (cp) => `\\u${cp.toString(16).padStart(4, '0')}`,
).join('');

const PY_WS_SPLIT_RE = new RegExp(`[${PY_WS_CLASS}]+`);
const PY_WS_LEADING_RE = new RegExp(`^[${PY_WS_CLASS}]+`);
const PY_WS_TRAILING_RE = new RegExp(`[${PY_WS_CLASS}]+$`);

/**
 * Python `str.split()` with no args: split on runs of CPython whitespace and drop
 * leading/trailing empty tokens. NOT `String.trim()`/`\s` — see `PY_WS_CODEPOINTS`.
 */
export function splitWhitespace(s: string): string[] {
  const stripped = strip(s);
  if (stripped === '') return [];
  return stripped.split(PY_WS_SPLIT_RE);
}

/**
 * Python `str.strip()`: strip a leading/trailing run of CPython whitespace. NOT
 * `String.trim()` — `.trim()` also strips U+FEFF (the BOM), which Python keeps.
 */
export function strip(s: string): string {
  return s.replace(PY_WS_LEADING_RE, '').replace(PY_WS_TRAILING_RE, '');
}

/** Lowercased tag name (e.g. `h2`, `div`). Python reads `node.tag`. */
function tagName(el: HElement): string {
  return el.localName.toLowerCase();
}

export function extractNumericFeatures(html: string, url: string): number[] {
  const f = new Array<number>(N_NUMERIC).fill(0);

  const urlLower = url.toLowerCase();
  const { domain, path } = extractDomainPath(urlLower);

  // === f[0..14]: URL pattern features ===
  f[0] = containsAny(domain, FORUM_DOMAINS) ? 1 : 0;
  f[1] = containsAny(path, FORUM_PATHS) ? 1 : 0;
  f[2] = containsAny(urlLower, FORUM_URL_PATTERNS) ? 1 : 0;
  f[3] = containsAny(domain, DOCS_DOMAINS) ? 1 : 0;
  f[4] = containsAny(path, DOCS_PATHS) ? 1 : 0;
  f[5] = containsAny(path, PRODUCT_PATHS) ? 1 : 0;
  f[6] = containsAny(path, CATEGORY_PATHS) ? 1 : 0;
  f[7] = containsAny(path, SERVICE_PATHS) ? 1 : 0;
  f[8] = containsAny(urlLower, SERVICE_SLUG_PATTERNS) ? 1 : 0;
  f[9] = containsAny(path, ARTICLE_PATHS) ? 1 : 0;
  f[10] = containsAny(urlLower, BLOG_SLUG_PATTERNS) ? 1 : 0;
  const pathTrimmed = trimEnd(path, '/');
  f[11] = LISTING_PATH_ENDINGS.some((p) => pathTrimmed.endsWith(p)) ? 1 : 0;
  f[12] = containsAny(path, LISTING_PATH_CONTAINS) ? 1 : 0;
  f[13] = domain.includes('shop.') || domain.includes('store.') ? 1 : 0;

  const doc: HDocument = parseDocumentSpec(html);

  // === f[14..63]: HTML structural features ===

  // Paragraph stats (trimmed byte-length > 20).
  let pCount = 0;
  let pTotalLen = 0;
  for (const node of select(doc, 'p')) {
    const trimmed = strip(nodeText(node));
    const len = blen(trimmed);
    if (len > 20) {
      pCount += 1;
      pTotalLen += len;
    }
  }
  f[14] = pCount;
  f[15] = pCount > 0 ? pTotalLen / pCount : 0;
  f[16] = selectLen(doc, 'h1, h2, h3, h4, h5, h6');
  const h2Count = selectLen(doc, 'h2');
  const bodyNodes = select(doc, 'body');
  const bodyTextFull = selectionText(bodyNodes);
  const bodyTextLen = blen(bodyTextFull);
  f[17] = h2Count > 0 ? bodyTextLen / h2Count : 0;
  f[18] = selectLen(doc, 'article') > 0 ? 1 : 0;
  f[19] = selectLen(doc, 'time') > 0 ? 1 : 0;
  f[20] = selectLen(doc, 'main') > 0 ? 1 : 0;
  f[21] = selectLen(doc, 'aside') > 0 ? 1 : 0;
  f[22] =
    selectLen(doc, 'meta[name="author"], meta[property="article:author"], [class*="author"]') > 0
      ? 1
      : 0;

  // JSON-LD signals (substring match on raw script text; quotes are part of needle).
  for (const node of select(doc, 'script[type="application/ld+json"]')) {
    const text = nodeText(node);
    if (
      text.includes('"Article"') ||
      text.includes('"NewsArticle"') ||
      text.includes('"BlogPosting"')
    )
      f[23] = 1;
    if (text.includes('"Product"')) f[24] = 1;
    if (text.includes('"FAQPage"')) f[25] = 1;
    if (text.includes('"CollectionPage"') || text.includes('"OfferCatalog"')) f[26] = 1;
    if (text.includes('"ItemList"')) f[27] = 1;
    if (text.includes('"LocalBusiness"')) f[28] = 1;
    if (text.includes('"Service"')) f[29] = 1;
    if (text.includes('"AggregateOffer"')) f[30] = 1;
  }

  const og = ogType(doc);
  f[31] = og.includes('product') ? 1 : 0;
  f[32] = og === 'article' ? 1 : 0;
  f[33] = og === 'website' ? 1 : 0;
  f[34] =
    selectLen(doc, "[class*='product-grid'], [class*='product-list'], [class*='product-card']") > 0
      ? 1
      : 0;
  f[35] =
    selectLen(doc, "[class*='add-to-cart'], [class*='addtocart'], [class*='buy-now']") > 0 ? 1 : 0;
  f[36] = selectLen(
    doc,
    "[class*='product-card'], [class*='product-tile'], [class*='product-item']",
  );
  f[37] = selectLen(doc, "link[rel='next'], [class*='pagination'], [class*='pager']") > 0 ? 1 : 0;
  f[38] = selectLen(doc, 'code, pre');
  f[39] =
    selectLen(
      doc,
      "[class*='docs-sidebar'], [class*='doc-sidebar'], [class*='docs-nav'], [class*='table-of-contents']",
    ) > 0
      ? 1
      : 0;

  const linkCount = selectLen(doc, 'a');
  const pText = selectionText(select(doc, 'p'));
  const pWords = splitWhitespace(pText).length;
  f[40] = pWords > 0 ? linkCount / pWords : 0;
  f[41] = pWords;
  f[42] = selectLen(doc, "[class*='grid'], [class*='col-'], [class*='column'], [class*='card']");
  f[43] = selectLen(doc, 'svg');

  let ctaCount = 0;
  for (const node of select(doc, 'button, a')) {
    const text = nodeText(node).toLowerCase();
    if (CTA_PHRASES.some((phrase) => text.includes(phrase))) ctaCount += 1;
  }
  f[44] = ctaCount;
  f[45] = selectLen(doc, "[class*='hero']") > 0 ? 1 : 0;
  f[46] = selectLen(doc, "[class*='testimonial']") > 0 ? 1 : 0;
  f[47] = selectLen(doc, "[class*='pricing']") > 0 ? 1 : 0;
  f[48] = selectLen(doc, "[class*='feature']") > 0 ? 1 : 0;
  f[49] = selectLen(doc, "[class*='breadcrumb']") > 0 ? 1 : 0;
  f[50] = selectLen(doc, 'form');
  f[51] = selectLen(doc, 'img');
  f[52] = selectLen(doc, 'ul, ol');
  f[53] = selectLen(doc, 'table');
  f[54] = selectLen(doc, 'nav');
  f[55] = selectLen(doc, 'section');
  f[56] = selectLen(doc, 'button');
  f[57] = selectLen(doc, 'input');
  f[58] = bodyTextLen;

  const linkHrefs = new Set<string>();
  for (const node of select(doc, 'a[href]')) {
    const href = node.getAttribute('href');
    if (href !== null) linkHrefs.add(href);
  }
  f[59] = linkHrefs.size;
  f[60] = selectLen(doc, "[class*='comment']");
  f[61] = selectLen(doc, "[class*='post']");
  f[62] = selectLen(doc, "[class*='message']");

  // === 500,000-byte body-text gate: early return leaves f[63..89] at 0.0 ===
  if (bodyTextLen > 500_000) {
    return f;
  }

  // === f[63..73]: Enhanced structural features ===

  // f[63]/f[64]: repeated sibling RAW class strings.
  const shallowNodes = select(doc, 'body > *, body > * > *, body > * > * > *');
  let maxRepeatedClass = 0;
  let parentsWithRepeats = 0;
  for (const node of shallowNodes) {
    const children = elementChildren(node);
    if (children.length < 3) continue;
    const classCounts = new Map<string, number>();
    for (const child of children) {
      // Python only counts children whose `class` attribute is PRESENT (not None).
      // linkedom's getAttribute returns '' for a missing class, so gate on hasAttribute.
      // ACCEPTED PARITY GAP: a valueless boolean `class` attribute (`<div class>`) is
      // counted here as a `''` class key, whereas selectolax/lexbor skips it
      // (`get('class') is None`). linkedom cannot distinguish `<div class>` from
      // `<div class="">`, so this rare edge case is an accepted divergence.
      if (!child.hasAttribute('class')) continue;
      const cls = child.getAttribute('class') ?? '';
      classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
    }
    if (classCounts.size > 0) {
      const maxCount = Math.max(...classCounts.values());
      if (maxCount >= 3) {
        parentsWithRepeats += 1;
        if (maxCount > maxRepeatedClass) maxRepeatedClass = maxCount;
      }
    }
  }
  f[63] = maxRepeatedClass;
  f[64] = parentsWithRepeats;

  // f[65]: currency-symbol occurrences in body text.
  f[65] =
    countChar(bodyTextFull, '$') + countChar(bodyTextFull, '€') + countChar(bodyTextFull, '£');

  // f[66]: image-to-text ratio (denominator is body bytes / 1000).
  const imgCount = f[51];
  f[66] = bodyTextLen > 0 ? imgCount / (bodyTextLen / 1000) : 0;

  // f[67]: heading breadth ratio (level read from 2nd char of tag name).
  const headingLevelCounts = [0, 0, 0, 0, 0, 0];
  for (const node of select(doc, 'h1, h2, h3, h4, h5, h6')) {
    const name = tagName(node);
    const second = name[1];
    if (second !== undefined && second >= '0' && second <= '9') {
      const level = Number.parseInt(second, 10);
      if (level >= 1 && level <= 6) {
        headingLevelCounts[level - 1] = (headingLevelCounts[level - 1] ?? 0) + 1;
      }
    }
  }
  const maxSameLevel = Math.max(...headingLevelCounts);
  const nLevelsUsed = headingLevelCounts.filter((c) => c > 0).length;
  f[67] = nLevelsUsed > 0 ? maxSameLevel / nLevelsUsed : 0;

  // body_lower is computed once and reused by f[75..78], f[84], f[86].
  const bodyLower = bodyTextFull.toLowerCase();
  f[68] = bodyLower.includes('breadcrumblist') ? 1 : 0;

  // f[69]: repeated link texts (lowercased trimmed, byte-len > 3, count >= 3).
  const linkTextCounts = new Map<string, number>();
  for (const node of select(doc, 'a')) {
    const text = strip(nodeText(node)).toLowerCase();
    if (blen(text) > 3) {
      linkTextCounts.set(text, (linkTextCounts.get(text) ?? 0) + 1);
    }
  }
  f[69] = countAtLeast(linkTextCounts, 3);

  // f[70]: section link-density population variance with the flush-before-assign quirk.
  const sectionRatios: number[] = [];
  let currentLinks = 0;
  let currentTextLen = 0;
  for (const node of select(doc, 'section, article, div')) {
    if (currentTextLen > 50) {
      sectionRatios.push((currentLinks / currentTextLen) * 1000);
    }
    currentLinks = 0;
    currentTextLen = 0;
    currentLinks = descendantCount(node, 'a');
    currentTextLen = blen(strip(nodeText(node)));
  }
  if (currentTextLen > 50) {
    sectionRatios.push((currentLinks / currentTextLen) * 1000);
  }
  if (sectionRatios.length >= 3) {
    const mean = sectionRatios.reduce((a, b) => a + b, 0) / sectionRatios.length;
    const variance =
      sectionRatios.reduce((acc, r) => acc + (r - mean) ** 2, 0) / sectionRatios.length;
    f[70] = variance;
  }

  f[71] = selectLen(doc, 'meta[name="robots"][content*="noindex"]') > 0 ? 1 : 0;

  const pathSegments = path.split('/').filter((s) => s !== '').length;
  f[72] = pathSegments;

  // === f[73..81]: DOM vocabulary features ===

  // f[73]/f[74]: structural signature `tag` or `tag|keyword`.
  let domMaxSig = 0;
  let domParentsWithRepeats = 0;
  for (const node of shallowNodes) {
    const children = elementChildren(node);
    if (children.length < 3) continue;
    const sigCounts = new Map<string, number>();
    for (const child of children) {
      const tag = tagName(child);
      if (!tag) continue;
      const cls = (child.getAttribute('class') ?? '').toLowerCase();
      let keyword = '';
      for (const kw of DOM_SIG_KEYWORDS) {
        if (cls.includes(kw)) {
          keyword = kw;
          break;
        }
      }
      const sig = keyword === '' ? tag : `${tag}|${keyword}`;
      sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
    }
    if (sigCounts.size > 0) {
      const top = Math.max(...sigCounts.values());
      if (top >= 3) {
        domParentsWithRepeats += 1;
        if (top > domMaxSig) domMaxSig = top;
      }
    }
  }
  f[73] = domMaxSig;
  f[74] = domParentsWithRepeats;

  // f[75..78]: vocabulary densities over exact whitespace-split tokens of body_lower.
  const bodyWords = splitWhitespace(bodyLower);
  const totalWords = bodyWords.length;
  if (totalWords > 0) {
    const wordCounts = new Map<string, number>();
    for (const word of bodyWords) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
    f[75] = sumCounts(wordCounts, COMMERCIAL_WORDS) / totalWords;
    f[76] = sumCounts(wordCounts, CONTENT_WORDS) / totalWords;
    f[77] = sumCounts(wordCounts, TECH_WORDS) / totalWords;
    f[78] = sumCounts(wordCounts, FORUM_WORDS) / totalWords;
  }

  // f[79]/f[80]: reuse the f[69] link-text frequency map.
  f[79] = linkTextCounts.size > 0 ? Math.max(...linkTextCounts.values()) : 0;
  f[80] = countAtLeast(linkTextCounts, 3);

  // === f[81..89]: Collection-specific features ===

  f[81] = selectLen(doc, 'meta[property="og:type"][content*="product.group"]') > 0 ? 1 : 0;
  f[82] =
    selectLen(
      doc,
      "[class*='filter'][class*='sidebar'], [class*='filter'][class*='panel'], [class*='filter'][class*='bar'], [class*='filter'][class*='menu']",
    ) > 0
      ? 1
      : 0;
  f[83] =
    selectLen(
      doc,
      "[class*='sort'][class*='select'], [class*='sort'][class*='dropdown'], [class*='sort'][class*='control'], [class*='sort'][class*='option']",
    ) > 0
      ? 1
      : 0;
  f[84] = PRODUCT_COUNT_RE.test(bodyLower) ? 1 : 0;

  const cardSelector =
    "[class*='product-card'], [class*='product-tile'], [class*='product-item'], [class*='product-grid-item'], [class*='grid-item'], [class*='collection-item']";
  const cardNodes = select(doc, cardSelector);
  const totalCards = cardNodes.length;
  let cardsWithPrice = 0;
  for (const node of cardNodes) {
    if (descendantCount(node, "[class*='price'], [class*='cost'], [class*='amount']") > 0) {
      cardsWithPrice += 1;
    }
  }
  f[85] = cardsWithPrice;
  f[86] = bodyLower.includes('collectionpage') || bodyLower.includes('productcollection') ? 1 : 0;
  f[87] = totalCards;
  f[88] = totalCards > 0 ? cardsWithPrice / totalCards : 0;

  return f;
}

/** Python `str.rstrip(chars)`: strip trailing occurrences of any char in `chars`. */
function trimEnd(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1] ?? '')) end -= 1;
  return s.slice(0, end);
}

/** Count non-overlapping occurrences of a single character, Python `str.count`. */
function countChar(s: string, ch: string): number {
  let count = 0;
  for (const c of s) {
    if (c === ch) count += 1;
  }
  return count;
}

function countAtLeast(counts: Map<string, number>, threshold: number): number {
  let n = 0;
  for (const c of counts.values()) {
    if (c >= threshold) n += 1;
  }
  return n;
}

function sumCounts(counts: Map<string, number>, words: readonly string[]): number {
  let total = 0;
  for (const w of words) {
    total += counts.get(w) ?? 0;
  }
  return total;
}
