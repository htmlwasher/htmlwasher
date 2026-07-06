// SPDX-License-Identifier: Apache-2.0
//! Main-content selection cascade, ported from the tested v1 `main-content.ts`
//! (itself go-trafilatura `content.go` content rules → semantic → readability scoring).

use dom_query::NodeRef;

use crate::dom::{all_elements, select_all, select_first, text_len};
use crate::link_density::link_density_test;
use crate::options::CoreOptions;
use crate::selector::utils::{ContentRule, rule};

/// Minimum text length (Unicode scalars) for a selector match to win outright.
const MIN_SELECTOR_CONTENT: usize = 100;

/// Reject a scoring winner covering under this fraction (numerator/denominator) of the
/// body text (rs-trafilatura `extract.rs` "coverage < 0.3" guard): the selection is
/// likely a fragment of flat-body content (e.g. one small div among thousands of
/// body-level `<p>`s); return `None` so the cascade falls back to the body floor.
const MIN_SCORING_COVERAGE_NUM: usize = 3;
const MIN_SCORING_COVERAGE_DEN: usize = 10;

const ARTICLE_DIV_MAIN_SECTION: &[&str] = &["article", "div", "main", "section"];

/// Content-node selector rules, tried in order (go `contentRule1..5`).
fn content_rules() -> [ContentRule; 5] {
    [
        // contentRule1 — canonical article-body classes/ids.
        ContentRule {
            tags: ARTICLE_DIV_MAIN_SECTION,
            eq_class: &["post", "entry"],
            eq_id: &["articleContent"],
            contains_class: &[
                "post-text",
                "post_text",
                "post-body",
                "post-entry",
                "postentry",
                "post-content",
                "post_content",
                "post_inner_wrapper",
                "article-text",
                "entry-content",
                "article-content",
                "article__content",
                "article-body",
                "article__body",
                "ArticleContent",
                "page-content",
                "text-content",
                "body-text",
                "article__container",
                "art-content",
            ],
            contains_id: &[
                "entry-content",
                "article-content",
                "article__content",
                "article-body",
                "article__body",
                "body-text",
                "art-content",
            ],
            contains_lower_class: &["postcontent", "articletext", "articlebody"],
            contains_lower_id: &["articlebody"],
            itemprop: &["articleBody"],
            ..rule()
        },
        // contentRule2 — any bare <article>.
        ContentRule {
            bare_tag: &["article"],
            ..rule()
        },
        // contentRule3 — story/blog/single-content classes, plus role=article.
        ContentRule {
            tags: ARTICLE_DIV_MAIN_SECTION,
            eq_class: &["postarea", "art-postcontent", "text", "cell", "story"],
            eq_id: &["article", "story"],
            eq_role: &["article"],
            starts_id: &["primary"],
            starts_class: &["article "],
            contains_class: &[
                "post-bodycopy",
                "storycontent",
                "story-content",
                "theme-content",
                "blog-content",
                "section-content",
                "single-content",
                "single-post",
                "main-column",
                "wpb_text_column",
                "story-body",
                "field-body",
            ],
            contains_id: &["story-body"],
            contains_lower_class: &["fulltext"],
            ..rule()
        },
        // contentRule4 — content-main / main-content / content-body.
        ContentRule {
            tags: ARTICLE_DIV_MAIN_SECTION,
            eq_class: &["content"],
            eq_id: &["content"],
            contains_class: &[
                "content-main",
                "content_main",
                "content-body",
                "content__body",
            ],
            contains_id: &["content-main", "content-body", "contentBody"],
            contains_lower_class: &["main-content", "page-content"],
            ..rule()
        },
        // contentRule5 — anything starting with "main", plus the bare <main>.
        ContentRule {
            tags: &["article", "div", "section"],
            starts_class: &["main"],
            starts_id: &["main"],
            starts_role: &["main"],
            bare_tag: &["main"],
            ..rule()
        },
    ]
}

