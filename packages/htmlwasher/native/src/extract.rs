// SPDX-License-Identifier: Apache-2.0
//! Orchestration: parse → clean → select main content → per-render clone with the
//! relocated DOM passes → the DUAL-mode serializer (preserve-markup default /
//! whitelist parity) + the internal text twin → short-extraction body fallback.
//!
//! Ported from the tested v1 `extract.ts` + `serialize-filtered.ts` with the doc-09
//! divergences applied: the serializer sanitizes nothing (preserve-markup), the
//! header/name/BreadcrumbList guards are relocated to DOM passes (never re-run on the
//! backoff path for the gated name filter), text length is measured from the DOM
//! `text()` of the kept subtree (never a regex tag-strip), and comments-are-content
//! is threaded explicitly (no thread-local).

use dom_query::{Document, NodeRef};

use crate::dom::{
    all_elements, body_or_root, has_ancestor_tag, parse, same_node, select_all, tag_of, text_len,
};
use crate::extractor::fallback::{
    baseline_paragraphs, extract_json_ld_article_body, prune_unwanted_nodes,
};
use crate::html_processing::{
    MAX_TREE_DEPTH, clean_document, enforce_max_depth, prune_empty_elements,
};
use crate::options::{CoreOptions, EmitMode};
use crate::page_type::PageType;
use crate::patterns::collapse_ws;
use crate::result::ExtractResult;
use crate::selector::content::find_content_node;
use crate::selector::discard::{is_always_excluded_name, is_boilerplate_named};
use crate::tags::{SERIALIZE_HARD_SKIP, VOID_TAGS};

/// Below this many chars of extracted text the whole-body fallback + structured rescues are tried.
pub const MIN_EXTRACTED_TEXT: usize = 200;

/// JSON-LD `articleBody` rescue is only accepted at/above this length (rs `MIN_STRUCTURED_BODY_LEN`).
const MIN_STRUCTURED_BODY_LEN: usize = 500;

/// Exact resource caps from rs-trafilatura (`extract.rs:2969-2970`).
const MAX_TABLE_CELLS: usize = 20_000;
const MAX_TABLE_TEXT_LEN: usize = 200_000;

/// Recursion depth guard for the serializer — the only bounded recursion in the crate
/// (all dom_query traversal is iterative). Beyond this, deeper nodes are not emitted,
/// so pathologically nested input can never overflow the stack (never panics).
const MAX_SERIALIZE_DEPTH: usize = 1024;

// ---- whitelist-parity serializer tables (reference-parity mode only) --------------

const EMIT_TAGS: &[&str] = &[
    "p",
    "div",
    "section",
    "article",
    "main",
    "header",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "pre",
    "figure",
    "figcaption",
    "ul",
    "ol",
    "li",
    "dl",
    "dt",
    "dd",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "caption",
    "colgroup",
    "col",
    "a",
    "strong",
    "em",
    "b",
    "i",
    "u",
    "s",
    "del",
    "ins",
    "mark",
    "small",
    "sub",
    "sup",
    "q",
    "cite",
    "abbr",
    "code",
    "kbd",
    "samp",
    "var",
    "time",
    "span",
    "img",
    "picture",
    "source",
    "video",
    "audio",
    "br",
    "hr",
];

const WHITELIST_SKIP_TAGS: &[&str] = &[
    "nav", "aside", "script", "style", "noscript", "iframe", "svg", "ins",
];

/// Per-tag attribute whitelist for the parity serializer.
fn whitelist_attrs(tag: &str) -> &'static [&'static str] {
    match tag {
        "a" => &["href", "title"],
        "img" => &["src", "alt", "width", "height"],
        "source" => &["src", "srcset", "type", "media"],
        "td" => &["colspan", "rowspan"],
        "th" => &["colspan", "rowspan", "scope"],
        "time" => &["datetime"],
        "blockquote" | "q" => &["cite"],
        "col" | "colgroup" => &["span"],
        "ol" => &["start", "type", "reversed"],
        "code" => &["class"],
        _ => &[],
    }
}

struct Rendered {
    html: String,
    text_length: usize,
}

impl Rendered {
    fn empty() -> Self {
        Self {
            html: String::new(),
            text_length: 0,
        }
    }
}

// ---- escaping ---------------------------------------------------------------------

