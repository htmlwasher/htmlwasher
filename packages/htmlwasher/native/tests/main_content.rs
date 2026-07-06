#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! Ported from v1 `core/main-content.test.ts` — the content-node cascade.

use htmlwasher_native::dom::{class_of, parse, tag_of};
use htmlwasher_native::selector::content::find_content_node;
use htmlwasher_native::{CoreOptions, Options, PageType, extract};

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
fn scoring_coverage_guard_rejects_a_fragment_of_flat_body_content() {
    // Flat-body layout (e.g. Project Gutenberg full-book pages): the real content is
    // dozens of <p>s DIRECTLY under <body>, and the only scoring candidate is one small
    // <div class="blockquot">. The coverage guard (winner < 3/10 of the body text) must
    // reject that fragment so the cascade falls back to the whole body.
    let para = "Prose paragraph of the flat-body book text, long enough to carry genuine reading content for both the coverage computation and the extraction result. ".repeat(2);
    let body_paras: String = (0..40).map(|_| format!("<p>{para}</p>")).collect();
    let quote = "A short quoted letter fragment inside the only div wrapper on the page. ";
    let html = format!(
        "<body>{body_paras}<div class=\"blockquot\"><p>{quote}</p><p>{quote}</p><p>{quote}</p></div></body>"
    );
    let doc = parse(&html);
    let body = doc.body().expect("body");
    let el = find_content_node(&body, &core());
    assert_eq!(tag_of(&el).as_deref(), Some("body"));

    // End-to-end: extraction returns far more than the blockquot alone (the pre-guard
    // failure mode extracted ONLY the blockquot — 1.4% of a Gutenberg book page).
    let opts = Options {
        page_type: Some(PageType::Article),
        ..Options::default()
    };
    let result = extract(&html, &opts).expect("extract ok");
    let blockquot_len = quote.chars().count() * 3;
    assert!(
        result.text_length > 3 * blockquot_len,
        "text_length {} should far exceed 3x the blockquot ({blockquot_len})",
        result.text_length
    );
    assert!(result.content_html.contains("flat-body book text"));
}

#[test]
fn scoring_winner_with_majority_body_coverage_is_kept() {
    // Counter-case: a proper content div holding well over 3/10 of the body text must
    // still win scoring — the guard must not balloon selection to the whole body.
    let para = "Genuine article prose paragraph with plenty of real reading content so the inner container dominates the page text by a comfortable margin. ".repeat(2);
    let content: String = (0..12).map(|_| format!("<p>{para}</p>")).collect();
    let tail = format!("<p>TAIL-MARKER {para}</p><p>TAIL-MARKER {para}</p>");
    let html = format!(
        "<body><div class=\"inner\">{content}</div><div class=\"tailnote\">{tail}</div></body>"
    );
    let doc = parse(&html);
    let body = doc.body().expect("body");
    let el = find_content_node(&body, &core());
    assert!(class_of(&el).contains("inner"));

    let opts = Options {
        page_type: Some(PageType::Article),
        ..Options::default()
    };
    let result = extract(&html, &opts).expect("extract ok");
    assert!(result.content_html.contains("Genuine article prose"));
    assert!(
        !result.content_html.contains("TAIL-MARKER"),
        "selection must stay on the content div, not balloon to the body"
    );
}

#[test]
fn gutenberg_external_fixture_extracts_the_full_book() {
    // Gated on the external tester cache (skips gracefully when absent) — the
    // Pride & Prejudice flat-body page that motivated the scoring coverage guard.
    let Ok(home) = std::env::var("HOME") else {
        return;
    };
    let path = format!("{home}/r/htmlwasher-external-tester/cache/3e2532c1eb86c33c.html");
    let Ok(html) = std::fs::read_to_string(&path) else {
        eprintln!("gutenberg fixture absent — skipping");
        return;
    };
    let result = extract(&html, &Options::default()).expect("extract ok");
    assert!(
        result.text_length > 400_000,
        "full book body should be extracted; got {}",
        result.text_length
    );
    assert!(!result.content_html.to_lowercase().contains("<script"));
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
