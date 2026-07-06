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
/// Parses `html`, removes boilerplate through the 3-stage node cascade, and returns
/// the kept content as HTML (preserve-markup by default) plus the resolved page type
/// and text length. The `page_type` in `options` selects the extraction profile;
/// `None` reproduces classifier-less behavior (the `Article` profile).
///
/// # Errors
///
/// Currently infallible in practice — dom_query's parser always yields a tree and all
/// traversal is stack-safe — but returns [`Error`] so the FFI boundary (Phase BIND)
/// can surface option-parse and resource-guard failures without unwinding.
pub fn extract(html: &str, options: &Options) -> Result<ExtractResult, Error> {
    let page_type = options.page_type.unwrap_or(PageType::Article);
    let core = CoreOptions::resolve(options);
    Ok(extract::extract_content(html, &core, page_type))
}

/// Convenience wrapper: extract with default options (balanced, preserve-markup, Article).
///
/// # Errors
///
/// Propagates [`extract`]'s errors (currently none in practice).
pub fn extract_default(html: &str) -> Result<ExtractResult, Error> {
    extract(html, &Options::default())
}
