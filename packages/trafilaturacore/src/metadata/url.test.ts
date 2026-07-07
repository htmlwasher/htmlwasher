import { describe, expect, it } from 'vitest';

import { parseDocument } from './dom.js';
import { extractDomain, extractUrl, getBaseUrl, isValidUrl } from './url.js';

describe('isValidUrl', () => {
  it('accepts http(s) URLs with a host', () => {
    expect(isValidUrl('https://example.com/a')).toBe(true);
    expect(isValidUrl('http://example.com')).toBe(true);
  });
  it('rejects relative, mailto, and garbage', () => {
    expect(isValidUrl('/relative')).toBe(false);
    expect(isValidUrl('mailto:a@b.c')).toBe(false);
    expect(isValidUrl('not a url')).toBe(false);
  });
});

describe('extractDomain', () => {
  it('strips a leading www. / wNN.', () => {
    expect(extractDomain('https://www.example.com/x')).toBe('example.com');
    expect(extractDomain('https://w3.example.com/x')).toBe('example.com');
    expect(extractDomain('https://news.example.com/x')).toBe('news.example.com');
  });
});

describe('getBaseUrl', () => {
  it('returns scheme + host only', () => {
    expect(getBaseUrl('https://example.com/a/b?c=d#e')).toBe('https://example.com');
  });
});

describe('extractUrl', () => {
  it('reads the canonical link', () => {
    const doc = parseDocument(
      '<html><head><link rel="canonical" href="https://ex.com/canonical"></head><body></body></html>',
    );
    expect(extractUrl(doc)).toBe('https://ex.com/canonical');
  });

  it('resolves a root-relative canonical against an og:url base', () => {
    const doc = parseDocument(
      '<html><head><meta property="og:url" content="https://ex.com/page"><link rel="canonical" href="/abs/path"></head><body></body></html>',
    );
    expect(extractUrl(doc)).toBe('https://ex.com/abs/path');
  });

  it('falls back to the default url', () => {
    const doc = parseDocument('<html><head></head><body></body></html>');
    expect(extractUrl(doc, 'https://fallback.io/')).toBe('https://fallback.io/');
  });
});
