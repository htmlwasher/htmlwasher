// SPDX-License-Identifier: Apache-2.0
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { washBuffer, washHtml } from './wash.js';

describe('washHtml — per-level tag allow-lists', () => {
  it('minimal drops <img> and <div>, keeps text formatting', async () => {
    const { html } = await washHtml(
      '<div><img src="x.png"><p>Hi <b>there</b></p></div>',
      'minimal',
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<div');
    expect(html).toContain('<p>');
    expect(html).toContain('<b>there</b>');
  });

  it('standard keeps <img> but drops <div>', async () => {
    const { html } = await washHtml('<div><img src="x.png" alt="a"><p>Hi</p></div>', 'standard');
    expect(html).toContain('<img');
    expect(html).not.toContain('<div');
    expect(html).toContain('<p>Hi</p>');
  });

  it('permissive keeps <div> and <section>', async () => {
    const { html } = await washHtml('<section><div>Hi</div></section>', 'permissive');
    expect(html).toContain('<section>');
    expect(html).toContain('<div>');
  });

  it('permissive drops class/style attributes (no styling below styled)', async () => {
    const { html } = await washHtml('<div class="c" style="color:red">Hi</div>', 'permissive');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('style=');
  });

  it('styled keeps class, inline style, and <style> CSS', async () => {
    const { html } = await washHtml(
      '<style>.a{color:red}</style><div class="c" style="color:blue">Hi</div>',
      'styled',
    );
    expect(html).toContain('<style>');
    expect(html).toContain('color: red');
    expect(html).toContain('class="c"');
    expect(html).toContain('style="color: blue"');
  });

  it('correct preserves arbitrary/unknown tags (normalize-only)', async () => {
    const { html } = await washHtml('<custom-x data-y="1">Hi</custom-x>', 'correct');
    expect(html).toContain('<custom-x');
    expect(html).toContain('data-y="1"');
    expect(html).toContain('Hi');
  });
});

describe('washHtml — security at EVERY level (incl. styled and correct)', () => {
  const levels = ['minimal', 'standard', 'permissive', 'styled'] as const;

  for (const level of levels) {
    it(`${level}: removes <script>`, async () => {
      const { html } = await washHtml('<p>Hi</p><script>alert(1)</script>', level);
      expect(html.toLowerCase()).not.toContain('<script');
    });

    it(`${level}: removes on* event handlers`, async () => {
      const { html } = await washHtml('<p onclick="alert(1)">Hi</p>', level);
      expect(html.toLowerCase()).not.toContain('onclick');
    });

    it(`${level}: removes javascript: hrefs`, async () => {
      const { html } = await washHtml('<a href="javascript:alert(1)">x</a>', level);
      expect(html.toLowerCase()).not.toContain('javascript:');
    });

    it(`${level}: removes data: hrefs`, async () => {
      const { html } = await washHtml('<a href="data:text/html,evil">x</a>', level);
      expect(html.toLowerCase()).not.toContain('data:text/html');
    });
  }

  it('styled: strips url(javascript:) from an inline style', async () => {
    const { html } = await washHtml(
      '<div style="background:url(javascript:alert(1))">x</div>',
      'styled',
    );
    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  it('styled: strips expression() from an inline style', async () => {
    const { html } = await washHtml('<div style="width:expression(alert(1))">x</div>', 'styled');
    expect(html.toLowerCase()).not.toContain('expression(');
  });

  it('styled: strips @import and url(javascript:) from a <style> body', async () => {
    const { html } = await washHtml(
      '<style>@import url(http://evil/x.css);.a{background:url(javascript:alert(1))}</style>',
      'styled',
    );
    expect(html.toLowerCase()).not.toContain('@import');
    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  it('correct: does not INTRODUCE script/handlers/javascript: (it only well-forms)', async () => {
    // correct is the caller's trust boundary: it preserves existing markup but
    // adds nothing executable of its own. A clean fragment stays clean.
    const { html } = await washHtml('<p>Hi <b>there</b></p>', 'correct');
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('onclick');
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html).toContain('<b>there</b>');
  });

  it('correct: does NOT transform deprecated tags (no sanitize stage runs)', async () => {
    const { html } = await washHtml('<strike>old</strike>', 'correct');
    // standard would transform <strike> → <del>; correct must leave it as-is.
    expect(html).toContain('<strike>');
    expect(html).not.toContain('<del>');
  });
});

describe('washHtml — formatting', () => {
  it('prettier-formats by default', async () => {
    const { html } = await washHtml('<p>Hi</p><p>Bye</p>', 'standard');
    expect(html).toBe('<p>Hi</p>\n<p>Bye</p>\n');
  });

  it('minify:true collapses whitespace', async () => {
    const { html } = await washHtml('<div>    <p>Hi</p>    </div>', 'permissive', { minify: true });
    expect(html).toBe('<div><p>Hi</p></div>');
  });

  it('prepends a DOCTYPE to full documents', async () => {
    const { html } = await washHtml(
      '<html><head><title>T</title></head><body><p>Hi</p></body></html>',
      'standard',
    );
    expect(html.trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(true);
  });
});

describe('washHtml — edge cases', () => {
  it('returns "" for empty input', async () => {
    expect((await washHtml('', 'standard')).html).toBe('');
  });

  it('returns "" for whitespace-only input', async () => {
    expect((await washHtml('   \n  ', 'standard')).html).toBe('');
  });

  it('does not throw on malformed HTML', async () => {
    const { html } = await washHtml('<p><b>unclosed <div>broken', 'permissive');
    expect(html).toBeTruthy();
    expect(html).toContain('broken');
  });
});

describe('washBuffer', () => {
  it('decodes a UTF-8 buffer and washes it', async () => {
    const buf = Buffer.from('<div><p>Café</p></div>', 'utf-8');
    const { html } = await washBuffer(buf, 'standard');
    expect(html).toContain('Café');
    expect(html).not.toContain('<div'); // standard drops div
  });

  it('decodes a non-UTF-8 (latin1) buffer, prepends decode diagnostics', async () => {
    const buf = iconv.encode('<p>Café déjà vu — naïve façade</p>', 'latin1');
    const { html, messages } = await washBuffer(buf, 'standard');
    expect(html).toContain('<p>');
    expect(messages.some((m) => m.type === 'info')).toBe(true);
  });

  it('returns "" for an empty buffer', async () => {
    expect((await washBuffer(new Uint8Array(0), 'standard')).html).toBe('');
  });
});

describe('washHtml — hardened (DOMPurify) backend', () => {
  it('removes <script> and on* handlers via the hardened backend', async () => {
    const { html, messages } = await washHtml(
      '<p>Hi</p><script>alert(1)</script><div onclick="x">y</div>',
      'permissive',
      { hardened: true },
    );
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('onclick');
    expect(html).toContain('<p>Hi</p>');
    // dompurify + jsdom are installed in this workspace → no fallback warning.
    expect(messages.some((m) => /falling back to sanitize-html/.test(m.text))).toBe(false);
  });

  it('removes javascript: hrefs via the hardened backend', async () => {
    const { html } = await washHtml('<a href="javascript:alert(1)">x</a>', 'standard', {
      hardened: true,
    });
    expect(html.toLowerCase()).not.toContain('javascript:');
  });
});
