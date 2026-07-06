// SPDX-License-Identifier: Apache-2.0
// Sitename extraction ported from trafilatura/metadata.py (extract_sitename and
// the sitename normalization block of extract_metadata) — Apache-2.0.

import type { HDocument } from './dom.js';
import { examineTitleElement } from './title.js';
import { extractDomain } from './url.js';

/**
 * extract_sitename: take the first dot-containing segment of the split
 * `<title>` (the "Site.com" half of "Article — Site.com"). Faithful port.
 */
export function extractSitename(doc: HDocument): string | undefined {
  const { first, second } = examineTitleElement(doc);
  return [first, second].find((part) => part?.includes('.')) ?? undefined;
}

/** Python `str.title()` for the capitalize-when-lowercase-initial sitename path. */
function pythonTitle(s: string): string {
  return s.replace(/([A-Za-zÀ-ɏ])([A-Za-zÀ-ɏ]*)/g, (_m, head: string, tail: string) => {
    return head.toUpperCase() + tail.toLowerCase();
  });
}

function firstCharIsUpper(s: string): boolean {
  const c = s[0];
  return c !== undefined && c !== c.toLowerCase() && c === c.toUpperCase();
}

/**
 * Normalize / backfill the sitename, mirroring the sitename block of
 * `extract_metadata`: strip a leading Twitter `@`, title-case a lowercase
 * dot-free name, and fall back to the URL host when no sitename was found.
 */
export function normalizeSitename(
  doc: HDocument,
  current: string | undefined,
  url: string | undefined,
): string | undefined {
  let sitename = current ?? extractSitename(doc);

  if (sitename) {
    sitename = sitename.replace(/^@+/, '');
    if (sitename && !sitename.includes('.') && !firstCharIsUpper(sitename)) {
      sitename = pythonTitle(sitename);
    }
    return sitename || undefined;
  }

  if (url) {
    return extractDomain(url);
  }
  return undefined;
}
