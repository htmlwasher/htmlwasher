import { describe, expect, it } from 'vitest';

import { parseDocument } from '../core/dom.js';
import { extractSitename, normalizeSitename } from './sitename.js';

describe('extractSitename', () => {
  it('takes the dot-containing half of a split title', () => {
    const doc = parseDocument(
      '<html><head><title>Story — Example.com</title></head><body></body></html>',
    );
    expect(extractSitename(doc)).toBe('Example.com');
  });
});

describe('normalizeSitename', () => {
  const empty = parseDocument('<html><head></head><body></body></html>');

  it('strips a leading @ from a Twitter-style sitename', () => {
    expect(normalizeSitename(empty, '@ExampleSite', undefined)).toBe('ExampleSite');
  });

  it('title-cases a lowercase dot-free sitename', () => {
    expect(normalizeSitename(empty, 'example news', undefined)).toBe('Example News');
  });

  it('leaves a domain-style sitename unchanged', () => {
    expect(normalizeSitename(empty, 'example.com', undefined)).toBe('example.com');
  });

  it('falls back to the URL host when no sitename is found', () => {
    expect(normalizeSitename(empty, undefined, 'https://www.example.com/a')).toBe('example.com');
  });
});
