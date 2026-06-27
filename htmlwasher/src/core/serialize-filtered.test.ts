import { describe, expect, it } from 'vitest';

import { parseDocument } from './dom.js';
import { DEFAULT_CORE_OPTIONS } from './options.js';
import {
  isAlwaysExcludedName,
  isBoilerplateNamed,
  postCleaning,
  renderFilteredHTML,
} from './serialize-filtered.js';

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
  function named(classOrId: string): boolean {
    const doc = parseDocument(`<div class="${classOrId}"></div>`);
    return isBoilerplateNamed(doc.querySelector('div')!, opts);
  }

  it('flags navigation/sidebar tokens', () => {
    const doc = parseDocument('<div class="main-sidebar"></div>');
    expect(isBoilerplateNamed(doc.querySelector('div')!, opts)).toBe(true);
  });

  it('does not flag content classes', () => {
    const doc = parseDocument('<div class="article-content"></div>');
    expect(isBoilerplateNamed(doc.querySelector('div')!, opts)).toBe(false);
  });

  // FIX (core-serializer-2): rs is_boilerplate false-positive guards. These tokens
  // must NOT be treated as boilerplate (Elementor content widgets, theme-namespace
  // sidebars, layout/component-prefixed social/sidebar tokens).
  it('does not flag rs false-positive tokens', () => {
    expect(named('elementor-widget-text-editor')).toBe(false);
    expect(named('elementor-widget-container')).toBe(false);
    expect(named('newspaper-x-sidebar')).toBe(false);
    expect(named('l-sidebar-fixed')).toBe(false);
    expect(named('c-social-buttons')).toBe(false);
  });

  // ...but genuine furniture still matches.
  it('still flags genuine sidebar/social/share tokens', () => {
    expect(named('sidebar')).toBe(true);
    expect(named('left-sidebar')).toBe(true);
    expect(named('c-social-share')).toBe(true); // `share` still matches
    expect(named('share-buttons')).toBe(true);
    expect(named('widget')).toBe(true); // bare widget (not elementor-prefixed)
  });
});

describe('isAlwaysExcludedName (unconditional)', () => {
  function el(html: string) {
    const doc = parseDocument(html);
    return doc.querySelector('[data-t]')!;
  }

  // FIX (core-serializer-0): rs is_always_excluded_name substrings — dropped
  // unconditionally (independent of the boilerplate-token backoff).
  it('flags always-excluded class/id substrings', () => {
    expect(isAlwaysExcludedName(el('<div data-t class="el__featured-video"></div>'), opts)).toBe(
      true,
    );
    expect(isAlwaysExcludedName(el('<div data-t class="pg-headline"></div>'), opts)).toBe(true);
    expect(isAlwaysExcludedName(el('<div data-t id="av-structured-data"></div>'), opts)).toBe(true);
  });

  // FIX (core-serializer-1): itemtype*=breadcrumblist is dropped unconditionally.
  it('flags BreadcrumbList microdata via itemtype', () => {
    expect(
      isAlwaysExcludedName(
        el('<ol data-t itemscope itemtype="https://schema.org/BreadcrumbList"></ol>'),
        opts,
      ),
    ).toBe(true);
  });

  it('does not flag ordinary content', () => {
    expect(isAlwaysExcludedName(el('<div data-t class="article-content"></div>'), opts)).toBe(
      false,
    );
    expect(
      isAlwaysExcludedName(el('<ol data-t itemtype="https://schema.org/ItemList"></ol>'), opts),
    ).toBe(false);
  });

  it('keeps comment-container nodes when commentsAsContent is true', () => {
    const node = el('<div data-t class="comment-container"></div>');
    expect(isAlwaysExcludedName(node, opts)).toBe(true);
    expect(isAlwaysExcludedName(node, { ...opts, commentsAsContent: true })).toBe(false);
  });
});

describe('renderFilteredHTML — unconditional drops', () => {
  it('drops a BreadcrumbList <ol> with no breadcrumb class/id', () => {
    const out = render(
      '<div><p>body text</p><ol itemscope itemtype="https://schema.org/BreadcrumbList"><li>Home</li><li>Section</li></ol></div>',
    );
    expect(out).toContain('body text');
    expect(out).not.toContain('Home');
    expect(out).not.toContain('Section');
  });

  it('drops an el__featured-video furniture node', () => {
    const out = render(
      '<div><p>real body</p><div class="el__featured-video"><p>video furniture</p></div></div>',
    );
    expect(out).toContain('real body');
    expect(out).not.toContain('video furniture');
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

  // FIX 3: strip an element with NO child elements and blank LEADING text, matching
  // go's `len(Children) == 0 && !textCharsTest(etree.Text(child))`.
  it('strips a whitespace-only <div> (no element children, blank leading text)', () => {
    const doc = parseDocument('<section><div>   </div><p>keep</p></section>');
    const root = doc.querySelector('section')!;
    postCleaning(root);
    expect(root.querySelector('div')).toBeNull();
    expect(root.querySelector('p')?.textContent).toBe('keep');
  });

  it('preserves a <div> with leading text', () => {
    const doc = parseDocument('<section><div>text</div></section>');
    const root = doc.querySelector('section')!;
    postCleaning(root);
    expect(root.querySelector('div')?.textContent).toBe('text');
  });

  it('preserves a <div> with a child element even when its leading text is blank', () => {
    const doc = parseDocument('<section><div>hello<span></span></div></section>');
    const root = doc.querySelector('section')!;
    postCleaning(root);
    // The <div> has a child element (the now-attribute-cleaned <span>), so it is
    // not "empty" and must survive. The empty <span> itself is stripped (unwrapped).
    expect(root.querySelector('div')?.textContent).toBe('hello');
  });
});
