// SPDX-License-Identifier: Apache-2.0
//! The 89 numeric features `f[0..89]`, a byte-for-byte port of the proven v1
//! `classifier/features/numeric.ts` (itself byte-exact with `training/extract_features.py`).
//!
//! Parity rules honored: UTF-8 byte lengths (`str::len` — Rust matches naturally);
//! the CPython `str.split()`/`str.strip()` whitespace class (NOT `char::is_whitespace`);
//! selectolax comma-union NO-dedup (one count per matching sub-selector, document
//! order); the 500_000-byte body-text gate (strict `>`, leaves `f[63..89] = 0`);
//! `[class*='x']` case-sensitive attribute substring. `<template>` content is excluded
//! by dom_query/html5ever natively (template children live in a separate fragment),
//! matching lexbor.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use dom_query::{Document, NodeRef};
use regex::Regex;

use crate::dom::{select_all, tag_of};
use crate::page_type::url::{
    ARTICLE_PATHS, BLOG_SLUG_PATTERNS, CATEGORY_PATHS, DOCS_DOMAINS, DOCS_PATHS, FORUM_DOMAINS,
    FORUM_PATHS, FORUM_URL_PATTERNS, LISTING_PATH_CONTAINS, LISTING_PATH_ENDINGS, PRODUCT_PATHS,
    SERVICE_PATHS, SERVICE_SLUG_PATTERNS, contains_any, extract_domain_path,
};

/// The number of numeric features.
pub const N_NUMERIC: usize = 89;

// f[84]: `[0-9]+\s*(results|items|products|pieces)` on the lowercased body text.
static PRODUCT_COUNT_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"[0-9]+\s*(results|items|products|pieces)").ok());

const COMMERCIAL_WORDS: &[&str] = &[
    "price", "buy", "cart", "shop", "order", "shipping", "delivery", "stock", "sale", "discount",
    "offer", "deal", "checkout", "payment", "warranty", "returns", "refund",
];
const CONTENT_WORDS: &[&str] = &[
    "posted",
    "author",
    "published",
    "updated",
    "comments",
    "share",
    "tweet",
    "read",
    "article",
    "blog",
    "opinion",
    "editor",
    "journalist",
    "source",
    "according",
];
const TECH_WORDS: &[&str] = &[
    "api",
    "function",
    "parameter",
    "returns",
    "example",
    "syntax",
    "reference",
    "deprecated",
    "version",
    "module",
    "class",
    "method",
    "interface",
    "configuration",
    "install",
];
const FORUM_WORDS: &[&str] = &[
    "reply",
    "thread",
    "post",
    "member",
    "joined",
    "reputation",
    "moderator",
    "admin",
    "quote",
    "likes",
    "views",
    "topic",
    "answered",
    "solution",
    "vote",
    "upvote",
];
const DOM_SIG_KEYWORDS: &[&str] = &[
    "item", "card", "product", "post", "entry", "result", "row", "cell",
];
const CTA_PHRASES: &[&str] = &[
    "get started",
    "free trial",
    "contact us",
    "sign up",
    "try free",
    "get pricing",
    "book a",
    "schedule",
];
const DESCRIPTION_KEYS: &[&str] = &[
    "description",
    "og:description",
    "twitter:description",
    "dc.description",
    "excerpt",
];

/// CPython `str.split()`/`str.strip()` whitespace codepoints (NOT JS `\s`, NOT Rust
/// `char::is_whitespace`): includes U+001C–U+001F and U+0085; EXCLUDES U+FEFF.
const PY_WS: &[char] = &[
    '\u{09}', '\u{0a}', '\u{0b}', '\u{0c}', '\u{0d}', '\u{1c}', '\u{1d}', '\u{1e}', '\u{1f}',
    '\u{20}', '\u{85}', '\u{a0}', '\u{1680}', '\u{2000}', '\u{2001}', '\u{2002}', '\u{2003}',
    '\u{2004}', '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}', '\u{2009}', '\u{200a}', '\u{2028}',
    '\u{2029}', '\u{202f}', '\u{205f}', '\u{3000}',
];

fn is_py_ws(ch: char) -> bool {
    PY_WS.contains(&ch)
}

/// Python `str.strip()`: strip leading/trailing runs of CPython whitespace.
#[must_use]
pub fn py_strip(s: &str) -> &str {
    s.trim_matches(is_py_ws)
}

