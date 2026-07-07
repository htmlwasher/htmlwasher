// SPDX-License-Identifier: Apache-2.0
//! Token/word helpers for name-based boilerplate matching.
//!
//! rs-trafilatura's `patterns.rs` is a regex module; the live boilerplate-name path
//! only needs cheap token splitting, so this is implemented with char iteration
//! (the `regex` dependency is reserved for the classifier phase). Mirrors the v1
//! `tokenMatch` split on `/[^a-z0-9]+/` and the `[-_]` part split.

/// Split a lowercased class/id token into `[a-z0-9]+` runs (v1 `/[^a-z0-9]+/`).
#[must_use]
pub fn alnum_tokens(s: &str) -> Vec<&str> {
    s.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect()
}

/// Split a token on `-`/`_` boundaries (BEM/namespace parts).
#[must_use]
pub fn hyphen_parts(s: &str) -> Vec<&str> {
    s.split(['-', '_']).collect()
}

/// v1 `tokenMatch`: whole-token for words, substring for hyphenated ids.
#[must_use]
pub fn token_match(haystack: &str, token: &str) -> bool {
    if token.contains('-') {
        haystack.contains(token)
    } else {
        alnum_tokens(haystack).contains(&token)
    }
}

/// Collapse internal whitespace to a single space and trim the ends — the extraction
/// `trim` (v1 `text.replace(/\s+/g, ' ').trim()`). Uses `char::is_whitespace`; the
/// exact CPython whitespace class is a CLASSIFIER-phase parity concern, not this one.
#[must_use]
pub fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending_space = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            pending_space = !out.is_empty();
        } else {
            if pending_space {
                out.push(' ');
                pending_space = false;
            }
            out.push(ch);
        }
    }
    out
}

/// Unicode-scalar length of the whitespace-collapsed, trimmed string.
#[must_use]
pub fn collapsed_len(s: &str) -> usize {
    collapse_ws(s).chars().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapse_ws_matches_js_trim() {
        assert_eq!(collapse_ws("  a\n\t  b   c "), "a b c");
        assert_eq!(collapse_ws("   "), "");
        assert_eq!(
            collapsed_len("  hello   world "),
            "hello world".chars().count()
        );
    }

    #[test]
    fn token_match_word_vs_hyphen() {
        assert!(token_match("main-sidebar", "sidebar"));
        assert!(token_match("read-more-link", "read-more"));
        assert!(!token_match("article-content", "art"));
    }
}
