import { describe, expect, it } from 'vitest';

import { parseDocument } from '../core/dom.js';
import { examineTitleElement, extractTitle } from './title.js';

const titleOf = (html: string): string | undefined => extractTitle(parseDocument(html));

describe('extractTitle', () => {
  it('takes the only h1 element', () => {
    expect(titleOf('<html><body><h1>The Only Heading</h1></body></html>')).toBe('The Only Heading');
  });

  it('uses an entry-title selector', () => {
    expect(
      titleOf(
        '<html><body><h2 class="entry-title">Post Title</h2><h1>x</h1><h1>y</h1></body></html>',
      ),
    ).toBe('Post Title');
  });

  it('uses a dot-free segment of the <title> tag', () => {
    const html =
      '<html><head><title>Great Article — Example.com</title></head><body><h1>a</h1><h1>b</h1></body></html>';
    expect(titleOf(html)).toBe('Great Article');
  });

  it('falls back to the first h2 when no h1/title qualifies', () => {
    const html = '<html><body><h2>Section Heading</h2></body></html>';
    expect(titleOf(html)).toBe('Section Heading');
  });

  it('returns undefined for an empty document', () => {
    expect(titleOf('<html><body></body></html>')).toBeUndefined();
  });

  it('space-joins a selector title split across adjacent inline elements (itertext)', () => {
    // Two h1s skip the single-h1 branch; the h2[class*=title] selector then wins
    // via selectMetaInfo, which must space-join "Post"+"Title" → "Post Title".
    const html =
      '<html><body><h1>a</h1><h1>b</h1><h2 class="entry-title"><span>Post</span><span>Title</span></h2></body></html>';
    expect(titleOf(html)).toBe('Post Title');
  });
});

describe('examineTitleElement', () => {
  it('splits "Article — Site" into parts', () => {
    const doc = parseDocument(
      '<html><head><title>My Story | Daily News</title></head><body></body></html>',
    );
    const parts = examineTitleElement(doc);
    expect(parts.first).toBe('My Story');
    expect(parts.second).toBe('Daily News');
  });
});
