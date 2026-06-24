// SPDX-License-Identifier: Apache-2.0
// Cross-language parity gate: the TS feature extractor + ONNX inference must agree
// with the Python `training/extract_features.py` output captured in
// `fixtures/classifier/parity.json`.
//
// - Numeric features: each of the 89 within abs diff <= 1e-6 (target >= 99% exact).
// - TF-IDF: each of the 100 within abs diff <= 1e-6.
// - ONNX argmax over the full 189-vector equals the recorded argmax for ALL fixtures
//   (compare CLASS, not probabilities).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { PageTypeClassifier } from './classifier.js';
import { buildFeatureVector, loadVocab } from './features/index.js';
import { extractNumericFeatures } from './features/numeric.js';
import { titleMetaText } from './features/text.js';
import { computeTfidf } from './features/tfidf.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = join(HERE, '..', '..', 'fixtures', 'classifier');

interface ParityItem {
  file: string;
  url: string;
  pageType: string;
  numeric: number[];
  tfidf: number[];
  argmax: number;
  argmaxLabel: string;
}

const parity = JSON.parse(readFileSync(join(FIX_DIR, 'parity.json'), 'utf8')) as ParityItem[];

function readFixture(file: string): string {
  return readFileSync(join(FIX_DIR, file), 'utf8');
}

const TOL = 1e-6;

describe('classifier feature parity', () => {
  let numericTotal = 0;
  let numericExact = 0;
  let tfidfTotal = 0;
  let tfidfExact = 0;

  afterAll(() => {
    const numericPct = (100 * numericExact) / numericTotal;
    const tfidfPct = (100 * tfidfExact) / tfidfTotal;
    // Surfaced for the run report.
    console.log(
      `[parity] numeric exact-match ${numericExact}/${numericTotal} = ${numericPct.toFixed(3)}%`,
    );
    console.log(`[parity] tfidf exact-match ${tfidfExact}/${tfidfTotal} = ${tfidfPct.toFixed(3)}%`);
  });

  for (const item of parity) {
    it(`numeric features match for ${item.file}`, () => {
      const html = readFixture(item.file);
      const got = extractNumericFeatures(html, item.url);
      expect(got).toHaveLength(89);
      const mismatches: string[] = [];
      for (let i = 0; i < 89; i += 1) {
        numericTotal += 1;
        const diff = Math.abs((got[i] ?? Number.NaN) - (item.numeric[i] ?? Number.NaN));
        if (diff <= TOL) {
          numericExact += 1;
        } else {
          mismatches.push(`f[${i}] got=${got[i]} exp=${item.numeric[i]} diff=${diff}`);
        }
      }
      expect(mismatches, `numeric mismatches:\n${mismatches.join('\n')}`).toHaveLength(0);
    });

    it(`tfidf features match for ${item.file}`, () => {
      const html = readFixture(item.file);
      const vocab = loadVocab();
      const got = computeTfidf(titleMetaText(html), vocab);
      expect(got).toHaveLength(100);
      const mismatches: string[] = [];
      for (let i = 0; i < 100; i += 1) {
        tfidfTotal += 1;
        const diff = Math.abs((got[i] ?? Number.NaN) - (item.tfidf[i] ?? Number.NaN));
        if (diff <= TOL) {
          tfidfExact += 1;
        } else {
          mismatches.push(`tfidf[${i}] got=${got[i]} exp=${item.tfidf[i]} diff=${diff}`);
        }
      }
      expect(mismatches, `tfidf mismatches:\n${mismatches.join('\n')}`).toHaveLength(0);
    });
  }
});

describe('classifier ONNX argmax parity', () => {
  const classifier = new PageTypeClassifier();

  for (const item of parity) {
    it(`argmax class matches for ${item.file} (${item.argmaxLabel})`, async () => {
      const html = readFixture(item.file);
      // Run the raw ML head over the full 189-vector and compare the argmax class.
      const features = buildFeatureVector(html, item.url);
      expect(features).toHaveLength(189);
      const ml = await classifier.classifyMl(html, item.url);
      expect(ml.pageType).toBe(item.argmaxLabel);
    });
  }
});
