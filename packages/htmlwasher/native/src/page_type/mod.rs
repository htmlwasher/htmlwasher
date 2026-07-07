// SPDX-License-Identifier: Apache-2.0
//! Page-type taxonomy + the 7 static extraction profiles.
//!
//! Ported from rs-trafilatura `src/page_type/mod.rs` (the `PageType` enum + the
//! `ExtractionProfile` constants), cross-checked against the tested v1
//! `packages/htmlwasher/src/profiles/index.ts`. The ML classifier cascade
//! (`classify_url`/`refine_with_html_signals`/`classify_ml`) is a LATER phase and
//! is intentionally NOT ported here — only the enum and the profiles it selects.

use std::str::FromStr;

use dom_query::Document;
use serde::{Deserialize, Serialize};

use crate::error::Error;

pub mod features;
pub mod gbdt;
pub mod model;
pub mod signals;
pub mod tfidf;
pub mod url;

/// The result of the 3-stage page-type cascade.
pub type Classification = (PageType, Option<f64>);

/// Run the 3-stage page-type cascade over a parsed document + URL.
///
/// Stage 1 = URL heuristics; Stage 2 = HTML-signal refinement (only ever overrides
/// `Article`); Stage 3 = the ML model. Agreement rule: `url_type != Article && ml ==
/// url_type` → `(url_type, 1.0)`; else `refined != Article && ml == refined` →
/// `(refined, 0.95)`; else `(ml_type, ml_prob)`.
///
/// # Errors
/// Returns [`Error::ModelLoad`] when the baked classifier artifacts fail to load.
pub fn classify(doc: &Document, url: &str) -> Result<Classification, Error> {
    let url_type = url::classify_url(url);
    // Stage-2 signals only ever refine `Article`, so the DOM walk is skipped otherwise.
    let refined = if url_type == PageType::Article {
        signals::refine_with_signals(url_type, &signals::extract_html_signals(doc))
    } else {
        url_type
    };

    let (ml_type, ml_conf) = model::model()?.classify_ml(doc, url);

    if url_type != PageType::Article && ml_type == url_type {
        return Ok((url_type, Some(1.0)));
    }
    if refined != PageType::Article && ml_type == refined {
        return Ok((refined, Some(0.95)));
    }
    Ok((ml_type, Some(ml_conf)))
}

/// The type of content on a web page. Seven variants; the internal `Category`
/// variant serializes to the wire string `"collection"` (and `FromStr`/serde accept
/// both `category` and `collection`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum PageType {
    /// Blog posts, news articles, editorials, guides, reviews. The default fallback.
    #[default]
    #[serde(rename = "article")]
    Article,
    /// Discussion threads, Q&A pages, community posts.
    #[serde(rename = "forum")]
    Forum,
    /// Individual product pages with descriptions, specs, pricing.
    #[serde(rename = "product")]
    Product,
    /// Product listings / collections / category browse pages. Wire string: `collection`.
    #[serde(rename = "collection", alias = "category")]
    Category,
    /// Content index pages: news feeds, catalogs, review/testimonial/award lists.
    #[serde(rename = "listing")]
    Listing,
    /// Technical documentation, API references, tutorials, wikis, man pages.
    #[serde(rename = "documentation", alias = "docs")]
    Documentation,
    /// SaaS feature pages, service descriptions, solution pages.
    #[serde(rename = "service")]
    Service,
}

impl PageType {
    /// The wire string name of this page type (`Category` → `"collection"`).
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Article => "article",
            Self::Forum => "forum",
            Self::Product => "product",
            Self::Category => "collection",
            Self::Listing => "listing",
            Self::Documentation => "documentation",
            Self::Service => "service",
        }
    }

    /// The static extraction profile for this page type.
    #[must_use]
    pub fn extraction_profile(self) -> ExtractionProfile {
        match self {
            Self::Article => ExtractionProfile::ARTICLE,
            Self::Forum => ExtractionProfile::FORUM,
            Self::Product => ExtractionProfile::PRODUCT,
            Self::Category => ExtractionProfile::CATEGORY,
            Self::Listing => ExtractionProfile::LISTING,
            Self::Documentation => ExtractionProfile::DOCUMENTATION,
            Self::Service => ExtractionProfile::SERVICE,
        }
    }
}

