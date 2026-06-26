// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { sanitizeCss, sanitizeStyledHtml } from './css-sanitizer.js';

describe('sanitizeCss', () => {
  it('strips url(javascript:…) but leaves a neutral placeholder', () => {
    const out = sanitizeCss('background:url(javascript:alert(1))');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toBe("background:url('')");
  });

  it('strips url(data:…) by default (default-deny)', () => {
    const out = sanitizeCss('background:url(data:image/svg+xml,xxx)');
    expect(out).not.toContain('data:');
    expect(out).toBe("background:url('')");
  });

  it('strips url(vbscript:…)', () => {
    const out = sanitizeCss('background:url(vbscript:msgbox(1))');
    expect(out).not.toMatch(/vbscript:/i);
  });

  it('removes expression(...) entirely with no stray token', () => {
    const out = sanitizeCss('width:expression(alert(1))');
    expect(out).not.toMatch(/expression/i);
    expect(out).not.toContain('alert');
    expect(out).toBe('width:');
  });

  it('removes @import at-rules', () => {
    const out = sanitizeCss('@import url(http://evil/x.css); color:red');
    expect(out).not.toMatch(/@import/i);
    expect(out).toContain('color:red');
  });

  it('removes -moz-binding declarations', () => {
    const out = sanitizeCss('-moz-binding:url(http://evil/x.xml#y)');
    expect(out).not.toMatch(/-moz-binding/i);
  });

  it('defeats CSS comment evasion of a banned scheme', () => {
    const out = sanitizeCss('background:url(/*x*/javascript:alert(1))');
    expect(out).not.toMatch(/javascript:/i);
  });

  it('defeats CSS backslash-escape evasion of a banned scheme', () => {
    // On the wire the CSS is `url(\6a avascript:alert(1))`; `\6a` is the CSS
    // escape for 'j', so a browser decodes it back to `javascript:`. Any url()
    // arg containing a backslash escape is rejected.
    const out = sanitizeCss('background:url(\\6a avascript:alert(1))');
    expect(out).toContain("url('')");
  });

  it('preserves safe http/https url()', () => {
    const out = sanitizeCss('background:url(https://ok.com/a.png)');
    expect(out).toBe('background:url(https://ok.com/a.png)');
  });

  it('preserves protocol-relative and relative url()', () => {
    expect(sanitizeCss('background:url("//cdn/a.png")')).toContain('//cdn/a.png');
    expect(sanitizeCss("background:url('../img/a.png')")).toContain('../img/a.png');
  });

  it('preserves fragment url() (same-doc reference)', () => {
    expect(sanitizeCss('clip-path:url(#mask)')).toContain('url(#mask)');
  });

  it('returns empty input unchanged', () => {
    expect(sanitizeCss('')).toBe('');
  });
});

describe('sanitizeStyledHtml', () => {
  it('sanitizes inline style attributes', () => {
    const out = sanitizeStyledHtml('<div style="background:url(javascript:alert(1))">x</div>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('<div');
  });

  it('sanitizes <style> element bodies', () => {
    const out = sanitizeStyledHtml('<style>.a{background:url(javascript:alert(1))}</style>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('<style>');
  });

  it('leaves a safe inline style untouched (modulo re-encoding)', () => {
    const out = sanitizeStyledHtml('<div style="color:red">x</div>');
    expect(out).toContain('color:red');
  });

  it('neutralizes a backslash-escaped scheme in an inline style attribute', () => {
    const out = sanitizeStyledHtml('<div style="background:url(\\6a avascript:alert(1))">x</div>');
    expect(out).toContain("url('')");
    expect(out).not.toMatch(/javascript:/i);
  });
});
