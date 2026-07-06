// SPDX-License-Identifier: Apache-2.0
// Per-page-type extraction profiles, ported verbatim from rs-trafilatura
// src/page_type/mod.rs (ExtractionProfile + the 7 constants + boilerplate
// selector lists). The classifier's predicted PageType selects a profile that
// tunes the boilerplate-removal core (content selectors to try first, tags to
// preserve from cleaning, extra boilerplate selectors to drop, whether comments
// are content, and the aggregate/collect post-pass flags).

import type { PageType } from '../types.js';

export interface ExtractionProfile {
  /** Comment-classed nodes are content (forums). */
  commentsAreContent: boolean;
  /**
   * Lenient boilerplate filtering. NOTE: declared in rs-trafilatura but never
   * read there (a dead field); carried for fidelity, not yet consumed here.
   */
  lenientBoilerplate: boolean;
  /** Extra content-node selectors tried before the default cascade. */
  contentSelectors: readonly string[];
  /** Tags kept during cleaning even if normally stripped (e.g. forum `<form>`). */
  preserveTags: readonly string[];
  /**
   * Minimum paragraph density for fallback usability. NOTE: dead in
   * rs-trafilatura (declared, never read); carried for fidelity.
   */
  minParagraphDensity: number;
  /** Page-type-specific boilerplate selectors removed during cleaning. */
  boilerplateSelectors: readonly string[];
  /**
   * Aggregate content across multiple sections (service/long-form fallback).
   * NOTE: LIVE in rs-trafilatura (src/extract.rs:231 runs try_multi_candidate_merge
   * when profile.aggregate_sections) but not yet consumed by the TS pipeline — the
   * post-pass is deferred. See PORTING-NOTES.
   * TODO: port rs-trafilatura try_multi_candidate_merge (extract.rs:644 under-extraction
   * gate) and thread this flag through CoreOptions so the service/product profile diverges.
   */
  aggregateSections: boolean;
  /**
   * Collect repeated sibling items (listing/index pages).
   * NOTE: LIVE in rs-trafilatura (src/extract.rs:252 runs try_collect_repeated_items
   * when profile.collect_repeated_items) but not yet consumed by the TS pipeline — the
   * post-pass is deferred. See PORTING-NOTES.
   * TODO: port rs-trafilatura try_collect_repeated_items (extract.rs:524 min-15-words
   * sibling collection) and thread this flag through CoreOptions so the listing profile diverges.
   */
  collectRepeatedItems: boolean;
}

const FORUM_BOILERPLATE_SELECTORS = [
  '.message-cell--user',
  '.message-actionBar',
  '.message-attribution',
  '.message-footer',
  '.message-lastEdit',
  '.message-userExtras',
  '#ai-summary-block',
  '.xfa-gptts-block',
  "[class*='ai-summary']",
  '.p-body-sidebar',
  '.p-body-sidebarCol',
  '.js-quickReply',
  '.block-outer',
  '.messageUserInfo',
  '.messageUserBlock',
  '.messageDetails',
  '.dark_postrating',
  '.extraUserInfo',
  '.crawler-post-meta',
  "[itemprop='interactionStatistic']",
  '.post-likes',
  '#related-topics',
  '.more-topics__list',
  '.votecell',
  '.post-layout--left',
  '.user-info',
  '.user-gravatar32',
  '#hot-network-questions',
  '.js-post-menu',
  '#post-form',
  '.related',
  '#sidebar',
  '.comments',
  '.post-signature',
  '.ipsComment_author',
  '.cAuthorPane',
  '.ipsComment_tools',
  '.ipsComment_meta',
  '.ipsComment_badges',
  '.ipsSideMenu',
  '.ipsWidget',
  "[data-role='replyArea']",
  '.pagetop',
  '.yclinks',
  '.morelink',
  'td.subtext',
  '.comhead',
  '.votelinks',
  'td.ind',
  '.fatitem .title',
  'aside.onebox',
  '.bbCodeBlock--quote',
  '.bbCodeBlock--expandable',
  '.postprofile',
  'dl.postprofile',
  '.tagline',
  '.child .midcol',
  '.commentTop',
  '.post-actions',
  '.post-toolbar',
  '.reply-button',
  '.share-button',
  '.user-signature',
  '.signature',
] as const;

const PRODUCT_BOILERPLATE_SELECTORS = [
  "nav[aria-label='breadcrumb']",
  "nav[aria-label='Breadcrumb']",
  '.breadcrumb',
  '.breadcrumbs',
  '.related-products',
  '.recommended-products',
  '.recently-viewed',
  '.also-bought',
  '.cross-sells',
  '.upsells',
  '#recently-viewed',
  '.newsletter-popup',
  '.newsletter-signup',
  '.popup-overlay',
  '#reviews',
  '#customer-reviews',
  '.reviews-section',
  '.customer-reviews',
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
] as const;

