// SPDX-License-Identifier: Apache-2.0
// Document cleaning, ported from go-trafilatura html-processing.go (Apache-2.0):
// docCleaning (tree_cleaning), pruneHTML, linkDensityTest(+Tables), and
// deleteByLinkDensity. Behavior follows go-trafilatura; precision/recall toggles
// match its `Options.Focus` branches.

import { EMPTY_TAGS_TO_REMOVE, TAGS_TO_CLEAN, TAGS_TO_STRIP } from './constants.js';
import {
  COMMENT_NODE,
  childElements,
  childNodesOf,
  getElementsByTagName,
  type HDocument,
  type HElement,
  type HNode,
  isElement,
  tagOf,
  trim,
} from './dom.js';
import type { CoreOptions } from './options.js';

/** Unwrap every instance of a tag (remove the tag, keep its children). */
function stripTags(root: HElement, tag: string): void {
  for (const el of getElementsByTagName(root, tag)) {
    el.replaceWith(...childNodesOf(el));
  }
}

/** Remove every instance of a tag including its children. */
function removeElements(root: HElement, tag: string): void {
  for (const el of getElementsByTagName(root, tag)) {
    el.remove();
  }
}

/** Remove all HTML comment nodes (go removeHtmlCommentNode). */
function removeComments(node: HNode): void {
  for (const child of childNodesOf(node)) {
    if (child.nodeType === COMMENT_NODE) {
      child.remove();
    } else {
      removeComments(child);
    }
  }
}

/** Delete empty instances of the prune-able tags (go pruneHTML). */
export function pruneEmptyElements(root: HElement): void {
  const all = getElementsByTagName(root, '*');
  for (let i = all.length - 1; i >= 0; i--) {
    const el = all[i];
    if (el === undefined) continue;
    if (!EMPTY_TAGS_TO_REMOVE.has(tagOf(el))) continue;
    if (el.childNodes.length === 0) {
      el.remove();
    }
  }
}

/**
 * Clean the document by discarding unwanted elements (go docCleaning). Strips
 * the "tags to strip" (keeping children), removes the "tags to clean" (including
 * children), drops HTML comments, and prunes empty elements. In recall mode it
 * backs off the clean pass if it would delete every `<p>`.
 */
export function cleanDocument(root: HElement, opts: CoreOptions): void {
  const cleaningList = new Set(TAGS_TO_CLEAN);
  const strippingList = new Set(TAGS_TO_STRIP);

  if (opts.excludeTables) {
    for (const t of ['table', 'td', 'th', 'tr']) cleaningList.add(t);
  }
  if (opts.includeImages) {
    for (const t of ['figure', 'picture', 'source']) cleaningList.delete(t);
    strippingList.delete('img');
  }
  if (opts.commentsAsContent) {
    // Forums keep comment widgets; do not strip the structural tags that host them.
    cleaningList.delete('form');
  }

  // Profile: never strip/clean preserved tags (e.g. forum `<form>`).
  if (opts.preserveTags) {
    for (const tag of opts.preserveTags) {
      cleaningList.delete(tag);
      strippingList.delete(tag);
    }
  }

  // Profile: drop page-type-specific boilerplate by CSS selector first.
  if (opts.boilerplateSelectors) {
    for (const selector of opts.boilerplateSelectors) {
      try {
        for (const el of getElementsByTagName(root, selector)) el.remove();
      } catch {
        // Ignore selectors linkedom cannot parse.
      }
    }
  }

  for (const tag of strippingList) stripTags(root, tag);

  const paragraphCount = (): number => getElementsByTagName(root, 'p').length;
  if (opts.focus === 'recall' && paragraphCount() > 0) {
    const backup = root.cloneNode(true);
    for (const tag of cleaningList) removeElements(root, tag);
    if (paragraphCount() === 0) {
      // Reverted: re-attach the backup's children in place of the stripped ones.
      for (const child of childNodesOf(root)) child.remove();
      for (const child of childNodesOf(backup)) root.append(child);
    }
  } else {
    for (const tag of cleaningList) removeElements(root, tag);
  }

  removeComments(root);
  pruneEmptyElements(root);
}

