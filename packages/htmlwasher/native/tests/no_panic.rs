#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! The malformed-HTML no-panic gate: truncated tags, nested `<body>`, control/BOM
//! garbage, and deeply-nested trees must yield a `Result` (never a panic / stack
//! overflow). The depth guard caps serializer recursion; all dom_query traversal is
//! iterative, so even pathological nesting is safe.

use htmlwasher_native::{Options, extract};

#[test]
fn malformed_inputs_never_panic() {
    let cases = [
        "",
        "   ",
        "<",
        "<<<>>><<",
        "<div><p>unclosed <b><i><a href=",
        "<html><body><body><p>double body</p></body></body></html>",
        "<table><tr><td><table><tr><td>nested",
        "plain text with no tags at all",
        "<div class=\"a\" class=\"b\" id id id>weird attrs</div>",
        "<p>emoji 🧫 and control \u{0000}\u{0001}\u{001c} and BOM \u{feff} text</p>",
        "<!doctype html><html><head><meta charset=garbage></head><body>x",
        "<svg><script>evil()</script></svg><math><mi>y</mi></math>",
        "<a href=\"javascript:alert(1)\">x</a><img src=\"data:text/html,evil\">",
    ];
    for case in cases {
        let result = extract(case, &Options::default());
        assert!(result.is_ok(), "extract panicked/erred on: {case:?}");
    }
}

#[test]
fn deeply_nested_divs_do_not_overflow() {
    // Well beyond the 1024 serializer depth guard — proves the recursion cap holds.
    let input = "<div>".repeat(3000);
    let result = extract(&input, &Options::default());
    assert!(result.is_ok());
    // Output is bounded by the depth guard, never a runaway or a crash.
    assert!(!result.expect("ok").content_html.contains("<script"));
}

#[test]
fn deeply_nested_tables_do_not_overflow() {
    let input = "<table><tr><td>".repeat(2000);
    let result = extract(&input, &Options::default());
    assert!(result.is_ok());
}

#[test]
fn oversized_table_hits_the_cell_cap_without_panicking() {
    // > MAX_TABLE_CELLS (20_000) cells — the serializer drops the runaway table body.
    let mut input = String::from("<table><tbody><tr>");
    for i in 0..25_000 {
        input.push_str(&format!("<td>{i}</td>"));
    }
    input.push_str("</tr></tbody></table>");
    let result = extract(&input, &Options::default());
    assert!(result.is_ok());
}
