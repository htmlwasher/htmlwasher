// SPDX-License-Identifier: Apache-2.0
//! Public extraction options + the internal resolved core options.
//!
//! The public [`Options`] is the FFI-facing surface (serde-serializable). Internally
//! it is merged with the selected page-type [`ExtractionProfile`](crate::page_type::ExtractionProfile)
//! into [`CoreOptions`], which threads the profile fields (content selectors, preserve
//! tags, boilerplate selectors, and — the re-entrancy fix — `comments_are_content`)
//! explicitly rather than through any hidden thread-local state.

use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::error::Error;
use crate::page_type::PageType;

/// Precision/recall focus, mirroring trafilatura's `favor_precision`/`favor_recall`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Focus {
    /// `favor_precision`: prune more aggressively.
    Precision,
    /// Neither favored (the default).
    #[default]
    Balanced,
    /// `favor_recall`: keep more.
    Recall,
}

impl FromStr for Focus {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "precision" => Ok(Self::Precision),
            "balanced" => Ok(Self::Balanced),
            "recall" => Ok(Self::Recall),
            other => Err(Error::InvalidOption(format!("focus: {other}"))),
        }
    }
}

/// Which serializer emits the kept content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum EmitMode {
    /// doc-09 default: kept nodes emit their ORIGINAL tag + ALL attributes (escaped);
    /// the only hard-skip is `script`/`style`/`noscript`/`iframe`. Rust sanitizes
    /// nothing — the TS cleaning stage owns all tag/attribute/scheme/CSS policy.
    #[default]
    PreserveMarkup,
    /// The upstream rs-trafilatura whitelist emit (fixed tag/attribute whitelist,
    /// non-whitelisted elements unwrapped). Retained for reference-parity testing ONLY.
    WhitelistParity,
}

/// Public, FFI-facing extraction options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Options {
    /// Precision/recall focus.
    pub focus: Focus,
    /// Manual page-type override. `None` reproduces classifier-less behavior
    /// (the `Article` profile). Drives profile selection.
    pub page_type: Option<PageType>,
    /// Original page URL (reserved for the page-type cascade; unused this phase).
    pub url: Option<String>,
    /// Which serializer to use for the kept content.
    pub emit_mode: EmitMode,
    /// Keep `<a>` markup in the whitelist-parity emit (preserve-markup always keeps it).
    pub include_links: bool,
    /// Keep media (`img`/`picture`/`source`) — controls doc cleaning + the parity emit.
    pub include_images: bool,
    /// Drop tables entirely during cleaning.
    pub exclude_tables: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            focus: Focus::Balanced,
            page_type: None,
            url: None,
            emit_mode: EmitMode::PreserveMarkup,
            include_links: true,
            include_images: true,
            exclude_tables: false,
        }
    }
}

/// Internal resolved options: [`Options`] merged with the selected profile. Every
/// profile-derived field is threaded explicitly (no thread-locals).
#[derive(Debug, Clone)]
pub struct CoreOptions {
    /// Precision/recall focus.
    pub focus: Focus,
    /// Serializer selection.
    pub emit_mode: EmitMode,
    /// Keep `<a>` in the whitelist-parity emit.
    pub include_links: bool,
    /// Keep media.
    pub include_images: bool,
    /// Drop tables during cleaning.
    pub exclude_tables: bool,
    /// The re-entrancy-safe replacement for rs-trafilatura's `COMMENTS_ARE_CONTENT`
    /// thread-local: forums treat `comment*`-classed nodes as content.
    pub comments_are_content: bool,
    /// Profile content-node selectors tried before the default cascade.
    pub content_selectors: &'static [&'static str],
    /// Profile tags preserved from cleaning (e.g. forum `<form>`).
    pub preserve_tags: &'static [&'static str],
    /// Profile-specific boilerplate selectors removed during cleaning.
    pub boilerplate_selectors: &'static [&'static str],
}

impl CoreOptions {
    /// Resolve public [`Options`] against the profile for the selected (or default) page type.
    #[must_use]
    pub fn resolve(options: &Options) -> Self {
        Self::resolve_for(options, options.page_type.unwrap_or(PageType::Article))
    }

    /// Resolve public [`Options`] against a specific page type's profile (used after the
    /// classifier cascade determines the type).
    #[must_use]
    pub fn resolve_for(options: &Options, page_type: PageType) -> Self {
        let profile = page_type.extraction_profile();
        Self {
            focus: options.focus,
            emit_mode: options.emit_mode,
            include_links: options.include_links,
            include_images: options.include_images,
            exclude_tables: options.exclude_tables,
            comments_are_content: profile.comments_are_content,
            content_selectors: profile.content_selectors,
            preserve_tags: profile.preserve_tags,
            boilerplate_selectors: profile.boilerplate_selectors,
        }
    }
}
