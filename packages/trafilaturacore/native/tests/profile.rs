#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! Ported from v1 `core/profile.test.ts` + `profiles/index.test.ts` — the page-type
//! profile steers extraction (content selectors, preserve tags, boilerplate selectors).

use trafilaturacore_native::{CoreOptions, Options, PageType, extract};

fn content_of(input: &str, page_type: Option<PageType>) -> String {
    let opts = Options {
        page_type,
        ..Options::default()
    };
    extract(input, &opts).expect("ok").content_html
}

#[test]
fn resolve_maps_forum_profile_fields() {
    let core = CoreOptions::resolve(&Options {
        page_type: Some(PageType::Forum),
        ..Options::default()
    });
    assert!(core.comments_are_content);
    assert!(core.preserve_tags.contains(&"form"));
    assert!(!core.content_selectors.is_empty());
    assert!(!core.boilerplate_selectors.is_empty());

    let article = CoreOptions::resolve(&Options::default());
    assert!(!article.comments_are_content);
    assert!(article.content_selectors.is_empty());
}

#[test]
fn product_profile_drops_recommendation_boilerplate() {
    let long = "Genuine product copy describing the item in enough detail to be the real page body content here. ".repeat(3);
    let junk = "Recommended junk from a related products carousel that is not the product body at all here. ".repeat(3);
    let input = format!(
        "<main><div class=\"product-description\"><p>{long}</p></div><div class=\"related-products\"><p>{junk}</p></div></main>"
    );
    let out = content_of(&input, Some(PageType::Product));
    assert!(out.contains("Genuine product copy"));
    assert!(!out.contains("Recommended junk"));
}

#[test]
fn product_content_selector_picks_the_description_container() {
    let long =
        "Real content sentence that carries the body of this page with enough words. ".repeat(3);
    let input = format!(
        "<body><div class=\"noise\"><p>noise noise noise</p></div><div class=\"product-description\"><p>{long}</p></div></body>"
    );
    let out = content_of(&input, Some(PageType::Product));
    assert!(out.contains("Real content"));
    assert!(!out.contains("noise noise noise"));
}

#[test]
fn forum_profile_preserves_form_as_content() {
    let long =
        "Real forum post content that carries the body of this thread with enough words to count. "
            .repeat(3);
    let input = format!("<main><form class=\"thread\"><p>{long}</p></form></main>");
    // Without the forum profile the <form> is cleaned away; with it, it is preserved.
    let out = content_of(&input, Some(PageType::Forum));
    assert!(out.contains("Real forum post content"));
}
