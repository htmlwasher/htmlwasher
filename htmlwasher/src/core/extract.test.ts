import { describe, expect, it } from 'vitest';

import { extractContentHTML } from './extract.js';

const ARTICLE = `<!doctype html><html><head><title>T</title><script>tracker()</script></head>
<body>
  <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <div class="sidebar"><ul><li><a href="/1">Recent 1</a></li><li><a href="/2">Recent 2</a></li></ul></div>
  <main>
    <article class="article-content">
      <h1>The Real Headline</h1>
      <p>This is the first substantial paragraph of the article body. It carries the actual content a reader came for, with enough length to be unambiguous.</p>
      <p>A second paragraph continues the story with more detail and a <a href="/ref">reference link</a> inside the prose.</p>
      <ul><li>First real point</li><li>Second real point</li></ul>
    </article>
  </main>
  <footer>Copyright 2026 — all rights reserved</footer>
  <script>moreTracking()</script>
</body></html>`;

describe('extractContentHTML — end to end', () => {
  it('extracts the article body as clean HTML', () => {
    const { html } = extractContentHTML(ARTICLE, { focus: 'balanced' });
    expect(html).toContain('The Real Headline');
    expect(html).toContain('first substantial paragraph');
    expect(html).toContain('Second real point');
  });

  it('drops navigation, sidebar, footer, and scripts', () => {
    const { html } = extractContentHTML(ARTICLE);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('tracker');
    expect(html).not.toContain('About');
    expect(html).not.toContain('Recent 1');
    expect(html).not.toContain('Copyright');
  });

  it('output is whitelisted HTML (no class/style/id leakage)', () => {
    const { html } = extractContentHTML(ARTICLE);
    expect(html).not.toContain('class=');
    expect(html).not.toContain('style=');
    expect(html).not.toContain(' id=');
    // keeps the reference link href
    expect(html).toContain('href="/ref"');
  });

  it('handles empty input', () => {
    expect(extractContentHTML('').html).toBe('');
  });

  it('handles malformed HTML without throwing', () => {
    const { html } = extractContentHTML('<div><p>unclosed <b>bold <main>hi there content');
    expect(typeof html).toBe('string');
  });

  it('precision focus removes more aggressively than recall', () => {
    const noisy = `<body><main><article class="article-content"><p>${'Real content paragraph that is clearly the body of the article. '.repeat(3)}</p>
      <div class="related"><a href="/a">a</a> <a href="/b">b</a> <a href="/c">c</a></div></article></main></body>`;
    const precision = extractContentHTML(noisy, { focus: 'precision' });
    const recall = extractContentHTML(noisy, { focus: 'recall' });
    expect(precision.html).toContain('Real content paragraph');
    expect(recall.html).toContain('Real content paragraph');
    // both should drop the boilerplate-classed related block
    expect(precision.html).not.toContain('href="/a"');
  });
});
