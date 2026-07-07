// Unit tests for the tag-anchored HARD security detectors.
//
// Regression intent: the detectors must fire on real attribute vectors but
// never on escaped VISIBLE TEXT — prose like "chapter one = another" or
// documentation quoting "javascript:void(0)" legitimately survives washing as
// escaped text content and must not flip the offline E2E gate to FAIL.
//
// Standalone on purpose: imports only security-detectors.ts (no htmlwasher, no
// corpus-runner), so it runs fast and never executes the corpus E2E.

import { describe, expect, it } from 'vitest';
import { findEventHandlerAttr, hasJavascriptUrl, hasScriptTag } from './security-detectors.js';

describe('hasScriptTag', () => {
  it('detects a surviving raw <script> tag', () => {
    expect(hasScriptTag('<p>x</p><script src="x.js"></script>')).toBe(true);
    expect(hasScriptTag('<script>alert(1)</script>')).toBe(true);
  });

  it('ignores escaped or plain-text mentions of script', () => {
    expect(hasScriptTag('<p>use &lt;script&gt; tags sparingly</p>')).toBe(false);
    expect(hasScriptTag('<p>the script tag description</p>')).toBe(false);
  });
});

describe('findEventHandlerAttr', () => {
  it('detects an inline handler attribute (true positive)', () => {
    expect(findEventHandlerAttr('<div onclick="x()">go</div>')).toBe('onclick=');
    expect(findEventHandlerAttr('<img src="x.png" onerror="alert(1)">')).toBe('onerror=');
  });

  it('detects handlers with single-quoted or unquoted values', () => {
    expect(findEventHandlerAttr("<div onclick='x()'>go</div>")).toBe('onclick=');
    expect(findEventHandlerAttr('<div onclick=x()>go</div>')).toBe('onclick=');
  });

  it('detects handlers preceded by a quote or slash instead of whitespace', () => {
    expect(findEventHandlerAttr('<img src="x"onerror=alert(1)>')).toBe('onerror=');
    expect(findEventHandlerAttr('<img/onerror=alert(1) src=x>')).toBe('onerror=');
  });

  it('does not fire on escaped visible text (false-positive regression)', () => {
    expect(findEventHandlerAttr('<p>chapter one = another</p>')).toBeUndefined();
    expect(findEventHandlerAttr('<p>lemonade= is not an attribute</p>')).toBeUndefined();
  });
});

describe('hasJavascriptUrl', () => {
  it('detects a javascript: URL in href (true positive)', () => {
    expect(hasJavascriptUrl('<a href="javascript:alert(1)">x</a>')).toBe(true);
  });

  it('detects single-quoted, unquoted, and space-padded attribute values', () => {
    expect(hasJavascriptUrl("<a href='javascript:alert(1)'>x</a>")).toBe(true);
    expect(hasJavascriptUrl('<a href=javascript:alert(1)>x</a>')).toBe(true);
    expect(hasJavascriptUrl('<a href = " javascript:alert(1)">x</a>')).toBe(true);
  });

  it('covers the src/action/formaction/xlink:href/data URL carriers', () => {
    expect(hasJavascriptUrl('<img src="javascript:alert(1)">')).toBe(true);
    expect(hasJavascriptUrl('<form action="javascript:alert(1)">')).toBe(true);
    expect(hasJavascriptUrl('<button formaction="javascript:alert(1)">x</button>')).toBe(true);
    expect(hasJavascriptUrl('<use xlink:href="javascript:alert(1)"/>')).toBe(true);
    expect(hasJavascriptUrl('<object data="javascript:alert(1)"></object>')).toBe(true);
  });

  it('does not fire on escaped visible text (false-positive regression)', () => {
    expect(hasJavascriptUrl('<p>links like javascript:void(0) are a no-op</p>')).toBe(false);
    expect(hasJavascriptUrl('<code>javascript:void(0)</code>')).toBe(false);
  });

  it('does not fire on a non-URL attribute mentioning javascript:', () => {
    expect(hasJavascriptUrl('<a href="/x" title="javascript: the good parts">x</a>')).toBe(false);
  });
});
