import { describe, expect, it } from 'vitest';

import { parseDocument } from '../core/dom.js';
import type { Metadata } from '../types.js';
import { extractJsonLd } from './json-ld.js';

function run(html: string): Metadata {
  const md: Metadata = {};
  extractJsonLd(parseDocument(html), md);
  return md;
}

const wrap = (json: string): string =>
  `<html><head><script type="application/ld+json">${json}</script></head><body></body></html>`;

describe('extractJsonLd', () => {
  it('builds an author from givenName + familyName', () => {
    const md = run(
      wrap(
        '{"@context":"https://schema.org","@type":"Article","author":{"@type":"Person","givenName":"Jane","familyName":"Doe"}}',
      ),
    );
    expect(md.author).toBe('Jane Doe');
  });

  it('reads multiple authors from an array', () => {
    const md = run(
      wrap(
        '{"@context":"https://schema.org","@type":"Article","author":[{"name":"Jane Doe"},{"name":"John Roe"}]}',
      ),
    );
    expect(md.author).toBe('Jane Doe; John Roe');
  });

  it('reads a categories array from articleSection', () => {
    const md = run(
      wrap(
        '{"@context":"https://schema.org","@type":"Article","articleSection":["Tech","Science"]}',
      ),
    );
    expect(md.categories).toEqual(['Tech', 'Science']);
  });

  it('reads sitename from an Organization publisher', () => {
    const md = run(
      wrap(
        '{"@context":"https://schema.org","@type":"Article","headline":"x","publisher":{"@type":"Organization","name":"Acme News"}}',
      ),
    );
    expect(md.sitename).toBe('Acme News');
  });

  it('maps DiscussionForumPosting to the forum page type', () => {
    const md = run(wrap('{"@context":"https://schema.org","@type":"DiscussionForumPosting"}'));
    expect(md.pageType).toBe('forum');
  });

  it('maps ItemPage to the product page type', () => {
    const md = run(wrap('{"@context":"https://schema.org","@type":"ItemPage"}'));
    expect(md.pageType).toBe('product');
  });

  it('ignores a non-schema.org @context entirely', () => {
    const md = run(wrap('{"@context":"https://example.com","@type":"Article","headline":"No"}'));
    expect(md.title).toBeUndefined();
    expect(md.pageType).toBeUndefined();
  });

  it('does not throw on malformed JSON and recovers the headline via regex', () => {
    const md = run(wrap('{ "@type": "Article", "headline": "Recovered", bad json'));
    expect(md.title).toBe('Recovered');
  });
});
