import { describe, expect, it } from 'vitest';

import { extractMetadata } from './index.js';

describe('extractMetadata — OpenGraph', () => {
  it('reads og:title / og:description / og:site_name / og:image', () => {
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="OG Headline">
      <meta property="og:description" content="An OG summary.">
      <meta property="og:site_name" content="Example News">
      <meta property="og:image" content="https://ex.com/cover.jpg">
    </head><body><p>body</p></body></html>`;
    const md = extractMetadata(html);
    expect(md.title).toBe('OG Headline');
    expect(md.description).toBe('An OG summary.');
    expect(md.sitename).toBe('Example News');
    expect(md.image).toBe('https://ex.com/cover.jpg');
  });
});

describe('extractMetadata — JSON-LD', () => {
  it('extracts author/headline/datePublished/articleSection/publisher from an Article', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": "JSON Headline",
        "datePublished": "2023-05-17T08:00:00Z",
        "articleSection": "World",
        "author": {"@type": "Person", "name": "Jane Roe"},
        "publisher": {"@type": "Organization", "name": "JSON Times"}
      }</script>
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.title).toBe('JSON Headline');
    expect(md.author).toBe('Jane Roe');
    expect(md.date).toBe('2023-05-17');
    expect(md.categories).toEqual(['World']);
    expect(md.sitename).toBe('JSON Times');
    expect(md.pageType).toBe('article');
  });

  it('maps a CollectionPage @type to the collection page type', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":"Cat"}</script>
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.pageType).toBe('collection');
  });

  it('ignores JSON-LD whose @context is not schema.org', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{"@context":"https://example.org","@type":"NewsArticle","headline":"Nope"}</script>
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.title).toBeUndefined();
  });

  it('does not throw on malformed JSON-LD and falls back to the regex path', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{ "@type":"Article", "headline": "Broken Headline", oops }</script>
    </head><body></body></html>`;
    expect(() => extractMetadata(html)).not.toThrow();
    const md = extractMetadata(html);
    expect(md.title).toBe('Broken Headline');
  });

  it('unwraps @graph blocks', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"Graph Co"},
        {"@type":"Article","headline":"Graph Title","author":{"@type":"Person","name":"Max Power"}}
      ]}</script>
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.title).toBe('Graph Title');
    expect(md.author).toBe('Max Power');
    expect(md.sitename).toBe('Graph Co');
  });
});

describe('extractMetadata — precedence', () => {
  it('fills the title from JSON-LD when OpenGraph has none', () => {
    const html = `<!doctype html><html><head>
      <meta property="og:description" content="d">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","name":"LD Title"}</script>
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.title).toBe('LD Title');
  });

  it('keeps the OG title (JSON-LD title is fill-only, mirroring process_parent)', () => {
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="OG Only">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","name":"LD Title"}</script>
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.title).toBe('OG Only');
  });

  it('merges a JSON-LD author into an existing OG author', () => {
    const html = `<!doctype html><html><head>
      <meta property="og:author" content="Alice Anderson">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","author":{"@type":"Person","name":"Bob Brown"}}</script>
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.author).toBe('Alice Anderson; Bob Brown');
  });
});

describe('extractMetadata — clean_and_trim final pass', () => {
  it('decodes HTML entities in a JSON-LD headline (Café &amp; Co → Café & Co)', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"Café &amp; Co"}</script>
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.title).toBe('Café & Co');
  });

  it('truncates an over-10000-char field to 10000 chars ending in an ellipsis', () => {
    const long = 'x'.repeat(20000);
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="${long}">
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.title?.length).toBe(10000);
    expect(md.title?.endsWith('…')).toBe(true);
  });

  it('keeps author/sitename entity decoding intact (regression guard)', () => {
    const html = `<!doctype html><html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"x","author":{"@type":"Person","name":"Jane O&#39;Doe"},"publisher":{"@type":"Organization","name":"Acme &amp; Co"}}</script>
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.author).toBe("Jane O'Doe");
    expect(md.sitename).toBe('Acme & Co');
  });
});

describe('extractMetadata — meta tags', () => {
  it('reads name=author / name=description / name=keywords', () => {
    const html = `<!doctype html><html><head>
      <meta name="author" content="Mary Major">
      <meta name="description" content="Meta description text.">
      <meta name="keywords" content="alpha, beta, gamma">
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.author).toBe('Mary Major');
    expect(md.description).toBe('Meta description text.');
    expect(md.tags).toEqual(['alpha, beta, gamma']);
  });

  it('reads itemprop=author and article:tag', () => {
    const html = `<!doctype html><html><head>
      <meta itemprop="author" content="Sam Smith">
      <meta property="article:tag" content="news">
      <meta property="article:tag" content="politics">
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.author).toBe('Sam Smith');
    expect(md.tags).toEqual(['news', 'politics']);
  });
});

describe('extractMetadata — url + hostname', () => {
  it('reads the canonical link and derives the hostname', () => {
    const html = `<!doctype html><html><head>
      <link rel="canonical" href="https://www.example.com/path/article">
    </head><body></body></html>`;
    const md = extractMetadata(html);
    expect(md.url).toBe('https://www.example.com/path/article');
    expect(md.hostname).toBe('example.com');
  });

  it('falls back to the default url and derives a hostname from it', () => {
    const md = extractMetadata('<html><body></body></html>', 'https://blog.test.io/p/1');
    expect(md.url).toBe('https://blog.test.io/p/1');
    expect(md.hostname).toBe('blog.test.io');
  });
});

describe('extractMetadata — categories + tags (DOM)', () => {
  it('collects category links from a post-meta block', () => {
    const html = `<!doctype html><html><body>
      <div class="entry-meta"><a href="/category/tech/">Tech</a><a href="/2020/01/01/post">post</a></div>
    </body></html>`;
    const md = extractMetadata(html);
    expect(md.categories).toEqual(['Tech']);
  });

  it('collects tag links from a tags block', () => {
    const html = `<!doctype html><html><body>
      <div class="tags"><a href="/tag/typescript/">TypeScript</a><a href="/tag/onnx/">ONNX</a></div>
    </body></html>`;
    const md = extractMetadata(html);
    expect(md.tags).toEqual(['TypeScript', 'ONNX']);
  });
});

describe('extractMetadata — license', () => {
  it('reads a CC license from a[rel=license] href', () => {
    const html = `<!doctype html><html><body>
      <a rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA</a>
    </body></html>`;
    const md = extractMetadata(html);
    expect(md.license).toBe('CC BY-SA 4.0');
  });

  it('reads link text when rel=license has no recognizable href code', () => {
    const html = `<!doctype html><html><body>
      <a rel="license" href="/legal">All rights reserved</a>
    </body></html>`;
    const md = extractMetadata(html);
    expect(md.license).toBe('All rights reserved');
  });
});

describe('extractMetadata — empty + safety', () => {
  it('returns an all-undefined / empty metadata for empty HTML', () => {
    const md = extractMetadata('');
    expect(md.title).toBeUndefined();
    expect(md.author).toBeUndefined();
    expect(md.url).toBeUndefined();
    expect(md.hostname).toBeUndefined();
    expect(md.description).toBeUndefined();
    expect(md.sitename).toBeUndefined();
    expect(md.date).toBeUndefined();
    expect(md.categories).toBeUndefined();
    expect(md.tags).toBeUndefined();
    expect(md.image).toBeUndefined();
    expect(md.pageType).toBeUndefined();
    expect(md.license).toBeUndefined();
  });
});