fn find_by_profile_selectors<'a>(body: &NodeRef<'a>, selectors: &[&str]) -> Option<NodeRef<'a>> {
    for selector in selectors {
        if let Some(m) = select_first(body, selector) {
            if text_len(&m) >= MIN_SELECTOR_CONTENT {
                return Some(m);
            }
        }
    }
    None
}

fn find_by_selectors<'a>(body: &NodeRef<'a>) -> Option<NodeRef<'a>> {
    let all = all_elements(body);
    let mut best: Option<NodeRef<'a>> = None;
    let mut best_len = 0;
    for content_rule in content_rules() {
        for el in &all {
            if !content_rule.matches(el) {
                continue;
            }
            let len = text_len(el);
            if len >= MIN_SELECTOR_CONTENT {
                return Some(*el);
            }
            if len > best_len {
                best = Some(*el);
                best_len = len;
            }
            break; // first match for this rule, like the Go `[1]`
        }
    }
    best
}

fn find_by_semantic<'a>(body: &NodeRef<'a>) -> Option<NodeRef<'a>> {
    for selector in ["article", "main", "[role=\"main\"]"] {
        let matches = select_all(body, selector);
        let mut best: Option<NodeRef<'a>> = None;
        let mut best_len = 0;
        for el in matches {
            let len = text_len(&el);
            if len > best_len {
                best = Some(el);
                best_len = len;
            }
        }
        if best.is_some() && best_len >= MIN_SELECTOR_CONTENT {
            return best;
        }
    }
    None
}

fn find_by_scoring<'a>(body: &NodeRef<'a>, opts: &CoreOptions) -> Option<NodeRef<'a>> {
    let candidates = select_all(body, "div, section, article, main, td");
    let mut best: Option<NodeRef<'a>> = None;
    let mut best_score = 0.0_f64;

    for el in candidates {
        let paragraphs = select_all(&el, "p");
        if paragraphs.is_empty() {
            continue;
        }
        let para_text: usize = paragraphs.iter().map(text_len).sum();
        if para_text == 0 {
            continue;
        }
        let high_density = link_density_test(&el, opts).high_density;
        let total = text_len(&el);
        let link_ratio = if total > 0 {
            1.0 - para_text as f64 / total as f64
        } else {
            1.0
        };
        let score =
            para_text as f64 * (if high_density { 0.2 } else { 1.0 }) * (1.0 - link_ratio.min(0.9));
        if score > best_score {
            best = Some(el);
            best_score = score;
        }
    }
    // Coverage guard (rs-trafilatura): a winner covering < 3/10 of the body text is a
    // fragment, not the main content — reject it and let the caller use the body floor.
    if let Some(ref el) = best {
        let body_len = text_len(body);
        if body_len > 0
            && text_len(el) * MIN_SCORING_COVERAGE_DEN < body_len * MIN_SCORING_COVERAGE_NUM
        {
            return None;
        }
    }
    best
}

/// Select the main-content element. Cascade: profile selectors → ported content
/// selectors → semantic elements → scoring (with the < 3/10 body-text coverage guard)
/// → the whole body. Never returns nothing (body is the floor).
#[must_use]
pub fn find_content_node<'a>(body: &NodeRef<'a>, opts: &CoreOptions) -> NodeRef<'a> {
    if !opts.content_selectors.is_empty() {
        if let Some(by_profile) = find_by_profile_selectors(body, opts.content_selectors) {
            return by_profile;
        }
    }

    let by_selector = find_by_selectors(body);
    if let Some(ref s) = by_selector {
        if text_len(s) >= MIN_SELECTOR_CONTENT {
            return *s;
        }
    }

    if let Some(by_semantic) = find_by_semantic(body) {
        return by_semantic;
    }

    if let Some(by_scoring) = find_by_scoring(body, opts) {
        return by_scoring;
    }

    by_selector.unwrap_or(*body)
}
