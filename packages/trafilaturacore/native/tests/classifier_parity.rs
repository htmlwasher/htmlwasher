#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! Byte-level classifier parity against the Python-generated oracle
//! (`tests/fixtures/classifier-parity.json`, HTML at `../fixtures/classifier/`).
//!
//! For each fixture: extract RAW numeric[89] + RAW tfidf[100] from its HTML+URL and
//! assert ≤ 1e-6 vs the oracle; scale + GBDT-evaluate and assert argmax == oracle
//! (100%) and probs within ~1e-4. This is the CLASSIFY gate + the body-text parity
//! check (body_text_len is f[58]; any parse divergence surfaces as numeric drift).

use std::path::PathBuf;

use dom_query::Document;
use trafilaturacore_native::page_type::features::{extract_numeric_features, title_meta_text};
use trafilaturacore_native::page_type::model::model;
use serde::Deserialize;

#[derive(Deserialize)]
struct ParityFile {
    fixtures: Vec<ParityEntry>,
}

#[derive(Deserialize)]
struct ParityEntry {
    file: String,
    url: String,
    numeric: Vec<f64>,
    tfidf: Vec<f64>,
    argmax: usize,
    page_type: String,
    probs: Vec<f64>,
}

fn max_abs_diff(a: &[f64], b: &[f64]) -> f64 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y).abs())
        .fold(0.0_f64, f64::max)
}

#[test]
fn classifier_parity_within_tolerance() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let parity_path = manifest.join("tests/fixtures/classifier-parity.json");
    let raw = std::fs::read_to_string(&parity_path).expect("parity fixture json present");
    let parity: ParityFile = serde_json::from_str(&raw).expect("parity fixture parses");
    let html_dir = manifest.join("../fixtures/classifier");

    let model = model().expect("model loads");

    let mut worst_numeric = 0.0_f64;
    let mut worst_tfidf = 0.0_f64;
    let mut worst_prob = 0.0_f64;
    let mut argmax_ok = 0usize;
    let n = parity.fixtures.len();

    for entry in &parity.fixtures {
        let html = std::fs::read_to_string(html_dir.join(&entry.file))
            .expect("classifier fixture html present");
        let doc = Document::from(html.as_str());

        // RAW (unscaled) numeric + RAW (L2-normed) tfidf.
        let numeric = extract_numeric_features(&doc, &entry.url);
        let tfidf = model.tfidf(&title_meta_text(&doc));

        let numeric_diff = max_abs_diff(&numeric, &entry.numeric);
        let tfidf_diff = max_abs_diff(&tfidf, &entry.tfidf);
        worst_numeric = worst_numeric.max(numeric_diff);
        worst_tfidf = worst_tfidf.max(tfidf_diff);

        assert!(
            numeric_diff <= 1e-6,
            "{}: numeric max diff {numeric_diff:e} > 1e-6 (worst index {})",
            entry.file,
            numeric
                .iter()
                .zip(entry.numeric.iter())
                .enumerate()
                .max_by(|a, b| (a.1.0 - a.1.1)
                    .abs()
                    .partial_cmp(&(b.1.0 - b.1.1).abs())
                    .unwrap())
                .map(|(i, _)| i)
                .unwrap_or(0),
        );
        assert!(
            tfidf_diff <= 1e-6,
            "{}: tfidf max diff {tfidf_diff:e} > 1e-6",
            entry.file
        );

        // Scale + GBDT evaluate.
        let mut features = model.scale_numeric(&numeric);
        features.extend(tfidf);
        let (idx, probs) = model.predict(&features);

        if idx == entry.argmax {
            argmax_ok += 1;
        } else {
            eprintln!(
                "{}: argmax {idx} != oracle {} ({})",
                entry.file, entry.argmax, entry.page_type
            );
        }
        worst_prob = worst_prob.max(max_abs_diff(&probs, &entry.probs));
    }

    eprintln!(
        "PARITY: numeric<={worst_numeric:e} tfidf<={worst_tfidf:e} probs<={worst_prob:e} argmax {argmax_ok}/{n}"
    );
    assert_eq!(argmax_ok, n, "argmax must match on ALL fixtures");
    assert!(worst_prob <= 1e-4, "probs max diff {worst_prob:e} > 1e-4");
}
