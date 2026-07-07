#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! Ported from v1 `core/dom.test.ts` — structural DOM helpers over dom_query.

use trafilaturacore_native::dom::{class_id, parse, select_all, tag_of, text_len};
use trafilaturacore_native::patterns::collapse_ws;

#[test]
fn parses_empty_input_without_panicking() {
    let doc = parse("");
    assert!(doc.body().is_some());
}

#[test]
fn collapse_ws_collapses_internal_whitespace() {
    assert_eq!(collapse_ws("  a\n\t  b   c "), "a b c");
}

#[test]
fn tag_of_lowercases_the_tag_name() {
    let doc = parse("<DIV></DIV>");
    let el = doc.select("div").nodes().first().copied().expect("div");
    assert_eq!(tag_of(&el).as_deref(), Some("div"));
}

#[test]
fn class_id_joins_class_and_id() {
    let doc = parse("<div class=\"post-content\" id=\"main\">x</div>");
    let el = doc.select("div").nodes().first().copied().expect("div");
    let ci = class_id(&el);
    assert!(ci.contains("post-content"));
    assert!(ci.contains("main"));
}

#[test]
fn text_len_counts_trimmed_unicode_chars() {
    let doc = parse("<p>  hello   world </p>");
    let p = doc.select("p").nodes().first().copied().expect("p");
    assert_eq!(text_len(&p), "hello world".chars().count());
}

#[test]
fn select_all_is_scoped_and_document_ordered() {
    let doc = parse("<div><p>a</p><section><p>b</p></section></div>");
    let body = doc.body().expect("body");
    let ps = select_all(&body, "p");
    assert_eq!(ps.len(), 2);
    assert_eq!(text_len(&ps[0]), 1);
}
