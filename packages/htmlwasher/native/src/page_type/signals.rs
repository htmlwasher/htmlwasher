// SPDX-License-Identifier: Apache-2.0
//! Stage-2 HTML signals — `extract_html_signals` + `refine_with_signals` (ported from
//! the proven v1 `html-signals.ts`). `refine` ONLY ever overrides `Article`. JSON-LD
//! `@type` comparisons are EXACT and case-sensitive.

use dom_query::Document;
use serde_json::Value;

use crate::page_type::PageType;
use crate::page_type::features::{og_type, select_doc, select_len, split_whitespace};

const MIN_PRODUCT_ELEMENTS_FOR_CATEGORY: usize = 5;

const PRODUCT_GRID_PATTERNS: &[&str] = &[
    "product-grid",
    "product-list",
    "product-listing",
    "products-grid",
    "product-card",
    "product-tile",
    "collection-products",
    "search-results-products",
];
const ADD_TO_CART_PATTERNS: &[&str] = &[
    "add-to-cart",
    "add_to_cart",
    "addtocart",
    "add-to-bag",
    "buy-now",
    "buynow",
];
const CART_BUTTON_TEXTS: &[&str] = &["add to cart", "add to bag", "buy now", "buy it now"];

/// The HTML signal bundle consumed by Stage-2 refinement.
pub struct HtmlSignals {
    og_type: String,
    ld_types: Vec<String>,
    has_aggregate_offer: bool,
    has_add_to_cart: bool,
    has_product_grid: bool,
    product_element_count: usize,
    has_pagination: bool,
    code_block_count: usize,
    has_docs_nav: bool,
    link_ratio: f64,
    paragraph_word_count: usize,
}

fn collect_ld_types(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Array(arr) => {
            for v in arr {
                collect_ld_types(v, out);
            }
        }
        Value::Object(obj) => {
            match obj.get("@type") {
                Some(Value::String(s)) => out.push(s.clone()),
                Some(Value::Array(arr)) => {
                    for tv in arr {
                        if let Value::String(s) = tv {
                            out.push(s.clone());
                        }
                    }
                }
                _ => {}
            }
            for v in obj.values() {
                collect_ld_types(v, out);
            }
        }
        _ => {}
    }
}

fn class_or_id(doc: &Document, patterns: &[&str]) -> bool {
    patterns
        .iter()
        .any(|p| select_len(doc, &format!("[class*='{p}'], [id*='{p}']")) > 0)
}

/// Extract the HTML signals bundle from a parsed document.
#[must_use]
pub fn extract_html_signals(doc: &Document) -> HtmlSignals {
    let og = og_type(doc);

    let mut ld_types = Vec::new();
    for script in select_doc(doc, "script[type=\"application/ld+json\"]") {
        let raw = script.text();
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
            collect_ld_types(&parsed, &mut ld_types);
        }
    }
    // One walk: `AggregateOffer` is just another collected `@type`.
    let aggregate_offer = ld_types.iter().any(|t| t == "AggregateOffer");

    let has_product_grid = class_or_id(doc, PRODUCT_GRID_PATTERNS);

    let mut has_add_to_cart = class_or_id(doc, ADD_TO_CART_PATTERNS);
    if !has_add_to_cart {
        for btn in select_doc(doc, "button, a") {
            let text = btn.text().to_lowercase();
            if CART_BUTTON_TEXTS.iter().any(|t| text.contains(t)) {
                has_add_to_cart = true;
                break;
            }
        }
    }

    let product_element_count = select_len(
        doc,
        "[class*='product-card'], [class*='product-tile'], [class*='product-item']",
    );
    let has_pagination = select_len(
        doc,
        "link[rel='next'], [class*='pagination'], [class*='pager']",
    ) > 0;
    let code_block_count = select_len(doc, "code, pre");
    let has_docs_nav = select_len(
        doc,
        "[class*='docs-sidebar'], [class*='doc-sidebar'], [class*='docs-nav'], [class*='table-of-contents']",
    ) > 0;

    let link_count = select_len(doc, "a");
    let mut p_text = String::new();
    for p in select_doc(doc, "p") {
        p_text.push_str(p.text().as_ref());
    }
    let paragraph_word_count = split_whitespace(&p_text).len();
    let link_ratio = if paragraph_word_count > 0 {
        link_count as f64 / paragraph_word_count as f64
    } else if link_count > 0 {
        link_count as f64
    } else {
        0.0
    };

    HtmlSignals {
        og_type: og,
        ld_types,
        has_aggregate_offer: aggregate_offer,
        has_add_to_cart,
        has_product_grid,
        product_element_count,
        has_pagination,
        code_block_count,
        has_docs_nav,
        link_ratio,
        paragraph_word_count,
    }
}

impl HtmlSignals {
    fn has(&self, t: &str) -> bool {
        self.ld_types.iter().any(|x| x == t)
    }

