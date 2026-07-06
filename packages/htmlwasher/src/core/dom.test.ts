import { describe, expect, it } from 'vitest';

import { classId, parseDocument, tagOf, textLength, trim, unwrap } from './dom.js';

describe('dom helpers', () => {
  it('parses empty input without throwing', () => {
    const doc = parseDocument('');
    expect(doc.body).not.toBeNull();
  });

  it('trim collapses internal whitespace', () => {
    expect(trim('  a\n\t  b   c ')).toBe('a b c');
  });

  it('tagOf lowercases the tag name', () => {
    const doc = parseDocument('<DIV></DIV>');
    const el = doc.querySelector('div');
    expect(el).not.toBeNull();
    expect(tagOf(el!)).toBe('div');
  });

  it('classId joins class and id', () => {
    const doc = parseDocument('<div class="post-content" id="main">x</div>');
    const el = doc.querySelector('div')!;
    expect(classId(el)).toContain('post-content');
    expect(classId(el)).toContain('main');
  });

  it('textLength counts trimmed unicode chars', () => {
    const doc = parseDocument('<p>  hello   world </p>');
    expect(textLength(doc.querySelector('p')!)).toBe('hello world'.length);
  });

  it('unwrap replaces an element with its children', () => {
    const doc = parseDocument('<p>a <span>b <b>c</b></span> d</p>');
    unwrap(doc.querySelector('span')!);
    expect(doc.querySelector('p')!.textContent).toBe('a b c d');
    expect(doc.querySelector('span')).toBeNull();
    expect(doc.querySelector('b')).not.toBeNull();
  });
});
