// SPDX-License-Identifier: Apache-2.0
// Tag catalogs + selector substrings ported from go-trafilatura (Apache-2.0),
// itself ported from adbar/trafilatura. Sources:
//   - settings.go (tagsToClean, tagsToStrip, emptyTagsToRemove, allowedAttributes,
//     elementWithSizeAttr) — verbatim.
//   - internal/selector/content.go (contentRule1..5) — the content-node selectors.

/** Removed including their children (the "tags to clean" list, settings.go:24). */
export const TAGS_TO_CLEAN = new Set([
  'aside',
  'embed',
  'footer',
  'form',
  'head',
  'iframe',
  'menu',
  'object',
  'script',
  'applet',
  'audio',
  'canvas',
  'figure',
  'map',
  'picture',
  'svg',
  'video',
  'area',
  'blink',
  'button',
  'datalist',
  'dialog',
  'frame',
  'frameset',
  'fieldset',
  'link',
  'input',
  'ins',
  'label',
  'legend',
  'marquee',
  'math',
  'menuitem',
  'nav',
  'noscript',
  'optgroup',
  'option',
  'output',
  'param',
  'progress',
  'rp',
  'rt',
  'rtc',
  'select',
  'source',
  'style',
  'track',
  'textarea',
  'time',
  'use',
]);

/** Unwrapped (tag removed, children kept) — the "tags to strip" list (settings.go:37). */
export const TAGS_TO_STRIP = new Set([
  'abbr',
  'acronym',
  'address',
  'bdi',
  'bdo',
  'big',
  'cite',
  'data',
  'dfn',
  'font',
  'hgroup',
  'img',
  'ins',
  'mark',
  'meta',
  'ruby',
  'small',
  'template',
  'tbody',
  'tfoot',
  'thead',
]);

/** Empty instances of these are pruned (settings.go:44). */
export const EMPTY_TAGS_TO_REMOVE = new Set([
  'article',
  'b',
  'blockquote',
  'dd',
  'div',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'li',
  'main',
  'p',
  'pre',
  'q',
  'section',
  'span',
  'strong',
]);

/** Only these may keep `width`/`height` after postCleaning (settings.go:79). */
export const ELEMENT_WITH_SIZE_ATTR = new Set(['table', 'th', 'td', 'hr', 'pre']);

/** Presentational/identification attributes always dropped in postCleaning (html-processing.go:429). */
export const ALWAYS_DROP_ATTRS = new Set([
  'id',
  'class',
  'align',
  'background',
  'bgcolor',
  'border',
  'cellpadding',
  'cellspacing',
  'frame',
  'hspace',
  'rules',
  'style',
  'valign',
  'vspace',
]);

/**
 * The go-domdistiller allowed-attribute whitelist used by postCleaning
 * (settings.go:82). Any attribute not in this set is dropped. (Trimmed of the
 * presentational keys that ALWAYS_DROP_ATTRS removes first.)
 */
export const ALLOWED_ATTRIBUTES = new Set([
  'abbr',
  'accept-charset',
  'accept',
  'accesskey',
  'action',
  'alink',
  'allow',
  'allowfullscreen',
  'allowpaymentrequest',
  'alt',
  'archive',
  'as',
  'async',
  'autocapitalize',
  'autocomplete',
  'autocorrect',
  'autofocus',
  'autoplay',
  'autopictureinpicture',
  'axis',
  'capture',
  'char',
  'challenge',
  'charoff',
  'charset',
  'checked',
  'cite',
  'classid',
  'clear',
  'code',
  'codebase',
  'codetype',
  'color',
  'cols',
  'colspan',
  'compact',
  'content',
  'contenteditable',
  'controls',
  'controlslist',
  'coords',
  'crossorigin',
  'csp',
  'data',
  'datetime',
  'declare',
  'decoding',
  'default',
  'defer',
  'dir',
  'direction',
  'dirname',
  'disabled',
  'download',
  'draggable',
  'enctype',
  'end',
  'enterkeyhint',
  'event',
  'face',
  'for',
  'form',
  'formaction',
  'formenctype',
  'formmethod',
  'formnovalidate',
  'formtarget',
  'headers',
  'height',
  'hidden',
  'high',
  'href',
  'hreflang',
  'http-equiv',
  'imagesizes',
  'imagesrcset',
  'inputmode',
  'integrity',
  'is',
  'ismap',
  'kind',
  'label',
  'lang',
  'language',
  'list',
  'loading',
  'longdesc',
  'loop',
  'low',
  'max',
  'maxlength',
  'media',
  'method',
  'min',
  'minlength',
  'multiple',
  'muted',
  'name',
  'nonce',
  'nowrap',
  'open',
  'optimum',
  'pattern',
  'placeholder',
  'playsinline',
  'ping',
  'poster',
  'preload',
  'readonly',
  'referrerpolicy',
  'rel',
  'required',
  'rev',
  'reversed',
  'role',
  'rows',
  'rowspan',
  'sandbox',
  'scope',
  'selected',
  'shape',
  'size',
  'sizes',
  'slot',
  'span',
  'spellcheck',
  'src',
  'srcset',
  'srcdoc',
  'srclang',
  'standby',
  'start',
  'step',
  'summary',
  'tabindex',
  'target',
  'text',
  'title',
  'translate',
  'type',
  'usemap',
  'value',
  'valuetype',
  'version',
  'width',
  'wrap',
]);

