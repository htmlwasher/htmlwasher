// SPDX-License-Identifier: Apache-2.0
//! Thin structural helpers over dom_query (html5ever DOM).
//!
//! dom_query uses `Rc<RefCell>` interior mutability, so tree edits happen through
//! shared `&NodeRef`s (no `&mut`). Traversal (`descendants`, `text`, `copy_node`) is
//! iterative in dom_query, so these helpers are stack-safe on deeply nested input;
//! the only bounded recursion lives in the serializer.

use dom_query::{Document, Matcher, NodeRef};

use crate::patterns::collapsed_len;

/// Parse HTML into a document. html5ever always yields a tree (never panics), so
/// this is total — malformed input produces a best-effort tree.
#[must_use]
pub fn parse(html: &str) -> Document {
    Document::from(html)
}

/// The document `<body>`, falling back to the `<html>` root (documentElement).
#[must_use]
pub fn body_or_root(doc: &Document) -> Option<NodeRef<'_>> {
    doc.body().or_else(|| {
        let root = doc.html_root();
        if root.is_element() { Some(root) } else { None }
    })
}

/// Lowercase tag name of an element node (`None` for non-elements).
#[must_use]
pub fn tag_of(node: &NodeRef) -> Option<String> {
    node.node_name().map(|n| n.as_ref().to_ascii_lowercase())
}

/// Whether the node is an element with the given lowercase tag.
#[must_use]
pub fn is_tag(node: &NodeRef, tag: &str) -> bool {
    tag_of(node).as_deref() == Some(tag)
}

/// The raw `class` attribute value (empty when absent) — matches DOM `className`.
#[must_use]
pub fn class_of(node: &NodeRef) -> String {
    node.class().map(|c| c.to_string()).unwrap_or_default()
}

/// The raw `id` attribute value (empty when absent).
#[must_use]
pub fn id_of(node: &NodeRef) -> String {
    node.id_attr().map(|c| c.to_string()).unwrap_or_default()
}

/// The lowercased attribute value (empty when absent).
#[must_use]
pub fn attr_lower(node: &NodeRef, name: &str) -> String {
    node.attr(name)
        .map(|v| v.to_ascii_lowercase())
        .unwrap_or_default()
}

/// `class` + `id` joined with a space (matches v1 `classId`).
#[must_use]
pub fn class_id(node: &NodeRef) -> String {
    format!("{} {}", class_of(node), id_of(node))
}

/// Trimmed, whitespace-collapsed text length (Unicode scalars) of the node's subtree.
/// This is the DOM-`textContent` measurement — never a regex tag-strip.
#[must_use]
pub fn text_len(node: &NodeRef) -> usize {
    collapsed_len(node.text().as_ref())
}

/// All descendant elements (document order) matching a CSS selector, scoped to `root`
/// (mirrors `root.querySelectorAll(sel)`). Invalid selectors yield an empty vec — never a panic.
#[must_use]
pub fn select_all<'a>(root: &NodeRef<'a>, sel: &str) -> Vec<NodeRef<'a>> {
    match Matcher::new(sel) {
        Ok(matcher) => root
            .descendants()
            .into_iter()
            .filter(|n| n.is_match(&matcher))
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// The first descendant element matching a CSS selector (mirrors `root.querySelector`).
#[must_use]
pub fn select_first<'a>(root: &NodeRef<'a>, sel: &str) -> Option<NodeRef<'a>> {
    match Matcher::new(sel) {
        Ok(matcher) => root
            .descendants()
            .into_iter()
            .find(|n| n.is_match(&matcher)),
        Err(_) => None,
    }
}

/// All descendant elements (document order), including non-matching by tag filtering out
/// text/comment nodes. Equivalent to `getElementsByTagName(root, '*')`.
#[must_use]
pub fn all_elements<'a>(root: &NodeRef<'a>) -> Vec<NodeRef<'a>> {
    root.descendants()
        .into_iter()
        .filter(NodeRef::is_element)
        .collect()
}

/// Whether two node refs point at the same tree node.
#[must_use]
pub fn same_node(a: &NodeRef, b: &NodeRef) -> bool {
    a.id == b.id
}

/// Whether `node` has an ancestor (up to and including `stop`) matching one of `tags`.
#[must_use]
pub fn has_ancestor_tag(node: &NodeRef, stop: &NodeRef, tags: &[&str]) -> bool {
    let mut current = node.parent();
    while let Some(parent) = current {
        if let Some(tag) = tag_of(&parent) {
            if tags.contains(&tag.as_str()) {
                return true;
            }
        }
        if same_node(&parent, stop) {
            break;
        }
        current = parent.parent();
    }
    false
}
