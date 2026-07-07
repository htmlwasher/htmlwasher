// SPDX-License-Identifier: Apache-2.0
// Ported VERBATIM from htmlprocessing-server presets/styled.ts (Apache-2.0).
// Do not diverge from the reference tag/attribute sets — parity is load-bearing.
//
// Note the two divergences from `permissive`:
//   - the `style` tag is allowed (its CSS text is preserved, not discarded);
//   - a global `'*': ['class', 'style']` attribute rule is added; and
//   - `nonTextTags` drops `style`, so `<style>` element content survives.
// sanitize-html does NOT filter `url()` inside inline `style` / `<style>` text,
// so the cleaning pipeline layers an explicit CSS cleaner on top for this level
// (see ../css-cleaner.ts).

import type { CleanConfig } from './types.js';

export const styledSetup: CleanConfig = {
  allowedTags: [
    // Document structure
    'html',
    'head',
    'meta',
    'title',
    'body',
    // Styling
    'style',
    // Block-level
    'p',
    'blockquote',
    'hr',
    'figure',
    'figcaption',
    // Links
    'a',
    // Text formatting
    'strong',
    'em',
    'b',
    'i',
    's',
    'u',
    'br',
    // Headings
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    // Images and responsive pictures
    'img',
    'picture',
    'source',
    // Media
    'video',
    'audio',
    'track',
    // Tables
    'table',
    'caption',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'col',
    'colgroup',
    // Code
    'code',
    'pre',
    // Lists
    'ul',
    'ol',
    'li',
    // Definition lists
    'dl',
    'dt',
    'dd',
    // Inline semantic
    'abbr',
    'cite',
    'dfn',
    'kbd',
    'samp',
    'var',
    'mark',
    'small',
    'q',
    'wbr',
    // Edit tracking
    'del',
    'ins',
    // Typographic
    'sub',
    'sup',
    // Time
    'time',
    // Structural HTML5
    'article',
    'section',
    'main',
    'header',
    'footer',
    'nav',
    'aside',
    'hgroup',
    'address',
    'search',
    // Containers
    'div',
    'span',
    // Interactive
    'details',
    'summary',
    // Legacy (image maps)
    'map',
    'area',
    // Text-level (bidi, ruby)
    'bdi',
    'bdo',
    'ruby',
    'rp',
    'rt',
  ],
  allowedAttributes: {
    '*': ['class', 'style'],
    html: ['lang'],
    meta: ['charset', 'name', 'content'],
    a: ['href', 'title', 'target'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    blockquote: ['cite'],
    time: ['datetime'],
    abbr: ['title'],
    del: ['datetime', 'cite'],
    ins: ['datetime', 'cite'],
    ol: ['start', 'type', 'reversed'],
    source: ['srcset', 'sizes', 'media', 'type', 'src'],
    video: ['src', 'width', 'height', 'poster', 'controls', 'preload'],
    audio: ['src', 'controls', 'preload'],
    col: ['span'],
    colgroup: ['span'],
    details: ['open'],
    track: ['src', 'kind', 'srclang', 'label', 'default'],
    map: ['name'],
    area: ['href', 'alt', 'shape', 'coords', 'target'],
  },
  selfClosing: ['img', 'br', 'hr', 'meta', 'source', 'col', 'wbr', 'track', 'area'],
  nonTextTags: ['script', 'textarea', 'option'],
  transformTags: {
    strike: 'del',
    tt: 'code',
    acronym: 'abbr',
    dir: 'ul',
    listing: 'pre',
    xmp: 'pre',
    plaintext: 'pre',
  },
};