fn escape_text(text: &str) -> String {
    html_escape::encode_text(text).into_owned()
}

fn escape_attr(value: &str) -> String {
    html_escape::encode_double_quoted_attribute(value).into_owned()
}

// ---- table caps -------------------------------------------------------------------

fn table_is_oversized(table: &NodeRef) -> bool {
    select_all(table, "td, th").len() > MAX_TABLE_CELLS || text_len(table) > MAX_TABLE_TEXT_LEN
}

// ---- preserve-markup serializer (doc-09 default) ----------------------------------

fn emit_preserve_children(node: &NodeRef, depth: usize) -> String {
    let mut out = String::new();
    for child in node.children() {
        if child.is_text() {
            let text = child.text();
            out.push_str(&escape_text(&text));
        } else if child.is_element() {
            out.push_str(&emit_preserve(&child, depth));
        }
    }
    out
}

fn emit_preserve(node: &NodeRef, depth: usize) -> String {
    if depth > MAX_SERIALIZE_DEPTH {
        return String::new();
    }
    let Some(tag) = tag_of(node) else {
        return String::new();
    };
    if SERIALIZE_HARD_SKIP.contains(&tag.as_str()) {
        return String::new();
    }

    let mut out = String::new();
    out.push('<');
    out.push_str(&tag);
    for attr in node.attrs() {
        let name: &str = &attr.name.local;
        let value: &str = &attr.value;
        out.push(' ');
        out.push_str(name);
        out.push_str("=\"");
        out.push_str(&escape_attr(value));
        out.push('"');
    }

    if VOID_TAGS.contains(&tag.as_str()) {
        out.push('>');
        return out;
    }

    out.push('>');
    if tag == "table" && table_is_oversized(node) {
        // Honor the resource caps: emit the table shell, drop its runaway contents.
        out.push_str("</table>");
        return out;
    }
    out.push_str(&emit_preserve_children(node, depth + 1));
    out.push_str("</");
    out.push_str(&tag);
    out.push('>');
    out
}

/// Preserve-markup serialize: original tags + all attributes (escaped), hard-skipping
/// only `script`/`style`/`noscript`/`iframe`. An `html`/`body` root is unwrapped so
/// the output is a content fragment, not a document wrapper.
pub fn serialize_preserve(root: &NodeRef) -> String {
    match tag_of(root).as_deref() {
        Some("html" | "body") => emit_preserve_children(root, 1),
        _ => emit_preserve(root, 0),
    }
}

// ---- whitelist-parity serializer (reference-parity mode only) ---------------------

fn emit_whitelist_attrs(el: &NodeRef, tag: &str, opts: &CoreOptions) -> String {
    let mut out = String::new();
    for name in whitelist_attrs(tag) {
        if tag == "a" && *name == "href" && !opts.include_links {
            continue;
        }
        let Some(value) = el.attr(name) else { continue };
        if value.is_empty() {
            continue;
        }
        out.push(' ');
        out.push_str(name);
        out.push_str("=\"");
        out.push_str(&escape_attr(&value));
        out.push('"');
    }
    out
}

fn emit_whitelist_children(
    node: &NodeRef,
    opts: &CoreOptions,
    depth: usize,
    inside: bool,
) -> String {
    let mut out = String::new();
    for child in node.children() {
        if child.is_text() {
            let text = child.text();
            out.push_str(&escape_text(&text));
        } else if child.is_element() {
            out.push_str(&emit_whitelist(&child, opts, depth, inside));
        }
    }
    out
}

fn emit_whitelist(el: &NodeRef, opts: &CoreOptions, depth: usize, inside: bool) -> String {
    if depth > MAX_SERIALIZE_DEPTH {
        return String::new();
    }
    let Some(tag) = tag_of(el) else {
        return String::new();
    };
    if WHITELIST_SKIP_TAGS.contains(&tag.as_str()) {
        return String::new();
    }
    let child_inside = inside || tag == "article" || tag == "main";

    if EMIT_TAGS.contains(&tag.as_str()) {
        if tag == "a" && !opts.include_links {
            return emit_whitelist_children(el, opts, depth + 1, child_inside);
        }
        if (tag == "img" || tag == "picture" || tag == "source") && !opts.include_images {
            return String::new();
        }
        let attrs = emit_whitelist_attrs(el, &tag, opts);
        if VOID_TAGS.contains(&tag.as_str()) {
            return format!("<{tag}{attrs}>");
        }
        if tag == "table" && table_is_oversized(el) {
            return format!("<{tag}{attrs}></{tag}>");
        }
        let inner = emit_whitelist_children(el, opts, depth + 1, child_inside);
        return format!("<{tag}{attrs}>{inner}</{tag}>");
    }

    // Non-whitelisted and not skipped → unwrap (emit children, drop the tag).
    emit_whitelist_children(el, opts, depth + 1, child_inside)
}

