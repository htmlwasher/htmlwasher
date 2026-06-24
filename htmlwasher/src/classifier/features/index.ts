// SPDX-License-Identifier: Apache-2.0
// Assemble the full 189-dim feature vector: StandardScaler the 89 numeric features,
// then concatenate the 100 unscaled TF-IDF values, exactly as `classify_ml` does.
//
//   all_features = scaled_numeric(89) ++ tfidf(100)   // indices 0..88, 89..188

import { readFileSync } from 'node:fs';
import { TFIDF_VOCAB_PATH } from '../model-paths.js';
import { extractNumericFeatures, N_NUMERIC } from './numeric.js';
import { titleMetaText } from './text.js';
import { computeTfidf, type TfidfVocab } from './tfidf.js';

export interface ModelVocab extends TfidfVocab {
  vocabulary: Record<string, number>;
  idf: number[];
  numericMean: number[];
  numericScale: number[];
  classLabels: string[];
  nNumeric: number;
  nTfidf: number;
}

let cachedVocab: ModelVocab | undefined;

/** Load and cache the shipped `tfidf-vocab.json` (vocab, idf, scaler params, labels). */
export function loadVocab(): ModelVocab {
  if (cachedVocab === undefined) {
    const raw = readFileSync(TFIDF_VOCAB_PATH, 'utf8');
    cachedVocab = JSON.parse(raw) as ModelVocab;
  }
  return cachedVocab;
}

/**
 * StandardScaler over the 89 numeric features only:
 *   out[i] = (x[i] - mean[i]) / scale[i]   when scale[i] > 0
 *          = 0.0                            otherwise (zero-variance feature)
 */
export function scaleNumeric(numeric: readonly number[], vocab: ModelVocab): number[] {
  const out = new Array<number>(N_NUMERIC).fill(0);
  for (let i = 0; i < N_NUMERIC; i += 1) {
    const scale = vocab.numericScale[i] ?? 0;
    if (scale > 0) {
      out[i] = ((numeric[i] ?? 0) - (vocab.numericMean[i] ?? 0)) / scale;
    } else {
      out[i] = 0;
    }
  }
  return out;
}

/**
 * Build the 189-dim feature vector from raw HTML + URL:
 * numeric(89) → scale → concat tfidf(titleMetaText)(100).
 */
export function buildFeatureVector(html: string, url: string): number[] {
  const vocab = loadVocab();
  const numeric = extractNumericFeatures(html, url);
  const scaled = scaleNumeric(numeric, vocab);
  const tfidf = computeTfidf(titleMetaText(html), vocab);
  return [...scaled, ...tfidf];
}