/// Python `str.split()` (no args): split on CPython-whitespace runs, drop empties.
#[must_use]
pub fn split_whitespace(s: &str) -> Vec<&str> {
    py_strip(s)
        .split(is_py_ws)
        .filter(|t| !t.is_empty())
        .collect()
}

/// UTF-8 byte length (every `len()` in the Python extractor is a byte count).
fn blen(s: &str) -> usize {
    s.len()
}

fn node_text(node: &NodeRef) -> String {
    node.text().to_string()
}

/// The document root as a `NodeRef` for document-wide selection.
fn root(doc: &Document) -> NodeRef<'_> {
    doc.root()
}

/// Split a comma-union selector into its trimmed, non-empty sub-selectors. Safe here
/// because none of the feature selectors carry commas inside `[attr]`/quotes/`:is()`.
fn split_union(sel: &str) -> Vec<&str> {
    sel.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect()
}

/// selectolax `node.css` semantics: descendants of `root_node` matching the union, in
/// document order, counted ONCE PER MATCHING SUB-SELECTOR (no dedup for multi-unions).
fn match_union<'a>(root_node: &NodeRef<'a>, sel: &str) -> Vec<NodeRef<'a>> {
    let subs = split_union(sel);
    if subs.len() <= 1 {
        return select_all(root_node, sel);
    }
    let candidates = select_all(root_node, sel);
    let mut out = Vec::new();
    for el in candidates {
        for sub in &subs {
            if el.is(sub) {
                out.push(el);
            }
        }
    }
    out
}

pub(crate) fn select_doc<'a>(doc: &'a Document, sel: &str) -> Vec<NodeRef<'a>> {
    match_union(&root(doc), sel)
}

pub(crate) fn select_len(doc: &Document, sel: &str) -> usize {
    match_union(&root(doc), sel).len()
}

fn descendant_count(node: &NodeRef, sel: &str) -> usize {
    match_union(node, sel).len()
}

fn selection_text(nodes: &[NodeRef]) -> String {
    let mut out = String::new();
    for n in nodes {
        out.push_str(node_text(n).as_str());
    }
    out
}

fn count_char(s: &str, ch: char) -> usize {
    s.chars().filter(|c| *c == ch).count()
}

fn count_at_least(counts: &HashMap<String, usize>, threshold: usize) -> usize {
    counts.values().filter(|c| **c >= threshold).count()
}

fn sum_counts(counts: &HashMap<String, usize>, words: &[&str]) -> usize {
    words
        .iter()
        .map(|w| counts.get(*w).copied().unwrap_or(0))
        .sum()
}

fn max_value(counts: &HashMap<String, usize>) -> usize {
    counts.values().copied().max().unwrap_or(0)
}

/// First-wins meta scan keyed by `name||property||itemprop||http-equiv` (lowercased);
/// empty key/content rows are skipped (Python `_scan_meta`).
fn scan_meta(doc: &Document) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for meta in select_doc(doc, "meta") {
        let key = meta
            .attr("name")
            .or_else(|| meta.attr("property"))
            .or_else(|| meta.attr("itemprop"))
            .or_else(|| meta.attr("http-equiv"))
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        let content = meta
            .attr("content")
            .map(|s| s.to_string())
            .unwrap_or_default();
        if key.is_empty() || content.is_empty() {
            continue;
        }
        out.entry(key).or_insert(content);
    }
    out
}

/// Raw `og:type` content, lowercased (empty when absent).
pub fn og_type(doc: &Document) -> String {
    scan_meta(doc)
        .get("og:type")
        .map(|s| s.to_lowercase())
        .unwrap_or_default()
}

/// `"{title} {description}"` — the ONLY TF-IDF input (simplified `title_meta`).
pub fn title_meta_text(doc: &Document) -> String {
    let title = select_doc(doc, "title")
        .first()
        .map(|t| py_strip(&node_text(t)).to_string())
        .unwrap_or_default();
    let meta = scan_meta(doc);
    let mut description = String::new();
    for key in DESCRIPTION_KEYS {
        if let Some(value) = meta.get(*key) {
            description = py_strip(value).to_string();
            break;
        }
    }
    format!("{title} {description}")
}