impl FromStr for PageType {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "article" => Ok(Self::Article),
            "forum" => Ok(Self::Forum),
            "product" => Ok(Self::Product),
            "collection" | "category" => Ok(Self::Category),
            "listing" => Ok(Self::Listing),
            "documentation" | "docs" => Ok(Self::Documentation),
            "service" => Ok(Self::Service),
            other => Err(Error::InvalidOption(format!("pageType: {other}"))),
        }
    }
}

/// Every page type, in enum order (`Category` reported as `"collection"`).
pub const ALL_PAGE_TYPES: [PageType; 7] = [
    PageType::Article,
    PageType::Forum,
    PageType::Product,
    PageType::Category,
    PageType::Listing,
    PageType::Documentation,
    PageType::Service,
];

/// Extraction configuration for a specific page type.
///
/// LIVE fields consumed by the core: `comments_are_content`, `content_selectors`,
/// `preserve_tags`, `boilerplate_selectors`, `aggregate_sections`,
/// `collect_repeated_items`. DEAD fields (declared in rs-trafilatura, never read
/// there either): `lenient_boilerplate`, `min_paragraph_density` — carried for
/// fidelity, no invented behavior.
#[derive(Debug, Clone, Copy)]
pub struct ExtractionProfile {
    /// Comment-classed nodes are content (forums).
    pub comments_are_content: bool,
    /// DEAD in rs-trafilatura (declared, never read). Carried for fidelity.
    pub lenient_boilerplate: bool,
    /// Content-node selectors tried before the default cascade.
    pub content_selectors: &'static [&'static str],
    /// Tags kept during cleaning even if normally stripped (e.g. forum `<form>`).
    pub preserve_tags: &'static [&'static str],
    /// DEAD in rs-trafilatura (declared, never read). Carried for fidelity.
    pub min_paragraph_density: f64,
    /// Page-type-specific boilerplate selectors removed during cleaning.
    pub boilerplate_selectors: &'static [&'static str],
    /// LIVE in rs-trafilatura (`try_multi_candidate_merge`); post-pass deferred this
    /// phase (measured at Phase VALIDATE). Carried as configuration.
    pub aggregate_sections: bool,
    /// LIVE in rs-trafilatura (`try_collect_repeated_items`); post-pass deferred this
    /// phase (measured at Phase VALIDATE). Carried as configuration.
    pub collect_repeated_items: bool,
}

const FORUM_BOILERPLATE_SELECTORS: &[&str] = &[
    ".message-cell--user",
    ".message-actionBar",
    ".message-attribution",
    ".message-footer",
    ".message-lastEdit",
    ".message-userExtras",
    "#ai-summary-block",
    ".xfa-gptts-block",
    "[class*='ai-summary']",
    ".p-body-sidebar",
    ".p-body-sidebarCol",
    ".js-quickReply",
    ".block-outer",
    ".messageUserInfo",
    ".messageUserBlock",
    ".messageDetails",
    ".dark_postrating",
    ".extraUserInfo",
    ".crawler-post-meta",
    "[itemprop='interactionStatistic']",
    ".post-likes",
    "#related-topics",
    ".more-topics__list",
    ".votecell",
    ".post-layout--left",
    ".user-info",
    ".user-gravatar32",
    "#hot-network-questions",
    ".js-post-menu",
    "#post-form",
    ".related",
    "#sidebar",
    ".comments",
    ".post-signature",
    ".ipsComment_author",
    ".cAuthorPane",
    ".ipsComment_tools",
    ".ipsComment_meta",
    ".ipsComment_badges",
    ".ipsSideMenu",
    ".ipsWidget",
    "[data-role='replyArea']",
    ".pagetop",
    ".yclinks",
    ".morelink",
    "td.subtext",
    ".comhead",
    ".votelinks",
    "td.ind",
    ".fatitem .title",
    "aside.onebox",
    ".bbCodeBlock--quote",
    ".bbCodeBlock--expandable",
    ".postprofile",
    "dl.postprofile",
    ".tagline",
    ".child .midcol",
    ".commentTop",
    ".post-actions",
    ".post-toolbar",
    ".reply-button",
    ".share-button",
    ".user-signature",
    ".signature",
];

