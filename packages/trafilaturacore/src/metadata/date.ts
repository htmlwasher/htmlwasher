// SPDX-License-Identifier: Apache-2.0
// Minimal date heuristic. trafilatura/metadata.py delegates dates to the external
// `htmldate` library (find_date), which is NOT ported here. This is a REDUCED
// htmldate equivalent: it returns an ISO-8601 (YYYY-MM-DD) date string in a fixed
// priority order, or undefined. It is intentionally small — not a faithful port
// of htmldate's full extraction.

import type { HDocument } from './dom.js';

// A YYYY-MM-DD prefix of any ISO-8601 datetime, validated loosely.
const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;
// A plausible YYYY/MM/DD or YYYY-MM-DD segment in a URL path.
const URL_DATE = /\/(\d{4})[/-](\d{2})[/-](\d{2})(?:[/-]|$)/;

/** Validate and canonicalize a Y/M/D triple to an ISO date, or undefined. */
function toIsoDate(year: number, month: number, day: number): string | undefined {
  if (year < 1900 || year > 2100) return undefined;
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > 31) return undefined;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Pull the first valid YYYY-MM-DD out of an arbitrary date-ish string. */
function parseIso(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const match = ISO_DATE.exec(value);
  if (!match) return undefined;
  return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Scan JSON-LD scripts for datePublished / dateModified (string fields). */
function dateFromJsonLd(doc: HDocument): string | undefined {
  const scripts = doc.querySelectorAll(
    'script[type="application/ld+json" i], script[type="application/settings+json" i]',
  );
  for (const elem of scripts) {
    const text = elem.textContent;
    if (!text) continue;
    for (const key of ['datePublished', 'dateModified']) {
      const re = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`);
      const match = re.exec(text);
      const iso = parseIso(match?.[1]);
      if (iso) return iso;
    }
  }
  return undefined;
}

/** Read the `content` of the first matching head meta selector. */
function metaContent(doc: HDocument, selector: string): string | undefined {
  const head = doc.head;
  if (!head) return undefined;
  const el = head.querySelector(selector);
  return el?.getAttribute('content') ?? undefined;
}

/**
 * Extract a publication date as an ISO-8601 date string, in priority order:
 *   JSON-LD datePublished/dateModified
 *   → <meta property="article:published_time"> / name="date"/"dcterms.date"/"datePublished"
 *   → <meta property="og:updated_time">
 *   → <time datetime>
 *   → first plausible YYYY-MM-DD in the URL.
 */
export function extractDate(doc: HDocument, url?: string): string | undefined {
  const fromJson = dateFromJsonLd(doc);
  if (fromJson) return fromJson;

  const metaSelectors = [
    'meta[property="article:published_time" i]',
    'meta[name="date" i]',
    'meta[name="dcterms.date" i]',
    'meta[name="datePublished" i]',
  ];
  for (const selector of metaSelectors) {
    const iso = parseIso(metaContent(doc, selector));
    if (iso) return iso;
  }

  const ogUpdated = parseIso(metaContent(doc, 'meta[property="og:updated_time" i]'));
  if (ogUpdated) return ogUpdated;

  const root = doc.body ?? doc.documentElement;
  if (root) {
    for (const time of root.querySelectorAll('time[datetime]')) {
      const iso = parseIso(time.getAttribute('datetime'));
      if (iso) return iso;
    }
  }

  if (url) {
    const match = URL_DATE.exec(url);
    if (match) {
      return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    }
  }

  return undefined;
}