/// Extract the 89 numeric features from a parsed document + URL.
#[must_use]
pub fn extract_numeric_features(doc: &Document, url: &str) -> Vec<f64> {
    let mut f = vec![0.0_f64; N_NUMERIC];
    let set = |f: &mut Vec<f64>, i: usize, v: f64| {
        if let Some(slot) = f.get_mut(i) {
            *slot = v;
        }
    };

    let url_lower = url.to_lowercase();
    let (domain, path) = extract_domain_path(&url_lower);

    // === f[0..14]: URL pattern features ===
    set(&mut f, 0, bool_f(contains_any(&domain, FORUM_DOMAINS)));
    set(&mut f, 1, bool_f(contains_any(&path, FORUM_PATHS)));
    set(
        &mut f,
        2,
        bool_f(contains_any(&url_lower, FORUM_URL_PATTERNS)),
    );
    set(&mut f, 3, bool_f(contains_any(&domain, DOCS_DOMAINS)));
    set(&mut f, 4, bool_f(contains_any(&path, DOCS_PATHS)));
    set(&mut f, 5, bool_f(contains_any(&path, PRODUCT_PATHS)));
    set(&mut f, 6, bool_f(contains_any(&path, CATEGORY_PATHS)));
    set(&mut f, 7, bool_f(contains_any(&path, SERVICE_PATHS)));
    set(
        &mut f,
        8,
        bool_f(contains_any(&url_lower, SERVICE_SLUG_PATTERNS)),
    );
    set(&mut f, 9, bool_f(contains_any(&path, ARTICLE_PATHS)));
    set(
        &mut f,
        10,
        bool_f(contains_any(&url_lower, BLOG_SLUG_PATTERNS)),
    );
    let path_trimmed = path.trim_end_matches('/');
    set(
        &mut f,
        11,
        bool_f(
            LISTING_PATH_ENDINGS
                .iter()
                .any(|p| path_trimmed.ends_with(p)),
        ),
    );
    set(
        &mut f,
        12,
        bool_f(contains_any(&path, LISTING_PATH_CONTAINS)),
    );
    set(
        &mut f,
        13,
        bool_f(domain.contains("shop.") || domain.contains("store.")),
    );

    // === f[14..63]: HTML structural features ===
    let mut p_count = 0usize;
    let mut p_total_len = 0usize;
    for node in select_doc(doc, "p") {
        let len = blen(py_strip(&node_text(&node)));
        if len > 20 {
            p_count += 1;
            p_total_len += len;
        }
    }
    set(&mut f, 14, p_count as f64);
    set(
        &mut f,
        15,
        if p_count > 0 {
            p_total_len as f64 / p_count as f64
        } else {
            0.0
        },
    );
    set(&mut f, 16, select_len(doc, "h1, h2, h3, h4, h5, h6") as f64);
    let h2_count = select_len(doc, "h2");
    let body_nodes = select_doc(doc, "body");
    let body_text_full = selection_text(&body_nodes);
    let body_text_len = blen(&body_text_full);
    set(
        &mut f,
        17,
        if h2_count > 0 {
            body_text_len as f64 / h2_count as f64
        } else {
            0.0
        },
    );
    set(&mut f, 18, bool_f(select_len(doc, "article") > 0));
    set(&mut f, 19, bool_f(select_len(doc, "time") > 0));
    set(&mut f, 20, bool_f(select_len(doc, "main") > 0));
    set(&mut f, 21, bool_f(select_len(doc, "aside") > 0));
    set(
        &mut f,
        22,
        bool_f(
            select_len(
                doc,
                "meta[name=\"author\"], meta[property=\"article:author\"], [class*=\"author\"]",
            ) > 0,
        ),
    );

    for node in select_doc(doc, "script[type=\"application/ld+json\"]") {
        let text = node_text(&node);
        if text.contains("\"Article\"")
            || text.contains("\"NewsArticle\"")
            || text.contains("\"BlogPosting\"")
        {
            set(&mut f, 23, 1.0);
        }
        if text.contains("\"Product\"") {
            set(&mut f, 24, 1.0);
        }
        if text.contains("\"FAQPage\"") {
            set(&mut f, 25, 1.0);
        }
        if text.contains("\"CollectionPage\"") || text.contains("\"OfferCatalog\"") {
            set(&mut f, 26, 1.0);
        }
        if text.contains("\"ItemList\"") {
            set(&mut f, 27, 1.0);
        }
        if text.contains("\"LocalBusiness\"") {
            set(&mut f, 28, 1.0);
        }
        if text.contains("\"Service\"") {
            set(&mut f, 29, 1.0);
        }
        if text.contains("\"AggregateOffer\"") {
            set(&mut f, 30, 1.0);
        }
    }

    let og = og_type(doc);
    set(&mut f, 31, bool_f(og.contains("product")));
    set(&mut f, 32, bool_f(og == "article"));
    set(&mut f, 33, bool_f(og == "website"));
    set(
        &mut f,
        34,
        bool_f(
            select_len(
                doc,
                "[class*='product-grid'], [class*='product-list'], [class*='product-card']",
            ) > 0,
        ),
    );
    set(
        &mut f,
        35,
        bool_f(
            select_len(
                doc,
                "[class*='add-to-cart'], [class*='addtocart'], [class*='buy-now']",
            ) > 0,
        ),
    );
    set(
        &mut f,
        36,
        select_len(
            doc,
            "[class*='product-card'], [class*='product-tile'], [class*='product-item']",
        ) as f64,
    );
    set(
        &mut f,
        37,
        bool_f(
            select_len(
                doc,
                "link[rel='next'], [class*='pagination'], [class*='pager']",
            ) > 0,
        ),
    );
    set(&mut f, 38, select_len(doc, "code, pre") as f64);
    set(
        &mut f,
        39,
        bool_f(
            select_len(
                doc,
                "[class*='docs-sidebar'], [class*='doc-sidebar'], [class*='docs-nav'], [class*='table-of-contents']",
            ) > 0,
        ),
    );

    let link_count = select_len(doc, "a");
    let p_text = selection_text(&select_doc(doc, "p"));
    let p_words = split_whitespace(&p_text).len();
    set(
        &mut f,
        40,
        if p_words > 0 {
            link_count as f64 / p_words as f64
        } else {
            0.0
        },
    );
    set(&mut f, 41, p_words as f64);
    set(
        &mut f,
        42,
        select_len(
            doc,
            "[class*='grid'], [class*='col-'], [class*='column'], [class*='card']",
        ) as f64,
    );
    set(&mut f, 43, select_len(doc, "svg") as f64);

    let mut cta_count = 0usize;
    for node in select_doc(doc, "button, a") {
        let text = node_text(&node).to_lowercase();
        if CTA_PHRASES.iter().any(|phrase| text.contains(phrase)) {
            cta_count += 1;
        }
    }
    set(&mut f, 44, cta_count as f64);
    set(&mut f, 45, bool_f(select_len(doc, "[class*='hero']") > 0));
    set(
        &mut f,
        46,
        bool_f(select_len(doc, "[class*='testimonial']") > 0),
    );
    set(
        &mut f,
        47,
        bool_f(select_len(doc, "[class*='pricing']") > 0),
    );
    set(
        &mut f,
        48,
        bool_f(select_len(doc, "[class*='feature']") > 0),
    );
    set(
        &mut f,
        49,
        bool_f(select_len(doc, "[class*='breadcrumb']") > 0),
    );
    set(&mut f, 50, select_len(doc, "form") as f64);
    set(&mut f, 51, select_len(doc, "img") as f64);
    set(&mut f, 52, select_len(doc, "ul, ol") as f64);
    set(&mut f, 53, select_len(doc, "table") as f64);
    set(&mut f, 54, select_len(doc, "nav") as f64);
    set(&mut f, 55, select_len(doc, "section") as f64);
    set(&mut f, 56, select_len(doc, "button") as f64);
    set(&mut f, 57, select_len(doc, "input") as f64);
    set(&mut f, 58, body_text_len as f64);

    let mut link_hrefs: HashSet<String> = HashSet::new();
    for node in select_doc(doc, "a[href]") {
        if let Some(href) = node.attr("href") {
            link_hrefs.insert(href.to_string());
        }
    }
    set(&mut f, 59, link_hrefs.len() as f64);
    set(&mut f, 60, select_len(doc, "[class*='comment']") as f64);
    set(&mut f, 61, select_len(doc, "[class*='post']") as f64);
    set(&mut f, 62, select_len(doc, "[class*='message']") as f64);

    // === 500,000-byte body-text gate: early return leaves f[63..89] at 0.0 ===
    if body_text_len > 500_000 {
        return f;
    }

    // f[63]/f[64]: repeated sibling RAW class strings.
    let shallow_nodes = select_doc(doc, "body > *, body > * > *, body > * > * > *");
    let mut max_repeated_class = 0usize;
    let mut parents_with_repeats = 0usize;
    for node in &shallow_nodes {
        let children = node.element_children();
        if children.len() < 3 {
            continue;
        }
        let mut class_counts: HashMap<String, usize> = HashMap::new();
        for child in &children {
            if !child.has_attr("class") {
                continue;
            }
            let cls = child
                .attr("class")
                .map(|s| s.to_string())
                .unwrap_or_default();
            *class_counts.entry(cls).or_insert(0) += 1;
        }
        if !class_counts.is_empty() {
            let max_count = max_value(&class_counts);
            if max_count >= 3 {
                parents_with_repeats += 1;
                if max_count > max_repeated_class {
                    max_repeated_class = max_count;
                }
            }
        }
    }
    set(&mut f, 63, max_repeated_class as f64);
    set(&mut f, 64, parents_with_repeats as f64);

    set(
        &mut f,
        65,
        (count_char(&body_text_full, '$')
            + count_char(&body_text_full, '€')
            + count_char(&body_text_full, '£')) as f64,
    );

    let img_count = select_len(doc, "img");
    set(
        &mut f,
        66,
        if body_text_len > 0 {
            img_count as f64 / (body_text_len as f64 / 1000.0)
        } else {
            0.0
        },
    );

    let mut heading_level_counts = [0usize; 6];
    for node in select_doc(doc, "h1, h2, h3, h4, h5, h6") {
        let name = tag_of(&node).unwrap_or_default();
        if let Some(second) = name.chars().nth(1) {
            if let Some(level) = second.to_digit(10) {
                if (1..=6).contains(&level) {
                    if let Some(slot) = heading_level_counts.get_mut((level - 1) as usize) {
                        *slot += 1;
                    }
                }
            }
        }
    }
    let max_same_level = heading_level_counts.iter().copied().max().unwrap_or(0);
    let n_levels_used = heading_level_counts.iter().filter(|c| **c > 0).count();
    set(
        &mut f,
        67,
        if n_levels_used > 0 {
            max_same_level as f64 / n_levels_used as f64
        } else {
            0.0
        },
    );

    let body_lower = body_text_full.to_lowercase();
    set(&mut f, 68, bool_f(body_lower.contains("breadcrumblist")));

    // f[69]: repeated link texts (strip+lower, byte-len > 3, count >= 3).
    let mut link_text_counts: HashMap<String, usize> = HashMap::new();
    for node in select_doc(doc, "a") {
        let text = py_strip(&node_text(&node)).to_lowercase();
        if blen(&text) > 3 {
            *link_text_counts.entry(text).or_insert(0) += 1;
        }
    }
    set(&mut f, 69, count_at_least(&link_text_counts, 3) as f64);

    // f[70]: section link-density population variance with the flush-before-assign quirk.
    let mut section_ratios: Vec<f64> = Vec::new();
    let mut current_links = 0usize;
    let mut current_text_len = 0usize;
    for node in select_doc(doc, "section, article, div") {
        if current_text_len > 50 {
            section_ratios.push((current_links as f64 / current_text_len as f64) * 1000.0);
        }
        current_links = descendant_count(&node, "a");
        current_text_len = blen(py_strip(&node_text(&node)));
    }
    if current_text_len > 50 {
        section_ratios.push((current_links as f64 / current_text_len as f64) * 1000.0);
    }
    if section_ratios.len() >= 3 {
        let mean = section_ratios.iter().sum::<f64>() / section_ratios.len() as f64;
        let variance = section_ratios
            .iter()
            .map(|r| (r - mean).powi(2))
            .sum::<f64>()
            / section_ratios.len() as f64;
        set(&mut f, 70, variance);
    }

    set(
        &mut f,
        71,
        bool_f(select_len(doc, "meta[name=\"robots\"][content*=\"noindex\"]") > 0),
    );

    let path_segments = path.split('/').filter(|s| !s.is_empty()).count();
    set(&mut f, 72, path_segments as f64);

    // f[73]/f[74]: structural signature `tag` or `tag|keyword`.
    let mut dom_max_sig = 0usize;
    let mut dom_parents_with_repeats = 0usize;
    for node in &shallow_nodes {
        let children = node.element_children();
        if children.len() < 3 {
            continue;
        }
        let mut sig_counts: HashMap<String, usize> = HashMap::new();
        for child in &children {
            let Some(tag) = tag_of(child) else { continue };
            if tag.is_empty() {
                continue;
            }
            let cls = child
                .attr("class")
                .map(|s| s.to_lowercase())
                .unwrap_or_default();
            let mut keyword = "";
            for kw in DOM_SIG_KEYWORDS {
                if cls.contains(kw) {
                    keyword = kw;
                    break;
                }
            }
            let sig = if keyword.is_empty() {
                tag
            } else {
                format!("{tag}|{keyword}")
            };
            *sig_counts.entry(sig).or_insert(0) += 1;
        }
        if !sig_counts.is_empty() {
            let top = max_value(&sig_counts);
            if top >= 3 {
                dom_parents_with_repeats += 1;
                if top > dom_max_sig {
                    dom_max_sig = top;
                }
            }
        }
    }
    set(&mut f, 73, dom_max_sig as f64);
    set(&mut f, 74, dom_parents_with_repeats as f64);

    // f[75..78]: vocabulary densities over whitespace-split tokens of body_lower.
    let body_words = split_whitespace(&body_lower);
    let total_words = body_words.len();
    if total_words > 0 {
        let mut word_counts: HashMap<String, usize> = HashMap::new();
        for word in &body_words {
            *word_counts.entry((*word).to_string()).or_insert(0) += 1;
        }
        set(
            &mut f,
            75,
            sum_counts(&word_counts, COMMERCIAL_WORDS) as f64 / total_words as f64,
        );
        set(
            &mut f,
            76,
            sum_counts(&word_counts, CONTENT_WORDS) as f64 / total_words as f64,
        );
        set(
            &mut f,
            77,
            sum_counts(&word_counts, TECH_WORDS) as f64 / total_words as f64,
        );
        set(
            &mut f,
            78,
            sum_counts(&word_counts, FORUM_WORDS) as f64 / total_words as f64,
        );
    }

    set(&mut f, 79, max_value(&link_text_counts) as f64);
    set(&mut f, 80, count_at_least(&link_text_counts, 3) as f64);

    // === f[81..89]: Collection-specific features ===
    set(
        &mut f,
        81,
        bool_f(
            select_len(
                doc,
                "meta[property=\"og:type\"][content*=\"product.group\"]",
            ) > 0,
        ),
    );
    set(
        &mut f,
        82,
        bool_f(
            select_len(
                doc,
                "[class*='filter'][class*='sidebar'], [class*='filter'][class*='panel'], [class*='filter'][class*='bar'], [class*='filter'][class*='menu']",
            ) > 0,
        ),
    );
    set(
        &mut f,
        83,
        bool_f(
            select_len(
                doc,
                "[class*='sort'][class*='select'], [class*='sort'][class*='dropdown'], [class*='sort'][class*='control'], [class*='sort'][class*='option']",
            ) > 0,
        ),
    );
    set(
        &mut f,
        84,
        bool_f(
            PRODUCT_COUNT_RE
                .as_ref()
                .is_some_and(|re| re.is_match(&body_lower)),
        ),
    );

    let card_selector = "[class*='product-card'], [class*='product-tile'], [class*='product-item'], [class*='product-grid-item'], [class*='grid-item'], [class*='collection-item']";
    let card_nodes = select_doc(doc, card_selector);
    let total_cards = card_nodes.len();
    let mut cards_with_price = 0usize;
    for node in &card_nodes {
        if descendant_count(node, "[class*='price'], [class*='cost'], [class*='amount']") > 0 {
            cards_with_price += 1;
        }
    }
    set(&mut f, 85, cards_with_price as f64);
    set(
        &mut f,
        86,
        bool_f(body_lower.contains("collectionpage") || body_lower.contains("productcollection")),
    );
    set(&mut f, 87, total_cards as f64);
    set(
        &mut f,
        88,
        if total_cards > 0 {
            cards_with_price as f64 / total_cards as f64
        } else {
            0.0
        },
    );

    f
}

fn bool_f(b: bool) -> f64 {
    if b { 1.0 } else { 0.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_whitespace_uses_cpython_class() {
        // U+0085 (NEL) and U+001C (FS) split; U+FEFF (BOM) does NOT.
        assert_eq!(split_whitespace("one\u{85}two\u{1c}three").len(), 3);
        assert_eq!(split_whitespace("alpha\u{feff}beta").len(), 1);
        assert_eq!(split_whitespace("   ").len(), 0);
        assert_eq!(split_whitespace("a b  c").len(), 3);
    }

    #[test]
    fn py_strip_trims_cpython_whitespace_not_bom() {
        assert_eq!(py_strip("  hi \t\n"), "hi");
        assert_eq!(py_strip("\u{feff}hi\u{feff}"), "\u{feff}hi\u{feff}");
        assert_eq!(py_strip("\u{85}\u{1c}x\u{1f}"), "x");
    }

    #[test]
    fn title_meta_text_joins_title_and_first_description() {
        let doc = Document::from(
            "<html><head><title> Hi </title><meta name=\"description\" content=\" desc \"></head><body></body></html>",
        );
        assert_eq!(title_meta_text(&doc), "Hi desc");
    }
}
