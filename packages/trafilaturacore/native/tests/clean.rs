#![allow(clippy::unwrap_used, clippy::expect_used)]
// SPDX-License-Identifier: Apache-2.0
//! Ported from v1 `core/clean.test.ts` — bucket-B doc cleaning + link-density tests.

use trafilaturacore_native::dom::{parse, select_all};
use trafilaturacore_native::html_processing::clean_document;
use trafilaturacore_native::link_density::{delete_by_link_density, link_density_test};
use trafilaturacore_native::{CoreOptions, Focus, Options};

fn core(focus: Focus) -> CoreOptions {
    CoreOptions::resolve(&Options {
        focus,
        ..Options::default()
    })
}

#[test]
fn removes_script_style_nav_footer_form_keeps_paragraphs() {
    let doc = parse(
        "<body><nav>n</nav><script>s</script><style>.a{}</style><main><p>keep me</p></main><footer>f</footer><form><input></form></body>",
    );
    let body = doc.body().expect("body");
    clean_document(&body, &core(Focus::Balanced));
    assert!(doc.select("script").nodes().is_empty());
    assert!(doc.select("style").nodes().is_empty());
    assert!(doc.select("nav").nodes().is_empty());
    assert!(doc.select("footer").nodes().is_empty());
    assert!(doc.select("form").nodes().is_empty());
    let p = doc.select("p").nodes().first().copied().expect("p");
    assert_eq!(p.text().as_ref(), "keep me");
}

#[test]
fn keeps_images_by_default() {
    let doc = parse("<body><main><p>x</p><img src=\"a.png\" alt=\"a\"></main></body>");
    let body = doc.body().expect("body");
    clean_document(&body, &core(Focus::Balanced));
    assert!(!doc.select("img").nodes().is_empty());
}

#[test]
fn removes_html_comments() {
    let doc = parse("<body><main><p>x</p><!-- secret --></main></body>");
    let body = doc.body().expect("body");
    clean_document(&body, &core(Focus::Balanced));
    assert!(!body.inner_html().as_ref().contains("secret"));
}

#[test]
fn flags_short_link_only_block_as_high_density() {
    let doc = parse("<ul><li><a href=\"/a\">x</a></li><li><a href=\"/b\">y</a></li></ul>");
    let ul = doc.select("ul").nodes().first().copied().expect("ul");
    assert!(link_density_test(&ul, &core(Focus::Balanced)).high_density);
}

#[test]
fn does_not_flag_text_rich_paragraph_with_one_link() {
    let doc = parse(
        "<p>This is a long paragraph of real content with a single <a href=\"/x\">link</a> embedded inside it for context.</p>",
    );
    let p = doc.select("p").nodes().first().copied().expect("p");
    assert!(!link_density_test(&p, &core(Focus::Balanced)).high_density);
}

#[test]
fn uses_higher_limit_for_last_p_before_whitespace_text_node() {
    // Two short links dominate; the <p> is the last ELEMENT child (a whitespace text
    // node follows), so the 60 limit applies, not 30.
    let doc = parse(
        "<div><p>x <a href=\"/a\">first link here</a> <a href=\"/b\">second link too</a></p>\n  </div>",
    );
    let p = doc.select("p").nodes().first().copied().expect("p");
    assert!(p.next_sibling().is_some());
    assert!(p.next_element_sibling().is_none());
    assert!(link_density_test(&p, &core(Focus::Balanced)).high_density);
}

#[test]
fn backtracking_removes_short_link_cluster_div() {
    // Python parity (`link_density_test` → `return False, mylist`): a short div holding
    // a cluster of non-short links is NOT high-density on its own, but the populated
    // link list lets `delete_by_link_density`'s backtracking branch prune it.
    let html = "<div><div><a href=\"/one\">first useful link</a> <span>plus some regular filler text sitting between the links</span> <a href=\"/two\">second useful link</a></div><p>real content paragraph that stays</p></div>";

    // Not link-dense, but the failing verdict carries the non-empty links.
    let doc = parse(html);
    let inner = doc
        .select("div div")
        .nodes()
        .first()
        .copied()
        .expect("inner div");
    let verdict = link_density_test(&inner, &core(Focus::Balanced));
    assert!(!verdict.high_density);
    assert!(!verdict.non_empty.is_empty());

    // Kept without backtracking...
    let doc = parse(html);
    let root = doc
        .select("body > div")
        .nodes()
        .first()
        .copied()
        .expect("outer div");
    delete_by_link_density(&root, &core(Focus::Balanced), false, &["div"]);
    assert_eq!(select_all(&root, "div").len(), 1);

    // ...removed by the backtracking pass (short text, >= 3 element children).
    let doc = parse(html);
    let root = doc
        .select("body > div")
        .nodes()
        .first()
        .copied()
        .expect("outer div");
    delete_by_link_density(&root, &core(Focus::Balanced), true, &["div"]);
    assert!(select_all(&root, "div").is_empty());
    assert!(!select_all(&root, "p").is_empty());
}

#[test]
fn removes_link_dense_list_under_subtree() {
    let doc = parse(
        "<div><p>real content here</p><ul><li><a href=\"/1\">a</a></li><li><a href=\"/2\">b</a></li><li><a href=\"/3\">c</a></li></ul></div>",
    );
    let root = doc.select("div").nodes().first().copied().expect("div");
    delete_by_link_density(&root, &core(Focus::Balanced), false, &["ul"]);
    assert!(select_all(&root, "ul").is_empty());
    assert!(!select_all(&root, "p").is_empty());
}
