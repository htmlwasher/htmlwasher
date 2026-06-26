// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseDocumentSpec } from '../core/dom.js';
import { extractHtmlSignals, refineWithHtmlSignals } from './html-signals.js';

describe('refineWithHtmlSignals — Stage-2 (only overrides article)', () => {
  it('leaves a non-article type unchanged', () => {
    expect(refineWithHtmlSignals('product', '<html><body></body></html>')).toBe('product');
    expect(refineWithHtmlSignals('forum', '<html><body></body></html>')).toBe('forum');
  });

  it('CollectionPage JSON-LD → collection', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"CollectionPage"}</script>
    </head><body></body></html>`;
    expect(refineWithHtmlSignals('article', html)).toBe('collection');
  });

  it('single Product JSON-LD → product', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"Product","name":"X"}</script>
    </head><body></body></html>`;
    expect(refineWithHtmlSignals('article', html)).toBe('product');
  });

  it('docs nav + >=3 code blocks → documentation', () => {
    const html = `<html><body>
      <div class="docs-sidebar"></div>
      <pre>a</pre><code>b</code><pre>c</pre>
    </body></html>`;
    expect(refineWithHtmlSignals('article', html)).toBe('documentation');
  });

  it('plain article stays article', () => {
    const html = '<html><body><article><p>words here</p></article></body></html>';
    expect(refineWithHtmlSignals('article', html)).toBe('article');
  });
});

describe('extractHtmlSignals — paragraphWordCount uses CPython whitespace (FIX H)', () => {
  const NEL = String.fromCodePoint(0x85); // CPython whitespace, JS \s ✗
  const FS = String.fromCodePoint(0x1c); // CPython whitespace, JS \s ✗
  const BOM = String.fromCodePoint(0xfeff); // CPython keeps it, JS .trim() strips it

  it('counts words split on U+0085 / U+001C (CPython, not JS \\s)', () => {
    const doc = parseDocumentSpec(`<html><body><p>one${NEL}two${FS}three</p></body></html>`);
    expect(extractHtmlSignals(doc).paragraphWordCount).toBe(3);
  });

  it('does NOT split on U+FEFF (BOM stays attached, one word)', () => {
    const doc = parseDocumentSpec(`<html><body><p>alpha${BOM}beta</p></body></html>`);
    expect(extractHtmlSignals(doc).paragraphWordCount).toBe(1);
  });
});
