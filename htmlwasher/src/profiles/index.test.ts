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

  it('getProfile returns the matching profile object per page type', () => {
    // Identity: each page type resolves to its own static PROFILES entry (consumed
    // by the pipeline), and an unknown type falls back to the article profile.
    for (const t of PAGE_TYPES) {
      expect(getProfile(t)).toBe(PROFILES[t]);
    }
    expect(getProfile('nonsense' as (typeof PAGE_TYPES)[number])).toBe(PROFILES.article);
  });

  it('forum profile wires the LIVE commentsAreContent flag that drives extraction', () => {
    // commentsAreContent IS consumed by the pipeline (forum keeps comment nodes as
    // content); only the forum profile sets it true.
    expect(getProfile('forum').commentsAreContent).toBe(true);
    for (const t of PAGE_TYPES) {
      if (t !== 'forum') expect(getProfile(t).commentsAreContent).toBe(false);
    }
  });

  it('profiles configure the post-pass flags per type (config-only; post-passes not yet wired)', () => {
    // NOTE: aggregateSections/collectRepeatedItems are LIVE in rs-trafilatura but not
    // yet consumed by the TS pipeline (see profiles/index.ts NOTE + PORTING-NOTES).
    // This asserts profile CONFIGURATION, not extraction behavior.
    expect(getProfile('listing').collectRepeatedItems).toBe(true);
    expect(getProfile('article').aggregateSections).toBe(true);
    expect(getProfile('article').collectRepeatedItems).toBe(false);
  });

  it('product/documentation carry type-specific selectors driving the content cascade', () => {
    expect(getProfile('product').contentSelectors).toContain('.product-description');
    expect(getProfile('documentation').contentSelectors).toContain('.markdown-body');
  });

  it("product boilerplate restores the rs-trafilatura [class*='recommend'] selector", () => {
    expect(getProfile('product').boilerplateSelectors).toContain("[class*='recommend']");
  });

  it('article and collection use no special content selectors', () => {
    expect(getProfile('article').contentSelectors).toHaveLength(0);
    expect(getProfile('collection').contentSelectors).toHaveLength(0);
  });
});
