#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! adbar-corpus sanity gate (mirrors v1 `test/adbar-corpus.test.ts`). Runs the core
//! over a handful of real pages and asserts sensible main-content HTML. The corpus
//! lives OUTSIDE this repo (`~/r/trafilatura-sources/`), so the test skips gracefully
//! when absent (stays green in CI).
//!
//! RE-BASELINED for preserve-markup: the hygiene guarantee on the default emit is only
//! that `<script` is absent (class/style/attrs are preserved — TS cleaning sanitizes).

use std::path::PathBuf;

use trafilaturacore_native::{EmitMode, Focus, Options, PageType, extract};

// (file, minimum expected extracted-text chars, a substring that must appear)
const PAGES: &[(&str, usize, &str)] = &[
    (
        "rs-ingenieure.de.tragwerksplanung.html",
        200,
        "Tragwerksplanung",
    ),
    ("blog.python.org.html", 200, "Python"),
    ("theplanetarypress.com.forestlands.html", 1000, "forest"),
    ("netzpolitik.org.abmahnungen.html", 1000, "Männer"),
];

fn corpus_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home).join("r/trafilatura-sources/trafilatura/tests/cache");
    if dir.is_dir() { Some(dir) } else { None }
}

#[test]
fn adbar_pages_yield_sensible_preserve_markup_content() {
    let Some(dir) = corpus_dir() else {
        eprintln!("adbar corpus absent — skipping (green in CI)");
        return;
    };

    // Observability: profile selection changes the output on ≥1 real page here. The
    // precision-vs-recall knob has NO effect on these 4 clean pages (matching v1's
    // documented finding that focus barely moves this coarse set); its observable
    // effect is proven by the synthetic `mode_choice_changes_output_via_link_density_threshold`
    // and `precision_removes_boilerplate_related_block` tests in `tests/extract.rs`.
    let mut profile_changed = false;

    for &(file, min_chars, needle) in PAGES {
        let path = dir.join(file);
        let Ok(html) = std::fs::read_to_string(&path) else {
            eprintln!("missing corpus page {file} — skipping");
            continue;
        };

        let balanced = Options {
            focus: Focus::Balanced,
            ..Options::default()
        };
        let result = extract(&html, &balanced).expect("extract ok");

        assert!(
            result.text_length > min_chars,
            "{file}: text_length {} not > {min_chars}",
            result.text_length
        );
        assert!(
            result
                .content_html
                .to_lowercase()
                .contains(&needle.to_lowercase()),
            "{file}: needle {needle:?} missing"
        );
        // Preserve-markup hygiene guarantee: never a script element.
        assert!(
            !result.content_html.to_lowercase().contains("<script"),
            "{file}: leaked <script"
        );

        // Observability: profile selection and precision/recall change the output.
        let forum = extract(
            &html,
            &Options {
                page_type: Some(PageType::Forum),
                ..balanced.clone()
            },
        )
        .expect("ok")
        .content_html;
        if forum != result.content_html {
            profile_changed = true;
        }
    }

    assert!(
        profile_changed,
        "profile selection should observably change output on ≥1 page"
    );
}

#[test]
fn adbar_whitelist_parity_strips_attributes() {
    let Some(dir) = corpus_dir() else {
        return;
    };
    let path = dir.join("blog.python.org.html");
    let Ok(html) = std::fs::read_to_string(&path) else {
        return;
    };
    let parity = Options {
        emit_mode: EmitMode::WhitelistParity,
        ..Options::default()
    };
    let out = extract(&html, &parity).expect("ok").content_html;
    assert!(!out.to_lowercase().contains("<script"));
    assert!(!out.contains(" class="));
    assert!(!out.contains(" style="));
}
