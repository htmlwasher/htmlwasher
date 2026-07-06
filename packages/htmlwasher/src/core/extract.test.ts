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

  // FIX (boilerplate-modes-0): prove focus mode actually CHANGES extraction output
  // via the clean.ts single-link threshold (NOT name-based boilerplate). The
  // deciding block has a NEUTRAL class (`entry-block`, not a BOILERPLATE_TOKEN). It
  // is a single-link div whose link text is 94 chars (>90% of the block's 100-char
  // text) and the div is NOT the last child (so the secondary block-density rule's
  // limit is 100). linkDensityTest's single-link rule (clean.ts:153) uses threshold
  // 10 under precision (94>10 -> link-dense -> dropped) vs 100 under recall (94<100
  // -> not dropped; secondary rule also skipped since textLength 100 is not < 100).
  // This fails if focus is ever decoupled from the clean.ts thresholds.
  it('mode choice changes extraction output (link-density threshold, not name)', () => {
    const lead =
      'This is the genuine article body paragraph carrying the real story a reader came for, long enough to be unambiguous and pass the threshold. ';
    const linkText =
      'Continue to the full borderline coverage of this listed story right over here on the next page'; // 94 chars
    // " tails" brings the div's text to exactly 100 chars (link is 94 = 94% of 100).
    const probe = `<div class="entry-block"><a href="/x">${linkText}</a> tails</div>`;
    // Trailing <p> AFTER the probe div so the div has a nextElementSibling (limit 100).
    const doc = `<body><main><article class="article-content"><h1>Headline</h1><p>${lead.repeat(2)}</p>${probe}<p>${lead}</p></article></main></body>`;
    const precision = extractContentHTML(doc, { focus: 'precision' });
    const recall = extractContentHTML(doc, { focus: 'recall' });
    // Recall keeps the borderline single-link block; precision drops it.
    expect(recall.html).toContain('Continue to the full borderline coverage');
    expect(precision.html).not.toContain('Continue to the full borderline coverage');
    // Both keep the genuine body — only the borderline block differs.
    expect(precision.html).toContain('genuine article body');
    expect(recall.html).toContain('genuine article body');
    // Cross-mode inequality: the two serialized outputs must actually differ.
    expect(precision.html).not.toBe(recall.html);
  });

  // FIX 1: name-based boilerplate must fire in the real pipeline. A non-link-dense
  // prose block whose class matches BOILERPLATE_TOKENS used to survive because
  // postCleaning stripped class/id BEFORE the serializer's isBoilerplateNamed guard.
  it('drops a non-link-dense newsletter-classed prose block inside the article', () => {
    const lead =
      'This is the genuine article body paragraph carrying the real story a reader came for, long enough to be unambiguous and pass the threshold. ';
    const html = `<body><main><article class="article-content">
        <h1>The Headline</h1>
        <p>${lead.repeat(2)}</p>
        <div class="newsletter-signup"><p>Sign up for our weekly newsletter to get the latest delivered to your inbox every Monday morning.</p></div>
        <p>${lead}</p>
      </article></main></body>`;
    const { html: out } = extractContentHTML(html, { focus: 'balanced' });
    expect(out).toContain('genuine article body');
    expect(out).not.toContain('Sign up for our weekly newsletter');
  });

  it('keeps a comment-classed prose block when commentsAsContent is true', () => {
    const lead =
      'This is the genuine article body paragraph carrying the real story a reader came for, long enough to be unambiguous and pass the threshold. ';
    const html = `<body><main><article class="article-content">
        <h1>The Headline</h1>
        <p>${lead.repeat(2)}</p>
        <div class="comment"><p>A thoughtful reader comment that adds context and should be preserved when comments are content.</p></div>
      </article></main></body>`;
    const { html: out } = extractContentHTML(html, {
      focus: 'balanced',
      commentsAsContent: true,
    });
    expect(out).toContain('genuine article body');
    expect(out).toContain('A thoughtful reader comment');
  });

  // Backoff: when the entire content lives in boilerplate-named containers
  // (typical of collection/listing pages), name-filtering must NOT empty the
  // output — it backs off to the unfiltered extraction (go's "don't delete all").
  it('backs off when name-based boilerplate removal would empty the content', () => {
    const item =
      'A listed entry with a meaningful description long enough to count as real body text for this collection page. ';
    const html = `<body><main><div class="related-widget">
        <div class="card"><p>${item.repeat(2)}</p></div>
        <div class="card"><p>${item.repeat(2)}</p></div>
      </div></main></body>`;
    const { html: out, textLength } = extractContentHTML(html, { focus: 'balanced' });
    expect(textLength).toBeGreaterThan(0);
    expect(out).toContain('A listed entry');
  });

  // FIX (core-serializer-0): the §10 backoff disables the GATED boilerplate-token
  // removal, but rs still drops `is_always_excluded_name` nodes and
  // itemtype=BreadcrumbList UNCONDITIONALLY. On a collection page whose body lives
  // in boilerplate-named containers (triggering the backoff), a hard
  // always-excluded node and a BreadcrumbList <ol> must STILL be absent.
  it('drops always-excluded + BreadcrumbList nodes even on the backoff path', () => {
    const item =
      'A listed entry with a meaningful description long enough to count as real body text for this collection page. ';
    const html = `<body><main><div class="related-widget">
        <ol itemscope itemtype="https://schema.org/BreadcrumbList"><li>Home</li><li>Listing</li></ol>
        <div class="el__featured-video"><p>autoplaying featured video furniture leaks here</p></div>
        <div class="card"><p>${item.repeat(2)}</p></div>
        <div class="card"><p>${item.repeat(2)}</p></div>
      </div></main></body>`;
    const { html: out, textLength } = extractContentHTML(html, { focus: 'balanced' });
    expect(textLength).toBeGreaterThan(0);
    // backoff still emits the real listing body...
    expect(out).toContain('A listed entry');
    // ...but the unconditionally-excluded furniture is gone.
    expect(out).not.toContain('featured video furniture');
    expect(out).not.toContain('Listing');
  });

  // FIX (core-serializer-1): BreadcrumbList microdata is dropped on the PRIMARY
  // path too (not only the backoff), with no breadcrumb-y class/id.
  it('drops BreadcrumbList microdata on the primary extraction path', () => {
    const lead =
      'This is the genuine article body paragraph carrying the real story a reader came for, long enough to be unambiguous and pass the threshold. ';
    const html = `<body><main><article class="article-content">
        <ol itemscope itemtype="https://schema.org/BreadcrumbList"><li>Home</li><li>Crumb</li></ol>
        <h1>The Headline</h1>
        <p>${lead.repeat(2)}</p>
      </article></main></body>`;
    const { html: out } = extractContentHTML(html, { focus: 'balanced' });
    expect(out).toContain('genuine article body');
    expect(out).not.toContain('Crumb');
  });
});
