// SPDX-License-Identifier: Apache-2.0
// TF-IDF transform reproducing scikit-learn's TfidfVectorizer EXACTLY for the 100
// shipped vocabulary terms, so the runtime vector matches the trained idf weights.
//
// Contract (from FEATURES.md + tfidf-vocab.json):
// - tokenPattern = "(?u)\\b\\w\\w+\\b" → keep runs of 2+ word chars (drops 1-char tokens).
// - lowercase = true; ngramRange = [1, 1] (unigrams only).
// - Per-document raw term count × shipped idf[idx]; then L2-normalize the 100-vector.
// - Terms not in the vocabulary are ignored. TF-IDF is NOT StandardScaler-scaled.

export interface TfidfVocab {
  vocabulary: Record<string, number>;
  idf: number[];
  nTfidf: number;
  lowercase: boolean;
}

// sklearn default token pattern (?u)\b\w\w+\b — Unicode word chars, length >= 2.
// `\w` in JS with the `u` flag is ASCII-only [A-Za-z0-9_]; sklearn's (?u) is Unicode.
// We mirror sklearn's Unicode \w using a Unicode-property class so non-ASCII script
// terms tokenize identically (the shipped vocab is ASCII, but tokenization affects
// which raw tokens are produced and thus the per-doc counts / L2 norm denominator is
// over vocab terms only, so only vocab-matching tokens matter — ASCII suffices, but
// we keep Unicode-aware matching to faithfully reproduce sklearn's token boundaries).
const TOKEN_RE = /[\p{L}\p{N}_][\p{L}\p{N}_]+/gu;

/**
 * Tokenize like sklearn's default analyzer: lowercase (when configured), then match
 * the token pattern. Returns the list of tokens (length >= 2 word chars).
 */
export function tokenize(text: string, lowercase: boolean): string[] {
  const source = lowercase ? text.toLowerCase() : text;
  return source.match(TOKEN_RE) ?? [];
}

/**
 * Compute the 100-dim TF-IDF vector for `text` against the shipped vocabulary.
 * tf = raw count of the term; value = tf × idf[idx]; then L2-normalize the vector.
 */
export function computeTfidf(text: string, vocab: TfidfVocab): number[] {
  const n = vocab.nTfidf;
  const out = new Array<number>(n).fill(0);

  const tokens = tokenize(text, vocab.lowercase);
  if (tokens.length === 0) return out;

  // Raw term frequency over vocabulary terms only.
  for (const tok of tokens) {
    const idx = vocab.vocabulary[tok];
    if (idx !== undefined) out[idx] = (out[idx] ?? 0) + 1;
  }

  // Multiply by idf.
  for (let i = 0; i < n; i += 1) {
    out[i] = (out[i] ?? 0) * (vocab.idf[i] ?? 0);
  }

  // L2 normalization.
  let normSq = 0;
  for (let i = 0; i < n; i += 1) normSq += (out[i] ?? 0) ** 2;
  if (normSq > 0) {
    const norm = Math.sqrt(normSq);
    for (let i = 0; i < n; i += 1) out[i] = (out[i] ?? 0) / norm;
  }

  return out;
}
