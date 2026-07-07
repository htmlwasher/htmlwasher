#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! Ported from v1 `core/extract.test.ts` — end-to-end extraction.
//!
//! The "no class/style/id leakage" case (v1 lines 38-45) is RE-BASELINED under
//! preserve-markup: attributes SURVIVE, only script-hygiene is guaranteed. The
//! backoff cases (v1 133-143 and 150-166) are the doc-09 regression guards and are
//! first-class must-pass here.

use htmlwasher_native::{EmitMode, Focus, Options, PageType, extract};

const ARTICLE: &str = r#"<!doctype html><html><head><title>T</title><script>tracker()</script></head>
<body>
  <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <div class="sidebar"><ul><li><a href="/1">Recent 1</a></li><li><a href="/2">Recent 2</a></li></ul></div>
  <main>
    <article class="article-content">
      <h1>The Real Headline</h1>
      <p>This is the first substantial paragraph of the article body. It carries the actual content a reader came for, with enough length to be unambiguous.</p>
      <p>A second paragraph continues the story with more detail and a <a href="/ref">reference link</a> inside the prose.</p>
      <ul><li>First real point</li><li>Second real point</li></ul>
    </article>
  </main>
  <footer>Copyright 2026 — all rights reserved</footer>
  <script>moreTracking()</script>
</body></html>"#;

fn html(input: &str, opts: &Options) -> String {
    extract(input, opts).expect("extract ok").content_html
}

fn opts(focus: Focus) -> Options {
    Options {
        focus,
        ..Options::default()
    }
}

#[test]
fn extracts_the_article_body_as_clean_html() {
    let out = html(ARTICLE, &opts(Focus::Balanced));
    assert!(out.contains("The Real Headline"));
    assert!(out.contains("first substantial paragraph"));
    assert!(out.contains("Second real point"));
}

#[test]
fn drops_navigation_sidebar_footer_and_scripts() {
    let out = html(ARTICLE, &Options::default());
    assert!(!out.contains("<script"));
    assert!(!out.contains("tracker"));
    assert!(!out.contains("About"));
    assert!(!out.contains("Recent 1"));
    assert!(!out.contains("Copyright"));
}

#[test]
fn preserve_markup_keeps_attributes_but_stays_script_free() {
    // RE-BASELINE of v1 "no class/style/id leakage": preserve-markup PRESERVES
    // class/id/attrs; the hygiene guarantee is only that scripts are gone + href kept.
    let out = html(ARTICLE, &Options::default());
    assert!(out.contains("class=\"article-content\""));
    assert!(out.contains("href=\"/ref\""));
    assert!(!out.contains("<script"));
}

#[test]
fn empty_input_yields_empty_string() {
    assert_eq!(html("", &Options::default()), "");
}

#[test]
fn malformed_html_does_not_panic() {
    let out = html(
        "<div><p>unclosed <b>bold <main>hi there content",
        &Options::default(),
    );
    // Just assert we got a string back (the value is a String by construction).
    assert!(out.is_empty() || !out.is_empty());
}

#[test]
fn precision_removes_boilerplate_related_block() {
    let body = "Real content paragraph that is clearly the body of the article. ".repeat(3);
    let noisy = format!(
        "<body><main><article class=\"article-content\"><p>{body}</p><div class=\"related\"><a href=\"/a\">a</a> <a href=\"/b\">b</a> <a href=\"/c\">c</a></div></article></main></body>"
    );
    let precision = html(&noisy, &opts(Focus::Precision));
    let recall = html(&noisy, &opts(Focus::Recall));
    assert!(precision.contains("Real content paragraph"));
    assert!(recall.contains("Real content paragraph"));
    assert!(!precision.contains("href=\"/a\""));
}

#[test]
fn mode_choice_changes_output_via_link_density_threshold() {
    let lead = "This is the genuine article body paragraph carrying the real story a reader came for, long enough to be unambiguous and pass the threshold. ";
    let link_text = "Continue to the full borderline coverage of this listed story right over here on the next page"; // 94 chars
    let probe = format!("<div class=\"entry-block\"><a href=\"/x\">{link_text}</a> tails</div>");
    let doc = format!(
        "<body><main><article class=\"article-content\"><h1>Headline</h1><p>{}</p>{probe}<p>{lead}</p></article></main></body>",
        lead.repeat(2)
    );
    let precision = html(&doc, &opts(Focus::Precision));
    let recall = html(&doc, &opts(Focus::Recall));
    assert!(recall.contains("Continue to the full borderline coverage"));
    assert!(!precision.contains("Continue to the full borderline coverage"));
    assert!(precision.contains("genuine article body"));
    assert!(recall.contains("genuine article body"));
    assert_ne!(precision, recall);
}

