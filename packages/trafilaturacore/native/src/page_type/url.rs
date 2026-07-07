// SPDX-License-Identifier: Apache-2.0
//! Stage-1 URL heuristics + the URL constant lists shared with the numeric features.
//!
//! Verbatim from rs-trafilatura `page_type/mod.rs` (NOT web-page-classifier's divergent
//! `url_heuristics.rs`), ported through the proven v1 `url-constants.ts` + `url-heuristics.ts`.
//! `extract_domain_path` strips a leading `https://` else `http://` (NOT `//`).

use crate::page_type::PageType;

pub const FORUM_DOMAINS: &[&str] = &[
    "forum.",
    "forums.",
    "community.",
    "discuss.",
    "discussion.",
    "users.",
    "bbs.",
    "reddit.com",
    "stackoverflow.com",
    "stackexchange.com",
    "gamefaqs.",
    "discourse.",
    "news.ycombinator.com",
    "quora.com",
    "lemmy.",
    "tapatalk.com",
    "webhostingtalk.com",
    "netmums.com",
    "mumsnet.com",
    "nairaland.com",
    "lobste.rs",
];

pub const FORUM_PATHS: &[&str] = &[
    "/forum",
    "/forums/",
    "/thread/",
    "/threads/",
    "/topic/",
    "/topics/",
    "/discussion/",
    "/discussions/",
    "/community/",
    "/t/",
    "/questions/",
    "/question/",
    "/comments/",
    "/talk/",
];

pub const FORUM_URL_PATTERNS: &[&str] = &["/viewtopic.php", "/showthread.php", "/item?id="];

pub const DOCS_DOMAINS: &[&str] = &[
    "docs.",
    "doc.",
    "wiki.",
    "devdocs.",
    "man7.org",
    "readthedocs.io",
    "readthedocs.org",
    "developer.hashicorp.com",
    "developer.mozilla.org",
];

pub const DOCS_PATHS: &[&str] = &[
    "/docs/",
    "/doc/",
    "/documentation/",
    "/reference/",
    "/api/",
    "/guide/",
    "/tutorial/",
    "/tutorials/",
    "/manual/",
    "/handbook/",
    "/wiki/",
    "/man-pages/",
    "/man/",
    "/concepts/",
    "/userguide/",
    "/quickstart",
    "/getting-started",
    "/book/",
    "/glossary/",
    "/tech_notes/",
];

pub const PRODUCT_PATHS: &[&str] = &["/products/", "/product/", "/shop/", "/dp/", "/ip/"];

/// Stage-1 only: `classify_url` checks these; f[5] does NOT (f[13] is a separate check).
pub const PRODUCT_DOMAINS: &[&str] = &["shop.", "store."];

pub const CATEGORY_PATHS: &[&str] = &[
    "/collections/",
    "/collection/",
    "/categories/",
    "/category/",
    "/browse/",
    "/cat/",
    "/subcategory/",
];

pub const SERVICE_PATHS: &[&str] = &[
    "/services/",
    "/service/",
    "/services.html",
    "/solutions/",
    "/solution/",
    "/offerings/",
    "/what-we-do",
];

pub const SERVICE_SLUG_PATTERNS: &[&str] = &[
    "-consulting-services",
    "-development-services",
    "-management-services",
    "-support-services",
    "-outsourcing-services",
    "-integration-services",
    "-development-company",
    "-consulting-company",
    "-ai-consulting",
    "-ai-development",
    "-ai-solutions",
];

pub const LISTING_PATH_ENDINGS: &[&str] = &[
    "/news",
    "/testimonials",
    "/coupons",
    "/issues",
    "/reviews",
    "/rankings",
    "-courses",
];

pub const LISTING_PATH_CONTAINS: &[&str] = &["/awards/", "/trending/", "/list/"];

pub const ARTICLE_PATHS: &[&str] = &[
    "/blog/",
    "/blog",
    "/news/",
    "/article/",
    "/articles/",
    "/post/",
    "/posts/",
    "/insight/",
    "/insights/",
    "/resource/",
    "/resources/",
    "/stories/",
    "/magazine/",
    "/journal/",
    "/press/",
    "/editorial/",
    "/opinion/",
    "/review/",
    "/column/",
];

pub const BLOG_SLUG_PATTERNS: &[&str] = &[
    "-ways-to-",
    "-tips-",
    "-reasons-",
    "-steps-to-",
    "-things-to-",
    "-best-",
    "-top-",
    "-essential-",
    "beginners-guide",
    "complete-guide",
    "ultimate-guide",
    "how-to-",
    "what-is-",
    "why-",
    "when-to-",
    "-vs-",
    "-versus-",
    "-comparison",
    "-checklist",
    "-trends-",
    "-strategies-",
    "-challenges-",
    "-benefits-",
    "-advantages-",
];

/// rs-trafilatura `contains_any`: ANY needle is a substring of `haystack`.
#[must_use]
pub fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack.contains(n))
}

