// SPDX-License-Identifier: Apache-2.0
//! Baked classifier artifacts + ML inference.
//!
//! `model.xgb.json` (the XGBoost dump) and `tfidf-vocab.json` (vocab, idf, baked
//! StandardScaler params, class labels) are `include_str!`-compiled and parsed +
//! validated once behind a `LazyLock`. Ports the v1 `assertModelVocab`/`scaleNumeric`/
//! `buildFeatureVector`/`classifyMl`.

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::LazyLock;

use dom_query::Document;
use serde::Deserialize;

use crate::error::Error;
use crate::page_type::PageType;
use crate::page_type::features::{N_NUMERIC, extract_numeric_features, title_meta_text};
use crate::page_type::gbdt::Gbdt;
use crate::page_type::tfidf::compute_tfidf;

const MODEL_JSON: &str = include_str!("../../artifacts/model.xgb.json");
const VOCAB_JSON: &str = include_str!("../../artifacts/tfidf-vocab.json");

const N_TFIDF: usize = 100;
const N_CLASS_LABELS: usize = 7;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawVocab {
    vocabulary: HashMap<String, usize>,
    idf: Vec<f64>,
    numeric_mean: Vec<f64>,
    numeric_scale: Vec<f64>,
    class_labels: Vec<String>,
    n_numeric: usize,
    n_tfidf: usize,
}

/// The loaded, validated classifier model.
pub struct Model {
    vocabulary: HashMap<String, usize>,
    idf: Vec<f64>,
    numeric_mean: Vec<f64>,
    numeric_scale: Vec<f64>,
    class_labels: Vec<String>,
    n_tfidf: usize,
    gbdt: Gbdt,
}

static MODEL: LazyLock<Result<Model, String>> = LazyLock::new(build_model);

fn build_model() -> Result<Model, String> {
    let v: RawVocab =
        serde_json::from_str(VOCAB_JSON).map_err(|e| format!("tfidf-vocab.json: {e}"))?;

    if v.n_numeric != N_NUMERIC {
        return Err(format!("nNumeric must equal {N_NUMERIC}"));
    }
    if v.numeric_mean.len() != N_NUMERIC {
        return Err(format!("numericMean must be number[{N_NUMERIC}]"));
    }
    if v.numeric_scale.len() != N_NUMERIC {
        return Err(format!("numericScale must be number[{N_NUMERIC}]"));
    }
    if v.n_tfidf != N_TFIDF {
        return Err(format!("nTfidf must equal {N_TFIDF}"));
    }
    if v.idf.len() != N_TFIDF {
        return Err(format!("idf must be number[{N_TFIDF}]"));
    }
    if v.vocabulary.len() != N_TFIDF {
        return Err(format!("vocabulary must have {N_TFIDF} terms"));
    }
    if v.class_labels.len() != N_CLASS_LABELS {
        return Err(format!("classLabels must have {N_CLASS_LABELS} entries"));
    }

    let gbdt = Gbdt::parse(MODEL_JSON).map_err(|e| e.to_string())?;
    if gbdt.num_class() != N_CLASS_LABELS {
        return Err(format!("model num_class must equal {N_CLASS_LABELS}"));
    }

    Ok(Model {
        vocabulary: v.vocabulary,
        idf: v.idf,
        numeric_mean: v.numeric_mean,
        numeric_scale: v.numeric_scale,
        class_labels: v.class_labels,
        n_tfidf: v.n_tfidf,
        gbdt,
    })
}

/// The lazily-loaded, validated model.
///
/// # Errors
/// Returns [`Error::ModelLoad`] when the baked `model.xgb.json`/`tfidf-vocab.json`
/// fail to parse or violate the expected shape (lengths, class count).
pub fn model() -> Result<&'static Model, Error> {
    MODEL.as_ref().map_err(|e| Error::ModelLoad(e.clone()))
}

impl Model {
    /// StandardScaler over the 89 numeric features: `(x - mean) / scale` when
    /// `scale > 0`, else `0.0` (zero-variance feature).
    #[must_use]
    pub fn scale_numeric(&self, numeric: &[f64]) -> Vec<f64> {
        let mut out = vec![0.0_f64; N_NUMERIC];
        for i in 0..N_NUMERIC {
            let scale = self.numeric_scale.get(i).copied().unwrap_or(0.0);
            if scale > 0.0 {
                let x = numeric.get(i).copied().unwrap_or(0.0);
                let mean = self.numeric_mean.get(i).copied().unwrap_or(0.0);
                if let Some(slot) = out.get_mut(i) {
                    *slot = (x - mean) / scale;
                }
            }
        }
        out
    }

    /// The TF-IDF vector for a `"{title} {description}"` input against the vocab.
    #[must_use]
    pub fn tfidf(&self, text: &str) -> Vec<f64> {
        compute_tfidf(text, &self.vocabulary, &self.idf, self.n_tfidf)
    }

    /// Build the 189-dim feature vector from a parsed document + URL:
    /// numeric(89) → scale → concat tfidf(title_meta_text)(100).
    #[must_use]
    pub fn build_feature_vector(&self, doc: &Document, url: &str) -> Vec<f64> {
        let numeric = extract_numeric_features(doc, url);
        let mut features = self.scale_numeric(&numeric);
        features.extend(self.tfidf(&title_meta_text(doc)));
        features
    }

    /// Map a class-label index to a [`PageType`].
    fn label_page_type(&self, idx: usize) -> PageType {
        self.class_labels
            .get(idx)
            .and_then(|label| PageType::from_str(label).ok())
            .unwrap_or(PageType::Article)
    }

    /// Run the ML model on a parsed document + URL → `(page_type, confidence)`.
    #[must_use]
    pub fn classify_ml(&self, doc: &Document, url: &str) -> (PageType, f64) {
        let features = self.build_feature_vector(doc, url);
        let (idx, probs) = self.gbdt.predict(&features);
        let confidence = probs.get(idx).copied().unwrap_or(0.0);
        (self.label_page_type(idx), confidence)
    }

    /// Predict `(argmax_index, probabilities)` from a pre-built 189-dim feature vector
    /// (used by the parity test).
    #[must_use]
    pub fn predict(&self, features: &[f64]) -> (usize, Vec<f64>) {
        self.gbdt.predict(features)
    }
}
