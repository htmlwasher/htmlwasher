// SPDX-License-Identifier: Apache-2.0
//! Tag catalogs for bucket-B doc cleaning + the serializers.
//!
//! Ported verbatim from go-trafilatura `settings.go` via the tested v1
//! `packages/htmlwasher/src/core/constants.ts`. Relocated OUT of rs-trafilatura's
//! dormant `extractor/tags.rs` per the PORTING-NOTES strip list.

/// Removed including their children (go `tagsToClean`).
pub const TAGS_TO_CLEAN: &[&str] = &[
    "aside", "embed", "footer", "form", "head", "iframe", "menu", "object", "script", "applet",
    "audio", "canvas", "figure", "map", "picture", "svg", "video", "area", "blink", "button",
    "datalist", "dialog", "frame", "frameset", "fieldset", "link", "input", "ins", "label",
    "legend", "marquee", "math", "menuitem", "nav", "noscript", "optgroup", "option", "output",
    "param", "progress", "rp", "rt", "rtc", "select", "source", "style", "track", "textarea",
    "time", "use",
];

/// Unwrapped (tag removed, children kept) — go `tagsToStrip`.
pub const TAGS_TO_STRIP: &[&str] = &[
    "abbr", "acronym", "address", "bdi", "bdo", "big", "cite", "data", "dfn", "font", "hgroup",
    "img", "ins", "mark", "meta", "ruby", "small", "template", "tbody", "tfoot", "thead",
];

/// Empty instances of these are pruned (go `emptyTagsToRemove`).
pub const EMPTY_TAGS_TO_REMOVE: &[&str] = &[
    "article",
    "b",
    "blockquote",
    "dd",
    "div",
    "dt",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "i",
    "li",
    "main",
    "p",
    "pre",
    "q",
    "section",
    "span",
    "strong",
];

/// Table tags stripped when `exclude_tables` is set.
pub const TABLE_TAGS_TO_STRIP: &[&str] = &["table", "td", "th", "tr"];

/// Media tags un-cleaned when `include_images` is set (deleted from the clean list).
pub const IMAGE_CLEAN_TAGS: &[&str] = &["figure", "picture", "source"];

/// The serializer hard-skip set — the zero-cost no-script FFI invariant. These NEVER
/// reach either serializer's emit path. (They are also removed doc-wide by cleaning,
/// so this is belt-and-suspenders.)
pub const SERIALIZE_HARD_SKIP: &[&str] = &["script", "style", "noscript", "iframe"];

/// HTML void elements (emitted without a closing tag / children).
pub const VOID_TAGS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];
