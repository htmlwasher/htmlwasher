// SPDX-License-Identifier: Apache-2.0
//! The one live extractor submodule.
//!
//! This phase ports `prune_unwanted_nodes` (relocated here per the PORTING-NOTES,
//! reconciled to a single copy) — the link-density prune of the chosen content
//! subtree. rs-trafilatura's structured JSON-LD/Discourse/baseline rescue paths and
//! the `aggregate_sections`/`collect_repeated_items` post-passes are NOT ported this
//! phase (they were dead flags in v1; their score effect is measured at Phase
//! VALIDATE). See the report/PORTING-NOTES for the deferral.

use dom_query::NodeRef;

use crate::link_density::delete_by_link_density;
use crate::options::CoreOptions;

/// Prune link-dense sections from the chosen subtree (go `pruneUnwantedSections`,
/// simplified): remove link-heavy lists, then link-dense divs (with backtracking),
/// then headings and quotes.
pub fn prune_unwanted_nodes(sub_tree: &NodeRef, opts: &CoreOptions) {
    delete_by_link_density(sub_tree, opts, false, &["ul", "ol", "dl"]);
    delete_by_link_density(sub_tree, opts, true, &["div"]);
    delete_by_link_density(sub_tree, opts, false, &["h1", "h2", "h3", "h4", "h5", "h6"]);
    delete_by_link_density(sub_tree, opts, false, &["blockquote", "q"]);
}
