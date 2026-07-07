// SPDX-License-Identifier: Apache-2.0
//! The one live extractor submodule.
//!
//! Ports `prune_unwanted_nodes` (relocated here per the PORTING-NOTES) plus the
//! rs-trafilatura structured RESCUES (`fallback.rs`): the profile-INDEPENDENT
//! `baseline` (basic cleaning + `<article>`/paragraph scraping + whole-body text) and
//! the JSON-LD `articleBody` pre-check. These recover the main content when the
//! profile-driven selection under-performs (Phase RETEST autofix) — e.g. a blog post
//! whose body lives in an `<article class="comment">` that the name filter drops.
//! Rescues fire ONLY on genuine under-extraction (see `extract.rs`), so pages that
//! extract fine are untouched (no precision regression). The dead `sanitize_tree`
//! whitelist-strip is NOT ported (TS washing owns sanitization).

use std::collections::HashSet;

use dom_query::{Document, NodeRef};
use serde_json::Value;

use crate::dom::{body_or_root, class_id, select_all};
use crate::link_density::delete_by_link_density;
use crate::options::CoreOptions;
use crate::patterns::collapse_ws;

/// Prune link-dense sections from the chosen subtree (go `pruneUnwantedSections`,
/// simplified): remove link-heavy lists, then link-dense divs (with backtracking),
/// then headings and quotes.
pub fn prune_unwanted_nodes(sub_tree: &NodeRef, opts: &CoreOptions) {
    delete_by_link_density(sub_tree, opts, false, &["ul", "ol", "dl"]);
    delete_by_link_density(sub_tree, opts, true, &["div"]);
    delete_by_link_density(sub_tree, opts, false, &["h1", "h2", "h3", "h4", "h5", "h6"]);
    delete_by_link_density(sub_tree, opts, false, &["blockquote", "q"]);
}

/// rs-trafilatura `BASIC_CLEANING_SELECTOR` — site furniture removed before the
/// profile-independent baseline extraction.
const BASIC_CLEANING_SELECTOR: &str = "aside, footer, nav, header, div[id*=\"footer\"], div[class*=\"footer\"], div[class*=\"consent\"], div[class*=\"cookie\"], div[class*=\"privacy\"], div[class*=\"gdpr\"], div[class*=\"banner\"], div[class*=\"modal\"], div[class*=\"popup\"], div[class*=\"newsletter\"], script, style, noscript";

/// Furniture class/id tokens skipped during baseline paragraph scraping (a focused
/// distillation of rs `OVERALL_DISCARDED_CONTENT` — deliberately EXCLUDES bare
/// `comment` so a comment-hosted post body is not discarded).
const BASELINE_DISCARD_TOKENS: &[&str] = &[
    "nav",
    "navbar",
    "navigation",
    "menu",
    "sidebar",
    "footer",
    "header",
    "masthead",
    "banner",
    "breadcrumb",
    "pagination",
    "social",
    "share",
    "sharing",
    "related",
    "advert",
    "advertisement",
    "sponsor",
    "widget",
    "cookie",
    "popup",
    "modal",
    "newsletter",
    "subscribe",
    "promo",
];

fn baseline_should_discard(node: &NodeRef) -> bool {
    let ci = class_id(node).to_ascii_lowercase();
    if ci.trim().is_empty() {
        return false;
    }
    BASELINE_DISCARD_TOKENS.iter().any(|t| ci.contains(t))
}

/// rs `basic_cleaning`: drop the `BASIC_CLEANING_SELECTOR` set + any `script/style/noscript`.
fn basic_cleaning(root: &NodeRef) {
    for node in select_all(root, BASIC_CLEANING_SELECTOR) {
        node.remove_from_parent();
    }
    for node in select_all(root, "script, style, noscript") {
        node.remove_from_parent();
    }
}

/// Recursively find an `articleBody` string in a JSON-LD value (rs `find_article_body`).
/// Bounded by serde_json's parse depth, so this recursion is safe.
fn find_article_body(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            for (key, val) in map {
                if key.eq_ignore_ascii_case("articlebody") {
                    if let Value::String(s) = val {
                        return Some(s.clone());
                    }
                }
                if let Some(found) = find_article_body(val) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(arr) => arr.iter().find_map(find_article_body),
        _ => None,
    }
}

/// Recover the article body from JSON-LD `articleBody` (rs `extract_json_ld_article_body`).
/// If the body contains HTML, its text is extracted.
#[must_use]
pub fn extract_json_ld_article_body(doc: &Document) -> Option<String> {
    let root = doc.root();
    for script in select_all(&root, "script[type=\"application/ld+json\"]") {
        let raw = script.text();
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(data) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if let Some(article_body) = find_article_body(&data) {
            let body = article_body.trim().to_string();
            if body.is_empty() {
                continue;
            }
            if body.contains("<p>") {
                let temp = Document::from(format!("<div>{body}</div>"));
                return Some(collapse_ws(temp.select("div").text().as_ref()));
            }
            return Some(body);
        }
    }
    None
}

/// Profile-INDEPENDENT baseline extraction (rs `baseline`): basic cleaning, then the
/// first substantial `<article>`/`<story>`, then paragraph scraping (`p`/`pre`/`q`/
/// `code`/`blockquote`, skipping furniture), then the whole-body text. Returns the
/// paragraph texts (the caller synthesizes bare `<p>` markup — the documented
/// best-effort limitation). Mutates `doc` (basic cleaning), so callers pass a
/// dedicated parse.
#[must_use]
pub fn baseline_paragraphs(doc: &Document) -> Vec<String> {
    // Clean the WHOLE document (head + body) so residual `<head>` scripts (e.g. JSON-LD)
    // never leak into the whole-body/text fallbacks below.
    basic_cleaning(&doc.root());
    let Some(body) = body_or_root(doc) else {
        return Vec::new();
    };

    // 3. First substantial <article>/<story>.
    if let Some(article) = select_all(&body, "article, story").into_iter().next() {
        let text = collapse_ws(article.text().as_ref());
        if text.chars().count() > 100 {
            return vec![text];
        }
    }

    // 4. Paragraph scraping (document order), skipping furniture + consent/tracking noise.
    let mut paras: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for node in select_all(&body, "blockquote, pre, q, code, p") {
        if baseline_should_discard(&node) {
            continue;
        }
        if let Some(parent) = node.parent() {
            if baseline_should_discard(&parent) {
                continue;
            }
        }
        let raw = node.text();
        let entry = collapse_ws(raw.as_ref());
        if entry.is_empty() {
            continue;
        }
        let lower = entry.to_ascii_lowercase();
        if (lower.contains("cookie") && lower.contains("consent"))
            || lower.contains("tracking technolog")
        {
            continue;
        }
        // Skip mostly-navigation blocks (high newline-to-word ratio).
        let newlines = raw.matches('\n').count();
        let words = raw.split_whitespace().count();
        if words > 0 && newlines > words / 2 {
            continue;
        }
        if seen.insert(entry.clone()) {
            paras.push(entry);
        }
    }
    let joined_len: usize = paras.iter().map(|p| p.chars().count() + 1).sum();
    if joined_len > 100 || !paras.is_empty() {
        return paras;
    }

    // 5. Whole-body text (the doc is already basic-cleaned, so no scripts/furniture).
    let body_text = collapse_ws(body.text().as_ref());
    if body_text.is_empty() {
        Vec::new()
    } else {
        vec![body_text]
    }
}
