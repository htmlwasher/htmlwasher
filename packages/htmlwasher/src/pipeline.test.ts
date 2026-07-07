import { afterEach, describe, expect, it, vi } from 'vitest';

import { wash } from './pipeline.js';
import { DEFAULT_MAX_INPUT_BYTES } from './types.js';

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

  it('a custom config drives the sanitize stage and wins over level', async () => {
    const { html } = await wash('<div><p>Hi</p><span>x</span></div>', {
      boilerplate: 'none',
      level: 'permissive', // would keep <div>/<span>…
      config: { allowedTags: ['p'] }, // …but the custom config keeps only <p>
    });
    expect(html).toContain('<p>Hi</p>');
    expect(html).not.toContain('<div');
    expect(html).not.toContain('<span');
  });

  it('throws a clear TypeError on an invalid custom config', async () => {
    await expect(
      wash('<p>Hi</p>', { boilerplate: 'none', config: { bogus: true } as never }),
    ).rejects.toThrow(/Invalid washing config: unknown field 'bogus'/);
  });

  it('throws a TypeError when html is not a string', async () => {
    await expect(wash(42 as never)).rejects.toThrow(TypeError);
    await expect(wash(null as never)).rejects.toThrow(/expects `html` to be a string/);
  });

  it('throws a TypeError on an invalid boilerplate mode', async () => {
    await expect(wash('<p>Hi</p>', { boilerplate: 'aggressive' as never })).rejects.toThrow(
      /Invalid boilerplate mode: aggressive/,
    );
  });

  it('throws a TypeError on an invalid washing level', async () => {
    await expect(wash('<p>Hi</p>', { level: 'minimal-reader' as never })).rejects.toThrow(
      /Invalid washing level: minimal-reader/,
    );
  });

  it('rejects input just over maxInputBytes with a RangeError', async () => {
    const html = 'a'.repeat(11);
    await expect(wash(html, { boilerplate: 'none', maxInputBytes: 10 })).rejects.toThrow(
      RangeError,
    );
    await expect(wash(html, { boilerplate: 'none', maxInputBytes: 10 })).rejects.toThrow(
      /exceeding the limit of 10 bytes/,
    );
  });

  it('accepts input exactly at maxInputBytes (just under the cap passes)', async () => {
    const html = 'a'.repeat(10);
    const { html: out } = await wash(html, { boilerplate: 'none', maxInputBytes: 10 });
    expect(typeof out).toBe('string');
  });

  it('measures the cap in UTF-8 bytes, not characters', async () => {
    // '€' is 3 UTF-8 bytes; two of them = 6 bytes > a 5-byte cap.
    await expect(wash('€€', { boilerplate: 'none', maxInputBytes: 5 })).rejects.toThrow(RangeError);
  });

  it('default cap is DEFAULT_MAX_INPUT_BYTES: 10 MB + 1 byte is rejected at the boundary', async () => {
    // The size gate runs before any parsing/washing, so this rejects on the byte
    // count alone — no need to push a real 10 MB document through prettier (the
    // under-cap path is covered by every other small-doc test in this suite).
    const overLimit = `${'a'.repeat(DEFAULT_MAX_INPUT_BYTES)}a`;
    await expect(wash(overLimit, { boilerplate: 'none' })).rejects.toThrow(RangeError);
    await expect(wash(overLimit, { boilerplate: 'none' })).rejects.toThrow(
      /exceeding the limit of/,
    );
  });

  it('security floor holds through the public API on the none+correct path', async () => {
    // The floor (script/on*/javascript: removal) must hold even on none+correct,
    // which otherwise skips sanitization (normalize-only).
    const { html } = await wash(
      '<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(2)">l</a>',
      { boilerplate: 'none', level: 'correct' },
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onclick/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('hi');
  });

  // doc 09 forward-guard: after Phase INTEGRATE the Rust core emits UNSANITIZED
  // preserve-markup HTML, so the washing floor is the ONLY thing between
  // extracted-but-hostile content and the output. v1 exercised hostile input only
  // on `none`-mode paths; assert the floor through the EXTRACTION path at every
  // level too — active-content vectors live INSIDE the main article here.
  const HOSTILE_MAIN = `<!doctype html><html><head><title>T</title></head><body>
    <nav><a href="/">home</a></nav>
    <main><article class="article-content">
      <h1>Genuine Headline</h1>
      <p onclick="steal()">This is the genuine article body with plenty of words so it is chosen as the main content node of this page for sure.</p>
      <script>alert('xss-in-content')</script>
      <p style="background:url(javascript:alert(1))">A second real paragraph, long enough to keep the article selected as the main content of the page.</p>
      <a href="javascript:evil()">malicious inline link inside the kept content</a>
    </article></main>
  </body></html>`;

  for (const level of ['minimal', 'standard', 'permissive', 'styled', 'correct'] as const) {
    it(`security floor holds through wash() at boilerplate:balanced × ${level}`, async () => {
      const { html } = await wash(HOSTILE_MAIN, { boilerplate: 'balanced', level });
      const lower = html.toLowerCase();
      expect(lower).not.toContain('<script');
      expect(lower).not.toContain('xss-in-content');
      expect(lower).not.toContain('onclick');
      expect(lower).not.toContain('javascript:');
    });
  }

  it('closes the wildcard-config bypass end-to-end through wash() with extraction on', async () => {
    const { html } = await wash(HOSTILE_MAIN, {
      boilerplate: 'balanced',
      config: {
        allowedTags: ['p', 'a', 'article', 'h1', 'script'],
        allowedAttributes: { '*': ['*'] },
      },
    });
    const lower = html.toLowerCase();
    expect(lower).not.toContain('<script');
    expect(lower).not.toContain('onclick');
    expect(lower).not.toContain('javascript:');
  });

  // doc-09 headline payoff: the Rust core emits preserve-markup HTML (class /
  // inline style survive extraction), so at the `styled` washing level — which
  // allows class + inline style — they now flow all the way through wash(). This
  // was IMPOSSIBLE in v1, whose TS core stripped class/style/id before washing.
  it('styled × balanced: class + inline style survive extraction through wash()', async () => {
    const STYLED_MAIN = `<!doctype html><html><head><title>Styled — Site</title></head><body>
      <nav><a href="/">Home</a></nav>
      <main><article class="article-content" style="color:navy">
        <h1 class="headline">Styled Headline</h1>
        <p class="lead" style="font-weight:bold">This is the genuine article body with enough words to be selected as the main content node of this page for sure.</p>
        <p style="margin:0">A second real paragraph, long enough to keep the article selected as the main content of the page here.</p>
      </article></main>
      <footer class="site-footer">© 2026</footer>
    </body></html>`;
    const { html } = await wash(STYLED_MAIN, { boilerplate: 'balanced', level: 'styled' });
    // The markup the v1 core would have stripped before washing now survives.
    expect(html).toContain('class="article-content"');
    expect(html).toContain('class="lead"');
    expect(html).toMatch(/style="color: ?navy"/);
    expect(html).toMatch(/style="font-weight: ?bold"/);
    // Extraction still ran (boilerplate dropped, not just a whole-document wash).
    expect(html).not.toContain('© 2026');
    expect(html).not.toContain('Home');
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

describe('wash() native-core diagnostics and degradation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('surfaces native extraction warnings as boilerplate-prefixed messages', async () => {
    vi.resetModules();
    vi.doMock('@htmlwasher/native', () => ({
      extract: async () => ({
        contentHtml: '<p>short</p>',
        pageType: 'article',
        confidence: 0.9,
        textLength: 5,
        fallbackUsed: true,
        warnings: ['body-fallback-used', 'content-very-short'],
      }),
    }));
    const { wash: washMocked } = await import('./pipeline.js');
    const { messages, pageType } = await washMocked(PAGE, { boilerplate: 'balanced' });
    const boilerMessages = messages.filter((m) => m.text.startsWith('boilerplate: '));
    expect(boilerMessages.map((m) => m.text)).toEqual([
      'boilerplate: body-fallback-used',
      'boilerplate: content-very-short',
    ]);
    expect(boilerMessages.every((m) => m.type === 'warning')).toBe(true);
    expect(pageType).toBe('article');
  });

  it('degrades to whole-document washing when the native extract() rejects', async () => {
    vi.resetModules();
    vi.doMock('@htmlwasher/native', () => ({
      extract: async () => {
        throw new Error('native exploded');
      },
    }));
    const { wash: washMocked } = await import('./pipeline.js');
    const result = await washMocked(PAGE, { boilerplate: 'balanced' });
    expect(result.html).toContain('Real Title'); // still produces output
    const warning = result.messages.find((m) => m.text.startsWith('boilerplate removal failed'));
    expect(warning?.type).toBe('warning');
    expect(warning?.text).toContain('native exploded');
    expect(warning?.text).toContain('washing the whole document');
    expect(result.pageType).toBeUndefined();
    expect(result.confidence).toBeUndefined();
  });

  it('degrades with a warning when the native binding itself fails to load', async () => {
    vi.resetModules();
    // A throwing factory makes `import('@htmlwasher/native')` reject — the closest
    // simulation of a missing/unloadable prebuilt .node. (vitest wraps the thrown
    // error's text, so assert the degradation contract, not the original message.)
    vi.doMock('@htmlwasher/native', () => {
      throw new Error('Cannot find native binding');
    });
    const { wash: washMocked } = await import('./pipeline.js');
    const result = await washMocked(PAGE, { boilerplate: 'balanced' });
    expect(result.html).toContain('Real Title');
    const warning = result.messages.find((m) => m.text.startsWith('boilerplate removal failed'));
    expect(warning?.type).toBe('warning');
    expect(warning?.text).toContain('washing the whole document');
    expect(result.pageType).toBeUndefined();
  });

  it("boilerplate 'none' never loads the native binding (lazy FFI)", async () => {
    vi.resetModules();
    const factory = vi.fn(() => {
      throw new Error('should never load');
    });
    vi.doMock('@htmlwasher/native', factory);
    // The package (pipeline module) itself must load without the binding…
    const { wash: washMocked } = await import('./pipeline.js');
    // …and a 'none'-mode wash must never trigger the import.
    const { html, messages } = await washMocked(PAGE, { boilerplate: 'none' });
    expect(html).toContain('Real Title');
    expect(factory).not.toHaveBeenCalled();
    expect(messages.some((m) => m.text.startsWith('boilerplate removal failed'))).toBe(false);
  });

  it('metadata warnings precede boilerplate warnings (extraction overlaps the metadata parse)', async () => {
    vi.resetModules();
    vi.doMock('./metadata/index.js', () => ({
      extractMetadata: () => {
        throw new Error('meta boom');
      },
    }));
    vi.doMock('@htmlwasher/native', () => ({
      extract: async () => ({
        contentHtml: '',
        pageType: 'article',
        confidence: 0.5,
        textLength: 0,
        fallbackUsed: false,
        warnings: ['content-very-short'],
      }),
    }));
    const { wash: washMocked } = await import('./pipeline.js');
    const { messages } = await washMocked('<p>x</p>', { boilerplate: 'balanced' });
    const metaIdx = messages.findIndex((m) => m.text.startsWith('metadata extraction failed'));
    const boilerIdx = messages.findIndex((m) => m.text.startsWith('boilerplate: '));
    expect(metaIdx).toBeGreaterThanOrEqual(0);
    expect(boilerIdx).toBeGreaterThan(metaIdx);
  });
});

describe('wash() warning builders narrow non-Error throws', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('a non-Error thrown from metadata extraction is stringified, not "undefined"', async () => {
    // A throw that is NOT an Error instance: `(error as Error).message` would be
    // `undefined`; the narrowed `String(error)` yields the literal text instead.
    // resetModules first so the freshly-imported pipeline graph wires the mock.
    vi.resetModules();
    vi.doMock('./metadata/index.js', () => ({
      extractMetadata: () => {
        throw 'boom-not-an-error';
      },
    }));
    const { wash: washMocked } = await import('./pipeline.js');
    const { messages } = await washMocked(PAGE, { boilerplate: 'none' });
    const warning = messages.find((m) => m.text.startsWith('metadata extraction failed'));
    expect(warning?.text).toContain('boom-not-an-error');
    expect(warning?.text).not.toContain('undefined');
  });
});
