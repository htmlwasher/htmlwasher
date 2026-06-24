// SPDX-License-Identifier: Apache-2.0
// Stage-2 HTML signals — `extract_html_signals` + `refine_with_html_signals`
// (rs-trafilatura page_type/mod.rs). `refine` ONLY overrides `article`; any other
// incoming page type is returned unchanged.
//
// ld_type comparisons are EXACT, case-sensitive against the original-case `@type`
// strings parsed from JSON-LD blocks.

import { type HDocument, parseDocumentSpec } from '../core/dom.js';
import type { PageType } from '../types.js';
import { selectLen } from './features/dom-query.js';
import { ogType } from './features/text.js';

const MIN_PRODUCT_ELEMENTS_FOR_CATEGORY = 5;

const PRODUCT_GRID_PATTERNS = [
  'product-grid',
  'product-list',
  'product-listing',
  'products-grid',
  'product-card',
  'product-tile',
  'collection-products',
  'search-results-products',
] as const;

const ADD_TO_CART_PATTERNS = [
  'add-to-cart',
  'add_to_cart',
  'addtocart',
  'add-to-bag',
  'buy-now',
  'buynow',
] as const;

const CART_BUTTON_TEXTS = ['add to cart', 'add to bag', 'buy now', 'buy it now'] as const;

export interface HtmlSignals {
  ogType: string;
  ldTypes: string[];
  hasAggregateOffer: boolean;
  hasAddToCart: boolean;
  hasProductGrid: boolean;
  productElementCount: number;
  hasPagination: boolean;
  codeBlockCount: number;
  hasDocsNav: boolean;
  linkRatio: number;
  paragraphWordCount: number;
}

/** Collect `@type` strings (original case) from a parsed JSON-LD value tree. */
function collectLdTypes(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collectLdTypes(v, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') {
      out.push(t);
    } else if (Array.isArray(t)) {
      for (const tv of t) {
        if (typeof tv === 'string') out.push(tv);
      }
    }
    for (const key of Object.keys(obj)) {
      collectLdTypes(obj[key], out);
    }
  }
}

/** Does any JSON-LD object carry an `offers` containing an `AggregateOffer`? */
function findAggregateOffer(value: unknown): boolean {
  const types: string[] = [];
  collectLdTypes(value, types);
  return types.includes('AggregateOffer');
}

function classOrId(doc: HDocument, patterns: readonly string[]): boolean {
  for (const p of patterns) {
    if (selectLen(doc, `[class*='${p}'], [id*='${p}']`) > 0) return true;
  }
  return false;
}

/** Extract the HTML signals struct used by Stage-2 refinement. */
export function extractHtmlSignals(doc: HDocument): HtmlSignals {
  const og = ogType(doc);

  const ldTypes: string[] = [];
  let hasAggregateOffer = false;
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = (script.textContent ?? '').trim();
    if (raw === '') continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      collectLdTypes(parsed, ldTypes);
      if (findAggregateOffer(parsed)) hasAggregateOffer = true;
    } catch {
      // Non-JSON or malformed LD block — skip (matches a parse-failure no-op).
    }
  }

  const hasProductGrid = classOrId(doc, PRODUCT_GRID_PATTERNS);

  let hasAddToCart = classOrId(doc, ADD_TO_CART_PATTERNS);
  if (!hasAddToCart) {
    for (const btn of doc.querySelectorAll('button, a')) {
      const text = (btn.textContent ?? '').toLowerCase();
      if (CART_BUTTON_TEXTS.some((t) => text.includes(t))) {
        hasAddToCart = true;
        break;
      }
    }
  }

  const productElementCount = selectLen(
    doc,
    "[class*='product-card'], [class*='product-tile'], [class*='product-item']",
  );

  const hasPagination =
    selectLen(doc, "link[rel='next'], [class*='pagination'], [class*='pager']") > 0;

  const codeBlockCount = selectLen(doc, 'code, pre');

  const hasDocsNav =
    selectLen(
      doc,
      "[class*='docs-sidebar'], [class*='doc-sidebar'], [class*='docs-nav'], [class*='table-of-contents']",
    ) > 0;

  const linkCount = selectLen(doc, 'a');
  let pText = '';
  for (const p of doc.querySelectorAll('p')) pText += p.textContent ?? '';
  const paragraphWordCount = pText.trim() === '' ? 0 : pText.trim().split(/\s+/).length;
  let linkRatio: number;
  if (paragraphWordCount > 0) linkRatio = linkCount / paragraphWordCount;
  else if (linkCount > 0) linkRatio = linkCount;
  else linkRatio = 0;

  return {
    ogType: og,
    ldTypes,
    hasAggregateOffer,
    hasAddToCart,
    hasProductGrid,
    productElementCount,
    hasPagination,
    codeBlockCount,
    hasDocsNav,
    linkRatio,
    paragraphWordCount,
  };
}

function hasCategorySignal(s: HtmlSignals): boolean {
  const has = (t: string) => s.ldTypes.includes(t);
  if (has('CollectionPage') || has('OfferCatalog') || has('ProductCollection')) return true;
  if ((has('Product') || has('ProductGroup')) && s.hasAggregateOffer) return true;
  if (
    has('ItemList') &&
    (s.hasProductGrid || s.productElementCount >= MIN_PRODUCT_ELEMENTS_FOR_CATEGORY)
  ) {
    return true;
  }
  return false;
}

function hasProductSignal(s: HtmlSignals): boolean {
  if (s.hasAggregateOffer) return false;
  const ogLower = s.ogType.toLowerCase();
  if (ogLower.includes('product') && ogLower !== 'product.group' && ogLower !== 'product:group') {
    return true;
  }
  return s.ldTypes.includes('Product') || s.ldTypes.includes('ProductGroup');
}

function hasSingleProductLd(s: HtmlSignals): boolean {
  if (s.hasAggregateOffer) return false;
  return s.ldTypes.includes('Product') || s.ldTypes.includes('ProductGroup');
}

/**
 * Refine the Stage-1 page type with HTML signals. ONLY overrides `article`; any
 * other `pageType` is returned unchanged. Ordered, first match wins.
 */
export function refineWithSignals(pageType: PageType, s: HtmlSignals): PageType {
  if (pageType !== 'article') return pageType;

  if (hasCategorySignal(s)) return 'collection';

  const ogLower = s.ogType.toLowerCase();
  if (ogLower === 'product.group' || ogLower === 'product:group') return 'collection';

  if (
    s.productElementCount >= MIN_PRODUCT_ELEMENTS_FOR_CATEGORY &&
    (s.hasPagination || (s.hasProductGrid && s.hasAddToCart))
  ) {
    return 'collection';
  }

  if (hasProductSignal(s)) {
    if (s.hasProductGrid && !hasSingleProductLd(s)) return 'collection';
    return 'product';
  }

  if (s.hasProductGrid && s.hasAddToCart) return 'collection';

  if (s.hasDocsNav && s.codeBlockCount >= 3) return 'documentation';

  if (s.codeBlockCount >= 500) return 'documentation';

  if (s.linkRatio >= 3.0 && s.paragraphWordCount < 30) return 'listing';

  return 'article';
}

/** Convenience: refine `pageType` directly from raw HTML (parses, extracts, refines). */
export function refineWithHtmlSignals(pageType: PageType, html: string): PageType {
  if (pageType !== 'article') return pageType;
  const doc = parseDocumentSpec(html);
  return refineWithSignals(pageType, extractHtmlSignals(doc));
}
