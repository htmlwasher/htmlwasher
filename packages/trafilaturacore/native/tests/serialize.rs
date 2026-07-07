#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! Ported/split from v1 `core/serialize-filtered.test.ts`:
//! - the whitelist-emit/escaping/unwrap cases → the WHITELIST-PARITY serializer,
//! - the preserve-markup contract (attributes SURVIVE) → the default serializer,
//! - the name/BreadcrumbList drop cases → the relocated discard predicates.

use trafilaturacore_native::dom::parse;
use trafilaturacore_native::extract::{serialize_preserve, serialize_whitelist};
use trafilaturacore_native::selector::discard::{is_always_excluded_name, is_boilerplate_named};
use trafilaturacore_native::{CoreOptions, Options, PageType};

fn core_article() -> CoreOptions {
    CoreOptions::resolve(&Options::default())
}

fn core_forum() -> CoreOptions {
    CoreOptions::resolve(&Options {
        page_type: Some(PageType::Forum),
        ..Options::default()
    })
}

fn render_whitelist(html: &str, opts: &CoreOptions) -> String {
    let doc = parse(html);
    let body = doc.body().expect("body");
    let root = body.element_children().into_iter().next().unwrap_or(body);
    serialize_whitelist(&root, opts)
}

fn render_preserve(html: &str) -> String {
    let doc = parse(html);
    let body = doc.body().expect("body");
    let root = body.element_children().into_iter().next().unwrap_or(body);
    serialize_preserve(&root)
}

// ---- whitelist-parity serializer (reference-parity mode) --------------------------

#[test]
fn whitelist_emits_block_and_inline_tags() {
    let out = render_whitelist(
        "<article><h1>Title</h1><p>Hello <strong>world</strong></p></article>",
        &core_article(),
    );
    assert_eq!(
        out,
        "<article><h1>Title</h1><p>Hello <strong>world</strong></p></article>"
    );
}

#[test]
fn whitelist_unwraps_non_whitelisted_elements() {
    let out = render_whitelist(
        "<div><p><span><font>kept</font> text</span></p></div>",
        &core_article(),
    );
    assert!(out.contains("kept text"));
    assert!(!out.contains("<font"));
}

#[test]
fn whitelist_drops_hard_skip_set() {
    let out = render_whitelist(
        "<div><p>keep</p><nav><a href=\"/x\">menu</a></nav><script>evil()</script><iframe src=\"x\"></iframe></div>",
        &core_article(),
    );
    assert!(out.contains("keep"));
    assert!(!out.contains("menu"));
    assert!(!out.contains("script"));
    assert!(!out.contains("iframe"));
}

#[test]
fn whitelist_keeps_href_but_only_whitelisted_attributes() {
    let out = render_whitelist(
        "<div><a href=\"/p\" class=\"btn\" onclick=\"x()\" data-id=\"9\">link</a></div>",
        &core_article(),
    );
    assert!(out.contains("href=\"/p\""));
    assert!(!out.contains("class="));
    assert!(!out.contains("onclick"));
    assert!(!out.contains("data-id"));
}

#[test]
fn whitelist_escapes_text() {
    let out = render_whitelist("<div><p>a &lt; b &amp; c &gt; d</p></div>", &core_article());
    assert!(out.contains("a &lt; b &amp; c &gt; d"));
}

#[test]
fn whitelist_drops_links_when_include_links_false() {
    let opts = CoreOptions::resolve(&Options {
        include_links: false,
        ..Options::default()
    });
    let out = render_whitelist("<div><a href=\"/p\">anchor</a></div>", &opts);
    assert!(out.contains("anchor"));
    assert!(!out.contains("href"));
}

// ---- preserve-markup serializer (doc-09 default) ----------------------------------

#[test]
fn preserve_keeps_original_tags_and_all_attributes() {
    // RE-BASELINED from the v1 "no class/style/id leakage" assertion: under
    // preserve-markup, attributes SURVIVE (TS cleaning owns sanitization).
    let out = render_preserve(
        "<article class=\"x\" id=\"y\"><p data-z=\"1\" style=\"color:red\">Hi</p></article>",
    );
    assert!(out.contains("class=\"x\""));
    assert!(out.contains("id=\"y\""));
    assert!(out.contains("data-z=\"1\""));
    assert!(out.contains("style=\"color:red\""));
    assert!(out.contains("Hi"));
}