/// rs-trafilatura `extract_domain_path` (NO `//` strip). Strips a leading `https://`
/// else `http://`, then splits at the first `/` (path KEEPS the `/`); else path = `/`.
#[must_use]
pub fn extract_domain_path(url_lower: &str) -> (String, String) {
    let rest = url_lower
        .strip_prefix("https://")
        .or_else(|| url_lower.strip_prefix("http://"))
        .unwrap_or(url_lower);
    match rest.find('/') {
        Some(slash) => (rest[..slash].to_string(), rest[slash..].to_string()),
        None => (rest.to_string(), "/".to_string()),
    }
}

/// Stage-1 classification from the URL alone. Ordered, first match wins.
#[must_use]
pub fn classify_url(url: &str) -> PageType {
    if url.is_empty() {
        return PageType::Article;
    }
    let url_lower = url.to_lowercase();
    let (domain, path) = extract_domain_path(&url_lower);

    if contains_any(&domain, FORUM_DOMAINS)
        || contains_any(&path, FORUM_PATHS)
        || contains_any(&url_lower, FORUM_URL_PATTERNS)
    {
        return PageType::Forum;
    }
    if contains_any(&domain, DOCS_DOMAINS) || contains_any(&path, DOCS_PATHS) {
        return PageType::Documentation;
    }
    if contains_any(&path, PRODUCT_PATHS) || contains_any(&domain, PRODUCT_DOMAINS) {
        return PageType::Product;
    }
    if contains_any(&path, CATEGORY_PATHS) {
        return PageType::Category;
    }
    if contains_any(&path, SERVICE_PATHS) || contains_any(&url_lower, SERVICE_SLUG_PATTERNS) {
        return PageType::Service;
    }
    let path_trimmed = path.trim_end_matches('/');
    if LISTING_PATH_ENDINGS
        .iter()
        .any(|p| path_trimmed.ends_with(p))
        || contains_any(&path, LISTING_PATH_CONTAINS)
    {
        return PageType::Listing;
    }
    if contains_any(&path, ARTICLE_PATHS) || contains_any(&url_lower, BLOG_SLUG_PATTERNS) {
        return PageType::Article;
    }
    PageType::Article
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_url_is_article() {
        assert_eq!(classify_url(""), PageType::Article);
    }

    #[test]
    fn forum_domain_path_pattern() {
        assert_eq!(classify_url("https://bbs.archlinux.org/"), PageType::Forum);
        assert_eq!(classify_url("https://forum.example.com/"), PageType::Forum);
        assert_eq!(
            classify_url("https://example.com/threads/123"),
            PageType::Forum
        );
    }

    #[test]
    fn docs_before_article() {
        assert_eq!(
            classify_url("https://docs.aws.amazon.com/"),
            PageType::Documentation
        );
        assert_eq!(
            classify_url("https://example.com/docs/guide/"),
            PageType::Documentation
        );
    }

    #[test]
    fn product_before_category() {
        assert_eq!(
            classify_url("https://example.com/products/widget"),
            PageType::Product
        );
        assert_eq!(classify_url("https://shop.example.com/"), PageType::Product);
    }

    #[test]
    fn category_is_collection() {
        assert_eq!(
            classify_url("https://example.com/collections/all"),
            PageType::Category
        );
        assert_eq!(
            classify_url("https://example.com/category/shoes"),
            PageType::Category
        );
    }

    #[test]
    fn service_path_and_slug() {
        assert_eq!(
            classify_url("https://example.com/services/"),
            PageType::Service
        );
        assert_eq!(
            classify_url("https://example.com/ai-consulting-services"),
            PageType::Service
        );
    }

    #[test]
    fn listing_endings_and_contains() {
        assert_eq!(classify_url("https://example.com/news"), PageType::Listing);
        assert_eq!(
            classify_url("https://example.com/awards/2024"),
            PageType::Listing
        );
    }

    #[test]
    fn article_path_and_blog_slug() {
        assert_eq!(
            classify_url("https://example.com/blog/my-post"),
            PageType::Article
        );
        assert_eq!(
            classify_url("https://example.com/10-tips-for-x"),
            PageType::Article
        );
    }

    #[test]
    fn unmatched_and_malformed_default_to_article() {
        assert_eq!(classify_url("https://example.com/"), PageType::Article);
        assert_eq!(classify_url("https:///"), PageType::Article);
    }

    #[test]
    fn extract_domain_path_no_double_slash_strip() {
        assert_eq!(
            extract_domain_path("https://example.com/a/b"),
            ("example.com".to_string(), "/a/b".to_string())
        );
        assert_eq!(
            extract_domain_path("https:///"),
            (String::new(), "/".to_string())
        );
        assert_eq!(
            extract_domain_path("example.com"),
            ("example.com".to_string(), "/".to_string())
        );
    }
}
