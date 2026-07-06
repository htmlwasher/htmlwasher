#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! Ported from v1 `core/main-content.test.ts` — the content-node cascade.

use htmlwasher_native::dom::{class_of, parse, tag_of};
use htmlwasher_native::selector::content::find_content_node;
use htmlwasher_native::{CoreOptions, Options};

const LONG: &str = "This is the actual article body with enough real text to exceed the minimum content threshold so the selector wins outright. This is the actual article body with enough real text to exceed the minimum content threshold so the selector wins outright. ";

fn core() -> CoreOptions {
    CoreOptions::resolve(&Options::default())
}

#[test]
fn selects_element_matching_a_content_class_rule() {
    let html = format!(
        "<body><div class=\"sidebar\">junk</div><div class=\"article-content\"><p>{LONG}</p></div></body>"
    );
    let doc = parse(&html);
    let body = doc.body().expect("body");
    let el = find_content_node(&body, &core());
    assert!(class_of(&el).contains("article-content"));
}

#[test]
fn falls_back_to_article_when_no_class_rule_matches() {
    let html = format!("<body><div>x</div><article><p>{LONG}</p></article></body>");
    let doc = parse(&html);
    let body = doc.body().expect("body");
    let el = find_content_node(&body, &core());
    assert_eq!(tag_of(&el).as_deref(), Some("article"));
}

#[test]
fn falls_back_to_scoring_when_no_semantic_element_exists() {
    let html = format!(
        "<body><div class=\"wrap\"><div class=\"inner\"><p>{LONG}</p><p>{LONG}</p></div></div></body>"
    );
    let doc = parse(&html);
    let body = doc.body().expect("body");
    let el = find_content_node(&body, &core());
    assert_ne!(tag_of(&el).as_deref(), Some("body"));
    assert!(el.text().as_ref().contains("actual article body"));
}

#[test]
fn returns_body_or_paragraph_as_last_resort() {
    let doc = parse("<body><p>tiny</p></body>");
    let body = doc.body().expect("body");
    let el = find_content_node(&body, &core());
    let tag = tag_of(&el).unwrap_or_default();
    assert!(tag == "body" || tag == "p");
}

#[test]
fn selects_div_with_role_article() {
    let html = format!("<div class=\"junk\">x</div><div role=\"article\"><p>{LONG}</p></div>");
    let doc = parse(&html);
    let body = doc.body().expect("body");
    let el = find_content_node(&body, &core());
    assert_eq!(
        el.attr("role").map(|r| r.to_string()).as_deref(),
        Some("article")
    );
}