#[test]
fn preserve_hard_skips_script_style_noscript_iframe() {
    let out = render_preserve(
        "<div><p>keep</p><script>evil()</script><style>.a{}</style><noscript>x</noscript><iframe src=\"y\"></iframe></div>",
    );
    assert!(out.contains("keep"));
    assert!(!out.contains("<script"));
    assert!(!out.contains("<style"));
    assert!(!out.contains("<noscript"));
    assert!(!out.contains("<iframe"));
}

#[test]
fn preserve_and_whitelist_observably_differ_on_attributes() {
    let html = "<div class=\"keepme\"><p>body</p></div>";
    let preserve = render_preserve(html);
    let whitelist = render_whitelist(html, &core_article());
    assert!(preserve.contains("class=\"keepme\""));
    assert!(!whitelist.contains("class="));
    assert_ne!(preserve, whitelist);
}

#[test]
fn preserve_escapes_text_and_attribute_values() {
    let out = render_preserve("<p title=\"a &quot; b\">a &lt; b &amp; c</p>");
    assert!(out.contains("a &lt; b &amp; c"));
    assert!(out.contains("title="));
}

// ---- relocated name/BreadcrumbList discard predicates -----------------------------

fn is_boiler(class_or_id: &str, opts: &CoreOptions) -> bool {
    let html = format!("<div class=\"{class_or_id}\"></div>");
    let doc = parse(&html);
    doc.body()
        .and_then(|b| b.element_children().into_iter().next())
        .is_some_and(|d| is_boilerplate_named(&d, opts))
}

#[test]
fn discard_flags_navigation_and_sidebar_tokens() {
    assert!(is_boiler("main-sidebar", &core_article()));
    assert!(is_boiler("sidebar", &core_article()));
    assert!(is_boiler("left-sidebar", &core_article()));
    assert!(is_boiler("share-buttons", &core_article()));
    assert!(is_boiler("c-social-share", &core_article())); // `share` still matches
    assert!(is_boiler("widget", &core_article())); // bare widget
}

#[test]
fn discard_does_not_flag_content_or_rs_false_positives() {
    assert!(!is_boiler("article-content", &core_article()));
    assert!(!is_boiler("elementor-widget-text-editor", &core_article()));
    assert!(!is_boiler("elementor-widget-container", &core_article()));
    assert!(!is_boiler("newspaper-x-sidebar", &core_article()));
    assert!(!is_boiler("l-sidebar-fixed", &core_article()));
    assert!(!is_boiler("c-social-buttons", &core_article()));
}

fn always_excluded(html: &str, opts: &CoreOptions) -> bool {
    let doc = parse(html);
    doc.select("[data-t]")
        .nodes()
        .first()
        .copied()
        .is_some_and(|n| is_always_excluded_name(&n, opts))
}

#[test]
fn discard_flags_always_excluded_substrings_and_breadcrumblist() {
    assert!(always_excluded(
        "<div data-t class=\"el__featured-video\"></div>",
        &core_article()
    ));
    assert!(always_excluded(
        "<div data-t class=\"pg-headline\"></div>",
        &core_article()
    ));
    assert!(always_excluded(
        "<div data-t id=\"av-structured-data\"></div>",
        &core_article()
    ));
    assert!(always_excluded(
        "<ol data-t itemscope itemtype=\"https://schema.org/BreadcrumbList\"></ol>",
        &core_article(),
    ));
    assert!(!always_excluded(
        "<div data-t class=\"article-content\"></div>",
        &core_article()
    ));
    assert!(!always_excluded(
        "<ol data-t itemtype=\"https://schema.org/ItemList\"></ol>",
        &core_article(),
    ));
}

#[test]
fn discard_scopes_comment_containers_behind_comments_are_content() {
    assert!(always_excluded(
        "<div data-t class=\"comment-container\"></div>",
        &core_article()
    ));
    assert!(!always_excluded(
        "<div data-t class=\"comment-container\"></div>",
        &core_forum()
    ));
}
