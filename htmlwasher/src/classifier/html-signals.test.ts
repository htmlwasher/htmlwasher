// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { refineWithHtmlSignals } from './html-signals.js';

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
