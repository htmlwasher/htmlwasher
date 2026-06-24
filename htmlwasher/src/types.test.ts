import { describe, expect, it } from 'vitest';

import {
  BOILERPLATE_MODES,
  DEFAULT_BOILERPLATE_MODE,
  DEFAULT_WASHING_LEVEL,
  isBoilerplateMode,
  isPageType,
  isWashingLevel,
  PAGE_TYPES,
  WASHING_LEVELS,
} from './types.js';

describe('option unions', () => {
  it('exposes exactly the four boilerplate modes', () => {
    expect([...BOILERPLATE_MODES]).toEqual(['precision', 'balanced', 'recall', 'none']);
  });

  it('exposes exactly the five washing levels (no *-reader variants)', () => {
    expect([...WASHING_LEVELS]).toEqual(['minimal', 'standard', 'permissive', 'styled', 'correct']);
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
    expect(DEFAULT_WASHING_LEVEL).toBe('standard');
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

  it('isWashingLevel accepts valid, rejects invalid', () => {
    expect(isWashingLevel('styled')).toBe(true);
    expect(isWashingLevel('correct')).toBe(true);
    expect(isWashingLevel('minimal-reader')).toBe(false);
    expect(isWashingLevel(null)).toBe(false);
  });

  it('isPageType accepts collection, rejects category', () => {
    expect(isPageType('collection')).toBe(true);
    expect(isPageType('forum')).toBe(true);
    expect(isPageType('category')).toBe(false);
  });
});
