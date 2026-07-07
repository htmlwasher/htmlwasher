import { describe, expect, it } from 'vitest';

import {
  BOILERPLATE_MODES,
  CLEANING_LEVELS,
  cleanConfigError,
  DEFAULT_BOILERPLATE_MODE,
  DEFAULT_CLEANING_LEVEL,
  DEFAULT_MAX_INPUT_BYTES,
  isBoilerplateMode,
  isCleanConfig,
  isCleaningLevel,
  isPageType,
  PAGE_TYPES,
} from './types.js';

describe('option unions', () => {
  it('exposes exactly the four boilerplate modes', () => {
    expect([...BOILERPLATE_MODES]).toEqual(['precision', 'balanced', 'recall', 'none']);
  });

  it('exposes exactly the five cleaning levels (no *-reader variants)', () => {
    expect([...CLEANING_LEVELS]).toEqual([
      'minimal',
      'standard',
      'permissive',
      'styled',
      'correct',
    ]);
  });

  it('exposes the seven page types with collection (not category)', () => {
    expect([...PAGE_TYPES]).toEqual([
      'article',
      'forum',
      'product',
      'collection',
      'listing',
      'documentation',
      'service',
    ]);
    expect(PAGE_TYPES).not.toContain('category');
  });

  it('defaults are balanced + standard', () => {
    expect(DEFAULT_BOILERPLATE_MODE).toBe('balanced');
    expect(DEFAULT_CLEANING_LEVEL).toBe('standard');
  });

  it('DEFAULT_MAX_INPUT_BYTES is 10 MB (per context doc 08)', () => {
    expect(DEFAULT_MAX_INPUT_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('runtime guards', () => {
  it('isBoilerplateMode accepts valid, rejects invalid', () => {
    expect(isBoilerplateMode('precision')).toBe(true);
    expect(isBoilerplateMode('none')).toBe(true);
    expect(isBoilerplateMode('aggressive')).toBe(false);
    expect(isBoilerplateMode(42)).toBe(false);
    expect(isBoilerplateMode(undefined)).toBe(false);
  });

  it('isCleaningLevel accepts valid, rejects invalid', () => {
    expect(isCleaningLevel('styled')).toBe(true);
    expect(isCleaningLevel('correct')).toBe(true);
    expect(isCleaningLevel('minimal-reader')).toBe(false);
    expect(isCleaningLevel(null)).toBe(false);
  });

  it('isPageType accepts collection, rejects category', () => {
    expect(isPageType('collection')).toBe(true);
    expect(isPageType('forum')).toBe(true);
    expect(isPageType('category')).toBe(false);
  });
});

describe('isCleanConfig / cleanConfigError', () => {
  it('accepts an empty config and a fully-populated one', () => {
    expect(isCleanConfig({})).toBe(true);
    expect(cleanConfigError({})).toBeNull();
    const full = {
      allowedTags: ['p', 'a'],
      allowedAttributes: { a: ['href'] },
      allowedClasses: { p: ['lead'] },
      selfClosing: ['br'],
      nonTextTags: ['script'],
      transformTags: { b: 'strong' },
    };
    expect(isCleanConfig(full)).toBe(true);
    expect(cleanConfigError(full)).toBeNull();
  });

  it('rejects non-objects with a clear message', () => {
    expect(isCleanConfig(null)).toBe(false);
    expect(isCleanConfig([])).toBe(false);
    expect(isCleanConfig('x')).toBe(false);
    expect(cleanConfigError(42)).toMatch(/expected a JSON object/);
  });

  it('rejects unknown fields by name', () => {
    expect(cleanConfigError({ allowedTags: ['p'], bogus: 1 })).toMatch(/unknown field 'bogus'/);
    expect(isCleanConfig({ allowedTags: ['p'], bogus: 1 })).toBe(false);
  });

  it('rejects wrong-typed fields', () => {
    expect(cleanConfigError({ allowedTags: 'p' })).toMatch(/'allowedTags' must be an array/);
    expect(cleanConfigError({ allowedTags: [1, 2] })).toMatch(/'allowedTags' must be an array/);
    expect(cleanConfigError({ allowedAttributes: { a: 'href' } })).toMatch(
      /'allowedAttributes' must map/,
    );
    expect(cleanConfigError({ transformTags: { b: 1 } })).toMatch(/'transformTags' must map/);
  });
});
