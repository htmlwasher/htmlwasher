// SPDX-License-Identifier: Apache-2.0
// Ported VERBATIM from htmlprocessing-server presets/standard.ts (Apache-2.0).
// Do not diverge from the reference tag/attribute sets — parity is load-bearing.

import type { CleanConfig } from './types.js';

export const standardSetup: CleanConfig = {
  allowedTags: [
    // Document structure
    'html',
    'head',
    'meta',
    'title',
    'body',
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
  ],
  allowedAttributes: {
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
  },
  selfClosing: ['img', 'br', 'hr', 'meta', 'source', 'col', 'wbr'],
  nonTextTags: ['style', 'script', 'textarea', 'option'],
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
