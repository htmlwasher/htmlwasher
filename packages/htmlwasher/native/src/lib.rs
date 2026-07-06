// SPDX-License-Identifier: Apache-2.0
//! `htmlwasher-native` — the Rust boilerplate-removal + page-type extraction core.
//!
//! A simplified fork of rs-trafilatura's LIVE extraction path (ported through the
//! tested v1 TypeScript core with the v2 doc-09 divergences applied). Rust owns
//! boilerplate removal, the extraction profiles, and (at a later phase) the page-type
//! classifier + confidence; the TypeScript layer owns the public `wash()` API,
//! sanitization, metadata, and the CLI.
//!
//! # Contract
//!
//! - The crate never panics on malformed HTML — every surface returns a `Result` or a
//!   total value.
//! - Default emit is **preserve-markup**: kept nodes keep their original tags +
//!   attributes (escaped); the ONLY hard-skip is `script`/`style`/`noscript`/`iframe`.
//!   Rust sanitizes nothing else — the TS washing stage owns all tag/attribute/scheme
//!   /CSS policy and MUST always run over [`ExtractResult::content_html`].

pub mod dom;
pub mod error;
pub mod extract;
pub mod extractor;
pub mod html_processing;
pub mod link_density;
pub mod options;
pub mod page_type;
pub mod patterns;
pub mod result;
pub mod selector;
pub mod tags;

pub use error::Error;
pub use options::{CoreOptions, EmitMode, Focus, Options};
pub use page_type::{ExtractionProfile, PageType};
pub use result::ExtractResult;

/// Extract the main content of an HTML document.
///
/// Parses `html` ONCE. When `options.page_type` is `None`, runs the 3-stage page-type
/// cascade (URL heuristics → HTML signals → the ML model) over the raw document to pick
/// the extraction profile and report `(pageType, confidence)`; when it is `Some`, that
/// type is used directly (confidence `None`, no classifier). Then removes boilerplate
/// through the node cascade and returns the kept content as HTML (preserve-markup by
/// default) plus the page type, confidence, and text length.
///
/// # Errors
///
/// Returns [`Error::ModelLoad`] if the baked classifier artifacts fail to load/validate
/// (only reachable on the auto-classify path). Extraction itself is total.
pub fn extract(html: &str, options: &Options) -> Result<ExtractResult, Error> {
    let doc = dom::parse(html);
    let (page_type, confidence) = match options.page_type {
        Some(pt) => (pt, None),
        None => {
            let url = options.url.as_deref().unwrap_or("");
            page_type::classify(&doc, url)?
        }
    };
    let core = CoreOptions::resolve_for(options, page_type);
    Ok(extract::extract_from_doc(
        &doc, &core, page_type, confidence,
    ))
}

/// Convenience wrapper: extract with default options (balanced, preserve-markup, Article).
///
/// # Errors
///
/// Propagates [`extract`]'s errors (currently none in practice).
pub fn extract_default(html: &str) -> Result<ExtractResult, Error> {
    extract(html, &Options::default())
}
