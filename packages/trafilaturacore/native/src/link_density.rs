// SPDX-License-Identifier: Apache-2.0
//! Link-density heuristics, ported from go-trafilatura `html-processing.go`
//! (`collectLinkInfo`, `linkDensityTest`, `linkDensityTestTables`,
//! `deleteByLinkDensity`) via the tested v1 `clean.ts`. Precision/recall toggles
//! match `Options.Focus`.

use dom_query::NodeRef;

use crate::dom::{select_all, text_len};
use crate::options::{CoreOptions, Focus};
use crate::patterns::collapsed_len;

struct LinkInfo<'a> {
    link_length: usize,
    short_links: usize,
    non_empty: Vec<NodeRef<'a>>,
}

/// Collect link-text heuristics (go `collectLinkInfo`).
fn collect_link_info<'a>(links: &[NodeRef<'a>]) -> LinkInfo<'a> {
    let mut link_length = 0;
    let mut short_links = 0;
    let mut non_empty = Vec::new();
    for link in links {
        let len = collapsed_len(link.text().as_ref());
        if len == 0 {
            continue;
        }
        link_length += len;
        if len < 10 {
            short_links += 1;
        }
        non_empty.push(*link);
    }
    LinkInfo {
        link_length,
        short_links,
        non_empty,
    }
}

/// The verdict of a link-density test: the non-empty links plus whether the element
/// is dense enough to be boilerplate (go `linkDensityTest`).
pub struct LinkDensityVerdict<'a> {
    /// Non-empty descendant links, when the block-density branch was reached.
    pub non_empty: Vec<NodeRef<'a>>,
    /// Whether the element is link-dense boilerplate.
    pub high_density: bool,
}

/// Whether an element is link-dense enough to be boilerplate (go `linkDensityTest`).
#[must_use]
pub fn link_density_test<'a>(element: &NodeRef<'a>, opts: &CoreOptions) -> LinkDensityVerdict<'a> {
    let links = select_all(element, "a");
    if links.is_empty() {
        return LinkDensityVerdict {
            non_empty: Vec::new(),
            high_density: false,
        };
    }

    let text_length = text_len(element);

    if links.len() == 1 {
        let threshold = if opts.focus == Focus::Precision {
            10
        } else {
            100
        };
        let link_text_length = links
            .first()
            .map_or(0, |first| collapsed_len(first.text().as_ref()));
        if link_text_length > threshold && link_text_length as f64 > text_length as f64 * 0.9 {
            return LinkDensityVerdict {
                non_empty: Vec::new(),
                high_density: true,
            };
        }
    }

    let is_last = element.next_element_sibling().is_none();
    let limit = if crate::dom::is_tag(element, "p") {
        if is_last { 60 } else { 30 }
    } else if is_last {
        300
    } else {
        100
    };

    if text_length < limit {
        let info = collect_link_info(&links);
        if info.non_empty.is_empty() {
            return LinkDensityVerdict {
                non_empty: info.non_empty,
                high_density: true,
            };
        }
        let link_dense = info.link_length as f64 > text_length as f64 * 0.8
            || (info.non_empty.len() > 1
                && info.short_links as f64 / info.non_empty.len() as f64 > 0.8);
        // Python parity (`link_density_test` → `return False, mylist`): the collected
        // links are returned even when NOT dense — they power `delete_by_link_density`'s
        // backtracking branch. (go-trafilatura discards them here, deadening its
        // backtracking; rs-trafilatura's `link_density_test_with_info` matches Python.)
        return LinkDensityVerdict {
            non_empty: info.non_empty,
            high_density: link_dense,
        };
    }

    LinkDensityVerdict {
        non_empty: Vec::new(),
        high_density: false,
    }
}

/// Whether a table is link-dense boilerplate (go `linkDensityTestTables`).
#[must_use]
pub fn link_density_test_tables(table: &NodeRef) -> bool {
    let links = select_all(table, "a");
    if links.is_empty() {
        return false;
    }
    let text_length = text_len(table);
    if text_length < 200 {
        return false;
    }
    let info = collect_link_info(&links);
    if info.non_empty.is_empty() {
        return true;
    }
    if text_length < 1000 {
        info.link_length as f64 > text_length as f64 * 0.8
    } else {
        info.link_length as f64 > text_length as f64 * 0.5
    }
}

/// Remove link-dense elements of the given tags (go `deleteByLinkDensity`). When
/// `tag_names` is empty, every descendant element is a candidate.
pub fn delete_by_link_density(
    sub_tree: &NodeRef,
    opts: &CoreOptions,
    backtracking: bool,
    tag_names: &[&str],
) {
    let threshold = if opts.focus == Focus::Precision {
        200
    } else {
        100
    };
    let child_limit = if opts.focus == Focus::Precision { 1 } else { 3 };

    let candidates: Vec<NodeRef> = if tag_names.is_empty() {
        select_all(sub_tree, "*")
    } else {
        tag_names
            .iter()
            .flat_map(|t| select_all(sub_tree, t))
            .collect()
    };

    let mut to_delete: Vec<NodeRef> = Vec::new();
    for el in &candidates {
        let verdict = link_density_test(el, opts);
        if verdict.high_density {
            to_delete.push(*el);
        } else if backtracking && !verdict.non_empty.is_empty() {
            let text_length = text_len(el);
            if text_length > 0
                && text_length < threshold
                && el.element_children().len() >= child_limit
            {
                to_delete.push(*el);
            }
        }
    }

    for el in to_delete.iter().rev() {
        el.remove_from_parent();
    }
}