/// Whitelist-parity serialize (the upstream rs-trafilatura emit). Reference-parity ONLY.
pub fn serialize_whitelist(root: &NodeRef, opts: &CoreOptions) -> String {
    emit_whitelist(root, opts, 0, false)
}

// ---- relocated DOM passes ---------------------------------------------------------

/// Remove `header`/`footer` elements not inside an `article`/`main` (relocated from
/// the serializer emit path). Runs on both the primary and backoff paths.
fn remove_header_footer_outside_main(root: &NodeRef) {
    for el in select_all(root, "header, footer") {
        if !has_ancestor_tag(&el, root, &["article", "main"]) {
            el.remove_from_parent();
        }
    }
}

/// Drop UNCONDITIONALLY-excluded descendants (rs `is_always_excluded_name` +
/// `itemtype*=BreadcrumbList`). Fires on both primary and backoff paths.
fn remove_always_excluded_named(root: &NodeRef, opts: &CoreOptions) {
    let mut all = all_elements(root);
    all.reverse();
    for el in all {
        if is_always_excluded_name(&el, opts) {
            el.remove_from_parent();
        }
    }
}

/// Drop GATED boilerplate-named descendants. MUST NOT run on the backoff path (the
/// doc-09 trap: it would re-empty exactly what the backoff rescues).
fn remove_boilerplate_named(root: &NodeRef, opts: &CoreOptions) {
    let mut all = all_elements(root);
    all.reverse();
    for el in all {
        if is_boilerplate_named(&el, opts) {
            el.remove_from_parent();
        }
    }
}

// ---- per-render clone + backoff ---------------------------------------------------

fn fragment_root(frag: &Document) -> Option<NodeRef<'_>> {
    frag.html_root().element_children().into_iter().next()
}

fn render_clone(node: &NodeRef, opts: &CoreOptions, drop_boilerplate_named: bool) -> Rendered {
    let frag = node.to_fragment();
    let Some(root) = fragment_root(&frag) else {
        return Rendered::empty();
    };

    prune_unwanted_nodes(&root, opts);
    remove_header_footer_outside_main(&root);
    // Unconditional bucket-A drops fire even on the backoff path...
    remove_always_excluded_named(&root, opts);
    // ...but the gated name filter is skipped on backoff (the doc-09 trap).
    if drop_boilerplate_named {
        remove_boilerplate_named(&root, opts);
    }
    prune_empty_elements(&root);

    // The internal TEXT twin: length measured from the kept subtree's DOM text().
    let text_length = text_len(&root);
    let html = if text_length == 0 {
        String::new()
    } else {
        match opts.emit_mode {
            EmitMode::PreserveMarkup => serialize_preserve(&root),
            EmitMode::WhitelistParity => serialize_whitelist(&root, opts),
        }
    };
    Rendered { html, text_length }
}

fn extract_from(node: &NodeRef, opts: &CoreOptions) -> Rendered {
    let filtered = render_clone(node, opts, true);
    if filtered.text_length > 0 {
        return filtered;
    }
    // Name-based boilerplate removal emptied the content — back off to the unfiltered
    // extraction (go-trafilatura's "do not delete all the content" rule).
    let unfiltered = render_clone(node, opts, false);
    if unfiltered.text_length > 0 {
        unfiltered
    } else {
        filtered
    }
}

fn apply_final_validations(result: &mut ExtractResult) {
    if result.fallback_used {
        result.warnings.push("body-fallback-used".to_string());
    }
    if result.text_length > 0 && result.text_length < 25 {
        result.warnings.push("content-very-short".to_string());
    }
}

