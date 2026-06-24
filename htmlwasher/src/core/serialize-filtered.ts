// SPDX-License-Identifier: Apache-2.0
// The whitelist re-serializer — the heart of the HTML-out contract. We never
// emit the kept subtree verbatim (`outerHTML`); instead we hand-emit a fixed
// tag/attribute whitelist, UNWRAP non-whitelisted elements (recurse, emit no
// tag), DROP the skip-set + boilerplate-named nodes, and HTML-escape every text
// and attribute value. Ported from rs-trafilatura push_filtered_html_children
// (src/extract.rs:2700) + go-trafilatura postCleaning (html-processing.go:401).

import {
  ALLOWED_ATTRIBUTES,
  ALWAYS_DROP_ATTRS,
  BOILERPLATE_TOKENS,
  COMMENT_TOKENS,
  ELEMENT_WITH_SIZE_ATTR,
  SERIALIZE_SKIP_TAGS,
} from './constants.js';
import {
  childNodesOf,
  classId,
  ELEMENT_NODE,
  getElementsByTagName,
  type HElement,
  type HNode,
  isElement,
  isText,
  tagOf,
  trim,
} from './dom.js';
import type { CoreOptions } from './options.js';

/** Tags emitted verbatim (with their whitelisted attributes). Generous on purpose. */
const EMIT_TAGS = new Set([
  // structural blocks
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'figure',
  'figcaption',
  // lists
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  // tables
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'colgroup',
  'col',
  // inline semantics
  'a',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'del',
  'ins',
  'mark',
  'small',
  'sub',
  'sup',
  'q',
  'cite',
  'abbr',
  'code',
  'kbd',
  'samp',
  'var',
  'time',
  'span',
  // media
  'img',
  'picture',
  'source',
  'video',
  'audio',
  // breaks
  'br',
  'hr',
]);

/** Void/self-closing tags emitted as `<tag>` with no closing tag. */
const VOID_TAGS = new Set(['br', 'hr', 'img', 'source', 'col', 'wbr']);

/** Minimal per-tag attribute whitelist for the re-serialized output. */
const ATTR_WHITELIST: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height'],
  source: ['src', 'srcset', 'type', 'media'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  time: ['datetime'],
  blockquote: ['cite'],
  q: ['cite'],
  col: ['span'],
  colgroup: ['span'],
  ol: ['start', 'type', 'reversed'],
  code: ['class'],
};

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Match a boilerplate token: whole-token for words, substring for hyphenated ids. */
function tokenMatch(haystack: string, token: string): boolean {
  if (token.includes('-')) return haystack.includes(token);
  return haystack.split(/[^a-z0-9]+/).includes(token);
}

/** Whether an element is boilerplate by its class/id (comments kept for forums). */
export function isBoilerplateNamed(el: HElement, opts: CoreOptions): boolean {
  const ci = classId(el).toLowerCase().trim();
  if (ci === '') return false;
  if (COMMENT_TOKENS.some((t) => tokenMatch(ci, t))) {
    return !opts.commentsAsContent;
  }
  return BOILERPLATE_TOKENS.some((t) => tokenMatch(ci, t));
}

/**
 * Concatenated text of the TEXT-node children that appear BEFORE the first child
 * element (go-trafilatura's `etree.Text(child)` — leading text only, never deep
 * descendant text). Stops at the first element node.
 */
function leadingText(el: HElement): string {
  let out = '';
  for (const node of childNodesOf(el)) {
    if (node.nodeType === ELEMENT_NODE) break;
    if (isText(node)) out += node.textContent;
  }
  return out;
}

/**
 * postCleaning — remove empty non-void elements and strip useless/unsafe
 * attributes in place (go-trafilatura postCleaning). An element is "empty" when
 * it has NO child elements and its LEADING text is blank — matching go's
 * `len(Children(child)) == 0 && !textCharsTest(etree.Text(child))`.
 */
export function postCleaning(root: HElement): void {
  const all = getElementsByTagName(root, '*');
  for (let i = all.length - 1; i >= 0; i--) {
    const el = all[i];
    if (el === undefined) continue;
    const isEmpty = trim(leadingText(el)) === '';
    const isVoid = VOID_TAGS.has(tagOf(el));
    if (el.children.length === 0 && isEmpty && !isVoid) {
      el.replaceWith(...childNodesOf(el));
    }
  }

  for (const el of getElementsByTagName(root, '*')) {
    const tag = tagOf(el);
    const allowsSize = ELEMENT_WITH_SIZE_ATTR.has(tag);
    for (const attr of Array.from(el.attributes)) {
      const key = attr.name.toLowerCase();
      if (ALWAYS_DROP_ATTRS.has(key)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((key === 'width' || key === 'height') && !allowsSize) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (!ALLOWED_ATTRIBUTES.has(key)) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

interface SerializeCtx {
  insideArticleOrMain: boolean;
}

function emitAttrs(el: HElement, tag: string, opts: CoreOptions): string {
  const allowed = ATTR_WHITELIST[tag];
  if (!allowed) return '';
  let out = '';
  for (const name of allowed) {
    if (tag === 'a' && name === 'href' && !opts.includeLinks) continue;
    const value = el.getAttribute(name);
    if (value === null || value === '') continue;
    out += ` ${name}="${escapeAttr(value)}"`;
  }
  return out;
}

function emitChildren(parent: HNode, opts: CoreOptions, ctx: SerializeCtx): string {
  let out = '';
  for (const node of childNodesOf(parent)) {
    if (isText(node)) {
      out += escapeText(node.textContent);
    } else if (isElement(node)) {
      out += emitElement(node, opts, ctx);
    }
  }
  return out;
}

function emitElement(el: HElement, opts: CoreOptions, ctx: SerializeCtx): string {
  const tag = tagOf(el);

  if (SERIALIZE_SKIP_TAGS.has(tag)) return '';
  if ((tag === 'header' || tag === 'footer') && !ctx.insideArticleOrMain) return '';
  if (isBoilerplateNamed(el, opts)) return '';

  const childCtx: SerializeCtx =
    ctx.insideArticleOrMain || tag === 'article' || tag === 'main'
      ? { insideArticleOrMain: true }
      : ctx;

  if (EMIT_TAGS.has(tag)) {
    if (tag === 'a' && !opts.includeLinks) return emitChildren(el, opts, childCtx);
    if ((tag === 'img' || tag === 'picture' || tag === 'source') && !opts.includeImages) {
      return '';
    }
    if (VOID_TAGS.has(tag)) {
      return `<${tag}${emitAttrs(el, tag, opts)}>`;
    }
    const inner = emitChildren(el, opts, childCtx);
    return `<${tag}${emitAttrs(el, tag, opts)}>${inner}</${tag}>`;
  }

  // Non-whitelisted and not skipped → unwrap (emit children, drop the tag).
  return emitChildren(el, opts, childCtx);
}

/**
 * Re-serialize the kept content element into a clean, whitelisted HTML string.
 * The root element's own tag is emitted when whitelisted, so callers get a
 * self-contained fragment.
 */
export function renderFilteredHTML(root: HElement, opts: CoreOptions): string {
  const ctx: SerializeCtx = { insideArticleOrMain: false };
  const html = emitElement(root, opts, ctx);
  return trim(html.replace(/\s+/g, ' ')) === '' ? '' : html.trim();
}
