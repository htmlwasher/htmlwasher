// SPDX-License-Identifier: Apache-2.0
//! Content selection + name-based boilerplate discard (the live `selector/` subset).
//!
//! Only the LIVE rs-trafilatura selector path is ported: `content` (the node cascade),
//! `discard` (the boilerplate-name predicates), and `utils` (rule matching). The
//! dormant go-style `precision`/`comments`/`meta` modules and discard.rs's
//! precision/teaser rules are intentionally NOT ported.

pub mod content;
pub mod discard;
pub mod utils;
