#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! The 3-stage cascade + confidence rules (ported from v1 `classifier.test.ts`; the
//! ONNX/InferenceBackend WASM-parity cases collapse to the GBDT argmax test) + model
//! load-time validation.

use std::path::PathBuf;

use dom_query::Document;
use htmlwasher_native::page_type::model::model;
use htmlwasher_native::page_type::{PageType, classify};
use htmlwasher_native::{Options, extract};

fn fixture(file: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures/classifier")
        .join(file);
    std::fs::read_to_string(path).expect("classifier fixture html present")
}

#[test]
fn url_and_ml_agree_non_article_gives_confidence_one() {
    // bbs.archlinux.org → Stage-1 forum; ML argmax forum → agreement, conf 1.0.
    let doc = Document::from(fixture("0541.html").as_str());
    let (page_type, confidence) = classify(&doc, "https://bbs.archlinux.org/").expect("classify");
    assert_eq!(page_type, PageType::Forum);
    assert_eq!(confidence, Some(1.0));
}

#[test]
fn docs_url_and_ml_agree_gives_confidence_one() {
    let doc = Document::from(fixture("4412.html").as_str());
    let (page_type, confidence) = classify(&doc, "https://docs.aws.amazon.com/").expect("classify");
    assert_eq!(page_type, PageType::Documentation);
    assert_eq!(confidence, Some(1.0));
}

#[test]
fn no_url_falls_through_to_ml_confidence() {
    // hamy.xyz article fixture with NO url → Stage-1 article, ML decides; confidence
    // is the ML max prob (not a synthetic 0.95/1.0).
    let doc = Document::from(fixture("0488.html").as_str());
    let (page_type, confidence) = classify(&doc, "").expect("classify");
    assert_eq!(page_type, PageType::Article);
    let conf = confidence.expect("some confidence");
    assert!(conf > 0.0 && conf <= 1.0);
    assert!(
        (conf - 0.95).abs() > f64::EPSILON,
        "must not be the synthetic refine score"
    );
}

#[test]
fn gbdt_argmax_maps_to_page_type() {
    // aliexpress product fixture → ML argmax product (class index 2 → "product").
    let doc = Document::from(fixture("4720.html").as_str());
    let (page_type, _conf) = model().expect("model").classify_ml(&doc, "");
    assert_eq!(page_type, PageType::Product);
}

#[test]
fn model_loads_and_feature_vector_is_189() {
    let m = model().expect("model loads and validates");
    let doc = Document::from(fixture("4853.html").as_str());
    let features = m.build_feature_vector(&doc, "");
    assert_eq!(features.len(), 189);
    // Class labels resolve in the shipped order (argmax index → PageType).
    let (page_type, conf) = m.classify_ml(&doc, "");
    assert!(conf > 0.0 && conf <= 1.0);
    // 4853 is a product fixture.
    assert_eq!(page_type, PageType::Product);
}

#[test]
fn public_extract_reports_page_type_and_confidence() {
    // page_type None → cascade runs, confidence populated.
    let html = fixture("0541.html");
    let options = Options {
        url: Some("https://bbs.archlinux.org/".to_string()),
        ..Options::default()
    };
    let result = extract(&html, &options).expect("extract");
    assert_eq!(result.page_type, PageType::Forum);
    assert_eq!(result.confidence, Some(1.0));

    // Manual page_type override → that type, confidence None, no cascade.
    let overridden = Options {
        page_type: Some(PageType::Article),
        ..options
    };
    let result2 = extract(&html, &overridden).expect("extract");
    assert_eq!(result2.page_type, PageType::Article);
    assert_eq!(result2.confidence, None);
}
