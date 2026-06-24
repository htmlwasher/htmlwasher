import { describe, expect, it } from 'vitest';

import { PAGE_TYPES } from '../types.js';
import { getProfile, PROFILES } from './index.js';

describe('extraction profiles', () => {
  it('defines a profile for every page type', () => {
    for (const t of PAGE_TYPES) {
      expect(PROFILES[t]).toBeDefined();
    }
  });

  it('forum: comments are content, preserves <form>, has content selectors', () => {
    const p = getProfile('forum');
    expect(p.commentsAreContent).toBe(true);
    expect(p.preserveTags).toContain('form');
    expect(p.contentSelectors.length).toBeGreaterThan(0);
    expect(p.boilerplateSelectors.length).toBeGreaterThan(0);
  });

  it('listing collects repeated items; article aggregates sections', () => {
    expect(getProfile('listing').collectRepeatedItems).toBe(true);
    expect(getProfile('article').aggregateSections).toBe(true);
    expect(getProfile('article').collectRepeatedItems).toBe(false);
  });

  it('product/documentation carry type-specific selectors', () => {
    expect(getProfile('product').contentSelectors).toContain('.product-description');
    expect(getProfile('documentation').contentSelectors).toContain('.markdown-body');
  });

  it('article and collection use no special content selectors', () => {
    expect(getProfile('article').contentSelectors).toHaveLength(0);
    expect(getProfile('collection').contentSelectors).toHaveLength(0);
  });
});
