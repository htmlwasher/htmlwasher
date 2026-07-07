// SPDX-License-Identifier: Apache-2.0
//! TF-IDF transform reproducing scikit-learn's `TfidfVectorizer` for the 100 shipped
//! vocabulary terms (ported from the proven v1 `tfidf.ts`).
//!
//! Token pattern `(?u)\b\w\w+\b` → runs of 2+ word chars (drops 1-char tokens),
//! lowercase, unigrams. Per-doc raw count × shipped `idf[idx]`, then L2-normalize the
//! 100-vector. OOV terms are ignored (only vocab terms affect the vector / its norm).

use std::collections::HashMap;

/// A word character for sklearn's `\w` (Unicode letters/numbers/underscore). For the
/// ASCII vocabulary this is identical to `[a-z0-9_]`; non-ASCII tokens are OOV and
/// never affect the output, so the exact Unicode boundary is immaterial.
fn is_word_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

/// Tokenize like sklearn's default analyzer: lowercase, then emit runs of ≥2 word chars.
#[must_use]
pub fn tokenize(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut len = 0usize;
    for ch in lower.chars() {
        if is_word_char(ch) {
            cur.push(ch);
            len += 1;
        } else {
            if len >= 2 {
                tokens.push(std::mem::take(&mut cur));
            } else {
                cur.clear();
            }
            len = 0;
        }
    }
    if len >= 2 {
        tokens.push(cur);
    }
    tokens
}

/// Compute the TF-IDF vector for `text` against the shipped vocabulary + idf weights.
/// `tf` = raw count of the term; value = `tf * idf[idx]`; then L2-normalize.
#[must_use]
pub fn compute_tfidf(
    text: &str,
    vocabulary: &HashMap<String, usize>,
    idf: &[f64],
    n_tfidf: usize,
) -> Vec<f64> {
    let mut out = vec![0.0_f64; n_tfidf];
    let tokens = tokenize(text);
    if tokens.is_empty() {
        return out;
    }
    for tok in &tokens {
        if let Some(&idx) = vocabulary.get(tok) {
            if let Some(slot) = out.get_mut(idx) {
                *slot += 1.0;
            }
        }
    }
    for (i, slot) in out.iter_mut().enumerate() {
        *slot *= idf.get(i).copied().unwrap_or(0.0);
    }
    let norm_sq: f64 = out.iter().map(|v| v * v).sum();
    if norm_sq > 0.0 {
        let norm = norm_sq.sqrt();
        for slot in &mut out {
            *slot /= norm;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_drops_single_char_and_lowercases() {
        assert_eq!(tokenize("Hello, World! a bb"), vec!["hello", "world", "bb"]);
        assert_eq!(tokenize("2025 what"), vec!["2025", "what"]);
    }

    #[test]
    fn tfidf_counts_vocab_terms_and_l2_normalizes() {
        let mut vocab = HashMap::new();
        vocab.insert("top".to_string(), 0);
        vocab.insert("news".to_string(), 1);
        let idf = [2.0, 3.0];
        // "top top news" → tf top=2, news=1 → [4.0, 3.0] → L2 norm 5.0 → [0.8, 0.6].
        let out = compute_tfidf("top top news oov", &vocab, &idf, 2);
        assert!((out[0] - 0.8).abs() < 1e-12);
        assert!((out[1] - 0.6).abs() < 1e-12);
    }
}
