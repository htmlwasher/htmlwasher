// SPDX-License-Identifier: Apache-2.0
//! Typed errors for the extraction core.
//!
//! The crate must never panic on malformed HTML (napi will map these to JS
//! exceptions at Phase BIND). All fallible surfaces return [`Error`]; extraction
//! itself is total in practice (dom_query's parser always yields a tree), but the
//! type is here so the FFI boundary can surface failures without unwinding.

use thiserror::Error;

/// Errors produced by the extraction core.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum Error {
    /// An option value could not be parsed (e.g. an unknown page type or focus).
    #[error("invalid option: {0}")]
    InvalidOption(String),

    /// The input tree exceeded the configured depth guard.
    #[error("input tree too deeply nested (limit {limit})")]
    TooDeep {
        /// The depth limit that was exceeded.
        limit: usize,
    },
}
