// SPDX-License-Identifier: Apache-2.0
//! napi-rs v3 boundary — a thin wrapper over the crate's pure-Rust [`crate::extract`].
//!
//! Exposes `extract` (async, on the libuv threadpool via napi `AsyncTask` — never
//! blocks the event loop) and `extractSync` to the `@htmlwasher/native` package
//! (consumed later only by `pipeline.ts`). Typed crate errors map to JS exceptions;
//! nothing here panics.
//!
//! This module sits behind the `napi` cargo feature (default OFF) so `cargo test` /
//! `cargo build` / `cargo clippy` build the pure-Rust `lib` (and all its test binaries)
//! with NO Node-API symbols; only `napi build --features napi` compiles it into the
//! cdylib addon (napi-build links it with `-undefined dynamic_lookup`).
//!
//! The `pageType`/`focus` fields are typed at the FFI boundary as string-literal UNIONS
//! (via `#[napi(ts_type = …)]`), not `const enum`s: the frozen public API is a plain
//! string union with no TS enums, AND bundlers (esbuild/vitest) erase `const enum`s at
//! runtime — so callers must pass the raw wire strings, which a `const enum` type rejects.
//! A `String` field + a union `ts_type` gives both the exact `.d.ts` type and working
//! runtime strings; conversion to/from the crate's Rust enums happens here.

use napi::bindgen_prelude::{AsyncTask, Result};
use napi::{Env, Task};
use napi_derive::napi;

/// The 7 page-type wire strings — used verbatim in the boundary `ts_type` annotations.
const PAGE_TYPE_TS: &str =
    "'article' | 'forum' | 'product' | 'collection' | 'listing' | 'documentation' | 'service'";

/// Options for a single extraction call. `pageType` overrides the classifier (and
/// suppresses `confidence`); `focus` tunes precision/recall; `url` feeds the cascade.
#[napi(object)]
pub struct ExtractOptions {
    #[napi(ts_type = "'article' | 'forum' | 'product' | 'collection' | 'listing' | 'documentation' | 'service'")]
    pub page_type: Option<String>,
    #[napi(ts_type = "'precision' | 'balanced' | 'recall'")]
    pub focus: Option<String>,
    pub url: Option<String>,
}

/// The extraction result. `contentHtml` is the preserve-markup output (script-free but
/// otherwise UNSANITIZED — the TS washing stage owns sanitization). `confidence` is
/// omitted when `pageType` was overridden.
#[napi(object)]
pub struct ExtractResult {
    pub content_html: String,
    #[napi(ts_type = "'article' | 'forum' | 'product' | 'collection' | 'listing' | 'documentation' | 'service'")]
    pub page_type: String,
    pub confidence: Option<f64>,
    pub text_length: u32,
    pub fallback_used: bool,
    pub warnings: Vec<String>,
}

/// Parse a wire page-type string into the crate enum (accepts the `category` alias).
fn parse_page_type(s: &str) -> Result<crate::PageType> {
    Ok(match s {
        "article" => crate::PageType::Article,
        "forum" => crate::PageType::Forum,
        "product" => crate::PageType::Product,
        "collection" | "category" => crate::PageType::Category,
        "listing" => crate::PageType::Listing,
        "documentation" | "docs" => crate::PageType::Documentation,
        "service" => crate::PageType::Service,
        other => {
            return Err(napi::Error::from_reason(format!(
                "invalid pageType {other:?}; expected one of {PAGE_TYPE_TS}"
            )));
        }
    })
}

/// The crate enum → its wire string (`Category` serializes as `"collection"`).
fn page_type_to_wire(pt: crate::PageType) -> &'static str {
    match pt {
        crate::PageType::Article => "article",
        crate::PageType::Forum => "forum",
        crate::PageType::Product => "product",
        crate::PageType::Category => "collection",
        crate::PageType::Listing => "listing",
        crate::PageType::Documentation => "documentation",
        crate::PageType::Service => "service",
    }
}

/// Parse a wire focus string into the crate enum.
fn parse_focus(s: &str) -> Result<crate::Focus> {
    Ok(match s {
        "precision" => crate::Focus::Precision,
        "balanced" => crate::Focus::Balanced,
        "recall" => crate::Focus::Recall,
        other => {
            return Err(napi::Error::from_reason(format!(
                "invalid focus {other:?}; expected 'precision' | 'balanced' | 'recall'"
            )));
        }
    })
}

fn build_options(options: Option<ExtractOptions>) -> Result<crate::Options> {
    let mut core = crate::Options::default();
    if let Some(opts) = options {
        if let Some(focus) = opts.focus {
            core.focus = parse_focus(&focus)?;
        }
        core.page_type = match opts.page_type {
            Some(s) => Some(parse_page_type(&s)?),
            None => None,
        };
        core.url = opts.url;
    }
    Ok(core)
}

fn run(html: &str, options: Option<ExtractOptions>) -> Result<ExtractResult> {
    let opts = build_options(options)?;
    let result =
        crate::extract(html, &opts).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    Ok(ExtractResult {
        content_html: result.content_html,
        page_type: page_type_to_wire(result.page_type).to_string(),
        confidence: result.confidence,
        text_length: u32::try_from(result.text_length).unwrap_or(u32::MAX),
        fallback_used: result.fallback_used,
        warnings: result.warnings,
    })
}

/// The libuv-threadpool task backing the async `extract`.
pub struct ExtractTask {
    html: String,
    options: Option<ExtractOptions>,
}

impl Task for ExtractTask {
    type Output = ExtractResult;
    type JsValue = ExtractResult;

    fn compute(&mut self) -> Result<Self::Output> {
        run(&self.html, self.options.take())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Extract the main content of an HTML document (async — runs on the libuv threadpool).
///
/// # Errors
/// Rejects the promise with a JS `Error` on an invalid `pageType`/`focus` string or if
/// the classifier artifacts fail to load.
#[napi(ts_return_type = "Promise<ExtractResult>")]
pub fn extract(html: String, options: Option<ExtractOptions>) -> AsyncTask<ExtractTask> {
    AsyncTask::new(ExtractTask { html, options })
}

/// Extract the main content of an HTML document synchronously (for scripting).
///
/// # Errors
/// Throws a JS `Error` on an invalid `pageType`/`focus` string or if the classifier
/// artifacts fail to load.
#[napi(js_name = "extractSync")]
pub fn extract_sync(html: String, options: Option<ExtractOptions>) -> Result<ExtractResult> {
    run(&html, options)
}
