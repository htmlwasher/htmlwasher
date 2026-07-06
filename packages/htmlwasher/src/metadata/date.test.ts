import { describe, expect, it } from 'vitest';

import { parseDocument } from '../core/dom.js';
import { extractDate } from './date.js';

const dateOf = (html: string, url?: string): string | undefined =>
  extractDate(parseDocument(html), url);

describe('extractDate (reduced htmldate)', () => {
  it('prefers JSON-LD datePublished', () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Article","datePublished":"2021-03-04T10:00:00Z"}
    </script></head><body></body></html>`;
    expect(dateOf(html)).toBe('2021-03-04');
  });

  it('reads article:published_time meta', () => {
    const html =
      '<html><head><meta property="article:published_time" content="2022-07-08"></head><body></body></html>';
    expect(dateOf(html)).toBe('2022-07-08');
  });

  it('reads name=date meta', () => {
    const html = '<html><head><meta name="date" content="2019-11-12"></head><body></body></html>';
    expect(dateOf(html)).toBe('2019-11-12');
  });

  it('reads og:updated_time meta', () => {
    const html =
      '<html><head><meta property="og:updated_time" content="2020-02-29T00:00:00Z"></head><body></body></html>';
    expect(dateOf(html)).toBe('2020-02-29');
  });

  it('reads a <time datetime> element', () => {
    const html = '<html><body><time datetime="2018-06-01">June 1</time></body></html>';
    expect(dateOf(html)).toBe('2018-06-01');
  });

  it('falls back to a YYYY/MM/DD path in the URL', () => {
    const html = '<html><body></body></html>';
    expect(dateOf(html, 'https://ex.com/2017/09/14/some-post')).toBe('2017-09-14');
  });

  it('returns undefined when no date is present', () => {
    expect(dateOf('<html><body><p>x</p></body></html>')).toBeUndefined();
  });

  it('rejects an implausible month', () => {
    const html = '<html><head><meta name="date" content="2020-13-40"></head><body></body></html>';
    expect(dateOf(html)).toBeUndefined();
  });
});
