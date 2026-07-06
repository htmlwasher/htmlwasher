import { describe, expect, it } from 'vitest';

import { parseDocument } from '../core/dom.js';
import { iterText } from './text.js';

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
