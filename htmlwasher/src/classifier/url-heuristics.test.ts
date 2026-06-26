// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { classifyUrl } from './url-heuristics.js';

describe('classifyUrl — Stage-1 URL heuristics', () => {
  it('empty URL → article', () => {
    expect(classifyUrl('')).toBe('article');
  });

  it('forum domain → forum', () => {
    expect(classifyUrl('https://bbs.archlinux.org/')).toBe('forum');
    expect(classifyUrl('https://forum.example.com/')).toBe('forum');
    expect(classifyUrl('https://example.com/threads/123')).toBe('forum');
  });

  it('docs domain/path → documentation (before article)', () => {
    expect(classifyUrl('https://docs.aws.amazon.com/')).toBe('documentation');
    expect(classifyUrl('https://example.com/docs/guide/')).toBe('documentation');
  });

  it('product path / shop domain → product (before category)', () => {
    expect(classifyUrl('https://example.com/products/widget')).toBe('product');
    expect(classifyUrl('https://shop.example.com/')).toBe('product');
  });

  it('category path → collection (wire string)', () => {
    expect(classifyUrl('https://example.com/collections/all')).toBe('collection');
    expect(classifyUrl('https://example.com/category/shoes')).toBe('collection');
  });

  it('service path / slug → service', () => {
    expect(classifyUrl('https://example.com/services/')).toBe('service');
    expect(classifyUrl('https://example.com/ai-consulting-services')).toBe('service');
  });

  it('listing endings and contains → listing', () => {
    expect(classifyUrl('https://example.com/news')).toBe('listing');
    expect(classifyUrl('https://example.com/awards/2024')).toBe('listing');
  });

  it('article path / blog slug → article', () => {
    expect(classifyUrl('https://example.com/blog/my-post')).toBe('article');
    expect(classifyUrl('https://example.com/10-tips-for-x')).toBe('article');
  });

  it('unmatched → article (default)', () => {
    expect(classifyUrl('https://example.com/')).toBe('article');
  });

  it('malformed `https:///` → article (empty domain/path "/")', () => {
    expect(classifyUrl('https:///')).toBe('article');
  });
});
