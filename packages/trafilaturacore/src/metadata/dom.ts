// SPDX-License-Identifier: Apache-2.0
// DOM helpers over linkedom (the primary DOM, per locked decision #2), scoped to
// the metadata sidecar. We expose a focused structural interface rather than
// pulling in the global `DOM` lib, so only the members linkedom actually
// implements are reachable from typed code.
//
// Relocated from the former `core/dom.ts` when the extraction/classification core
// moved to the `@trafilaturacore/native` Rust crate (Phase INTEGRATE): only the subset
// the metadata modules consume — `parseDocument`, `trim`, `TEXT_NODE`, and the
// structural node/element/document interfaces — is kept here.

import { parseHTML } from 'linkedom';

/** Node type we care about (subset of the DOM `Node.*_NODE` constants). */
export const TEXT_NODE = 3;

/** A structural attribute pair as exposed by linkedom's `element.attributes`. */
interface HAttr {
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
  readonly firstElementChild: HElement | null;
  /** The next sibling that is an element (null when this is the last element child). */
  readonly nextElementSibling: HElement | null;
  /** The nearest ancestor that is an element (null at the document root). */
  readonly parentElement: HElement | null;
  readonly innerHTML: string;
  readonly attributes: ArrayLike<HAttr> & Iterable<HAttr>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  /** Nearest self-or-ancestor element matching the selector (standard DOM `closest`). */
  closest(selectors: string): HElement | null;
  /** Whether this element matches the selector (standard DOM `matches`). */
  matches(selectors: string): boolean;
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

/** Collapse internal whitespace and trim, matching trafilatura's `trim`. */
export function trim(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
