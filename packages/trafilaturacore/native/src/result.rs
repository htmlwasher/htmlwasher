// SPDX-License-Identifier: Apache-2.0
//! The extraction result surfaced to callers (and, at Phase BIND, to JS).

use serde::{Deserialize, Serialize};

use crate::page_type::PageType;

/// The result of extracting the main content of a document.
///
/// `content_html` is the boilerplate-free markup of the kept nodes (preserve-markup
/// by default: original tags + attributes, script-free but otherwise UNSANITIZED —
/// the TS cleaning stage owns sanitization and MUST always run over this).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractResult {
    /// The extracted main-content HTML (empty string when nothing was extractable).
    pub content_html: String,
    /// The resolved page type (defaults to `Article` when no classifier/override ran).
    pub page_type: PageType,
    /// Classification confidence — `None` this phase (the ML cascade lands at Phase CLASSIFY).
    pub confidence: Option<f64>,
    /// Trimmed text length (Unicode scalar values) of the extracted content, measured
    /// from the DOM `text()` of the kept subtree (never by regex tag-stripping).
    pub text_length: usize,
    /// True when the primary selection came up short and the whole-body fallback won.
    pub fallback_used: bool,
    /// Non-fatal diagnostics (min/max length notes, etc.).
    pub warnings: Vec<String>,
}

impl ExtractResult {
    /// An empty result for the given page type (no content extractable).
    #[must_use]
    pub fn empty(page_type: PageType) -> Self {
        Self {
            content_html: String::new(),
            page_type,
            confidence: None,
            text_length: 0,
            fallback_used: false,
            warnings: Vec::new(),
        }
    }
}
