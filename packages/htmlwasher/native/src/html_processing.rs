// SPDX-License-Identifier: Apache-2.0
//! Bucket-B document cleaning (extraction hygiene), ported from go-trafilatura
//! `docCleaning`/`pruneHTML` via the tested v1 `clean.ts`.
//!
//! This strips ~50 tag types (script/style/noscript/iframe/svg/form/nav/aside/footer
//! /head/…) and HTML comments from the whole body BEFORE scoring — the pre-scoring
//! side effect that guarantees `<script>`/`<style>` never reach the serializer. It
//! is NOT a sanitization pass (that is TS-owned, doc-09 bucket C); rs-trafilatura's
//! dead `post_cleaning` attribute stripper is intentionally NOT ported.
//!
//! Ordering is deterministic (ordered `Vec`s, never hash-set iteration) for
//! cross-platform reproducibility.

use dom_query::NodeRef;

use crate::dom::{all_elements, select_all, tag_of};
use crate::options::{CoreOptions, Focus};
use crate::tags::{
    EMPTY_TAGS_TO_REMOVE, IMAGE_CLEAN_TAGS, TABLE_TAGS_TO_STRIP, TAGS_TO_CLEAN, TAGS_TO_STRIP,
};

/// Maximum tree depth. rs-trafilatura's `max_tree_depth` option is never enforced on
/// the live path; here it IS enforced up front so no downstream recursion (dom_query's
/// recursive `strip_elements`, the serializer) can overflow the stack on pathological
/// input. Real HTML nests ~10-100 deep; 512 is generous headroom.
pub const MAX_TREE_DEPTH: usize = 512;

/// Iteratively cap the tree at [`MAX_TREE_DEPTH`] by removing everything deeper. Uses
/// an explicit heap stack (never recurses), so it is itself safe on deep input, and it
/// bounds every subsequent recursive DOM walk. Never panics.
pub fn enforce_max_depth(root: &NodeRef, max_depth: usize) {
    let mut stack: Vec<(NodeRef, usize)> = root.children().into_iter().map(|c| (c, 1)).collect();
    while let Some((node, depth)) = stack.pop() {
        if depth > max_depth {
            node.remove_from_parent();
            continue;
        }
        for child in node.children() {
            stack.push((child, depth + 1));
        }
    }
}

/// Remove every instance of a tag including its children.
fn remove_elements(root: &NodeRef, tag: &str) {
    for el in select_all(root, tag) {
        el.remove_from_parent();
    }
}

/// Remove all HTML comment nodes in the subtree.
///
/// This is the REAL comment-strip pass: rs-trafilatura's `dom.rs::remove_comments`
/// is a no-op stub, but bucket-B cleaning requires comments gone.
fn remove_comments(root: &NodeRef) {
    for node in root.descendants() {
        if node.is_comment() {
            node.remove_from_parent();
        }
    }
}

/// Delete empty instances of the prune-able tags (go `pruneHTML`).
pub fn prune_empty_elements(root: &NodeRef) {
    let mut all = all_elements(root);
    all.reverse();
    for el in all {
        let Some(tag) = tag_of(&el) else { continue };
        if !EMPTY_TAGS_TO_REMOVE.contains(&tag.as_str()) {
            continue;
        }
        if el.first_child().is_none() {
            el.remove_from_parent();
        }
    }
}

fn paragraph_count(root: &NodeRef) -> usize {
    select_all(root, "p").len()
}

/// Push `tag` onto an ordered list if not already present (dedup, order-preserving).
fn push_unique<'a>(list: &mut Vec<&'a str>, tag: &'a str) {
    if !list.contains(&tag) {
        list.push(tag);
    }
}

/// Clean the document by discarding unwanted elements (go `docCleaning`). Strips the
/// "tags to strip" (keeping children), removes the "tags to clean" (with children),
/// drops HTML comments, and prunes empty elements. In recall mode it backs off the
/// clean pass if it would delete every `<p>`.
pub fn clean_document(root: &NodeRef, opts: &CoreOptions) {
    let mut cleaning_list: Vec<&str> = TAGS_TO_CLEAN.to_vec();
    let mut stripping_list: Vec<&str> = TAGS_TO_STRIP.to_vec();

    if opts.exclude_tables {
        for t in TABLE_TAGS_TO_STRIP {
            push_unique(&mut cleaning_list, t);
        }
    }
    if opts.include_images {
        cleaning_list.retain(|t| !IMAGE_CLEAN_TAGS.contains(t));
        stripping_list.retain(|t| *t != "img");
    }
    if opts.comments_are_content {
        // Forums keep comment widgets; do not strip the structural tags that host them.
        cleaning_list.retain(|t| *t != "form");
    }

    // Profile: never strip/clean preserved tags (e.g. forum `<form>`).
    for tag in opts.preserve_tags {
        cleaning_list.retain(|t| t != tag);
        stripping_list.retain(|t| t != tag);
    }

    // Profile: drop page-type-specific boilerplate by CSS selector first.
    for selector in opts.boilerplate_selectors {
        for el in select_all(root, selector) {
            el.remove_from_parent();
        }
    }

    // Unwrap the strip list (remove the tag, keep its children). dom_query's
    // `strip_elements` is the correct primitive: its `unwrap_node` instead removes a
    // node's PARENT, which corrupts the tree — never use it for tag stripping.
    root.strip_elements(&stripping_list);

    if opts.focus == Focus::Recall && paragraph_count(root) > 0 {
        let backup = root.inner_html().to_string();
        for tag in &cleaning_list {
            remove_elements(root, tag);
        }
        if paragraph_count(root) == 0 {
            root.set_html(backup);
        }
    } else {
        for tag in &cleaning_list {
            remove_elements(root, tag);
        }
    }

    remove_comments(root);
    prune_empty_elements(root);
}