/**
 * Content-node selector predicates, ported from go-trafilatura
 * internal/selector/content.go (contentRule1..5). Each rule is tried in order;
 * the first matching element (in document order) becomes the content root.
 * Matching uses the union of an element's `class` + `id`.
 */
export interface ContentRule {
  /** Allowed tag names for this rule. */
  tags: Set<string>;
  /** Exact `class`/`id`/`role` equalities (case-sensitive, matching the Go source). */
  equals?: { class?: string[]; id?: string[]; role?: string[] };
  /** Case-sensitive substring matches against `class`/`id`. */
  contains?: { class?: string[]; id?: string[] };
  /** Case-insensitive substring matches against `class`/`id` (Go `translate(...)`). */
  containsLower?: { class?: string[]; id?: string[] };
  /** itemprop equality. */
  itemprop?: string[];
  /** `starts-with` predicates on class/id/role (contentRule5). */
  startsWith?: { class?: string[]; id?: string[]; role?: string[] };
  /** Bare tag match with no class/id predicate (contentRule5's `(.//main)`). */
  bareTag?: string[];
}

const ARTICLE_DIV_MAIN_SECTION = new Set(['article', 'div', 'main', 'section']);

export const CONTENT_RULES: ContentRule[] = [
  // contentRule1 — the canonical article-body classes/ids.
  {
    tags: ARTICLE_DIV_MAIN_SECTION,
    equals: { class: ['post', 'entry'], id: ['articleContent'] },
    contains: {
      class: [
        'post-text',
        'post_text',
        'post-body',
        'post-entry',
        'postentry',
        'post-content',
        'post_content',
        'post_inner_wrapper',
        'article-text',
        'entry-content',
        'article-content',
        'article__content',
        'article-body',
        'article__body',
        'ArticleContent',
        'page-content',
        'text-content',
        'body-text',
        'article__container',
        'art-content',
      ],
      id: [
        'entry-content',
        'article-content',
        'article__content',
        'article-body',
        'article__body',
        'body-text',
        'art-content',
      ],
    },
    containsLower: {
      class: ['postcontent', 'articletext', 'articlebody'],
      id: ['articlebody'],
    },
    itemprop: ['articleBody'],
  },
  // contentRule2 — any bare <article> (runs before the class-based rules).
  {
    tags: new Set(),
    bareTag: ['article'],
  },
  // contentRule3 — story/blog/single-content classes, plus role=article.
  {
    tags: ARTICLE_DIV_MAIN_SECTION,
    equals: {
      class: ['postarea', 'art-postcontent', 'text', 'cell', 'story'],
      id: ['article', 'story'],
      role: ['article'],
    },
    startsWith: { id: ['primary'], class: ['article '] },
    contains: {
      class: [
        'post-bodycopy',
        'storycontent',
        'story-content',
        'theme-content',
        'blog-content',
        'section-content',
        'single-content',
        'single-post',
        'main-column',
        'wpb_text_column',
        'story-body',
        'field-body',
      ],
      id: ['story-body'],
    },
    containsLower: { class: ['fulltext'] },
  },
  // contentRule4 — content-main / main-content / content-body.
  {
    tags: ARTICLE_DIV_MAIN_SECTION,
    equals: { class: ['content'], id: ['content'] },
    contains: {
      class: ['content-main', 'content_main', 'content-body', 'content__body'],
      id: ['content-main', 'content-body', 'contentBody'],
    },
    containsLower: { class: ['main-content', 'page-content'] },
  },
  // contentRule5 — anything starting with "main", plus the bare <main>.
  {
    tags: new Set(['article', 'div', 'section']),
    startsWith: { class: ['main'], id: ['main'], role: ['main'] },
    bareTag: ['main'],
  },
];

/**
 * Always skipped entirely by the whitelist re-serializer (rs
 * push_filtered_html_children's always-excluded tags). Form controls and other
 * interactive elements are NOT listed here — `cleanDocument` removes them via
 * TAGS_TO_CLEAN, and a profile that *preserves* a tag (e.g. the forum `<form>`,
 * which holds the thread) must reach the serializer and be unwrapped, not dropped.
 */
export const SERIALIZE_SKIP_TAGS = new Set([
  'nav',
  'aside',
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'ins',
]);

/**
 * Boilerplate class/id tokens. An element whose `class`/`id` contains one of
 * these (token- or substring-wise) is dropped by the re-serializer — unless it
 * is a `comment*` token and comments are being treated as content (forum profile).
 * Distilled from rs-trafilatura is_boilerplate / is_always_excluded_name and the
 * go-trafilatura content-discard selectors.
 */
export const BOILERPLATE_TOKENS = [
  'nav',
  'navbar',
  'navigation',
  'menu',
  'sidebar',
  'breadcrumb',
  'pagination',
  'masthead',
  'banner',
  'share',
  'sharing',
  'social',
  'related',
  'promo',
  'advert',
  'advertisement',
  'sponsor',
  'widget',
  'cookie',
  'popup',
  'modal',
  'newsletter',
  'subscribe',
  'byline',
  'author-box',
  'meta-info',
  'metadata',
  'read-more',
  'readmore',
  'more-link',
  'skip-link',
  'screen-reader',
  'sr-only',
  'visually-hidden',
  'wp-caption',
  'caption-text',
  'tags',
  'tag-list',
  'category-list',
  'comment-respond',
  'comment-form',
  'reply',
];

/** Comment-container tokens (kept when comments are treated as content). */
export const COMMENT_TOKENS = ['comment', 'comments', 'disqus', 'discussion'];
