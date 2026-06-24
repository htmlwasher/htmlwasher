import { describe, expect, it } from 'vitest';

import { wash } from './pipeline.js';

const PAGE = `<!doctype html><html><head><title>Real Title — Site</title>
<meta property="og:site_name" content="Site"><meta name="author" content="Jane Doe">
<script>tracker()</script></head>
<body>
  <nav><a href="/">Home</a></nav>
  <main><article class="article-content">
    <h1>Real Title</h1>
    <p>This is the genuine article body with enough words to be selected as the main content of the page.</p>
    <p>A second paragraph with an <a href="/x" onclick="evil()">inline link</a> for good measure.</p>
  </article></main>
  <footer class="site-footer">© 2026</footer>
</body></html>`;

describe('wash() orchestration', () => {
  it('balanced + standard: extracts main content, strips boilerplate + scripts', async () => {
    const { html, messages } = await wash(PAGE, { boilerplate: 'balanced', level: 'standard' });
    expect(html).toContain('Real Title');
    expect(html).toContain('genuine article body');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('Home');
    expect(html).not.toContain('© 2026');
    expect(html).not.toMatch(/onclick/i);
    expect(Array.isArray(messages)).toBe(true);
  });

  it('returns the metadata sidecar', async () => {
    const { metadata } = await wash(PAGE);
    expect(metadata?.title).toContain('Real Title');
    expect(metadata?.author).toBe('Jane Doe');
    expect(metadata?.sitename).toBe('Site');
  });

  it("boilerplate 'none' washes the whole document", async () => {
    const { html } = await wash(PAGE, { boilerplate: 'none', level: 'standard' });
    // whole-document wash keeps more than the article (but still strips scripts)
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('Real Title');
  });

  it("level 'correct' preserves arbitrary tags (normalize-only)", async () => {
    const { html } = await wash('<div><custom-x>hi</custom-x></div>', {
      boilerplate: 'none',
      level: 'correct',
    });
    expect(html).toContain('<custom-x>');
  });

  it('minify produces collapsed output', async () => {
    const pretty = await wash(PAGE, { boilerplate: 'none', minify: false });
    const min = await wash(PAGE, { boilerplate: 'none', minify: true });
    expect(min.html.length).toBeLessThanOrEqual(pretty.html.length);
  });

  it('handles empty input', async () => {
    const { html } = await wash('');
    expect(typeof html).toBe('string');
  });

  it('classifies the page and exposes pageType + confidence when extracting', async () => {
    const { pageType, confidence } = await wash(PAGE, { boilerplate: 'balanced' });
    expect(pageType).toBeDefined();
    expect([
      'article',
      'forum',
      'product',
      'collection',
      'listing',
      'documentation',
      'service',
    ]).toContain(pageType);
    expect(typeof confidence).toBe('number');
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("omits pageType for boilerplate 'none' (no extraction, no classification)", async () => {
    const { pageType, confidence } = await wash(PAGE, { boilerplate: 'none' });
    expect(pageType).toBeUndefined();
    expect(confidence).toBeUndefined();
  });
});
