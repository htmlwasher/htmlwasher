// SPDX-License-Identifier: Apache-2.0
// FIX G regression: `assertModelVocab` must reject a malformed/truncated
// `tfidf-vocab.json` shape before it can silently produce wrong vectors.
import { describe, expect, it } from 'vitest';
import { assertModelVocab, loadVocab } from './index.js';

/** A minimal well-formed vocab object the guard should accept. */
function validVocab(): Record<string, unknown> {
  return {
    vocabulary: { foo: 0, bar: 1 },
    idf: Array.from({ length: 100 }, () => 1),
    numericMean: Array.from({ length: 89 }, () => 0),
    numericScale: Array.from({ length: 89 }, () => 1),
    classLabels: [
      'article',
      'forum',
      'product',
      'collection',
      'listing',
      'documentation',
      'service',
    ],
    nNumeric: 89,
    nTfidf: 100,
  };
}

describe('assertModelVocab', () => {
  it('accepts a well-formed vocab object', () => {
    expect(() => assertModelVocab(validVocab())).not.toThrow();
  });

  it('accepts the actual shipped artifact', () => {
    // loadVocab() runs the guard internally; a throw here would fail the suite.
    expect(() => loadVocab()).not.toThrow();
  });

  it('rejects a non-object', () => {
    expect(() => assertModelVocab(null)).toThrow(/malformed/);
    expect(() => assertModelVocab('truncated')).toThrow(/malformed/);
  });

  it('rejects a truncated numericMean (wrong length)', () => {
    const v = validVocab();
    v.numericMean = Array.from({ length: 88 }, () => 0);
    expect(() => assertModelVocab(v)).toThrow(/numericMean/);
  });

  it('rejects a truncated numericScale (wrong length)', () => {
    const v = validVocab();
    v.numericScale = [];
    expect(() => assertModelVocab(v)).toThrow(/numericScale/);
  });

  it('rejects a wrong nNumeric', () => {
    const v = validVocab();
    v.nNumeric = 81;
    expect(() => assertModelVocab(v)).toThrow(/nNumeric/);
  });

  it('rejects an idf length that disagrees with nTfidf', () => {
    const v = validVocab();
    v.idf = Array.from({ length: 99 }, () => 1);
    expect(() => assertModelVocab(v)).toThrow(/idf/);
  });

  it('rejects a wrong nTfidf', () => {
    const v = validVocab();
    v.nTfidf = 50;
    v.idf = Array.from({ length: 50 }, () => 1);
    expect(() => assertModelVocab(v)).toThrow(/nTfidf/);
  });

  it('rejects a non-object vocabulary', () => {
    const v = validVocab();
    v.vocabulary = null;
    expect(() => assertModelVocab(v)).toThrow(/vocabulary/);
  });

  it('rejects classLabels with the wrong length', () => {
    const v = validVocab();
    v.classLabels = ['article', 'forum'];
    expect(() => assertModelVocab(v)).toThrow(/classLabels/);
  });
});
