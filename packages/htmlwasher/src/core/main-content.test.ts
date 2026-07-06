import { describe, expect, it } from 'vitest';

import { parseDocument, tagOf } from './dom.js';
import { findContentNode } from './main-content.js';
import { DEFAULT_CORE_OPTIONS } from './options.js';

const opts = DEFAULT_CORE_OPTIONS;
const LONG =
  'This is the actual article body with enough real text to exceed the minimum content threshold so the selector wins outright. '.repeat(
    2,
  );

function content(html: string) {
  const doc = parseDocument(html);
  return findContentNode(doc.body!, opts);
}

describe('findContentNode', () => {
  it('selects an element matching a content-class rule', () => {
    const el = content(
      `<body><div class="sidebar">junk</div><div class="article-content"><p>${LONG}</p></div></body>`,
    );
    expect(el.className).toContain('article-content');
  });

  it('falls back to <article> when no class rule matches', () => {
    const el = content(`<body><div>x</div><article><p>${LONG}</p></article></body>`);
    expect(tagOf(el)).toBe('article');
  });

  it('falls back to scoring when no semantic element exists', () => {
    const el = content(
      `<body><div class="wrap"><div class="inner"><p>${LONG}</p><p>${LONG}</p></div></div></body>`,
    );
    // Some block container with the paragraphs is chosen (not the bare body).
    expect(tagOf(el)).not.toBe('body');
    expect(el.textContent).toContain('actual article body');
  });

  it('returns the body as the last resort', () => {
    const el = content('<body><p>tiny</p></body>');
    expect(['body', 'p']).toContain(tagOf(el));
  });

  it('selects a div with role="article" (contentRule3 role predicate)', () => {
    const el = content(`<div class="junk">x</div><div role="article"><p>${LONG}</p></div>`);
    expect(el.getAttribute('role')).toBe('article');
  });
});
