// SPDX-License-Identifier: Apache-2.0
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { cleanBuffer, cleanHtml } from './clean.js';

describe('cleanHtml — the Trafilatura-aligned default config', () => {
  it('keeps the canonical content vocabulary (p, headings, lists, tables, quotes)', async () => {
    const { html } = await cleanHtml(
      '<h2>T</h2><p>Hi</p><ul><li>a</li></ul><ol start="3"><li>b</li></ol>' +
        '<blockquote>q</blockquote><pre>c</pre><table><tr><th>h</th><td>d</td></tr></table>',
    );
    for (const tag of ['<h2>', '<p>', '<ul>', '<ol start="3">', '<li>', '<blockquote>', '<pre>']) {
      expect(html).toContain(tag);
    }
    expect(html).toContain('<table>');
    expect(html).toContain('<th>');
    expect(html).toContain('<td>');
  });

  it('keeps images with their Trafilatura attributes (src/alt/title/width/height)', async () => {
    const { html } = await cleanHtml(
      '<figure><img src="x.png" alt="a" title="t" width="10" height="20" data-lazy="y"><figcaption>cap</figcaption></figure>',
    );
    expect(html).toContain('<figure>');
    expect(html).toContain('<figcaption>');
    expect(html).toContain('src="x.png"');
    expect(html).toContain('alt="a"');
    expect(html).toContain('title="t"');
    expect(html).not.toContain('data-lazy'); // not in the whitelist
  });

  it('keeps a[href|title] and drops other link attributes', async () => {
    const { html } = await cleanHtml(
      '<p><a href="https://x.example" title="t" target="_blank" rel="nofollow">l</a></p>',
    );
    expect(html).toContain('href="https://x.example"');
    expect(html).toContain('title="t"');
    expect(html).not.toContain('target=');
    expect(html).not.toContain('rel=');
  });

  it('keeps inline formatting (i/em/strong/b/u/s/q/code/kbd/samp/var/sub/sup/del)', async () => {
    const { html } = await cleanHtml(
      '<p><i>i</i><em>e</em><strong>s</strong><b>b</b><u>u</u><s>x</s><q>q</q>' +
        '<code>c</code><kbd>k</kbd><samp>m</samp><var>v</var><sub>1</sub><sup>2</sup><del>d</del></p>',
    );
    for (const tag of [
      '<i>',
      '<em>',
      '<strong>',
      '<b>',
      '<u>',
      '<s>',
      '<q>',
      '<code>',
      '<kbd>',
      '<samp>',
      '<var>',
      '<sub>',
      '<sup>',
      '<del>',
    ]) {
      expect(html).toContain(tag);
    }
  });

  it('unwraps structural containers (div/span/section/article) keeping content — like MANUALLY_STRIPPED', async () => {
    const { html } = await cleanHtml(
      '<section><article><div><span>Hi</span> there</div></article></section>',
    );
    expect(html).not.toContain('<section');
    expect(html).not.toContain('<article');
    expect(html).not.toContain('<div');
    expect(html).not.toContain('<span');
    expect(html).toContain('Hi');
    expect(html).toContain('there');
  });

  it('unwraps thead/tfoot keeping rows (both upstreams strip row groups)', async () => {
    // Note: the sanitize stage strips thead/tbody/tfoot, but the HTML5
    // re-normalization (parse5) synthesizes a single <tbody> around bare <tr>
    // rows — exactly what a browser does — so only thead/tfoot stay gone.
    const { html } = await cleanHtml(
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody>' +
        '<tfoot><tr><td>f</td></tr></tfoot></table>',
    );
    expect(html).not.toContain('<thead');
    expect(html).not.toContain('<tfoot');
    expect(html).toContain('<tr>');
    expect(html).toContain('<th>h</th>');
    expect(html).toContain('<td>d</td>');
    expect(html).toContain('<td>f</td>');
  });

  it('unwraps inline semantics Trafilatura strips (abbr/cite/mark/small)', async () => {
    const { html } = await cleanHtml(
      '<p><abbr title="x">a</abbr><cite>c</cite><mark>m</mark><small>s</small></p>',
    );
    for (const tag of ['<abbr', '<cite', '<mark', '<small']) {
      expect(html).not.toContain(tag);
    }
    for (const text of ['a', 'c', 'm', 's']) {
      expect(html).toContain(text);
    }
  });

  it('discards MANUALLY_CLEANED subtrees with their content (nav/aside/form/video/time)', async () => {
    const { html } = await cleanHtml(
      '<nav>menu</nav><aside>side</aside><form><input value="x">field</form>' +
        '<video><source src="v.mp4">fallback</video><p>Published <time>2026-01-05</time>keep</p>',
    );
    for (const gone of ['menu', 'side', 'field', 'fallback', '2026-01-05']) {
      expect(html).not.toContain(gone);
    }
    expect(html).toContain('keep');
    expect(html).toContain('<p>');
  });

  it('discards <style> content entirely and drops class/style attributes', async () => {
    const { html } = await cleanHtml(
      '<style>.a{color:red}</style><p class="c" style="color:blue">Hi</p>',
    );
    expect(html).not.toContain('<style');
    expect(html).not.toContain('color:red');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('style=');
    expect(html).toContain('Hi');
  });

  it('transforms deprecated tags into the canonical set (strike→del, tt→var, xmp→pre)', async () => {
    const { html } = await cleanHtml('<strike>s</strike><tt>t</tt><xmp>x</xmp>');
    expect(html).toContain('<del>s</del>');
    expect(html).toContain('<var>t</var>');
    expect(html).toContain('<pre>');
    expect(html).not.toContain('<strike');
    expect(html).not.toContain('<tt');
    expect(html).not.toContain('<xmp');
  });

  it('drops unknown/custom tags but keeps their text', async () => {
    const { html } = await cleanHtml('<custom-x data-y="1">Hi</custom-x>');
    expect(html).not.toContain('<custom-x');
    expect(html).not.toContain('data-y');
    expect(html).toContain('Hi');
  });
});

