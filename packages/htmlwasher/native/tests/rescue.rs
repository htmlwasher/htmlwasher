#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! Phase RETEST autofix — the profile-independent structured rescues (baseline +
//! JSON-LD articleBody) that recover the main content when the profile-driven
//! selection under-performs. The rescue is defaults-only (fires ONLY on genuine
//! under-extraction), so pages that extract fine are untouched.

use htmlwasher_native::{Options, PageType, extract};

fn content(input: &str, opts: &Options) -> htmlwasher_native::ExtractResult {
    extract(input, opts).expect("extract ok")
}

#[test]
fn baseline_rescue_recovers_body_dropped_by_the_comment_filter() {
    // Reproduces the antirez mechanism: the content node is a parent <div>, and the
    // real body lives in a descendant with a `comment` class that `remove_boilerplate_named`
    // drops — leaving a tiny non-empty result (no backoff), which the baseline rescues.
    let prose = "This is the genuine post body sentence that carries the real content of the article for readers. ".repeat(4);
    // A neutral tail element (NOT a <p>) keeps the primary result non-empty (so no
    // backoff) but tiny; the body prose lives in a comment-classed <span> the profile drops.
    let html = format!(
        "<html><body><div id=\"content\"><div class=\"comment\"><span>{prose}</span></div><span>a brief closing note</span></div></body></html>"
    );
    // Pin a non-forum profile (as the classifier mis-typed antirez) so the `comment`
    // filter drops the body deterministically — the exact under-extraction the rescue fixes.
    let opts = Options {
        page_type: Some(PageType::Documentation),
        ..Options::default()
    };
    let result = content(&html, &opts);
    assert!(
        result.content_html.contains("genuine post body"),
        "baseline rescue should recover the comment-hosted body; got: {}",
        result.content_html
    );
    assert!(
        result.text_length > 200,
        "recovered text_length {} not > 200",
        result.text_length
    );
    assert!(result.fallback_used);
    assert!(result.warnings.iter().any(|w| w == "baseline-rescue"));
    // doc-09 hygiene invariant survives the synthesized markup.
    assert!(!result.content_html.to_lowercase().contains("<script"));
}

#[test]
fn json_ld_article_body_rescue_gated_at_500() {
    let body = "The full article body recovered from JSON-LD structured data. ".repeat(10); // ~620 chars
    let html = format!(
        "<html><head><script type=\"application/ld+json\">{{\"@type\":\"Article\",\"articleBody\":\"{body}\"}}</script></head><body><div class=\"popup\">x</div></body></html>"
    );
    let result = content(
        &html,
        &Options {
            page_type: Some(PageType::Article),
            ..Options::default()
        },
    );
    assert!(result.content_html.contains("recovered from JSON-LD"));
    assert!(result.text_length >= 500);
    assert!(result.warnings.iter().any(|w| w == "json-ld-rescue"));
    assert!(!result.content_html.to_lowercase().contains("<script"));
}

#[test]
fn json_ld_below_500_does_not_rescue_from_it() {
    // A short articleBody (< 500) must NOT win the JSON-LD gate.
    let short = "Too short to trust as structured content.".repeat(2); // ~80 chars
    let html = format!(
        "<html><head><script type=\"application/ld+json\">{{\"articleBody\":\"{short}\"}}</script></head><body><div class=\"popup\">x</div></body></html>"
    );
    let result = content(&html, &Options::default());
    assert!(!result.warnings.iter().any(|w| w == "json-ld-rescue"));
}

#[test]
fn rescue_does_not_fire_on_a_well_extracted_article() {
    // A normal article extracts > 200 chars → the rescue self-gates → output stays
    // PRESERVE-MARKUP (keeps the <article> tag), never the synthesized bare <p>.
    let lead = "This is the genuine article body paragraph carrying the real story a reader came for, long enough to be unambiguous. ".repeat(3);
    let html = format!(
        "<html><body><main><article class=\"article-content\"><h1>Headline</h1><p>{lead}</p></article></main></body></html>"
    );
    let result = content(
        &html,
        &Options {
            page_type: Some(PageType::Article),
            ..Options::default()
        },
    );
    assert!(
        result.content_html.contains("<article"),
        "should keep preserve-markup <article>"
    );
    assert!(result.content_html.contains("class=\"article-content\""));
    assert!(!result.fallback_used);
    assert!(
        !result
            .warnings
            .iter()
            .any(|w| w == "baseline-rescue" || w == "json-ld-rescue")
    );
}

#[test]
fn antirez_external_fixture_recovers_the_post_body() {
    // Gated on the external tester cache (skips gracefully when absent).
    let Ok(home) = std::env::var("HOME") else {
        return;
    };
    let path = format!("{home}/r/htmlwasher-external-tester/cache/7857c13f48708eb1.html");
    let Ok(html) = std::fs::read_to_string(&path) else {
        eprintln!("antirez fixture absent — skipping");
        return;
    };
    let opts = Options {
        url: Some("https://antirez.com/news/123".to_string()),
        ..Options::default()
    };
    let result = content(&html, &opts);
    // The classifier still (mis)types it — the fix is extraction robustness, not re-typing.
    assert_eq!(result.page_type, PageType::Documentation);
    assert!(
        result.text_length > 1000,
        "post body should be recovered; got {}",
        result.text_length
    );
    assert!(result.content_html.contains("quite intense"));
    assert!(!result.content_html.to_lowercase().contains("<script"));
}
