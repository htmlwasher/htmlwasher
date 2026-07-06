import { describe, expect, it } from 'vitest';

import { checkAuthors, normalizeAuthors } from './authors.js';

describe('normalizeAuthors', () => {
  it('splits on ; , & / and the word "and"', () => {
    expect(normalizeAuthors(undefined, 'Jane Doe; John Smith')).toBe('Jane Doe; John Smith');
    expect(normalizeAuthors(undefined, 'Jane Doe, John Smith')).toBe('Jane Doe; John Smith');
    expect(normalizeAuthors(undefined, 'Jane Doe & John Smith')).toBe('Jane Doe; John Smith');
    expect(normalizeAuthors(undefined, 'Jane Doe / John Smith')).toBe('Jane Doe; John Smith');
    expect(normalizeAuthors(undefined, 'Jane Doe and John Smith')).toBe('Jane Doe; John Smith');
  });

  it('title-cases a lowercase name', () => {
    expect(normalizeAuthors(undefined, 'jane doe')).toBe('Jane Doe');
  });

  it('strips a leading "by" / "von" prefix', () => {
    expect(normalizeAuthors(undefined, 'by Jane Doe')).toBe('Jane Doe');
    expect(normalizeAuthors(undefined, 'von Klaus Müller')).toBe('Klaus Müller');
  });

  it('removes @twitter handles and email/url inputs', () => {
    expect(normalizeAuthors(undefined, '@janedoe Jane Doe')).toBe('Jane Doe');
    expect(normalizeAuthors(undefined, 'https://x.com/jane')).toBeUndefined();
    expect(normalizeAuthors(undefined, 'jane@example.com')).toBeUndefined();
  });

  it('only discards on a START-anchored email (mirrors Python re.match)', () => {
    // mid-string email does NOT discard the whole string (re.match anchors at
    // position 0); the name survives and is processed normally. Canonical
    // mangles the trailing email via twitter/join cleanup → "John Doe john com".
    expect(normalizeAuthors(undefined, 'John Doe john@x.com')).toBe('John Doe john com');
    // a name immediately followed by an email keeps the leading name
    expect(normalizeAuthors(undefined, 'Jane Roe contact jane@x.com')?.startsWith('Jane Roe')).toBe(
      true,
    );
    // leading email still discards the whole string
    expect(normalizeAuthors(undefined, 'jane@example.com')).toBeUndefined();
    expect(normalizeAuthors(undefined, 'jane@example.com extra')).toBeUndefined();
  });

  it('merges into existing authors and dedupes substrings', () => {
    expect(normalizeAuthors('Jane Doe', 'John Smith')).toBe('Jane Doe; John Smith');
    expect(normalizeAuthors('Jane Doe', 'Jane Doe')).toBe('Jane Doe');
  });

  it('returns current authors unchanged when nothing survives', () => {
    expect(normalizeAuthors('Jane Doe', 'https://x.com/y')).toBe('Jane Doe');
  });
});

describe('checkAuthors', () => {
  it('removes blacklisted names case-insensitively', () => {
    expect(checkAuthors('Jane Doe; Admin', new Set(['admin']))).toBe('Jane Doe');
  });

  it('returns undefined when everything is blacklisted', () => {
    expect(checkAuthors('Admin', new Set(['admin']))).toBeUndefined();
  });
});
