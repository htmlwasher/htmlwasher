// SPDX-License-Identifier: Apache-2.0
// Pins the Trafilatura-alignment invariants of DEFAULT_CLEAN_CONFIG (see the
// derivation in config.ts): the allow-list is Trafilatura's HTML output
// vocabulary union rs-trafilatura's serializer whitelist, MANUALLY_CLEANED
// backs nonTextTags, and MANUALLY_STRIPPED tags are simply absent (unwrapped).

import { describe, expect, it } from 'vitest';
import { DEFAULT_CLEAN_CONFIG } from './config.js';

const allowed = new Set(DEFAULT_CLEAN_CONFIG.allowedTags);
const nonText = new Set(DEFAULT_CLEAN_CONFIG.nonTextTags);

describe('DEFAULT_CLEAN_CONFIG — allowedTags', () => {
  it("contains Trafilatura's full HTML output vocabulary", () => {
    // TEI_VALID_TAGS rendered via HTML_CONVERSIONS (trafilatura 2.1.0) + scaffolding.
    const trafilaturaHtmlOutput = [
      'html',
      'head',
      'meta',
      'body',
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'li',
      'pre',
      'blockquote',
      'br',
      'img',
      'a',
      'i',
      'strong',
      'u',
      'var',
      'sub',
      'sup',
      'table',
      'tr',
      'td',
      'th',
      'del',
    ];
    for (const tag of trafilaturaHtmlOutput) {
      expect(allowed, `expected allowedTags to contain <${tag}>`).toContain(tag);
    }
  });

  it("contains rs-trafilatura's additional content-semantic tags", () => {
    const rsAdditions = [
      'ol',
      'code',
      'hr',
      'dl',
      'dt',
      'dd',
      'caption',
      'colgroup',
      'col',
      'q',
      'em',
      'b',
      's',
      'kbd',
      'samp',
      'figure',
      'figcaption',
      'picture',
      'source',
    ];
    for (const tag of rsAdditions) {
      expect(allowed, `expected allowedTags to contain <${tag}>`).toContain(tag);
    }
  });

  it('excludes what both upstreams strip or clean (containers, row groups, media)', () => {
    const excluded = [
      'div',
      'span',
      'section',
      'article',
      'main',
      'header',
      'footer',
      'thead',
      'tbody',
      'tfoot',
      'abbr',
      'cite',
      'mark',
      'small',
      'ins',
      'time',
      'video',
      'audio',
      'nav',
      'aside',
      'form',
      'style',
      'script',
      'iframe',
    ];
    for (const tag of excluded) {
      expect(allowed, `expected allowedTags to NOT contain <${tag}>`).not.toContain(tag);
    }
  });
});

describe('DEFAULT_CLEAN_CONFIG — nonTextTags (MANUALLY_CLEANED)', () => {
  it('discards script/style and form/media/navigation subtrees', () => {
    for (const tag of [
      'script',
      'style',
      'noscript',
      'iframe',
      'textarea',
      'option',
      'form',
      'nav',
      'aside',
      'video',
      'audio',
      'time',
      'svg',
      'canvas',
    ]) {
      expect(nonText, `expected nonTextTags to contain <${tag}>`).toContain(tag);
    }
  });

  it('never discards the image-mode rescues or scaffolding/header/footer', () => {
    for (const tag of ['figure', 'picture', 'source', 'head', 'header', 'footer']) {
      expect(nonText, `expected nonTextTags to NOT contain <${tag}>`).not.toContain(tag);
    }
  });

  it('never lists an allowed tag as nonText (the two sets are disjoint)', () => {
    for (const tag of nonText) {
      expect(allowed, `<${tag}> is both allowed and nonText`).not.toContain(tag);
    }
  });
});

describe('DEFAULT_CLEAN_CONFIG — attributes and transforms', () => {
  it("keeps Trafilatura's link/image attributes and no on* anywhere", () => {
    const attrs = DEFAULT_CLEAN_CONFIG.allowedAttributes ?? {};
    expect(attrs.a).toEqual(['href', 'title']);
    expect(attrs.img).toEqual(['src', 'alt', 'title', 'width', 'height']);
    for (const [tag, list] of Object.entries(attrs)) {
      expect(allowed, `attributes configured for disallowed tag <${tag}>`).toContain(tag);
      for (const attr of list) {
        expect(attr.toLowerCase().startsWith('on'), `on* attribute on <${tag}>`).toBe(false);
      }
    }
  });

  it('maps every deprecated-tag transform into the allowed set', () => {
    const transforms = DEFAULT_CLEAN_CONFIG.transformTags ?? {};
    expect(transforms.strike).toBe('del');
    expect(transforms.tt).toBe('var');
    for (const [from, to] of Object.entries(transforms)) {
      expect(allowed, `transform target <${to}> (from <${from}>) must be allowed`).toContain(to);
      expect(allowed, `transform source <${from}> must not itself be allowed`).not.toContain(from);
    }
  });

  it('lists only void elements as selfClosing', () => {
    expect(DEFAULT_CLEAN_CONFIG.selfClosing).toEqual(['img', 'br', 'hr', 'meta', 'source', 'col']);
  });
});

describe('DEFAULT_CLEAN_CONFIG — immutability', () => {
  it('is deeply frozen (mutation cannot poison the shared default)', () => {
    expect(Object.isFrozen(DEFAULT_CLEAN_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CLEAN_CONFIG.allowedTags)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CLEAN_CONFIG.nonTextTags)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CLEAN_CONFIG.allowedAttributes)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CLEAN_CONFIG.allowedAttributes?.a)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CLEAN_CONFIG.transformTags)).toBe(true);
    expect(() => DEFAULT_CLEAN_CONFIG.allowedTags?.push('script')).toThrow(TypeError);
  });
});
