// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { computeTfidf, type TfidfVocab, tokenize } from './tfidf.js';

const VOCAB: TfidfVocab = {
  vocabulary: { coffee: 0, guide: 1, best: 2 },
  idf: [2, 3, 5],
  nTfidf: 3,
  lowercase: true,
};

describe('tokenize — sklearn default token pattern', () => {
  it('lowercases and drops 1-char tokens', () => {
    expect(tokenize('A Best Coffee-Guide!', true)).toEqual(['best', 'coffee', 'guide']);
  });

  it('keeps digits in 2+ char tokens', () => {
    expect(tokenize('top 10 2025', true)).toEqual(['top', '10', '2025']);
  });
});

describe('computeTfidf', () => {
  it('term value = raw count × idf, then L2-normalized; OOV ignored', () => {
    // "best coffee coffee zzz" → coffee:2, best:1, zzz: OOV ignored.
    const got = computeTfidf('best coffee coffee zzz', VOCAB);
    // raw*idf: coffee = 2*2 = 4, guide = 0, best = 1*5 = 5
    const norm = Math.sqrt(4 * 4 + 5 * 5);
    expect(got[0]).toBeCloseTo(4 / norm, 12);
    expect(got[1]).toBe(0);
    expect(got[2]).toBeCloseTo(5 / norm, 12);
    // L2 norm of the result is 1.
    const l2 = Math.sqrt(got.reduce((a, b) => a + b * b, 0));
    expect(l2).toBeCloseTo(1, 12);
  });

  it('empty / all-OOV text → all zeros', () => {
    expect(computeTfidf('', VOCAB)).toEqual([0, 0, 0]);
    expect(computeTfidf('zzz qqq', VOCAB)).toEqual([0, 0, 0]);
  });
});