const PRODUCT_BOILERPLATE_SELECTORS: &[&str] = &[
    "nav[aria-label='breadcrumb']",
    "nav[aria-label='Breadcrumb']",
    ".breadcrumb",
    ".breadcrumbs",
    ".related-products",
    ".recommended-products",
    ".recently-viewed",
    ".also-bought",
    ".cross-sells",
    ".upsells",
    "#recently-viewed",
    ".newsletter-popup",
    ".newsletter-signup",
    ".popup-overlay",
    "#reviews",
    "#customer-reviews",
    ".reviews-section",
    ".customer-reviews",
    "[class*='reviews']",
    "[class*='review-']",
    "[class*='-review']",
    "[id*='reviews']",
    "[class*='rating']",
    "[class*='ratings']",
    "[class*='questions']",
    "[class*='faq']",
    "[id*='questions']",
    "[id*='faq']",
    "[class*='newsletter']",
    "[class*='email-signup']",
    "[class*='signup']",
    "[class*='recently-viewed']",
    "[class*='recommend']",
    "[class*='related-']",
    "[class*='sponsored']",
    "[class*='a-carousel']",
    "[class*='similarities']",
    "[class*='merch-module']",
    "[class*='vi-ilComp']",
    "[class*='similar-']",
    "[class*='also-viewed']",
    "[class*='also-bought']",
    "[class*='people-also']",
    "[class*='you-may-also']",
];

const DOC_BOILERPLATE_SELECTORS: &[&str] = &[
    "div.sphinxsidebar",
    "div.related",
    "a.headerlink",
    "#docs-sidebar",
    "#docs-sidebar-popout",
    "#docs-bottom-navigation",
    "[role='complementary']",
    "nav.browse-horizontal",
    ".rst-other-versions",
    "nav.wy-nav-side",
    ".sidebar",
    ".sidebar-elems",
    ".sidebar-crate",
    "a.src",
    ".left-sidebar",
    ".reference-toc",
    ".document-toc",
    ".bc-table",
    "div.navheader",
    "div.navfooter",
    "nav.toc",
    ".nav-sidebar",
    ".docs-sidebar",
    ".page-nav",
    ".breadcrumb",
];

const FORUM_CONTENT_SELECTORS: &[&str] = &[
    "div[itemscope][itemtype='http://schema.org/DiscussionForumPosting']",
    "#mainbar",
    "div.block--messages",
    "ol.messageList",
    "div.cTopic",
    "table.comment-tree",
    "#page-body",
    "#postContent",
    "ul#commentlisting",
    "div.commentarea",
    ".thread-content",
    ".topic-body",
    ".post-container",
    "[data-controller='topic']",
    "#posts",
    "[role='main']",
];

const PRODUCT_CONTENT_SELECTORS: &[&str] = &[
    "[itemtype*='schema.org/Product']",
    "[itemtype*='schema.org/SoftwareApplication']",
    ".product-page",
    ".product-detail",
    ".product-description",
    ".product-content",
    ".product-info",
    ".pdp-main",
    ".pdp-content",
    "#product-description",
    "#productDescription",
    "#descriptionAndDetails",
    ".item-description",
    "#item-description",
    "[itemprop='description']",
    ".game_description_snippet",
    ".game_area_description",
    "#game_area_description",
    "#desc_ifr",
    "#viTabs_0_is",
    ".x-item-description",
    "[class*='buy-box-product-description']",
    ".product__description",
    ".product-single__description",
    ".prose",
    ".rich-text",
    ".rte",
    "[role='main']",
    "main",
];

const DOC_CONTENT_SELECTORS: &[&str] = &[
    "div.body",
    "main#main-content > article",
    "#docContent",
    "#main",
    "article.Doc",
    ".td-content",
    "article.main-page-content",
    "#mw-content-text",
    ".mw-parser-output",
    "#content-wrapper",
    "[role='main']",
    "article[role='main']",
    ".markdown",
    ".docs-content",
    ".guide-body",
    ".wiki-content",
    ".api-reference",
    ".markdown-body",
];

impl ExtractionProfile {
    /// Article (and the default fallback) profile.
    pub const ARTICLE: Self = Self {
        comments_are_content: false,
        lenient_boilerplate: false,
        content_selectors: &[],
        preserve_tags: &[],
        min_paragraph_density: 0.4,
        boilerplate_selectors: &[],
        aggregate_sections: true,
        collect_repeated_items: false,
    };

    /// Forum profile: comments ARE content; preserves `<form>`.
    pub const FORUM: Self = Self {
        comments_are_content: true,
        lenient_boilerplate: true,
        content_selectors: FORUM_CONTENT_SELECTORS,
        preserve_tags: &["form"],
        min_paragraph_density: 0.2,
        boilerplate_selectors: FORUM_BOILERPLATE_SELECTORS,
        aggregate_sections: false,
        collect_repeated_items: false,
    };

