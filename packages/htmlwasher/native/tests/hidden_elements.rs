#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! Hidden-element removal — Trafilatura `OVERALL_DISCARD_XPATH` (second expression)
//! hidden conditions, applied by `clean_document` via `remove_hidden_elements`.

use htmlwasher_native::dom::parse;
use htmlwasher_native::html_processing::clean_document;
use htmlwasher_native::{CoreOptions, Focus, Options};

fn core(focus: Focus) -> CoreOptions {
    CoreOptions::resolve(&Options {
        focus,
        ..Options::default()
    })
}

/// Run `clean_document` (Balanced) over a `<body>` snippet and return its inner HTML.
fn cleaned(html: &str) -> String {
    let doc = parse(html);
    let body = doc.body().expect("body");
    clean_document(&body, &core(Focus::Balanced));
    body.inner_html().to_string()
}

#[test]
fn drops_display_none_space_span_keeps_visible_cell_text() {
    // The Wikipedia release-history pattern: a screen-reader span next to real text.
    let out = cleaned(
        "<body><main><p>intro paragraph</p><table><tbody><tr><td><span style=\"display: none;\">HIDDENTEXT</span>Unsupported</td></tr></tbody></table></main></body>",
    );
    assert!(!out.contains("HIDDENTEXT"));
    assert!(out.contains("Unsupported"));
    assert!(out.contains("intro paragraph"));
}

#[test]
fn drops_display_none_no_space_variant() {
    let out = cleaned(
        "<body><main><p>visible text</p><td><span style=\"display:none\">HIDDENTEXT</span>kept</td></main></body>",
    );
    assert!(!out.contains("HIDDENTEXT"));
    assert!(out.contains("visible text"));
}

#[test]
fn drops_aria_hidden_true_element() {
    let out = cleaned(
        "<body><main><p>real content</p><span aria-hidden=\"true\">ARIAHIDDEN</span></main></body>",
    );
    assert!(!out.contains("ARIAHIDDEN"));
    assert!(out.contains("real content"));
}

#[test]
fn drops_hidden_class_with_leading_space() {
    // Matches the ` hidden` token (leading space) of the class regex.
    let out = cleaned(
        "<body><main><p>keep me</p><div class=\"visually hidden\">CLASSHIDDEN</div></main></body>",
    );
    assert!(!out.contains("CLASSHIDDEN"));
    assert!(out.contains("keep me"));
}

#[test]
fn drops_noprint_class() {
    let out =
        cleaned("<body><main><p>keep me</p><div class=\"noprint\">NOPRINT</div></main></body>");
    assert!(!out.contains("NOPRINT"));
    assert!(out.contains("keep me"));
}

#[test]
fn drops_hide_prefix_and_infix_classes() {
    let out = cleaned(
        "<body><main><p>keep me</p><div class=\"hide-comments\">HIDEPREFIX</div><div class=\"is-hide-mobile\">HIDEINFIX</div></main></body>",
    );
    assert!(!out.contains("HIDEPREFIX"));
    assert!(!out.contains("HIDEINFIX"));
    assert!(out.contains("keep me"));
}

#[test]
fn keeps_class_with_hidden_substring() {
    // The 'hidden' substring rule applies to @id|@style ONLY, never @class; and
    // "hidden-gems-list" matches neither `^hide-` nor any other class token.
    let out = cleaned(
        "<body><main><p>keep me</p><div class=\"hidden-gems-list\">GEMS</div></main></body>",
    );
    assert!(out.contains("GEMS"));
}

#[test]
fn drops_id_containing_hidden_substring() {
    let out =
        cleaned("<body><main><p>keep me</p><div id=\"main-hidden\">IDHIDDEN</div></main></body>");
    assert!(!out.contains("IDHIDDEN"));
    assert!(out.contains("keep me"));
}

#[test]
fn drops_style_visibility_hidden() {
    let out = cleaned(
        "<body><main><p>keep me</p><div style=\"visibility:hidden\">VISHIDDEN</div></main></body>",
    );
    assert!(!out.contains("VISHIDDEN"));
    assert!(out.contains("keep me"));
}

#[test]
fn backoff_restores_when_every_paragraph_is_hidden() {
    // A page that hides its whole body (cloaked/JS-revealed content) must not lose
    // every <p>: the removal is rolled back.
    let doc = parse("<body><div style=\"display:none\"><p>only paragraph content</p></div></body>");
    let body = doc.body().expect("body");
    clean_document(&body, &core(Focus::Balanced));
    assert!(!doc.select("p").nodes().is_empty());
    assert!(
        body.inner_html()
            .as_ref()
            .contains("only paragraph content")
    );
}