const DOC_BOILERPLATE_SELECTORS = [
  'div.sphinxsidebar',
  'div.related',
  'a.headerlink',
  '#docs-sidebar',
  '#docs-sidebar-popout',
  '#docs-bottom-navigation',
  "[role='complementary']",
  'nav.browse-horizontal',
  '.rst-other-versions',
  'nav.wy-nav-side',
  '.sidebar',
  '.sidebar-elems',
  '.sidebar-crate',
  'a.src',
  '.left-sidebar',
  '.reference-toc',
  '.document-toc',
  '.bc-table',
  'div.navheader',
  'div.navfooter',
  'nav.toc',
  '.nav-sidebar',
  '.docs-sidebar',
  '.page-nav',
  '.breadcrumb',
] as const;

const FORUM_CONTENT_SELECTORS = [
  "div[itemscope][itemtype='http://schema.org/DiscussionForumPosting']",
  '#mainbar',
  'div.block--messages',
  'ol.messageList',
  'div.cTopic',
  'table.comment-tree',
  '#page-body',
  '#postContent',
  'ul#commentlisting',
  'div.commentarea',
  '.thread-content',
  '.topic-body',
  '.post-container',
  "[data-controller='topic']",
  '#posts',
  "[role='main']",
] as const;

const PRODUCT_CONTENT_SELECTORS = [
  "[itemtype*='schema.org/Product']",
  "[itemtype*='schema.org/SoftwareApplication']",
  '.product-page',
  '.product-detail',
  '.product-description',
  '.product-content',
  '.product-info',
  '.pdp-main',
  '.pdp-content',
  '#product-description',
  '#productDescription',
  '#descriptionAndDetails',
  '.item-description',
  '#item-description',
  "[itemprop='description']",
  '.game_description_snippet',
  '.game_area_description',
  '#game_area_description',
  '#desc_ifr',
  '#viTabs_0_is',
  '.x-item-description',
  "[class*='buy-box-product-description']",
  '.product__description',
  '.product-single__description',
  '.prose',
  '.rich-text',
  '.rte',
  "[role='main']",
  'main',
] as const;

const DOC_CONTENT_SELECTORS = [
  'div.body',
  'main#main-content > article',
  '#docContent',
  '#main',
  'article.Doc',
  '.td-content',
  'article.main-page-content',
  '#mw-content-text',
  '.mw-parser-output',
  '#content-wrapper',
  "[role='main']",
  "article[role='main']",
  '.markdown',
  '.docs-content',
  '.guide-body',
  '.wiki-content',
  '.api-reference',
  '.markdown-body',
] as const;

/** The 7 static profiles, keyed by serialized page type (`collection`, not `category`). */
export const PROFILES: Record<PageType, ExtractionProfile> = {
  article: {
    commentsAreContent: false,
    lenientBoilerplate: false,
    contentSelectors: [],
    preserveTags: [],
    minParagraphDensity: 0.4,
    boilerplateSelectors: [],
    aggregateSections: true,
    collectRepeatedItems: false,
  },
  forum: {
    commentsAreContent: true,
    lenientBoilerplate: true,
    contentSelectors: FORUM_CONTENT_SELECTORS,
    preserveTags: ['form'],
    minParagraphDensity: 0.2,
    boilerplateSelectors: FORUM_BOILERPLATE_SELECTORS,
    aggregateSections: false,
    collectRepeatedItems: false,
  },
  product: {
    commentsAreContent: false,
    lenientBoilerplate: true,
    contentSelectors: PRODUCT_CONTENT_SELECTORS,
    preserveTags: [],
    minParagraphDensity: 0.2,
    boilerplateSelectors: PRODUCT_BOILERPLATE_SELECTORS,
    aggregateSections: true,
    collectRepeatedItems: false,
  },
  collection: {
    commentsAreContent: false,
    lenientBoilerplate: false,
    contentSelectors: [],
    preserveTags: [],
    minParagraphDensity: 0.3,
    boilerplateSelectors: [],
    aggregateSections: false,
    collectRepeatedItems: false,
  },
  listing: {
    commentsAreContent: false,
    lenientBoilerplate: false,
    contentSelectors: [],
    preserveTags: [],
    minParagraphDensity: 0.3,
    boilerplateSelectors: [],
    aggregateSections: false,
    collectRepeatedItems: true,
  },
  documentation: {
    commentsAreContent: false,
    lenientBoilerplate: false,
    contentSelectors: DOC_CONTENT_SELECTORS,
    preserveTags: [],
    minParagraphDensity: 0.2,
    boilerplateSelectors: DOC_BOILERPLATE_SELECTORS,
    aggregateSections: false,
    collectRepeatedItems: false,
  },
  service: {
    commentsAreContent: false,
    lenientBoilerplate: false,
    contentSelectors: [],
    preserveTags: [],
    minParagraphDensity: 0.4,
    boilerplateSelectors: [],
    aggregateSections: true,
    collectRepeatedItems: false,
  },
};

/** The extraction profile for a page type (defaults to the article profile). */
export function getProfile(pageType: PageType): ExtractionProfile {
  return PROFILES[pageType] ?? PROFILES.article;
}