/// Synthesize a preserve-markup result from rescued paragraph texts. Markup is
/// best-effort bare `<p>` (the documented doc-09 limitation for fallback wins); the
/// text is escaped, so the output is script-free and satisfies the FFI hygiene invariant.
fn synth_result(
    paragraphs: &[String],
    page_type: PageType,
    confidence: Option<f64>,
    tag: &str,
) -> ExtractResult {
    let mut html = String::new();
    let mut text = String::new();
    for para in paragraphs {
        if para.is_empty() {
            continue;
        }
        html.push_str("<p>");
        html.push_str(&escape_text(para));
        html.push_str("</p>");
        if !text.is_empty() {
            text.push(' ');
        }
        text.push_str(para);
    }
    let text_length = collapse_ws(&text).chars().count();
    ExtractResult {
        content_html: html,
        page_type,
        confidence,
        text_length,
        fallback_used: true,
        warnings: vec![tag.to_string()],
    }
}

/// Defaults-only robustness rescue: when the profile-driven extraction under-performs,
/// try the profile-INDEPENDENT structured rescues (JSON-LD `articleBody`, then the
/// `baseline` whole-document extraction) and keep the longer result. Self-gating —
/// re-parses `html` (basic cleaning mutates that copy) only when under-extracting, so
/// pages that extract fine are untouched (no precision regression). Never re-types the
/// page (classifier verdict preserved).
pub fn rescue_under_extraction(
    html: &str,
    page_type: PageType,
    confidence: Option<f64>,
    result: &mut ExtractResult,
) {
    if result.text_length >= MIN_EXTRACTED_TEXT {
        return;
    }
    let doc = parse(html);

    // JSON-LD articleBody (gated at MIN_STRUCTURED_BODY_LEN) — read scripts before baseline
    // strips them.
    if let Some(body) = extract_json_ld_article_body(&doc) {
        let collapsed = collapse_ws(&body);
        let len = collapsed.chars().count();
        if len >= MIN_STRUCTURED_BODY_LEN && len > result.text_length {
            *result = synth_result(&[collapsed], page_type, confidence, "json-ld-rescue");
        }
    }

    // Baseline whole-document extraction (mutates `doc`).
    let paragraphs = baseline_paragraphs(&doc);
    let baseline_len = {
        let joined = paragraphs.join(" ");
        collapse_ws(&joined).chars().count()
    };
    if baseline_len > result.text_length && baseline_len >= MIN_EXTRACTED_TEXT {
        *result = synth_result(&paragraphs, page_type, confidence, "baseline-rescue");
    }
}

/// Extract the main content, parsing `html` into a fresh document (confidence `None`).
///
/// This is total: dom_query's parser always yields a tree and every traversal is
/// stack-safe, so malformed/deeply-nested input yields an (possibly empty) result
/// rather than a panic.
#[must_use]
pub fn extract_content(html: &str, opts: &CoreOptions, page_type: PageType) -> ExtractResult {
    let doc = parse(html);
    extract_from_doc(&doc, opts, page_type, None)
}

/// Extract the main content from an ALREADY-PARSED document.
///
/// The classifier cascade classifies on this same (raw, read-only) document BEFORE
/// this runs, so one parse feeds both classify + extract. This mutates the document
/// (depth guard, cleaning), so it must run AFTER any classification.
#[must_use]
pub fn extract_from_doc(
    doc: &Document,
    opts: &CoreOptions,
    page_type: PageType,
    confidence: Option<f64>,
) -> ExtractResult {
    let Some(body) = body_or_root(doc) else {
        let mut empty = ExtractResult::empty(page_type);
        empty.confidence = confidence;
        return empty;
    };

    // Enforce the depth guard up front so no downstream recursion can overflow.
    enforce_max_depth(&body, MAX_TREE_DEPTH);
    clean_document(&body, opts);

    let content = find_content_node(&body, opts);
    let primary = extract_from(&content, opts);

    let make = |html: String, text_length: usize, fallback_used: bool| ExtractResult {
        content_html: html,
        page_type,
        confidence,
        text_length,
        fallback_used,
        warnings: Vec::new(),
    };

    let mut result = if primary.text_length < MIN_EXTRACTED_TEXT && !same_node(&content, &body) {
        let fallback = extract_from(&body, opts);
        if fallback.text_length > primary.text_length {
            make(fallback.html, fallback.text_length, true)
        } else {
            make(primary.html, primary.text_length, false)
        }
    } else {
        make(primary.html, primary.text_length, false)
    };

    apply_final_validations(&mut result);
    result
}
