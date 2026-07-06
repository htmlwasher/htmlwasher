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
  ALWAYS_EXCLUDED_COMMENT_NAME_TOKENS,
  ALWAYS_EXCLUDED_NAME_TOKENS,
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

/**
 * BEM-style layout/component prefixes (rs LAYOUT_COMPONENT_PREFIXES). A token like
 * `l-sidebar-fixed` / `c-social-buttons` is a layout-component namespace, not site
 * furniture, and rs exempts it when its ONLY boilerplate hit is `sidebar`/`social`.
 */
const LAYOUT_COMPONENT_PREFIXES = ['l-', 'c-'];

/** Position words that mark an ACTUAL sidebar element (rs SIDEBAR_POSITION_WORDS). */
const SIDEBAR_POSITION_WORDS = new Set(['left', 'right', 'primary', 'secondary', 'main', 'widget']);

function hasLayoutComponentPrefix(token: string): boolean {
  return LAYOUT_COMPONENT_PREFIXES.some((p) => token.startsWith(p));
}

/**
 * rs is_boilerplate's `sidebar`-position guard (extract.rs:3253-3265). A bare
 * `sidebar` part is real furniture only when it is the sole part, the first part,
 * or preceded by a position word; theme namespaces like `newspaper-x-sidebar` are
 * NOT boilerplate.
 */
function sidebarTokenMatches(token: string): boolean {
  const parts = token.split(/[-_]/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== 'sidebar') continue;
    if (parts.length === 1 || i === 0) return true;
    if (i > 0 && SIDEBAR_POSITION_WORDS.has(parts[i - 1] ?? '')) return true;
  }
  return false;
}

/**
 * Per-token boilerplate verdict with rs is_boilerplate's false-positive guards
 * (extract.rs:3215-3312), adapted to the distilled BOILERPLATE_TOKENS list:
 *  - `sidebar` uses position-aware matching (newspaper-x-sidebar is NOT furniture);
 *  - `widget` is skipped when preceded by `elementor` (Elementor content widgets);
 *  - `l-`/`c-` layout-component tokens are exempt when their ONLY hit is `sidebar`
 *    or `social` (l-sidebar-fixed, c-social-buttons), but still match when another
 *    boilerplate word remains (c-social-share keeps matching via `share`).
 */
function boilerplateTokenMatches(token: string): boolean {
  const matched = BOILERPLATE_TOKENS.filter((t) => {
    if (t === 'sidebar') return sidebarTokenMatches(token);
    return tokenMatch(token, t);
  });
  if (matched.length === 0) return false;

  // Elementor content widgets: skip a `widget` hit when preceded by `elementor`.
  const parts = token.split(/[-_]/);
  const widgetIsElementor = parts.some(
    (p, i) => p === 'widget' && i > 0 && parts[i - 1] === 'elementor',
  );
  const effective = widgetIsElementor ? matched.filter((t) => t !== 'widget') : matched;
  if (effective.length === 0) return false;

  // Layout/component-prefixed tokens: exempt when the ONLY hit is `sidebar`/`social`.
  if (hasLayoutComponentPrefix(token)) {
    const onlySidebarOrSocial = effective.every((t) => t === 'sidebar' || t === 'social');
    if (onlySidebarOrSocial) return false;
  }

  return true;
}

/**
 * Whether a class/id is UNCONDITIONALLY excluded (rs is_always_excluded_name,
 * extract.rs:2934-2953) — independent of the boilerplate-token backoff. Substring
 * match, case-insensitive. The comment-prefixed entries are scoped behind
 * `!commentsAsContent` so the forum profile keeps comment threads.
 */
function isAlwaysExcludedClassId(ci: string, opts: CoreOptions): boolean {
  if (ci === '') return false;
  if (ALWAYS_EXCLUDED_NAME_TOKENS.some((t) => ci.includes(t))) return true;
  if (!opts.commentsAsContent && ALWAYS_EXCLUDED_COMMENT_NAME_TOKENS.some((t) => ci.includes(t))) {
    return true;
  }
  return false;
}

/**
 * Whether an element is UNCONDITIONALLY excluded by name or microdata, mirroring
 * rs push_filtered_html_children's checks that run OUTSIDE the
 * `filter_named_boilerplate` gate: the `is_always_excluded_name` class/id list AND
 * the `itemtype` *=`breadcrumblist` drop (extract.rs:2727-2736, 2750-2755). This
 * fires even in the §10 boilerplate-token backoff. MUST run before postCleaning,
 * which strips id/class/itemtype.
 */
export function isAlwaysExcludedName(el: HElement, opts: CoreOptions): boolean {
  const itemtype = el.getAttribute('itemtype');
  if (itemtype?.toLowerCase().includes('breadcrumblist')) return true;
  return isAlwaysExcludedClassId(classId(el).toLowerCase().trim(), opts);
}

/**
 * Whether an element is boilerplate by its class/id (comments kept for forums).
 *
 * Note: in the production pipeline this serialize-time guard is a defense-in-depth
 * redundancy — `renderClone` (extract.ts) runs the real name-based removal in a
 * DOM pass BEFORE postCleaning, which strips id/class so `classId(el)` is already
 * empty by the time emitElement calls this. The real removal is owned by
 * `removeAlwaysExcludedNamed`/`removeBoilerplateNamed` in extract.ts; this stays
 * to keep the serializer self-protecting for callers that skip postCleaning (and
 * the unit tests that exercise it in isolation with class/id still present).
 */
export function isBoilerplateNamed(el: HElement, opts: CoreOptions): boolean {
  if (isAlwaysExcludedName(el, opts)) return true;
  const ci = classId(el).toLowerCase().trim();
  if (ci === '') return false;
  if (COMMENT_TOKENS.some((t) => tokenMatch(ci, t))) {
    return !opts.commentsAsContent;
  }
  return ci.split(/\s+/).some((token) => boilerplateTokenMatches(token));
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
