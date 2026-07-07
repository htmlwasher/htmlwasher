// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { cleanCss, cleanStyledHtml } from './css-cleaner.js';

describe('cleanCss', () => {
  it('strips url(javascript:…) but leaves a neutral placeholder', () => {
    const out = cleanCss('background:url(javascript:alert(1))');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toBe("background:url('')");
  });

  it('strips url(data:…) by default (default-deny)', () => {
    const out = cleanCss('background:url(data:image/svg+xml,xxx)');
    expect(out).not.toContain('data:');
    expect(out).toBe("background:url('')");
  });

  it('strips url(vbscript:…)', () => {
    const out = cleanCss('background:url(vbscript:msgbox(1))');
    expect(out).not.toMatch(/vbscript:/i);
  });

  it('strips QUOTED url("javascript:…") fully (no surviving scheme literal)', () => {
    // Regression: the quoted form whose arg contains a nested `)` previously
    // matched only `url(`, leaving `"javascript:alert(1)")` behind as text.
    const out = cleanCss('background:url("javascript:alert(1)")');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toBe("background:url('')");
  });

  it("strips single-quoted url('vbscript:…') fully", () => {
    const out = cleanCss("background:url('vbscript:msgbox(1)')");
    expect(out).not.toMatch(/vbscript:/i);
    expect(out).toContain("url('')");
  });

  it('strips quoted url("data:…") by default', () => {
    const out = cleanCss('background:url("data:image/svg+xml,x")');
    expect(out).not.toContain('data:');
    expect(out).toContain("url('')");
  });

  it('removes expression(...) entirely with no stray token', () => {
    const out = cleanCss('width:expression(alert(1))');
    expect(out).not.toMatch(/expression/i);
    expect(out).not.toContain('alert');
    expect(out).toBe('width:');
  });

  it('removes @import at-rules', () => {
    const out = cleanCss('@import url(http://evil/x.css); color:red');
    expect(out).not.toMatch(/@import/i);
    expect(out).toContain('color:red');
  });

  it('removes -moz-binding declarations', () => {
    const out = cleanCss('-moz-binding:url(http://evil/x.xml#y)');
    expect(out).not.toMatch(/-moz-binding/i);
  });

  it('defeats CSS comment evasion of a banned scheme', () => {
    const out = cleanCss('background:url(/*x*/javascript:alert(1))');
    expect(out).not.toMatch(/javascript:/i);
  });

  it('defeats CSS backslash-escape evasion of a banned scheme', () => {
    // On the wire the CSS is `url(\6a avascript:alert(1))`; `\6a` is the CSS
    // escape for 'j', so a browser decodes it back to `javascript:`. Any url()
    // arg containing a backslash escape is rejected.
    const out = cleanCss('background:url(\\6a avascript:alert(1))');
    expect(out).toContain("url('')");
  });

  it('preserves safe http/https url()', () => {
    const out = cleanCss('background:url(https://ok.com/a.png)');
    expect(out).toBe('background:url(https://ok.com/a.png)');
  });

  it('preserves protocol-relative and relative url()', () => {
    expect(cleanCss('background:url("//cdn/a.png")')).toContain('//cdn/a.png');
    expect(cleanCss("background:url('../img/a.png')")).toContain('../img/a.png');
  });

  it('preserves fragment url() (same-doc reference)', () => {
    expect(cleanCss('clip-path:url(#mask)')).toContain('url(#mask)');
  });

  it('returns empty input unchanged', () => {
    expect(cleanCss('')).toBe('');
  });
});

describe('cleanStyledHtml', () => {
  it('sanitizes inline style attributes', () => {
    const out = cleanStyledHtml('<div style="background:url(javascript:alert(1))">x</div>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('<div');
  });

  it('sanitizes <style> element bodies', () => {
    const out = cleanStyledHtml('<style>.a{background:url(javascript:alert(1))}</style>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('<style>');
  });

  it('neutralizes a quoted url("javascript:…") in a <style> body end-to-end', () => {
    const out = cleanStyledHtml('<style>.a{background:url("javascript:alert(1)")}</style>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('<style>');
  });

  it('leaves a safe inline style untouched (modulo re-encoding)', () => {
    const out = cleanStyledHtml('<div style="color:red">x</div>');
    expect(out).toContain('color:red');
  });

  it('neutralizes a backslash-escaped scheme in an inline style attribute', () => {
    const out = cleanStyledHtml('<div style="background:url(\\6a avascript:alert(1))">x</div>');
    expect(out).toContain("url('')");
    expect(out).not.toMatch(/javascript:/i);
  });

  it('does not double-decode a double-escaped entity in a style attribute', () => {
    // `&amp;lt;` is the literal text `&lt;` — decoding must stop after one level
    // (a chained-replace decode would corrupt it into a live `<`).
    const out = cleanStyledHtml(`<div style="content:'&amp;lt;'">x</div>`);
    expect(out).toContain("content:'&amp;lt;'");
    expect(out).not.toContain("content:'<'");
    expect(out).not.toContain("content:'&lt;'");
  });

  it('round-trips &amp;amp; URL query separators without double-decoding', () => {
    const out = cleanStyledHtml('<div style="background:url(a?x=1&amp;amp;y=2)">x</div>');
    expect(out).toContain('url(a?x=1&amp;amp;y=2)');
  });
});
