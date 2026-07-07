import { describe, expect, it } from 'vitest';

import { parseDocument } from './dom.js';
import { iterText, unescapeHtml } from './text.js';

describe('unescapeHtml', () => {
  it('decodes the named and numeric entity subset', () => {
    expect(unescapeHtml('a &lt;b&gt; &quot;c&quot; &apos;d&apos; &amp; e&nbsp;f')).toBe(
      'a <b> "c" \'d\' & e f',
    );
    expect(unescapeHtml('&#60;&#x3E;')).toBe('<>');
  });

  it('single-pass: a double-escaped title decodes one level, not two (html.unescape semantics)', () => {
    // Regression: chained replaces decoded `&amp;lt;` → `&lt;` → `<`.
    expect(unescapeHtml('Using &amp;lt;template&amp;gt; tags')).toBe('Using &lt;template&gt; tags');
    expect(unescapeHtml('&amp;#60;')).toBe('&#60;');
  });
});

describe('iterText', () => {
  it('space-joins adjacent inline text nodes (mirrors lxml itertext)', () => {
    const doc = parseDocument(
      '<html><body><div id="x"><span>John</span><span>Doe</span></div></body></html>',
    );
    const el = doc.querySelector('#x');
    expect(el).not.toBeNull();
    if (!el) return;
    // textContent would yield "JohnDoe"; itertext joins with a space.
    expect(iterText(el).trim()).toBe('John Doe');
  });

  it('walks nested descendants in document order', () => {
    const doc = parseDocument('<html><body><p id="p">A<b>B<i>C</i></b>D</p></body></html>');
    const el = doc.querySelector('#p');
    expect(el).not.toBeNull();
    if (!el) return;
    expect(iterText(el).replace(/\s+/g, ' ').trim()).toBe('A B C D');
  });
});
