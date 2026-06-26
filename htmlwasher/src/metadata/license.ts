// SPDX-License-Identifier: Apache-2.0
// License extraction ported from trafilatura/metadata.py (extract_license,
// parse_license_element, LICENSE_REGEX, TEXT_LICENSE_REGEX) — Apache-2.0.

import { type HDocument, type HElement, trim } from '../core/dom.js';

// Creative Commons license codes embedded in an href (e.g. /by-nc-sa/4.0).
const LICENSE_REGEX = /\/(by-nc-nd|by-nc-sa|by-nc|by-nd|by-sa|by|zero)\/([1-9]\.[0-9])/;
const TEXT_LICENSE_REGEX =
  /(cc|creative commons) (by-nc-nd|by-nc-sa|by-nc|by-nd|by-sa|by|zero) ?([1-9]\.[0-9])?/i;

/** parse_license_element: probe a link's href then text for a CC license cue. */
function parseLicenseElement(element: HElement, strict: boolean): string | undefined {
  const href = element.getAttribute('href') ?? '';
  const match = LICENSE_REGEX.exec(href);
  if (match?.[1] && match[2]) {
    return `CC ${match[1].toUpperCase()} ${match[2]}`;
  }
  const text = trim(element.textContent);
  if (text) {
    if (strict) {
      const textMatch = TEXT_LICENSE_REGEX.exec(text);
      return textMatch ? textMatch[0] : undefined;
    }
    return text;
  }
  return undefined;
}

/**
 * extract_license: prefer `a[rel="license"][href]`, then probe footer links for
 * CC cues (strict). Faithful port of `extract_license`. The footer XPath
 * `.//footer//a[@href] | .//div[contains(@class,"footer") or contains(@id,"footer")]//a[@href]`
 * is translated to the CSS below.
 */
export function extractLicense(doc: HDocument): string | undefined {
  const root = doc.body ?? doc.documentElement;
  if (!root) return undefined;

  for (const element of root.querySelectorAll('a[rel="license" i][href]')) {
    const result = parseLicenseElement(element, false);
    if (result !== undefined) return result;
  }

  const footerSelector =
    'footer a[href], div[class*="footer" i] a[href], div[id*="footer" i] a[href]';
  for (const element of root.querySelectorAll(footerSelector)) {
    const result = parseLicenseElement(element, true);
    if (result !== undefined) return result;
  }
  return undefined;
}
