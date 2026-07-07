// SPDX-License-Identifier: Apache-2.0
//! Name-based boilerplate discard predicates.
//!
//! Ported from rs-trafilatura `is_always_excluded_name` / `is_boilerplate`
//! (`extract.rs:2934`, `3215`) via the tested v1 `serialize-filtered.ts` +
//! `constants.ts`. These are RELOCATED off the serializer emit path into DOM passes
//! (see `extract.rs`): `is_always_excluded_name` fires unconditionally (including on
//! the doc-09 backoff path); the gated `is_boilerplate` never runs on backoff-rescued
//! content.

use dom_query::NodeRef;

use crate::dom::{attr_lower, class_id};
use crate::options::CoreOptions;
use crate::patterns::{hyphen_parts, token_match};

/// UNCONDITIONALLY-excluded class/id substrings (rs `is_always_excluded_name`).
/// Matched by case-insensitive substring, OUTSIDE the boilerplate-token backoff gate.
const ALWAYS_EXCLUDED_NAME_TOKENS: &[&str] = &[
    "av-structured-data",
    "post-meta-infos",
    "blog-categories",
    "blog-author",
    "wp-caption",
    "wp-caption-text",
    "video__end-slate",
    "zn-large-media",
    "featured-video-collection",
    "el__featured-video",
    "messenger-content",
    "read-more-link",
    "zn-body__read-more",
    "js-body-read-more",
    "pg-headline",
];

/// Comment-prefixed always-excluded substrings, scoped behind `!comments_are_content`.
const ALWAYS_EXCLUDED_COMMENT_NAME_TOKENS: &[&str] = &["comment-container", "comments-link"];

/// Boilerplate class/id tokens (gated, recall-able). Distilled from rs `is_boilerplate`
/// / `is_always_excluded_name` + the go content-discard selectors.
const BOILERPLATE_TOKENS: &[&str] = &[
    "nav",
    "navbar",
    "navigation",
    "menu",
    "sidebar",
    "breadcrumb",
    "pagination",
    "masthead",
    "banner",
    "share",
    "sharing",
    "social",
    "related",
    "promo",
    "advert",
    "advertisement",
    "sponsor",
    "widget",
    "cookie",
    "popup",
    "modal",
    "newsletter",
    "subscribe",
    "byline",
    "author-box",
    "meta-info",
    "metadata",
    "read-more",
    "readmore",
    "more-link",
    "skip-link",
    "screen-reader",
    "sr-only",
    "visually-hidden",
    "wp-caption",
    "caption-text",
    "tags",
    "tag-list",
    "category-list",
    "comment-respond",
    "comment-form",
    "reply",
];

/// Comment-container tokens (kept when comments are treated as content).
const COMMENT_TOKENS: &[&str] = &["comment", "comments", "disqus", "discussion"];

/// BEM-style layout/component prefixes (rs `LAYOUT_COMPONENT_PREFIXES`).
const LAYOUT_COMPONENT_PREFIXES: &[&str] = &["l-", "c-"];

/// Position words that mark an ACTUAL sidebar (rs `SIDEBAR_POSITION_WORDS`).
const SIDEBAR_POSITION_WORDS: &[&str] =
    &["left", "right", "primary", "secondary", "main", "widget"];

fn has_layout_component_prefix(token: &str) -> bool {
    LAYOUT_COMPONENT_PREFIXES
        .iter()
        .any(|p| token.starts_with(p))
}

/// rs `is_boilerplate`'s `sidebar` position guard: a bare `sidebar` part is real
/// furniture only when it is the sole part, the first part, or preceded by a position word.
fn sidebar_token_matches(token: &str) -> bool {
    let parts = hyphen_parts(token);
    for (i, part) in parts.iter().enumerate() {
        if *part != "sidebar" {
            continue;
        }
        if parts.len() == 1 || i == 0 {
            return true;
        }
        if i > 0
            && parts
                .get(i - 1)
                .is_some_and(|prev| SIDEBAR_POSITION_WORDS.contains(prev))
        {
            return true;
        }
    }
    false
}

/// Per-token boilerplate verdict with rs `is_boilerplate`'s false-positive guards
/// (elementor content widgets, theme-namespace sidebars, layout-component exemption).
fn boilerplate_token_matches(token: &str) -> bool {
    let matched: Vec<&str> = BOILERPLATE_TOKENS
        .iter()
        .copied()
        .filter(|&t| {
            if t == "sidebar" {
                sidebar_token_matches(token)
            } else {
                token_match(token, t)
            }
        })
        .collect();
    if matched.is_empty() {
        return false;
    }

    // Elementor content widgets: skip a `widget` hit when preceded by `elementor`.
    let parts = hyphen_parts(token);
    let widget_is_elementor = parts
        .iter()
        .enumerate()
        .any(|(i, p)| *p == "widget" && i > 0 && parts.get(i - 1) == Some(&"elementor"));
    let effective: Vec<&str> = if widget_is_elementor {
        matched.into_iter().filter(|&t| t != "widget").collect()
    } else {
        matched
    };
    if effective.is_empty() {
        return false;
    }

    // Layout/component-prefixed tokens: exempt when the ONLY hit is `sidebar`/`social`.
    if has_layout_component_prefix(token) {
        let only_sidebar_or_social = effective.iter().all(|&t| t == "sidebar" || t == "social");
        if only_sidebar_or_social {
            return false;
        }
    }

    true
}

fn is_always_excluded_class_id(ci: &str, opts: &CoreOptions) -> bool {
    if ci.is_empty() {
        return false;
    }
    if ALWAYS_EXCLUDED_NAME_TOKENS.iter().any(|t| ci.contains(t)) {
        return true;
    }
    if !opts.comments_are_content
        && ALWAYS_EXCLUDED_COMMENT_NAME_TOKENS
            .iter()
            .any(|t| ci.contains(t))
    {
        return true;
    }
    false
}

/// Whether an element is UNCONDITIONALLY excluded by name or microdata (rs checks that
/// run OUTSIDE the `filter_named_boilerplate` gate): the `is_always_excluded_name`
/// class/id list AND `itemtype*=breadcrumblist`. Fires even on the doc-09 backoff path.
#[must_use]
pub fn is_always_excluded_name(el: &NodeRef, opts: &CoreOptions) -> bool {
    if attr_lower(el, "itemtype").contains("breadcrumblist") {
        return true;
    }
    let ci = class_id(el).to_ascii_lowercase();
    is_always_excluded_class_id(ci.trim(), opts)
}

/// Whether an element is boilerplate by its class/id (comments kept for forums). The
/// gated predicate — must NOT run on backoff-rescued content.
#[must_use]
pub fn is_boilerplate_named(el: &NodeRef, opts: &CoreOptions) -> bool {
    if is_always_excluded_name(el, opts) {
        return true;
    }
    let ci = class_id(el).to_ascii_lowercase();
    let ci = ci.trim();
    if ci.is_empty() {
        return false;
    }
    if COMMENT_TOKENS.iter().any(|t| token_match(ci, t)) {
        return !opts.comments_are_content;
    }
    ci.split_whitespace().any(boilerplate_token_matches)
}