    fn has_category_signal(&self) -> bool {
        if self.has("CollectionPage") || self.has("OfferCatalog") || self.has("ProductCollection") {
            return true;
        }
        if (self.has("Product") || self.has("ProductGroup")) && self.has_aggregate_offer {
            return true;
        }
        if self.has("ItemList")
            && (self.has_product_grid
                || self.product_element_count >= MIN_PRODUCT_ELEMENTS_FOR_CATEGORY)
        {
            return true;
        }
        false
    }

    fn has_product_signal(&self) -> bool {
        if self.has_aggregate_offer {
            return false;
        }
        let og = self.og_type.to_lowercase();
        if og.contains("product") && og != "product.group" && og != "product:group" {
            return true;
        }
        self.has("Product") || self.has("ProductGroup")
    }

    fn has_single_product_ld(&self) -> bool {
        if self.has_aggregate_offer {
            return false;
        }
        self.has("Product") || self.has("ProductGroup")
    }
}

/// Refine the Stage-1 page type with HTML signals. ONLY overrides `Article`; any other
/// incoming type is returned unchanged. Ordered, first match wins.
#[must_use]
pub fn refine_with_signals(page_type: PageType, s: &HtmlSignals) -> PageType {
    if page_type != PageType::Article {
        return page_type;
    }

    if s.has_category_signal() {
        return PageType::Category;
    }

    let og = s.og_type.to_lowercase();
    if og == "product.group" || og == "product:group" {
        return PageType::Category;
    }

    if s.product_element_count >= MIN_PRODUCT_ELEMENTS_FOR_CATEGORY
        && (s.has_pagination || (s.has_product_grid && s.has_add_to_cart))
    {
        return PageType::Category;
    }

    if s.has_product_signal() {
        if s.has_product_grid && !s.has_single_product_ld() {
            return PageType::Category;
        }
        return PageType::Product;
    }

    if s.has_product_grid && s.has_add_to_cart {
        return PageType::Category;
    }

    if s.has_docs_nav && s.code_block_count >= 3 {
        return PageType::Documentation;
    }

    if s.code_block_count >= 500 {
        return PageType::Documentation;
    }

    if s.link_ratio >= 3.0 && s.paragraph_word_count < 30 {
        return PageType::Listing;
    }

    PageType::Article
}

/// Refine directly from raw HTML (parse + extract + refine). Only overrides `Article`.
#[must_use]
pub fn refine_with_html_signals(page_type: PageType, html: &str) -> PageType {
    if page_type != PageType::Article {
        return page_type;
    }
    let doc = Document::from(html);
    refine_with_signals(page_type, &extract_html_signals(&doc))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refine(page_type: PageType, html: &str) -> PageType {
        refine_with_html_signals(page_type, html)
    }

    #[test]
    fn leaves_non_article_unchanged() {
        assert_eq!(
            refine(PageType::Product, "<html><body></body></html>"),
            PageType::Product
        );
        assert_eq!(
            refine(PageType::Forum, "<html><body></body></html>"),
            PageType::Forum
        );
    }

    #[test]
    fn collection_page_json_ld() {
        let html = r#"<html><head><script type="application/ld+json">{"@type":"CollectionPage"}</script></head><body></body></html>"#;
        assert_eq!(refine(PageType::Article, html), PageType::Category);
    }

    #[test]
    fn single_product_json_ld() {
        let html = r#"<html><head><script type="application/ld+json">{"@type":"Product","name":"X"}</script></head><body></body></html>"#;
        assert_eq!(refine(PageType::Article, html), PageType::Product);
    }

    #[test]
    fn docs_nav_plus_code_blocks() {
        let html = "<html><body><div class=\"docs-sidebar\"></div><pre>a</pre><code>b</code><pre>c</pre></body></html>";
        assert_eq!(refine(PageType::Article, html), PageType::Documentation);
    }

    #[test]
    fn plain_article_stays_article() {
        let html = "<html><body><article><p>words here</p></article></body></html>";
        assert_eq!(refine(PageType::Article, html), PageType::Article);
    }

    #[test]
    fn paragraph_word_count_uses_cpython_whitespace() {
        // U+0085 (NEL) and U+001C (FS) ARE CPython whitespace (not JS `\s`).
        let html = "<html><body><p>one\u{85}two\u{1c}three</p></body></html>";
        let doc = Document::from(html);
        assert_eq!(extract_html_signals(&doc).paragraph_word_count, 3);
    }

    #[test]
    fn paragraph_word_count_does_not_split_on_bom() {
        // U+FEFF is NOT CPython whitespace — the BOM stays attached (one word).
        let html = "<html><body><p>alpha\u{feff}beta</p></body></html>";
        let doc = Document::from(html);
        assert_eq!(extract_html_signals(&doc).paragraph_word_count, 1);
    }
}
