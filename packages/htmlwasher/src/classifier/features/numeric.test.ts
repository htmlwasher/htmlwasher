// SPDX-License-Identifier: Apache-2.0
// FIX H regression: `splitWhitespace` / `strip` must match CPython
// `str.split()` / `str.strip()` whitespace semantics byte-for-byte, NOT the JS
// `\s` / `String.trim()` set. CPython treats U+001C..U+001F and U+0085 as
// whitespace (JS does not); JS treats U+FEFF (the BOM) as whitespace (CPython
// does not). Exotic codepoints are built via `String.fromCodePoint` so no literal
// glyph appears in source.
import { describe, expect, it } from 'vitest';
import { splitWhitespace, strip } from './numeric.js';

const NEL = String.fromCodePoint(0x85); // U+0085, CPython whitespace, JS \s ✗
const FS = String.fromCodePoint(0x1c); // U+001C, CPython whitespace, JS \s ✗
const BOM = String.fromCodePoint(0xfeff); // U+FEFF, JS trims it, CPython keeps it
const TAB = '\t';

describe('splitWhitespace — CPython str.split() parity', () => {
  it('splits on U+0085 (NEL) and U+001C, which JS \\s does NOT', () => {
    // Sanity: prove these are the divergent codepoints.
    expect(/\s/.test(NEL)).toBe(false);
    expect(/\s/.test(FS)).toBe(false);

    const s = `alpha${NEL}beta${FS}gamma${BOM}delta`;
    // Python str.split() => ['alpha', 'beta', 'gamma﻿delta'] — the BOM stays
    // attached to its neighbor because CPython does not treat it as whitespace.
    expect(splitWhitespace(s)).toEqual(['alpha', 'beta', `gamma${BOM}delta`]);
  });

  it('drops leading/trailing whitespace and collapses runs (like str.split())', () => {
    expect(splitWhitespace(`  ${TAB}\n one  two${NEL}${NEL}three \n`)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('returns [] for an all-whitespace or empty string', () => {
    expect(splitWhitespace('')).toEqual([]);
    expect(splitWhitespace(` \t\n${NEL}${FS} `)).toEqual([]);
  });

  it('does NOT split on U+FEFF (BOM is not CPython whitespace)', () => {
    expect(splitWhitespace(`x${BOM}y`)).toEqual([`x${BOM}y`]);
  });
});

describe('strip — CPython str.strip() parity', () => {
  it('strips a leading/trailing run of CPython whitespace', () => {
    expect(strip(`${NEL}${FS} hello ${TAB}${NEL}`)).toBe('hello');
  });

  it('KEEPS a leading/trailing U+FEFF — diverging from String.trim()', () => {
    const s = `${BOM}x${BOM}`;
    // CPython keeps the BOM; JS .trim() would strip it.
    expect(strip(s)).toBe(s);
    expect(s.trim()).toBe('x'); // documents the divergence we are guarding against
  });

  it('strips ASCII space exactly like .trim() for the common case', () => {
    expect(strip('  hi  ')).toBe('hi');
  });
});
