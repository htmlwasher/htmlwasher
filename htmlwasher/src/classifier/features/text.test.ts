// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseDocumentSpec } from '../../core/dom.js';
import { ogType, scanMeta, titleMetaText } from './text.js';

describe('titleMetaText — TF-IDF input', () => {
  it('joins <title> and meta description with a single space', () => {
    const html = `<!doctype html><html><head>
      <title>  Best Coffee 2025  </title>
      <meta name="description" content="  A guide to coffee.  ">
    </head><body>ignored body text</body></html>`;
    expect(titleMetaText(html)).toBe('Best Coffee 2025 A guide to coffee.');
  });

  it('uses the FIRST present description key (description > og:description > ...)', () => {
    const html = `<!doctype html><html><head>
      <title>T</title>
      <meta property="og:description" content="og desc">
      <meta name="twitter:description" content="tw desc">
    </head><body></body></html>`;
    // description absent → first present is og:description.
    expect(titleMetaText(html)).toBe('T og desc');
  });

  it('empty title and no description → single space', () => {
    const html = '<!doctype html><html><head></head><body>x</body></html>';
    expect(titleMetaText(html)).toBe(' ');
  });
});

describe('scanMeta / ogType', () => {
  it('first-wins per routing key; empty key or content skipped', () => {
    const html = `<!doctype html><html><head>
      <meta name="description" content="first">
      <meta name="description" content="second">
      <meta name="empty" content="">
      <meta property="og:type" content="Article">
    </head><body></body></html>`;
    const doc = parseDocumentSpec(html);
    const meta = scanMeta(doc);
    expect(meta.get('description')).toBe('first');
    expect(meta.has('empty')).toBe(false);
    expect(ogType(doc)).toBe('article'); // lowercased
  });
});
