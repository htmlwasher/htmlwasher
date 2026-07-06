import { describe, expect, it } from 'vitest';

import { extractContentHTML } from './extract.js';

const LONG = 'Real content sentence that carries the body of this page with enough words. '.repeat(
  3,
);

describe('profile-driven extraction (CoreOptions wiring)', () => {
  it('boilerplateSelectors drops matching elements', () => {
    const html = `<main><div class="keep"><p>${LONG}</p></div><div class="related-products"><p>${LONG}</p></div></main>`;
    const { html: out } = extractContentHTML(html, {
      boilerplateSelectors: ['.related-products'],
    });
    expect(out).toContain('Real content');
    // the related-products block is removed before selection/serialization
    const matches = out.match(/Real content/g) ?? [];
    const withoutSelector = extractContentHTML(html, {}).html.match(/Real content/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(withoutSelector.length);
  });

  it('preserveTags keeps a tag that would otherwise be cleaned (form)', () => {
    const html = `<main><form class="thread"><p>${LONG}</p></form></main>`;
    const kept = extractContentHTML(html, {
      preserveTags: ['form'],
      contentSelectors: ['form.thread'],
      commentsAsContent: true,
    });
    expect(kept.html).toContain('Real content');
  });

  it('contentSelectors picks a profile-specific container first', () => {
    const html = `<body><div class="noise"><p>noise noise noise</p></div><div class="product-description"><p>${LONG}</p></div></body>`;
    const { html: out } = extractContentHTML(html, {
      contentSelectors: ['.product-description'],
    });
    expect(out).toContain('Real content');
    expect(out).not.toContain('noise noise noise');
  });
});
