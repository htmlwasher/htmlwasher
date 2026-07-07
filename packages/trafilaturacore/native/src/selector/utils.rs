// SPDX-License-Identifier: Apache-2.0
//! Content-rule matching, ported from go-trafilatura `internal/selector/content.go`
//! predicates via the tested v1 `main-content.ts::matchesRule`.

use dom_query::NodeRef;

use crate::dom::{class_of, id_of, tag_of};

/// A content-node selector predicate. Each field is a set of candidate substrings/
/// equalities; a rule matches when ANY predicate matches. Matching mirrors the v1
/// `matchesRule`: `eq_*` are whole-string (case-sensitive) equalities, `contains_*`
/// are case-sensitive substrings, `contains_lower_*` are case-insensitive substrings.
pub struct ContentRule {
    /// Allowed tag names (empty = only `bare_tag` applies).
    pub tags: &'static [&'static str],
    /// Bare tag match with no class/id predicate (e.g. `<main>`/`<article>`).
    pub bare_tag: &'static [&'static str],
    /// Exact `class` equalities.
    pub eq_class: &'static [&'static str],
    /// Exact `id` equalities.
    pub eq_id: &'static [&'static str],
    /// Exact `role` equalities.
    pub eq_role: &'static [&'static str],
    /// Case-sensitive `class` substrings.
    pub contains_class: &'static [&'static str],
    /// Case-sensitive `id` substrings.
    pub contains_id: &'static [&'static str],
    /// Case-insensitive `class` substrings.
    pub contains_lower_class: &'static [&'static str],
    /// Case-insensitive `id` substrings.
    pub contains_lower_id: &'static [&'static str],
    /// `itemprop` equalities.
    pub itemprop: &'static [&'static str],
    /// `class` `starts-with` predicates.
    pub starts_class: &'static [&'static str],
    /// `id` `starts-with` predicates.
    pub starts_id: &'static [&'static str],
    /// `role` `starts-with` predicates.
    pub starts_role: &'static [&'static str],
}

impl ContentRule {
    /// Whether `el` matches this rule.
    #[must_use]
    pub fn matches(&self, el: &NodeRef) -> bool {
        let Some(tag) = tag_of(el) else { return false };
        if !self.tags.contains(&tag.as_str()) {
            return self.bare_tag.contains(&tag.as_str());
        }

        let class = class_of(el);
        let id = id_of(el);
        let class_lower = class.to_ascii_lowercase();
        let id_lower = id.to_ascii_lowercase();
        let role = el.attr("role").map(|r| r.to_string()).unwrap_or_default();
        let itemprop = el
            .attr("itemprop")
            .map(|r| r.to_string())
            .unwrap_or_default();

        self.eq_class.contains(&class.as_str())
            || self.eq_id.contains(&id.as_str())
            || self.eq_role.contains(&role.as_str())
            || self.contains_class.iter().any(|s| class.contains(s))
            || self.contains_id.iter().any(|s| id.contains(s))
            || self
                .contains_lower_class
                .iter()
                .any(|s| class_lower.contains(&s.to_ascii_lowercase()))
            || self
                .contains_lower_id
                .iter()
                .any(|s| id_lower.contains(&s.to_ascii_lowercase()))
            || self.itemprop.contains(&itemprop.as_str())
            || self.starts_class.iter().any(|s| class.starts_with(s))
            || self.starts_id.iter().any(|s| id.starts_with(s))
            || self.starts_role.iter().any(|s| role.starts_with(s))
    }
}

/// A constructor with every field defaulting to empty, so rule tables stay readable.
#[must_use]
pub const fn rule() -> ContentRule {
    ContentRule {
        tags: &[],
        bare_tag: &[],
        eq_class: &[],
        eq_id: &[],
        eq_role: &[],
        contains_class: &[],
        contains_id: &[],
        contains_lower_class: &[],
        contains_lower_id: &[],
        itemprop: &[],
        starts_class: &[],
        starts_id: &[],
        starts_role: &[],
    }
}
