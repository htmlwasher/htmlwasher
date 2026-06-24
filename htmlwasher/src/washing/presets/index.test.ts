// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { getSanitizeConfig } from './index.js';
import { minimalSetup } from './minimal.js';
import { permissiveSetup } from './permissive.js';
import { standardSetup } from './standard.js';
import { styledSetup } from './styled.js';

describe('getSanitizeConfig', () => {
  it('maps each sanitize level to its preset', () => {
    expect(getSanitizeConfig('minimal')).toBe(minimalSetup);
    expect(getSanitizeConfig('standard')).toBe(standardSetup);
    expect(getSanitizeConfig('permissive')).toBe(permissiveSetup);
    expect(getSanitizeConfig('styled')).toBe(styledSetup);
  });

  it('returns undefined for correct (normalize-only, no sanitize)', () => {
    expect(getSanitizeConfig('correct')).toBeUndefined();
  });
});

describe('preset tag sets form a strict inclusion chain', () => {
  it('standard is a superset of minimal', () => {
    for (const tag of minimalSetup.allowedTags ?? []) {
      expect(standardSetup.allowedTags).toContain(tag);
    }
    expect(standardSetup.allowedTags).toContain('img');
    expect(minimalSetup.allowedTags).not.toContain('img');
  });

  it('permissive is a superset of standard', () => {
    for (const tag of standardSetup.allowedTags ?? []) {
      expect(permissiveSetup.allowedTags).toContain(tag);
    }
    expect(permissiveSetup.allowedTags).toContain('div');
    expect(standardSetup.allowedTags).not.toContain('div');
  });

  it('styled is permissive plus <style> and a global class/style attribute', () => {
    for (const tag of permissiveSetup.allowedTags ?? []) {
      expect(styledSetup.allowedTags).toContain(tag);
    }
    expect(styledSetup.allowedTags).toContain('style');
    expect(permissiveSetup.allowedTags).not.toContain('style');
    expect(styledSetup.allowedAttributes?.['*']).toEqual(['class', 'style']);
    // styled drops `style` from nonTextTags so its CSS body is preserved.
    expect(styledSetup.nonTextTags).not.toContain('style');
    expect(permissiveSetup.nonTextTags).toContain('style');
  });

  it('no preset ever lists an event-handler attribute', () => {
    for (const preset of [minimalSetup, standardSetup, permissiveSetup, styledSetup]) {
      for (const attrs of Object.values(preset.allowedAttributes ?? {})) {
        for (const attr of attrs) {
          expect(attr.toLowerCase().startsWith('on')).toBe(false);
        }
      }
    }
  });
});