    /// Product profile.
    pub const PRODUCT: Self = Self {
        comments_are_content: false,
        lenient_boilerplate: true,
        content_selectors: PRODUCT_CONTENT_SELECTORS,
        preserve_tags: &[],
        min_paragraph_density: 0.2,
        boilerplate_selectors: PRODUCT_BOILERPLATE_SELECTORS,
        aggregate_sections: true,
        collect_repeated_items: false,
    };

    /// Collection / category profile (wire string `collection`).
    pub const CATEGORY: Self = Self {
        comments_are_content: false,
        lenient_boilerplate: false,
        content_selectors: &[],
        preserve_tags: &[],
        min_paragraph_density: 0.3,
        boilerplate_selectors: &[],
        aggregate_sections: false,
        collect_repeated_items: false,
    };

    /// Listing profile: collect repeated sibling items.
    pub const LISTING: Self = Self {
        comments_are_content: false,
        lenient_boilerplate: false,
        content_selectors: &[],
        preserve_tags: &[],
        min_paragraph_density: 0.3,
        boilerplate_selectors: &[],
        aggregate_sections: false,
        collect_repeated_items: true,
    };

    /// Documentation profile.
    pub const DOCUMENTATION: Self = Self {
        comments_are_content: false,
        lenient_boilerplate: false,
        content_selectors: DOC_CONTENT_SELECTORS,
        preserve_tags: &[],
        min_paragraph_density: 0.2,
        boilerplate_selectors: DOC_BOILERPLATE_SELECTORS,
        aggregate_sections: false,
        collect_repeated_items: false,
    };

    /// Service profile.
    pub const SERVICE: Self = Self {
        comments_are_content: false,
        lenient_boilerplate: false,
        content_selectors: &[],
        preserve_tags: &[],
        min_paragraph_density: 0.4,
        boilerplate_selectors: &[],
        aggregate_sections: true,
        collect_repeated_items: false,
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_serializes_to_collection() {
        assert_eq!(PageType::Category.as_str(), "collection");
        assert_eq!(
            serde_json::to_string(&PageType::Category).ok(),
            Some("\"collection\"".to_string())
        );
    }

    #[test]
    fn from_str_accepts_both_collection_and_category() {
        assert_eq!(
            PageType::from_str("collection").ok(),
            Some(PageType::Category)
        );
        assert_eq!(
            PageType::from_str("category").ok(),
            Some(PageType::Category)
        );
        assert_eq!(
            PageType::from_str("docs").ok(),
            Some(PageType::Documentation)
        );
        // ASCII-case-insensitive — the napi binding delegates its wire parsing here.
        assert_eq!(
            PageType::from_str("Category").ok(),
            Some(PageType::Category)
        );
        assert!(PageType::from_str("nonsense").is_err());
    }

    #[test]
    fn every_page_type_has_a_profile() {
        for pt in ALL_PAGE_TYPES {
            let _ = pt.extraction_profile();
        }
    }

    #[test]
    fn forum_profile_wires_comments_and_form() {
        let forum = PageType::Forum.extraction_profile();
        assert!(forum.comments_are_content);
        assert!(forum.preserve_tags.contains(&"form"));
        assert!(!forum.content_selectors.is_empty());
        assert!(!forum.boilerplate_selectors.is_empty());
        for pt in ALL_PAGE_TYPES {
            if pt != PageType::Forum {
                assert!(!pt.extraction_profile().comments_are_content);
            }
        }
    }

    #[test]
    fn post_pass_flags_configured_per_type() {
        assert!(
            PageType::Listing
                .extraction_profile()
                .collect_repeated_items
        );
        assert!(PageType::Article.extraction_profile().aggregate_sections);
        assert!(
            !PageType::Article
                .extraction_profile()
                .collect_repeated_items
        );
    }

    #[test]
    fn product_and_doc_selectors_present() {
        assert!(
            PageType::Product
                .extraction_profile()
                .content_selectors
                .contains(&".product-description")
        );
        assert!(
            PageType::Documentation
                .extraction_profile()
                .content_selectors
                .contains(&".markdown-body")
        );
        assert!(
            PageType::Product
                .extraction_profile()
                .boilerplate_selectors
                .contains(&"[class*='recommend']")
        );
    }
}