describe('cleanHtml — custom config (CleanOptions.config)', () => {
  it('replaces the default config entirely', async () => {
    // A custom allow-list of just <p>: even tags the default keeps (<ul>) are
    // unwrapped under the custom config.
    const { html } = await cleanHtml('<ul><li>x</li></ul><p>Hi</p>', {
      config: { allowedTags: ['p'] },
    });
    expect(html).toContain('<p>Hi</p>');
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<li');
  });

  it('enforces the security floor even if the custom config allows <script> / on*', async () => {
    const { html } = await cleanHtml(
      '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">l</a>',
      {
        config: {
          allowedTags: ['p', 'a', 'script'],
          allowedAttributes: { p: ['onclick'], a: ['href'] },
        },
      },
    );
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('alert(1)');
    expect(html.toLowerCase()).not.toContain('onclick');
    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  it('runs the CSS-URL allow-list when a custom config permits inline style', async () => {
    const { html } = await cleanHtml('<div style="background:url(javascript:alert(1))">Hi</div>', {
      config: { allowedTags: ['div'], allowedAttributes: { '*': ['style'] } },
    });
    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  it('a custom config may keep class, inline style, and <style> CSS (cleaned)', async () => {
    const { html } = await cleanHtml(
      '<style>.a{color:red}</style><div class="c" style="color:blue">Hi</div>',
      {
        config: {
          allowedTags: ['div', 'style'],
          allowedAttributes: { '*': ['class', 'style'] },
        },
      },
    );
    expect(html).toContain('<style>');
    expect(html).toContain('color: red');
    expect(html).toContain('class="c"');
    expect(html).toContain('style="color: blue"');
  });

  // --- doc 09: the wildcard-config bypass regression guard ---
  // `{ allowedAttributes: { '*': ['*'] } }` passes shape-only validation, and the
  // wildcard `'*'` VALUE defeated both v1 defenses: `filterEventHandlers` only
  // strips literal `on*`-NAMED keys (not the `'*'` value, so `onclick` survived
  // sanitize-html), and the old `configAllowsStyle` gate checked `.includes('style')`
  // (`['*']` is not `'style'`, so the CSS cleaner was skipped and a `javascript:`
  // CSS URL survived). The UNCONDITIONAL floor closes both.
  it('closes the wildcard-config bypass: { allowedAttributes: { "*": ["*"] } } strips on*/javascript:/CSS (doc 09)', async () => {
    const { html } = await cleanHtml(
      '<p onclick="steal()" style="background:url(javascript:alert(1))">Hi</p>' +
        '<script>alert(2)</script><a href="javascript:evil()">l</a>',
      { config: { allowedTags: ['p', 'a', 'script'], allowedAttributes: { '*': ['*'] } } },
    );
    const lower = html.toLowerCase();
    expect(lower).not.toContain('<script');
    expect(lower).not.toContain('alert(2)');
    expect(lower).not.toContain('onclick');
    expect(lower).not.toContain('steal()');
    expect(lower).not.toContain('javascript:');
    // Benign text still survives — the floor removes only active-content vectors.
    expect(html).toContain('Hi');
  });

  it('closes the wildcard bypass with no allowedTags (wildcard attrs, dangerous CSS)', async () => {
    const { html } = await cleanHtml(
      '<div onmouseover="x()"><p style="width:expression(alert(1))">hi</p>' +
        '<a href="vbscript:msgbox(1)">l</a></div>',
      { config: { allowedAttributes: { '*': ['*'] } } },
    );
    const lower = html.toLowerCase();
    expect(lower).not.toContain('onmouseover');
    expect(lower).not.toContain('expression(');
    expect(lower).not.toContain('vbscript:');
    expect(html).toContain('hi');
  });
});

describe('cleanHtml — the security floor on every path', () => {
  const paths: { name: string; options: Parameters<typeof cleanHtml>[1] }[] = [
    { name: 'default config', options: {} },
    {
      name: 'custom config',
      options: { config: { allowedTags: ['p', 'a', 'div', 'meta'] } },
    },
  ];

  for (const { name, options } of paths) {
    it(`${name}: removes <script>`, async () => {
      const { html } = await cleanHtml('<p>Hi</p><script>alert(1)</script>', options);
      expect(html.toLowerCase()).not.toContain('<script');
    });

    it(`${name}: removes on* event handlers`, async () => {
      const { html } = await cleanHtml('<p onclick="alert(1)">Hi</p>', options);
      expect(html.toLowerCase()).not.toContain('onclick');
    });

    it(`${name}: removes javascript: hrefs`, async () => {
      const { html } = await cleanHtml('<a href="javascript:alert(1)">x</a>', options);
      expect(html.toLowerCase()).not.toContain('javascript:');
    });

    it(`${name}: removes data: hrefs`, async () => {
      const { html } = await cleanHtml('<a href="data:text/html,evil">x</a>', options);
      expect(html.toLowerCase()).not.toContain('data:text/html');
    });

    // `srcdoc` is inline HTML (not a URL, not an on* handler), so scheme filtering
    // alone never neutralizes `<iframe srcdoc>` — the whole tag must go.
    it(`${name}: drops <iframe srcdoc> (nested-document XSS)`, async () => {
      const { html } = await cleanHtml(
        '<iframe srcdoc="<script>alert(1)</script>">x</iframe>',
        options,
      );
      const lower = html.toLowerCase();
      expect(lower).not.toContain('<iframe');
      expect(lower).not.toContain('srcdoc');
      expect(lower).not.toContain('alert(1)');
    });

    it(`${name}: neutralizes <meta http-equiv="refresh"> auto-navigation`, async () => {
      const { html } = await cleanHtml(
        '<meta http-equiv="refresh" content="0;url=https://evil.example">',
        options,
      );
      expect(html.toLowerCase()).not.toContain('http-equiv');
      // The refresh payload must die too, even when the config-driven sanitize
      // pass stripped `http-equiv` first but kept `content` (the floor also
      // matches a refresh-shaped content attribute on its own).
      expect(html.toLowerCase()).not.toContain('evil.example');
    });

    it(`${name}: drops <object>/<embed>/<base>`, async () => {
      const { html } = await cleanHtml(
        '<object data="x.swf"></object><embed src="y"><base href="https://evil/">',
        options,
      );
      const lower = html.toLowerCase();
      expect(lower).not.toContain('<object');
      expect(lower).not.toContain('<embed');
      expect(lower).not.toContain('<base');
    });
  }
});

describe('cleanHtml — formatting', () => {
  it('prettier-formats by default', async () => {
    const { html } = await cleanHtml('<p>Hi</p><p>Bye</p>');
    expect(html).toBe('<p>Hi</p>\n<p>Bye</p>\n');
  });

  it('minify:true collapses whitespace', async () => {
    const { html } = await cleanHtml('<ul>    <li>Hi</li>    </ul>', { minify: true });
    expect(html).toBe('<ul><li>Hi</li></ul>');
  });

  it('prepends a DOCTYPE to full documents', async () => {
    const { html } = await cleanHtml(
      '<html><head><title>T</title></head><body><p>Hi</p></body></html>',
    );
    expect(html.trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>T</title>');
  });
});

describe('cleanHtml — edge cases', () => {
  it('returns "" for empty input', async () => {
    expect((await cleanHtml('')).html).toBe('');
  });

  it('returns "" for whitespace-only input', async () => {
    expect((await cleanHtml('   \n  ')).html).toBe('');
  });

  it('does not throw on malformed HTML', async () => {
    const { html } = await cleanHtml('<p><b>unclosed <div>broken');
    expect(html).toBeTruthy();
    expect(html).toContain('broken');
  });
});

describe('cleanBuffer', () => {
  it('decodes a UTF-8 buffer and cleans it', async () => {
    const buf = Buffer.from('<div><p>Café</p></div>', 'utf-8');
    const { html } = await cleanBuffer(buf);
    expect(html).toContain('Café');
    expect(html).not.toContain('<div'); // the default config unwraps div
  });

  it('decodes a non-UTF-8 (latin1) buffer, prepends decode diagnostics', async () => {
    const buf = iconv.encode('<p>Café déjà vu — naïve façade</p>', 'latin1');
    const { html, messages } = await cleanBuffer(buf);
    expect(html).toContain('<p>');
    expect(messages.some((m) => m.type === 'info')).toBe(true);
  });

  it('returns "" for an empty buffer', async () => {
    expect((await cleanBuffer(new Uint8Array(0))).html).toBe('');
  });
});

describe('cleanHtml — hardened (DOMPurify) backend', () => {
  it('removes <script> and on* handlers via the hardened backend', async () => {
    const { html, messages } = await cleanHtml(
      '<p>Hi</p><script>alert(1)</script><div onclick="x">y</div>',
      { hardened: true },
    );
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('onclick');
    expect(html).toContain('<p>Hi</p>');
    // dompurify + jsdom are installed in this workspace → no fallback warning.
    expect(messages.some((m) => /falling back to sanitize-html/.test(m.text))).toBe(false);
  });

  it('removes javascript: hrefs via the hardened backend', async () => {
    const { html } = await cleanHtml('<a href="javascript:alert(1)">x</a>', { hardened: true });
    expect(html.toLowerCase()).not.toContain('javascript:');
  });
});
