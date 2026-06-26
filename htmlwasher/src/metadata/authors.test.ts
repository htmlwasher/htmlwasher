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
