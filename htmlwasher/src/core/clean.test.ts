import { describe, expect, it } from 'vitest';

import { cleanDocument, deleteByLinkDensity, linkDensityTest } from './clean.js';
import { parseDocument } from './dom.js';
import { DEFAULT_CORE_OPTIONS } from './options.js';

const opts = DEFAULT_CORE_OPTIONS;

describe('cleanDocument', () => {
  it('removes script/style/nav/footer/form, keeps paragraphs', () => {
    const doc = parseDocument(
      '<body><nav>n</nav><script>s</script><style>.a{}</style><main><p>keep me</p></main><footer>f</footer><form><input></form></body>',
    );
    cleanDocument(doc.body!, opts);
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('style')).toBeNull();
    expect(doc.querySelector('nav')).toBeNull();
    expect(doc.querySelector('footer')).toBeNull();
    expect(doc.querySelector('form')).toBeNull();
    expect(doc.querySelector('p')?.textContent).toBe('keep me');
  });

  it('keeps images by default (includeImages)', () => {
    const doc = parseDocument('<body><main><p>x</p><img src="a.png" alt="a"></main></body>');
    cleanDocument(doc.body!, opts);
    expect(doc.querySelector('img')).not.toBeNull();
  });

  it('removes HTML comments', () => {
    const doc = parseDocument('<body><main><p>x</p><!-- secret --></main></body>');
    cleanDocument(doc.body!, opts);
    expect(doc.body!.innerHTML).not.toContain('secret');
  });
});

describe('linkDensityTest', () => {
  it('flags a short link-only block as high density', () => {
    const doc = parseDocument('<ul><li><a href="/a">x</a></li><li><a href="/b">y</a></li></ul>');
    const { highDensity } = linkDensityTest(doc.querySelector('ul')!, opts);
    expect(highDensity).toBe(true);
  });

  it('does not flag a text-rich paragraph with one link', () => {
    const doc = parseDocument(
      '<p>This is a long paragraph of real content with a single <a href="/x">link</a> embedded inside it for context.</p>',
    );
    const { highDensity } = linkDensityTest(doc.querySelector('p')!, opts);
    expect(highDensity).toBe(false);
  });
});

describe('deleteByLinkDensity', () => {
  it('removes a link-dense list under the subtree', () => {
    const doc = parseDocument(
      '<div><p>real content here</p><ul><li><a href="/1">a</a></li><li><a href="/2">b</a></li><li><a href="/3">c</a></li></ul></div>',
    );
    const root = doc.querySelector('div')!;
    deleteByLinkDensity(root, opts, false, 'ul');
    expect(root.querySelector('ul')).toBeNull();
    expect(root.querySelector('p')).not.toBeNull();
  });
});
