import { describe, expect, it } from 'vitest';
import { extractAuthor } from './author-dom.js';
import { parseDocument } from './dom.js';

const authorOf = (html: string): string | undefined => extractAuthor(parseDocument(html));

describe('extractAuthor', () => {
  it('space-joins a byline split across adjacent inline elements (itertext)', () => {
    // textContent would yield "JohnDoe"; canonical extract_metainfo space-joins.
    const html =
      '<html><body><div class="author"><span>John</span><span>Doe</span></div></body></html>';
    expect(authorOf(html)).toBe('John Doe');
  });

  it('extracts a simple byline', () => {
    expect(authorOf('<html><body><span class="author">Jane Roe</span></body></html>')).toBe(
      'Jane Roe',
    );
  });
});
