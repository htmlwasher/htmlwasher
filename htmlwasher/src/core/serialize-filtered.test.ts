import { describe, expect, it } from 'vitest';

import { parseDocument } from './dom.js';
import { DEFAULT_CORE_OPTIONS } from './options.js';
import { isBoilerplateNamed, postCleaning, renderFilteredHTML } from './serialize-filtered.js';

const opts = DEFAULT_CORE_OPTIONS;

function render(html: string, override = opts): string {
  const doc = parseDocument(html);
  const root = Array.from(doc.body!.children)[0] ?? doc.body!;
  return renderFilteredHTML(root, override);
}

describe('renderFilteredHTML — whitelist re-serializer', () => {
  it('emits whitelisted block + inline tags', () => {
    const out = render('<article><h1>Title</h1><p>Hello <strong>world</strong></p></article>');
    expect(out).toBe('<article><h1>Title</h1><p>Hello <strong>world</strong></p></article>');
  });

  it('unwraps non-whitelisted elements (span, font) keeping their text', () => {
    const out = render('<div><p><span><font>kept</font> text</span></p></div>');
    // span is in EMIT_TAGS; font is not -> unwrapped
    expect(out).toContain('kept text');
    expect(out).not.toContain('<font');
  });

  it('drops the hard skip-set entirely (nav, script, iframe)', () => {
    const out = render(
      '<div><p>keep</p><nav><a href="/x">menu</a></nav><script>evil()</script><iframe src="x"></iframe></div>',
    );
    expect(out).toContain('keep');
    expect(out).not.toContain('menu');
    expect(out).not.toContain('script');
    expect(out).not.toContain('iframe');
  });

  it('drops boilerplate-named nodes by class/id', () => {
    const out = render('<div><p>body</p><div class="social-share"><p>follow us</p></div></div>');
    expect(out).toContain('body');
    expect(out).not.toContain('follow us');
  });

  it('keeps href on <a> but only whitelisted attributes', () => {
    const out = render('<div><a href="/p" class="btn" onclick="x()" data-id="9">link</a></div>');
    expect(out).toContain('href="/p"');
    expect(out).not.toContain('class=');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('data-id');
  });

  it('escapes text and attribute values', () => {
    const out = render('<div><p>a &lt; b &amp; c &gt; d</p></div>');
    expect(out).toContain('a &lt; b &amp; c &gt; d');
  });

  it('drops links when includeLinks is false (unwraps, keeps text)', () => {
    const out = render('<div><a href="/p">anchor</a></div>', { ...opts, includeLinks: false });
    expect(out).toContain('anchor');
    expect(out).not.toContain('href');
  });

  it('keeps comment-classed nodes when commentsAsContent is true', () => {
    const html = '<div><p>post</p><div class="comment"><p>nice</p></div></div>';
    expect(render(html)).not.toContain('nice'); // default: dropped
    expect(render(html, { ...opts, commentsAsContent: true })).toContain('nice');
  });
});

describe('isBoilerplateNamed', () => {
  it('flags navigation/sidebar tokens', () => {
    const doc = parseDocument('<div class="main-sidebar"></div>');
    expect(isBoilerplateNamed(doc.querySelector('div')!, opts)).toBe(true);
  });

  it('does not flag content classes', () => {
    const doc = parseDocument('<div class="article-content"></div>');
    expect(isBoilerplateNamed(doc.querySelector('div')!, opts)).toBe(false);
  });
});

describe('postCleaning', () => {
  it('strips presentational + unsafe attributes, keeps size attrs on tables', () => {
    const doc = parseDocument(
      '<div><table width="100" style="x" bgcolor="red"><tr><td width="5">c</td></tr></table></div>',
    );
    const root = doc.querySelector('div')!;
    postCleaning(root);
    const table = root.querySelector('table')!;
    expect(table.getAttribute('width')).toBe('100');
    expect(table.getAttribute('style')).toBeNull();
    expect(table.getAttribute('bgcolor')).toBeNull();
  });
});
