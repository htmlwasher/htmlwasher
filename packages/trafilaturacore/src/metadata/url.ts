// SPDX-License-Identifier: Apache-2.0
// URL extraction ported from trafilatura/metadata.py (extract_url, URL_SELECTORS,
// META_URL) plus the courlan validate_url/normalize_url/get_base_url/extract_domain
// helpers it relies on — reduced to a faithful, dependency-free subset (Apache-2.0).

import type { HDocument } from './dom.js';

/** META_URL: capture the host (minus a leading www./wNN.) from a URL. */
const META_URL = /^https?:\/\/(?:www\.|w[0-9]+\.)?([^/]+)/;

/**
 * Loose validity check matching courlan `is_valid_url`: a parseable http(s)
 * URL with a host. The WHATWG `URL` parser is the dependency-free stand-in.
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}

/** courlan `get_base_url`: scheme + host (drops path/query/fragment). */
export function getBaseUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return undefined;
  }
}

/** courlan `normalize_url` (reduced): drop the fragment, keep the rest as-is. */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * courlan `extract_domain(url, fast=True)`: the registrable host without a
 * leading `www.`/`wNN.`. (No public-suffix list — the fast path is a plain host.)
 */
export function extractDomain(url: string): string | undefined {
  const match = META_URL.exec(url);
  return match?.[1];
}

// URL_SELECTORS translated from XPath to CSS, in priority order:
//   .//head//link[@rel="canonical"]
//   .//head//base
//   .//head//link[@rel="alternate"][@hreflang="x-default"]
const URL_SELECTORS = [
  'head link[rel="canonical" i]',
  'head base',
  'head link[rel="alternate" i][hreflang="x-default" i]',
];

/**
 * Extract the canonical URL. Faithful port of `extract_url`: probe the canonical
 * link / base / x-default alternate, resolve a root-relative href against the
 * first og:/twitter: meta base, validate, and normalize.
 */
export function extractUrl(doc: HDocument, defaultUrl?: string): string | undefined {
  let url: string | undefined;
  for (const selector of URL_SELECTORS) {
    const element = doc.querySelector(selector);
    const href = element?.getAttribute('href') ?? undefined;
    if (href) {
      url = href;
      break;
    }
  }

  // Fix root-relative URLs using an og:/twitter: meta content base.
  if (url?.startsWith('/')) {
    const head = doc.head;
    if (head) {
      for (const element of head.querySelectorAll('meta[content]')) {
        const attrType = element.getAttribute('name') ?? element.getAttribute('property') ?? '';
        if (attrType.startsWith('og:') || attrType.startsWith('twitter:')) {
          const base = getBaseUrl(element.getAttribute('content') ?? '');
          if (base) {
            url = base + url;
            break;
          }
        }
      }
    }
  }

  // Drop invalid URLs.
  if (url) {
    url = isValidUrl(url) ? normalizeUrl(url) : undefined;
  }

  return url ?? defaultUrl;
}
