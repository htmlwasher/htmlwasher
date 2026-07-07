// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { isHtmlDocument, normalizeHtml } from './normalize.js';

describe('isHtmlDocument', () => {
  it('detects doctype/html/head/body markers', () => {
    expect(isHtmlDocument('<!DOCTYPE html><html></html>')).toBe(true);
    expect(isHtmlDocument('<html lang="en">x</html>')).toBe(true);
    expect(isHtmlDocument('<head><title>t</title></head>')).toBe(true);
    expect(isHtmlDocument('<body>x</body>')).toBe(true);
  });

  it('treats a bare fragment as not-a-document', () => {
    expect(isHtmlDocument('<p>hi</p><div>x</div>')).toBe(false);
  });
});

describe('normalizeHtml', () => {
  it('returns empty string for empty/whitespace input', () => {
    expect(normalizeHtml('').html).toBe('');
    expect(normalizeHtml('   ').html).toBe('');
  });

  it('well-forms a broken fragment without throwing', () => {
    const result = normalizeHtml('<p><b>unclosed <div>broken', true);
    expect(result.html).toBeDefined();
    expect(result.messages).toEqual([]);
  });

  it('parses a full document with the html/head/body scaffold', () => {
    const result = normalizeHtml('<html><body><p>hi</p></body></html>', false);
    expect(result.html).toContain('<html>');
    expect(result.html).toContain('<body>');
  });
});