/** Collect link-text heuristics (go collectLinkInfo). */
function collectLinkInfo(links: HElement[]): {
  linkLength: number;
  shortLinks: number;
  nonEmpty: HElement[];
} {
  let linkLength = 0;
  let shortLinks = 0;
  const nonEmpty: HElement[] = [];
  for (const link of links) {
    const len = [...trim(link.textContent)].length;
    if (len === 0) continue;
    linkLength += len;
    if (len < 10) shortLinks++;
    nonEmpty.push(link);
  }
  return { linkLength, shortLinks, nonEmpty };
}

/**
 * Whether an element is link-dense enough to be boilerplate (go linkDensityTest).
 * Returns the non-empty links plus the high-density verdict.
 */
export function linkDensityTest(
  element: HElement,
  opts: CoreOptions,
): { nonEmpty: HElement[]; highDensity: boolean } {
  const links = getElementsByTagName(element, 'a');
  if (links.length === 0) return { nonEmpty: [], highDensity: false };

  const text = trim(element.textContent);
  const textLength = [...text].length;

  if (links.length === 1) {
    const threshold = opts.focus === 'precision' ? 10 : 100;
    const firstLink = links[0];
    const linkTextLength = firstLink ? [...trim(firstLink.textContent)].length : 0;
    if (linkTextLength > threshold && linkTextLength > textLength * 0.9) {
      return { nonEmpty: [], highDensity: true };
    }
  }

  let limit: number;
  if (tagOf(element) === 'p') {
    limit = element.nextSibling === null ? 60 : 30;
  } else {
    limit = element.nextSibling === null ? 300 : 100;
  }

  if (textLength < limit) {
    const { linkLength, shortLinks, nonEmpty } = collectLinkInfo(links);
    if (nonEmpty.length === 0) return { nonEmpty, highDensity: true };
    if (
      linkLength > textLength * 0.8 ||
      (nonEmpty.length > 1 && shortLinks / nonEmpty.length > 0.8)
    ) {
      return { nonEmpty, highDensity: true };
    }
  }

  return { nonEmpty: [], highDensity: false };
}

/** Whether a table is link-dense boilerplate (go linkDensityTestTables). */
export function linkDensityTestTables(table: HElement, _opts: CoreOptions): boolean {
  const links = getElementsByTagName(table, 'a');
  if (links.length === 0) return false;

  const textLength = [...trim(table.textContent)].length;
  if (textLength < 200) return false;

  const { linkLength, nonEmpty } = collectLinkInfo(links);
  if (nonEmpty.length === 0) return true;

  return textLength < 1000 ? linkLength > textLength * 0.8 : linkLength > textLength * 0.5;
}

/** Remove link-dense elements of the given tags (go deleteByLinkDensity). */
export function deleteByLinkDensity(
  subTree: HElement,
  opts: CoreOptions,
  backtracking: boolean,
  ...tagNames: string[]
): void {
  const threshold = opts.focus === 'precision' ? 200 : 100;
  const childLimit = opts.focus === 'precision' ? 1 : 3;

  const candidates =
    tagNames.length === 0
      ? getElementsByTagName(subTree, '*')
      : tagNames.flatMap((t) => getElementsByTagName(subTree, t));

  const toDelete: HElement[] = [];
  for (const el of candidates) {
    const { nonEmpty, highDensity } = linkDensityTest(el, opts);
    if (highDensity) {
      toDelete.push(el);
    } else if (backtracking && nonEmpty.length > 0) {
      const textLength = [...trim(el.textContent)].length;
      if (textLength > 0 && textLength < threshold && childElements(el).length >= childLimit) {
        toDelete.push(el);
      }
    }
  }

  for (let i = toDelete.length - 1; i >= 0; i--) {
    toDelete[i]?.remove();
  }
}

/** Convenience: every element in document order (used by callers needing `*`). */
export function allElements(doc: HDocument): HElement[] {
  return Array.from(doc.querySelectorAll('*')).filter(isElement);
}
