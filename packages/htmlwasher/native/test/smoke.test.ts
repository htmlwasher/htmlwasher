// SPDX-License-Identifier: Apache-2.0
// End-to-end smoke test of the locally built napi binding: loads `../index.js` (the
// generated loader → the committed/host `.node`) and runs `extract`/`extractSync` over
// a real fixture from TypeScript. Not a parity test (that lives in cargo); this proves
// the FFI boundary loads and returns the frozen result shape.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// The generated napi loader (CommonJS) → resolves the darwin-arm64 prebuild here.
const native = require('../index.js') as typeof import('../index.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (file: string): string =>
  readFileSync(join(HERE, '..', '..', 'fixtures', 'classifier', file), 'utf8');

const WIRE_PAGE_TYPES = [
  'article',
  'forum',
  'product',
  'collection',
  'listing',
  'documentation',
  'service',
] as const;

describe('@htmlwasher/native — napi binding smoke test', () => {
  it('exposes the frozen surface + the generated PageType union = the 7 wire strings', () => {
    expect(typeof native.extract).toBe('function');
    expect(typeof native.extractSync).toBe('function');

    // The generated .d.ts types pageType/focus as string-literal UNIONS (no const enum —
    // bundlers erase those, and the frozen public API is a plain string union). Assert the
    // pageType union is exactly the 7 wire strings, incl. `collection` (Category's wire value).
    const dts = readFileSync(join(HERE, '..', 'index.d.ts'), 'utf8');
    const pageTypeUnion = dts.match(/pageType\??:\s*([^;\n]+)/)?.[1] ?? '';
    const pageTypeValues = [...pageTypeUnion.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(pageTypeValues)].sort()).toEqual([...WIRE_PAGE_TYPES].sort());
    expect(pageTypeUnion.includes("'collection'")).toBe(true);

    const focusUnion = dts.match(/focus\??:\s*([^;\n]+)/)?.[1] ?? '';
    const focusValues = [...focusUnion.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(focusValues)].sort()).toEqual(['balanced', 'precision', 'recall']);
  });

  it('extractSync returns the frozen result shape over a real fixture', () => {
    const result = native.extractSync(fixture('0541.html'), {
      url: 'https://bbs.archlinux.org/',
    });
    expect(result.contentHtml.length).toBeGreaterThan(0);
    expect((WIRE_PAGE_TYPES as readonly string[]).includes(result.pageType)).toBe(true);
    expect(result.pageType).toBe('forum');
    expect(result.textLength).toBeGreaterThan(0);
    expect(typeof result.fallbackUsed).toBe('boolean');
    expect(Array.isArray(result.warnings)).toBe(true);
    // The FFI boundary's hygiene guarantee: never a <script> in the output.
    expect(/<script/i.test(result.contentHtml)).toBe(false);
  });

  it('extract runs async on the libuv threadpool and returns a Promise', async () => {
    const result = await native.extract(fixture('0488.html'), { focus: 'balanced' });
    expect(result.contentHtml.length).toBeGreaterThan(0);
    expect((WIRE_PAGE_TYPES as readonly string[]).includes(result.pageType)).toBe(true);
    expect(/<script/i.test(result.contentHtml)).toBe(false);
  });

  it('a JS-skeleton page whose only static text is hidden extracts empty (hidden-element discard)', async () => {
    // 4720.html is a JS-rendered product skeleton; its sole static text is an SEO
    // <h1> inside a display:none div, which the Trafilatura-parity hidden-element
    // pass now drops (previously extracted as textLength 10 / "content-very-short").
    const result = await native.extract(fixture('4720.html'), { focus: 'balanced' });
    expect(result.textLength).toBe(0);
    expect((WIRE_PAGE_TYPES as readonly string[]).includes(result.pageType)).toBe(true);
    expect(/<script/i.test(result.contentHtml)).toBe(false);
  });

  it('a manual pageType override suppresses confidence', () => {
    const result = native.extractSync(fixture('0488.html'), { pageType: 'article' });
    expect(result.pageType).toBe('article');
    expect(result.confidence == null).toBe(true);
  });
});