#[test]
fn drops_non_link_dense_newsletter_classed_prose_block() {
    let lead = "This is the genuine article body paragraph carrying the real story a reader came for, long enough to be unambiguous and pass the threshold. ";
    let input = format!(
        "<body><main><article class=\"article-content\"><h1>The Headline</h1><p>{}</p><div class=\"newsletter-signup\"><p>Sign up for our weekly newsletter to get the latest delivered to your inbox every Monday morning.</p></div><p>{lead}</p></article></main></body>",
        lead.repeat(2)
    );
    let out = html(&input, &opts(Focus::Balanced));
    assert!(out.contains("genuine article body"));
    assert!(!out.contains("Sign up for our weekly newsletter"));
}

#[test]
fn keeps_comment_classed_block_under_forum_profile() {
    let lead = "This is the genuine article body paragraph carrying the real story a reader came for, long enough to be unambiguous and pass the threshold. ";
    let input = format!(
        "<body><main><article class=\"article-content\"><h1>The Headline</h1><p>{}</p><div class=\"comment\"><p>A thoughtful reader comment that adds context and should be preserved when comments are content.</p></div></article></main></body>",
        lead.repeat(2)
    );
    let article = html(&input, &opts(Focus::Balanced));
    assert!(!article.contains("A thoughtful reader comment"));

    let forum_opts = Options {
        page_type: Some(PageType::Forum),
        ..Options::default()
    };
    let forum = html(&input, &forum_opts);
    assert!(forum.contains("genuine article body"));
    assert!(forum.contains("A thoughtful reader comment"));
}

// ---- doc-09 backoff regression guards (must-pass) --------------------------------

#[test]
fn backs_off_when_name_removal_would_empty_content() {
    let item = "A listed entry with a meaningful description long enough to count as real body text for this collection page. ";
    let input = format!(
        "<body><main><div class=\"related-widget\"><div class=\"card\"><p>{item}{item}</p></div><div class=\"card\"><p>{item}{item}</p></div></div></main></body>"
    );
    let result = extract(&input, &opts(Focus::Balanced)).expect("ok");
    assert!(result.text_length > 0);
    assert!(result.content_html.contains("A listed entry"));
}

#[test]
fn drops_always_excluded_and_breadcrumblist_even_on_backoff_path() {
    let item = "A listed entry with a meaningful description long enough to count as real body text for this collection page. ";
    let input = format!(
        "<body><main><div class=\"related-widget\"><ol itemscope itemtype=\"https://schema.org/BreadcrumbList\"><li>Home</li><li>Listing</li></ol><div class=\"el__featured-video\"><p>autoplaying featured video furniture leaks here</p></div><div class=\"card\"><p>{item}{item}</p></div><div class=\"card\"><p>{item}{item}</p></div></div></main></body>"
    );
    let result = extract(&input, &opts(Focus::Balanced)).expect("ok");
    assert!(result.text_length > 0);
    assert!(result.content_html.contains("A listed entry"));
    assert!(!result.content_html.contains("featured video furniture"));
    assert!(!result.content_html.contains("Listing"));
}

#[test]
fn drops_breadcrumblist_microdata_on_primary_path() {
    let lead = "This is the genuine article body paragraph carrying the real story a reader came for, long enough to be unambiguous and pass the threshold. ";
    let input = format!(
        "<body><main><article class=\"article-content\"><ol itemscope itemtype=\"https://schema.org/BreadcrumbList\"><li>Home</li><li>Crumb</li></ol><h1>The Headline</h1><p>{}</p></article></main></body>",
        lead.repeat(2)
    );
    let out = html(&input, &opts(Focus::Balanced));
    assert!(out.contains("genuine article body"));
    assert!(!out.contains("Crumb"));
}

#[test]
fn whitelist_parity_mode_strips_attributes() {
    // The retained reference-parity emit re-baselines the ORIGINAL v1 assertion.
    let parity = Options {
        emit_mode: EmitMode::WhitelistParity,
        ..Options::default()
    };
    let out = html(ARTICLE, &parity);
    assert!(out.contains("The Real Headline"));
    assert!(!out.contains("class="));
    assert!(out.contains("href=\"/ref\""));
}
