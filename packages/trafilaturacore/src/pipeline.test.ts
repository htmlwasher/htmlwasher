import { afterEach, describe, expect, it, vi } from 'vitest';

import { clean } from './pipeline.js';
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

describe('clean() orchestration', () => {
  it('balanced: extracts main content, strips boilerplate + scripts', async () => {
    const { html, messages } = await clean(PAGE, { boilerplate: 'balanced' });
    expect(html).toContain('Real Title');
    expect(html).toContain('genuine article body');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('Home');
    expect(html).not.toContain('© 2026');
    expect(html).not.toMatch(/onclick/i);
    expect(Array.isArray(messages)).toBe(true);
  });

  it('returns the metadata sidecar', async () => {
    const { metadata } = await clean(PAGE);
    expect(metadata?.title).toContain('Real Title');
    expect(metadata?.author).toBe('Jane Doe');
    expect(metadata?.sitename).toBe('Site');
  });

  it("boilerplate 'clean-keep-boilerplate' cleans the whole document", async () => {
    const { html } = await clean(PAGE, { boilerplate: 'clean-keep-boilerplate' });
    // whole-document clean keeps more than the article (but still strips scripts)
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('Real Title');
  });

  it('minify produces collapsed output', async () => {
    const pretty = await clean(PAGE, { boilerplate: 'clean-keep-boilerplate', minify: false });
    const min = await clean(PAGE, { boilerplate: 'clean-keep-boilerplate', minify: true });
    expect(min.html.length).toBeLessThanOrEqual(pretty.html.length);
  });

  it('a custom config drives the sanitize stage, replacing the default config', async () => {
    const { html } = await clean('<ul><li>x</li></ul><p>Hi</p>', {
      boilerplate: 'clean-keep-boilerplate',
      config: { allowedTags: ['p'] }, // the default would keep <ul>/<li> too
    });
    expect(html).toContain('<p>Hi</p>');
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<li');
  });

  it('throws a clear TypeError on an invalid custom config', async () => {
    await expect(
      clean('<p>Hi</p>', {
        boilerplate: 'clean-keep-boilerplate',
        config: { bogus: true } as never,
      }),
    ).rejects.toThrow(/Invalid cleaning config: unknown field 'bogus'/);
  });

  it('throws a TypeError when html is not a string', async () => {
    await expect(clean(42 as never)).rejects.toThrow(TypeError);
    await expect(clean(null as never)).rejects.toThrow(/expects `html` to be a string/);
  });

  it('throws a TypeError on an invalid boilerplate mode', async () => {
    await expect(clean('<p>Hi</p>', { boilerplate: 'aggressive' as never })).rejects.toThrow(
      /Invalid boilerplate mode: aggressive/,
    );
  });

  it('rejects input just over maxInputBytes with a RangeError', async () => {
    const html = 'a'.repeat(11);
    await expect(
      clean(html, { boilerplate: 'clean-keep-boilerplate', maxInputBytes: 10 }),
    ).rejects.toThrow(RangeError);
    await expect(
      clean(html, { boilerplate: 'clean-keep-boilerplate', maxInputBytes: 10 }),
    ).rejects.toThrow(/exceeding the limit of 10 bytes/);
  });

  it('accepts input exactly at maxInputBytes (just under the cap passes)', async () => {
    const html = 'a'.repeat(10);
    const { html: out } = await clean(html, {
      boilerplate: 'clean-keep-boilerplate',
      maxInputBytes: 10,
    });
    expect(typeof out).toBe('string');
  });

  it('measures the cap in UTF-8 bytes, not characters', async () => {
    // '€' is 3 UTF-8 bytes; two of them = 6 bytes > a 5-byte cap.
    await expect(
      clean('€€', { boilerplate: 'clean-keep-boilerplate', maxInputBytes: 5 }),
    ).rejects.toThrow(RangeError);
  });

  it('default cap is DEFAULT_MAX_INPUT_BYTES: 10 MB + 1 byte is rejected at the boundary', async () => {
    // The size gate runs before any parsing/cleaning, so this rejects on the byte
    // count alone — no need to push a real 10 MB document through prettier (the
    // under-cap path is covered by every other small-doc test in this suite).
    const overLimit = `${'a'.repeat(DEFAULT_MAX_INPUT_BYTES)}a`;
    await expect(clean(overLimit, { boilerplate: 'clean-keep-boilerplate' })).rejects.toThrow(
      RangeError,
    );
    await expect(clean(overLimit, { boilerplate: 'clean-keep-boilerplate' })).rejects.toThrow(
      /exceeding the limit of/,
    );
  });

  it('security floor holds through the public API on the clean-keep-boilerplate path', async () => {
    const { html } = await clean(
      '<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(2)">l</a>',
      { boilerplate: 'clean-keep-boilerplate' },
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onclick/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('hi');
  });

  // doc 09 forward-guard: after Phase INTEGRATE the Rust core emits UNSANITIZED
  // preserve-markup HTML, so the cleaning floor is the ONLY thing between
  // extracted-but-hostile content and the output. Assert the floor through the
  // EXTRACTION path too — active-content vectors live INSIDE the main article here.
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

  it('security floor holds through clean() at boilerplate:balanced (default config)', async () => {
    const { html } = await clean(HOSTILE_MAIN, { boilerplate: 'balanced' });
    const lower = html.toLowerCase();
    expect(lower).not.toContain('<script');
    expect(lower).not.toContain('xss-in-content');
    expect(lower).not.toContain('onclick');
    expect(lower).not.toContain('javascript:');
  });

  it('closes the wildcard-config bypass end-to-end through clean() with extraction on', async () => {
    const { html } = await clean(HOSTILE_MAIN, {
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
  // inline style survive extraction), so a custom config that allows class +
  // inline style lets them flow all the way through clean(). This was
  // IMPOSSIBLE in v1, whose TS core stripped class/style/id before cleaning.
  it('custom config × balanced: class + inline style survive extraction through clean()', async () => {
    const STYLED_MAIN = `<!doctype html><html><head><title>Styled — Site</title></head><body>
      <nav><a href="/">Home</a></nav>
      <main><article class="article-content" style="color:navy">
        <h1 class="headline">Styled Headline</h1>
        <p class="lead" style="font-weight:bold">This is the genuine article body with enough words to be selected as the main content node of this page for sure.</p>
        <p style="margin:0">A second real paragraph, long enough to keep the article selected as the main content of the page here.</p>
      </article></main>
      <footer class="site-footer">© 2026</footer>
    </body></html>`;
    const { html } = await clean(STYLED_MAIN, {
      boilerplate: 'balanced',
      config: {
        allowedTags: ['article', 'h1', 'p', 'a'],
        allowedAttributes: { '*': ['class', 'style'] },
      },
    });
    // The markup the v1 core would have stripped before cleaning now survives.
    expect(html).toContain('class="article-content"');
    expect(html).toContain('class="lead"');
    expect(html).toMatch(/style="color: ?navy"/);
    expect(html).toMatch(/style="font-weight: ?bold"/);
    // Extraction still ran (boilerplate dropped, not just a whole-document clean).
    expect(html).not.toContain('© 2026');
    expect(html).not.toContain('Home');
  });

  it('handles empty input', async () => {
    const { html } = await clean('');
    expect(typeof html).toBe('string');
  });

  it('classifies the page and exposes pageType + confidence when extracting', async () => {
    const { pageType, confidence } = await clean(PAGE, { boilerplate: 'balanced' });
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

  it("omits pageType for boilerplate 'clean-keep-boilerplate' (no extraction, no classification)", async () => {
    const { pageType, confidence } = await clean(PAGE, { boilerplate: 'clean-keep-boilerplate' });
    expect(pageType).toBeUndefined();
    expect(confidence).toBeUndefined();
  });
});

describe('clean() content-inclusion toggles', () => {
  // clean-keep-boilerplate → deterministic whole-document cleaning, so a toggle's
  // effect is isolated from extraction. The tri-state contract: only an explicit
  // `false` subtracts; `undefined`/`true` keeps.
  it('includeImages: false discards image subtrees (img/figure/figcaption)', async () => {
    const input =
      '<p>Body text with plenty of words here for sure.</p><figure><img src="x.png" alt="pic"><figcaption>the caption</figcaption></figure>';
    const { html } = await clean(input, {
      boilerplate: 'clean-keep-boilerplate',
      includeImages: false,
    });
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<figure/i);
    expect(html).not.toContain('the caption'); // figcaption discarded with its figure parent
    expect(html).toContain('Body text');
  });

  it('keeps images by default (no toggle)', async () => {
    const input = '<p>Body text with plenty of words here.</p><img src="x.png" alt="pic">';
    const { html } = await clean(input, { boilerplate: 'clean-keep-boilerplate' });
    expect(html).toMatch(/<img/i);
  });

  it('includeTables: false discards the table subtree', async () => {
    const input = '<p>Paragraph text here.</p><table><tr><td>cell content text</td></tr></table>';
    const { html } = await clean(input, {
      boilerplate: 'clean-keep-boilerplate',
      includeTables: false,
    });
    expect(html).not.toMatch(/<table/i);
    expect(html).not.toContain('cell content text');
    expect(html).toContain('Paragraph text');
  });

  it('includeLinks: false unwraps <a> but keeps the anchor text (href dropped)', async () => {
    const input = '<p>See <a href="/x" title="t">the link text</a> now.</p>';
    const { html } = await clean(input, {
      boilerplate: 'clean-keep-boilerplate',
      includeLinks: false,
    });
    expect(html).not.toMatch(/<a[\s>]/i);
    expect(html).not.toContain('href');
    expect(html).toContain('the link text');
  });

  it('includeComments: false is a soft no-op (identical output to no toggle)', async () => {
    const withToggle = await clean(PAGE, {
      boilerplate: 'clean-keep-boilerplate',
      includeComments: false,
    });
    const without = await clean(PAGE, { boilerplate: 'clean-keep-boilerplate' });
    expect(withToggle.html).toBe(without.html);
  });

  it('all toggles true leaves the default path byte-identical (whole-document)', async () => {
    const withTrue = await clean(PAGE, {
      boilerplate: 'clean-keep-boilerplate',
      includeComments: true,
      includeTables: true,
      includeImages: true,
      includeLinks: true,
    });
    const without = await clean(PAGE, { boilerplate: 'clean-keep-boilerplate' });
    expect(withTrue.html).toBe(without.html);
  });

  it('no-toggle default extraction path stays byte-identical (balanced)', async () => {
    const withTrue = await clean(PAGE, {
      boilerplate: 'balanced',
      includeTables: true,
      includeImages: true,
      includeLinks: true,
    });
    const without = await clean(PAGE, { boilerplate: 'balanced' });
    expect(withTrue.html).toBe(without.html);
  });

  it('throws a TypeError on a non-boolean toggle', async () => {
    await expect(clean('<p>Hi</p>', { includeImages: 'yes' as never })).rejects.toThrow(TypeError);
    await expect(clean('<p>Hi</p>', { includeTables: 1 as never })).rejects.toThrow(
      /Invalid includeTables/,
    );
  });
});

describe('clean() native-core diagnostics and degradation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('surfaces native extraction warnings as boilerplate-prefixed messages', async () => {
    vi.resetModules();
    vi.doMock('@trafilaturacore/native', () => ({
      extract: async () => ({
        contentHtml: '<p>short</p>',
        pageType: 'article',
        confidence: 0.9,
        textLength: 5,
        fallbackUsed: true,
        warnings: ['body-fallback-used', 'content-very-short'],
      }),
    }));
    const { clean: cleanMocked } = await import('./pipeline.js');
    const { messages, pageType } = await cleanMocked(PAGE, { boilerplate: 'balanced' });
    const boilerMessages = messages.filter((m) => m.text.startsWith('boilerplate: '));
    expect(boilerMessages.map((m) => m.text)).toEqual([
      'boilerplate: body-fallback-used',
      'boilerplate: content-very-short',
    ]);
    expect(boilerMessages.every((m) => m.type === 'warning')).toBe(true);
    expect(pageType).toBe('article');
  });

  it('degrades to whole-document cleaning when the native extract() rejects', async () => {
    vi.resetModules();
    vi.doMock('@trafilaturacore/native', () => ({
      extract: async () => {
        throw new Error('native exploded');
      },
    }));
    const { clean: cleanMocked } = await import('./pipeline.js');
    const result = await cleanMocked(PAGE, { boilerplate: 'balanced' });
    expect(result.html).toContain('Real Title'); // still produces output
    const warning = result.messages.find((m) => m.text.startsWith('boilerplate removal failed'));
    expect(warning?.type).toBe('warning');
    expect(warning?.text).toContain('native exploded');
    expect(warning?.text).toContain('cleaning the whole document');
    expect(result.pageType).toBeUndefined();
    expect(result.confidence).toBeUndefined();
  });

  it('degrades with a warning when the native binding itself fails to load', async () => {
    vi.resetModules();
    // A throwing factory makes `import('@trafilaturacore/native')` reject — the closest
    // simulation of a missing/unloadable prebuilt .node. (vitest wraps the thrown
    // error's text, so assert the degradation contract, not the original message.)
    vi.doMock('@trafilaturacore/native', () => {
      throw new Error('Cannot find native binding');
    });
    const { clean: cleanMocked } = await import('./pipeline.js');
    const result = await cleanMocked(PAGE, { boilerplate: 'balanced' });
    expect(result.html).toContain('Real Title');
    const warning = result.messages.find((m) => m.text.startsWith('boilerplate removal failed'));
    expect(warning?.type).toBe('warning');
    expect(warning?.text).toContain('cleaning the whole document');
    expect(result.pageType).toBeUndefined();
  });

  it("boilerplate 'clean-keep-boilerplate' never loads the native binding (lazy FFI)", async () => {
    vi.resetModules();
    const factory = vi.fn(() => {
      throw new Error('should never load');
    });
    vi.doMock('@trafilaturacore/native', factory);
    // The package (pipeline module) itself must load without the binding…
    const { clean: cleanMocked } = await import('./pipeline.js');
    // …and a 'clean-keep-boilerplate'-mode clean must never trigger the import.
    const { html, messages } = await cleanMocked(PAGE, { boilerplate: 'clean-keep-boilerplate' });
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
    vi.doMock('@trafilaturacore/native', () => ({
      extract: async () => ({
        contentHtml: '',
        pageType: 'article',
        confidence: 0.5,
        textLength: 0,
        fallbackUsed: false,
        warnings: ['content-very-short'],
      }),
    }));
    const { clean: cleanMocked } = await import('./pipeline.js');
    const { messages } = await cleanMocked('<p>x</p>', { boilerplate: 'balanced' });
    const metaIdx = messages.findIndex((m) => m.text.startsWith('metadata extraction failed'));
    const boilerIdx = messages.findIndex((m) => m.text.startsWith('boilerplate: '));
    expect(metaIdx).toBeGreaterThanOrEqual(0);
    expect(boilerIdx).toBeGreaterThan(metaIdx);
  });
});

describe('clean() warning builders narrow non-Error throws', () => {
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
    const { clean: cleanMocked } = await import('./pipeline.js');
    const { messages } = await cleanMocked(PAGE, { boilerplate: 'clean-keep-boilerplate' });
    const warning = messages.find((m) => m.text.startsWith('metadata extraction failed'));
    expect(warning?.text).toContain('boom-not-an-error');
    expect(warning?.text).not.toContain('undefined');
  });
});
