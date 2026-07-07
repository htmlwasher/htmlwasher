// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { cleanHtmlBackend, filterEventHandlers } from './cleaner.js';
import { DEFAULT_CLEAN_CONFIG } from './config.js';

describe('filterEventHandlers', () => {
  it('strips every attribute whose name starts with on', () => {
    const filtered = filterEventHandlers({
      div: ['class', 'onclick', 'onmouseover', 'data-x'],
      a: ['href', 'ONLOAD'],
    });
    expect(filtered.div).toEqual(['class', 'data-x']);
    expect(filtered.a).toEqual(['href']);
  });

  it('is case-insensitive', () => {
    const filtered = filterEventHandlers({ p: ['OnClick', 'onFocus', 'title'] });
    expect(filtered.p).toEqual(['title']);
  });
});

describe('cleanHtmlBackend', () => {
  it('applies the default allow-list', () => {
    const out = cleanHtmlBackend.clean(
      '<div><p>Hi</p></div><script>x</script>',
      DEFAULT_CLEAN_CONFIG,
    );
    expect(out).toContain('<p>Hi</p>');
    expect(out).not.toContain('<div>'); // unwrapped, not allowed
    expect(out).not.toContain('<script>');
  });

  it('drops event handlers even if a config tried to allow them', () => {
    const out = cleanHtmlBackend.clean('<div onclick="alert(1)">Hi</div>', {
      allowedTags: ['div'],
      allowedAttributes: { div: ['onclick', 'class'] },
    });
    expect(out).not.toContain('onclick');
  });
});
