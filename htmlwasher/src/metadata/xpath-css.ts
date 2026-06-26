// SPDX-License-Identifier: Apache-2.0
// Shared DOM-selection helpers porting trafilatura/metadata.py extract_metainfo
// and the lxml XPath-driven probing used by title/author/catstags extraction.
// trafilatura uses lxml XPath; linkedom supports only CSS, so the XPaths in
// xpaths.py are translated to a faithful CSS-selector subset here. The regex
// class/id predicates (re:test) that CSS cannot express are approximated with
// `[attr*=… i]` substring selectors plus the explicit token cases trafilatura
// enumerates. See each consumer module for the exact XPath it stands in for.

import { type HDocument, trim } from '../core/dom.js';

/**
 * extract_metainfo: try each selector in order; return the first element whose
 * trimmed text is `2 < len < len_limit`. The selector strings already encode the
 * union of element predicates for one XPath expression.
 */
export function selectMetaInfo(
  doc: HDocument,
  selectors: string[],
  lenLimit = 200,
): string | undefined {
  const root = doc.body ?? doc.documentElement;
  if (!root) return undefined;
  for (const selector of selectors) {
    for (const elem of root.querySelectorAll(selector)) {
      const content = trim(elem.textContent);
      if (content && content.length > 2 && content.length < lenLimit) {
        return content;
      }
    }
  }
  return undefined;
}
