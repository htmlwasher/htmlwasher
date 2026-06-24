// SPDX-License-Identifier: Apache-2.0
// DOM helpers over linkedom (the primary DOM, per locked decision #2). We expose
// a focused structural interface rather than pulling in the global `DOM` lib, so
// only the members linkedom actually implements are reachable from typed code.

import { parseHTML } from 'linkedom';

/** Node types we care about (subset of the DOM `Node.*_NODE` constants). */
export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export const COMMENT_NODE = 8;

/** A structural attribute pair as exposed by linkedom's `element.attributes`. */
export interface HAttr {
  name: string;
  value: string;
}

/** Minimal structural view of a linkedom Node. */
export interface HNode {
  readonly nodeType: number;
  readonly textContent: string;
  parentNode: HElement | null;
  nextSibling: HNode | null;
  previousSibling: HNode | null;
  readonly childNodes: ArrayLike<HNode> & Iterable<HNode>;
  remove(): void;
  replaceWith(...nodes: (HNode | string)[]): void;
}

/** Minimal structural view of a linkedom Element. */
export interface HElement extends HNode {
  readonly localName: string;
  readonly tagName: string;
  id: string;
  className: string;
  readonly children: ArrayLike<HElement> & Iterable<HElement>;
  readonly firstChild: HNode | null;
  readonly innerHTML: string;
  readonly attributes: ArrayLike<HAttr> & Iterable<HAttr>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  querySelector(selectors: string): HElement | null;
  querySelectorAll(selectors: string): ArrayLike<HElement> & Iterable<HElement>;
  append(...nodes: (HNode | string)[]): void;
  cloneNode(deep?: boolean): HElement;
}

/** Structural view of the parsed document we operate on. */
export interface HDocument {
  readonly documentElement: HElement | null;
  readonly body: HElement | null;
  readonly head: HElement | null;
  querySelector(selectors: string): HElement | null;
  querySelectorAll(selectors: string): ArrayLike<HElement> & Iterable<HElement>;
  createElement(tagName: string): HElement;
}

/**
 * Whether the input looks like a full HTML document (vs a bare fragment).
 * Mirrors htmlprocessing-server's `isHtmlDocument` substring/regex heuristic.
 */
export function looksLikeDocument(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('<!doctype') ||
    /<html[\s>]/.test(lower) ||
    /<head[\s>]/.test(lower) ||
    /<body[\s>]/.test(lower)
  );
}

/**
 * Parse an HTML string into a document we can traverse and mutate. linkedom's
 * `parseHTML` does not wrap loose input in `<html><body>` (it promotes the first
 * element to the document root, leaving `<body>` empty), so we normalize first:
 * full documents (with `<html>`) parse as-is; a stray `<body>` without `<html>`
 * is wrapped in `<html>`; a bare fragment is wrapped in `<html><body>`.
 */
export function parseDocument(html: string): HDocument {
  const input = html ?? '';
  let full: string;
  if (/<html[\s>]/i.test(input)) {
    full = input;
  } else if (/<body[\s>]/i.test(input)) {
    full = `<!doctype html><html>${input}</html>`;
  } else {
    full = `<!doctype html><html><body>${input}</body></html>`;
  }
  const { document } = parseHTML(full);
  return document as unknown as HDocument;
}

export function isElement(node: HNode): node is HElement {
  return node.nodeType === ELEMENT_NODE;
}

export function isText(node: HNode): boolean {
  return node.nodeType === TEXT_NODE;
}

/** Lowercase tag name of an element. */
export function tagOf(el: HElement): string {
  return el.localName.toLowerCase();
}

/** All descendant elements matching the tag (or every element for `'*'`). */
export function getElementsByTagName(root: HElement | HDocument, tag: string): HElement[] {
  return Array.from(root.querySelectorAll(tag));
}

/** Array snapshot of an element's child elements (safe to mutate during iteration). */
export function childElements(el: HElement): HElement[] {
  return Array.from(el.children);
}

/** Array snapshot of an element's child nodes (safe to mutate during iteration). */
export function childNodesOf(node: HNode): HNode[] {
  return Array.from(node.childNodes);
}

/** Collapse internal whitespace and trim, matching trafilatura's `trim`. */
export function trim(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Unicode-aware length of the trimmed text content of an element. */
export function textLength(el: HElement): number {
  return [...trim(el.textContent)].length;
}

/** Replace an element with its children (strip the tag, keep content) = "unwrap". */
export function unwrap(el: HElement): void {
  el.replaceWith(...childNodesOf(el));
}

/** The `class` + `id` of an element, lowercased and space-joined, for matching. */
export function classId(el: HElement): string {
  const cls = el.className || '';
  const id = el.id || '';
  return `${cls} ${id}`;
}
