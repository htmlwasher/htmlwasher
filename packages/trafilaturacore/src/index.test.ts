import { describe, expect, it } from 'vitest';

import * as api from './index.js';
import { VERSION } from './index.js';

describe('trafilaturacore scaffold', () => {
  it('exports a non-empty VERSION string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it('exports the public surface (clean, modes, DEFAULT_CLEAN_CONFIG) without level artifacts', () => {
    expect(typeof api.clean).toBe('function');
    expect(api.BOILERPLATE_MODES).toContain('clean-only');
    expect(api.DEFAULT_CLEAN_CONFIG.allowedTags).toContain('p');
    // The five-level preset system is gone from the public surface.
    expect('CLEANING_LEVELS' in api).toBe(false);
    expect('isCleaningLevel' in api).toBe(false);
    expect('DEFAULT_CLEANING_LEVEL' in api).toBe(false);
  });
});
