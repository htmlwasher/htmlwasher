# Page-Type Classifier — Feature & Inference Spec

Authoritative spec for the trafilaturacore page-type classifier, extracted from the
Rust references. It is the contract for BOTH the offline Python training extractor
(`training/`) and the TypeScript runtime extractor (`packages/trafilaturacore/src/classifier/`).
Both sides MUST produce byte-identical feature vectors so the trained model
behaves the same at train and inference time.

Sources read (read-only):

- `~/r/trafilatura-sources/web-page-classifier/src/lib.rs` — `N_NUMERIC_FEATURES = 89`, `classify_ml`, `PageType` enum, `N_QUALITY_FEATURES = 27`.
- `~/r/trafilatura-sources/web-page-classifier/src/model.rs` — `scale_features`, `compute_tfidf`, `predict`, `Tree::evaluate`.
- `~/r/trafilatura-sources/rs-trafilatura/src/page_type/ml.rs` — `extract_ml_features` (fills `f[0..89]`).
- `~/r/trafilatura-sources/rs-trafilatura/src/page_type/mod.rs` — `classify_url`, `extract_html_signals`, `refine_with_html_signals`, `HtmlSignals`, URL constant lists, `extract_domain_path`, `contains_any`.
- `~/r/trafilatura-sources/rs-trafilatura/src/extract.rs` (~50-92) — the 3-stage cascade and `title_meta` construction.

## Critical counts and invariants

- Numeric features: exactly **89** (`N_NUMERIC_FEATURES = 89`). Note: stale comments
  in `ml.rs` say "81" in two places (the doc comment at line 22 and line 48). They
  are WRONG — the array is `[0.0f64; N_NUMERIC]` with `N_NUMERIC = 89`, and the model
  binary's `scaler_mean.len() == 89`. Trust 89.
- TF-IDF features: exactly **100**.
- Full feature vector fed to the trees: **189** = 89 numeric (scaled) ++ 100 TF-IDF.
- Classes: **7** page types.
- The classifier model is multi-class XGBoost with `n_trees = 1400` = 200 boosting
  rounds × 7 classes (per the rust test). The port trains its own model; only the
  feature contract and inference math below must match.

## Feature vector assembly order

In `classify_ml` (lib.rs):

1. `scaled = scale_features(numeric_features)` — StandardScaler applied to the 89
   numeric features ONLY.
2. `tfidf = compute_tfidf(title_meta)` — 100 raw (already L2-normalized × idf) TF-IDF
   values, NOT scaled.
3. `all_features = scaled ++ tfidf` — concatenation: indices 0..88 = scaled numeric,
   89..188 = TF-IDF.

So StandardScaler is applied to the **numeric block only** (89 values); the TF-IDF
block (100 values) is passed through unscaled. Tree feature indices 0..88 reference
scaled numerics; 89..188 reference TF-IDF columns in vocabulary order.

## Numeric features f[0..89]

Computed by `extract_ml_features(doc, metadata, url)` in `ml.rs`. All booleans are
emitted as `1.0` / `0.0` (f64). Default for every slot is `0.0` (array is zero-init).

Two preprocessing inputs:

- `url_lower = url.to_ascii_lowercase()`.
- `(domain, path) = extract_domain_path(url_lower)` — see "URL parsing" below.

CSS selectors use `dom_query` semantics: `doc.select(sel).length()` = number of
matched elements; `.text()` = concatenated descendant text; `[class*='x']` =
attribute-substring match (case-sensitive on the attribute value). Multiple comma-
separated selectors = union. Port these against the chosen TS/Python DOM lib with
the SAME case sensitivity and substring semantics.

### `<template>` exclusion (parity rule)

Per the HTML5 spec, a `<template>` element's children live in a separate content
document fragment, NOT in the normal DOM subtree. lexbor (the selectolax parser the
Python extractor and the trained model use) honors this: `node.text(deep=True)`
never includes template content, and CSS selectors never descend into it. The TS
runtime uses linkedom, which instead keeps template children inline, so its
`textContent` WOULD include them. To stay byte-identical, the TS classifier parser
(`parseDocumentSpec` in `core/dom.ts`) removes every `<template>` subtree right
after parsing. This affects only the text-derived numeric features (e.g. body-text
length f[58] and the currency/price counts that read body text); element-count
selectors are unaffected because neither lexbor nor linkedom counts `<template>`
descendants for a `.some-class` selector. Any page shipping a `<template>` (common
on JS-rendered e-commerce/collection pages) would otherwise diverge ~10 numeric
slots; the `4853.html` parity fixture exercises exactly this case.

### Group f[0..14] — URL pattern signals (URL-DERIVED; need the source URL)

If `url` is empty, `url_lower` is empty and `extract_domain_path("")` returns
`("", "/")`, so all of f[0..14] are `0.0` except f[11]/f[13] which also evaluate
false. (At inference, missing URL → these 14 are all 0.0.)

- f[0] domain_is_forum — `contains_any(domain, FORUM_DOMAINS)`.
- f[1] path_is_forum — `contains_any(path, FORUM_PATHS)`.
- f[2] url_forum_pattern — `contains_any(url_lower, FORUM_URL_PATTERNS)`.
- f[3] domain_is_docs — `contains_any(domain, DOCS_DOMAINS)`.
- f[4] path_is_docs — `contains_any(path, DOCS_PATHS)`.
- f[5] path_is_product — `contains_any(path, PRODUCT_PATHS)`.
- f[6] path_is_category — `contains_any(path, CATEGORY_PATHS)`.
- f[7] path_is_service — `contains_any(path, SERVICE_PATHS)`.
- f[8] url_service_slug — `contains_any(url_lower, SERVICE_SLUG_PATTERNS)`.
- f[9] path_is_article — `contains_any(path, ARTICLE_PATHS)`.
- f[10] url_blog_slug — `contains_any(url_lower, BLOG_SLUG_PATTERNS)`.
- f[11] path_listing_ending — `path.trim_end_matches('/')` then any
  `LISTING_PATH_ENDINGS` is a suffix (`ends_with`).
- f[12] path_listing_contains — `contains_any(path, LISTING_PATH_CONTAINS)`.
- f[13] domain_shop_store — `domain.contains("shop.") || domain.contains("store.")`.

Note: f[0..14] uses the SAME constant lists as Stage-1 `classify_url` but f[5] uses
`PRODUCT_PATHS` only (no `PRODUCT_DOMAINS`); f[13] is a separate hardcoded
shop./store. check rather than `PRODUCT_DOMAINS`.

### Group f[14..63] — HTML structural signals (DOM-DERIVED)

- f[14] long_paragraph_count — count of `p` whose `text().trim().len() > 20`
  (byte length, not chars).
- f[15] avg_long_paragraph_len — `p_total_len / p_count` over those long `p`,
  else `0.0`. (sum of trimmed byte-lengths / count.)
- f[16] heading_count — `select("h1, h2, h3, h4, h5, h6").length()`.
- f[17] body_text_per_h2 — `body_text_len / h2_count` if `h2_count > 0` else `0.0`.
  `body_text_len = select("body").text().len()` (byte length).
- f[18] has_article — `select("article").length() > 0` → 1.0.
- f[19] has_time — `select("time").length() > 0`.
- f[20] has_main — `select("main").length() > 0`.
- f[21] has_aside — `select("aside").length() > 0`.
- f[22] has_author_signal — `select(meta[name="author"], meta[property="article:author"], [class*="author"]).length() > 0`.
- f[23] jsonld_article — any `script[type="application/ld+json"]` whose `.text()`
  CONTAINS the literal `"Article"` OR `"NewsArticle"` OR `"BlogPosting"` (with the
  surrounding double-quotes, i.e. matches the substring `"Article"`). Substring
  match on raw script text — NOT JSON-parsed.
- f[24] jsonld_product — script text contains `"Product"`.
- f[25] jsonld_faqpage — script text contains `"FAQPage"`.
- f[26] jsonld_collection — contains `"CollectionPage"` OR `"OfferCatalog"`.
- f[27] jsonld_itemlist — contains `"ItemList"`.
- f[28] jsonld_localbusiness — contains `"LocalBusiness"`.
- f[29] jsonld_service — contains `"Service"`.
- f[30] jsonld_aggregateoffer — contains `"AggregateOffer"`.
  (f[23..31] are set inside one loop over all ld+json scripts; each is a sticky OR
  across all script blocks. The quotes in the needles ARE part of the substring.)
- f[31] og_type_product — `og_type.contains("product")` where
  `og_type = metadata.page_type` (the raw og:type content) lowercased, default "".
- f[32] og_type_article — `og_type == "article"` (exact equality).
- f[33] og_type_website — `og_type == "website"` (exact equality).
- f[34] has_product_grid_class — `select([class*='product-grid'], [class*='product-list'], [class*='product-card']).length() > 0`.
- f[35] has_add_to_cart_class — `select([class*='add-to-cart'], [class*='addtocart'], [class*='buy-now']).length() > 0`.
- f[36] product_card_count — `select([class*='product-card'], [class*='product-tile'], [class*='product-item']).length()`.
- f[37] has_pagination_class — `select(link[rel='next'], [class*='pagination'], [class*='pager']).length() > 0`.
- f[38] code_pre_count — `select("code, pre").length()`.
- f[39] has_docs_nav_class — `select([class*='docs-sidebar'], [class*='doc-sidebar'], [class*='docs-nav'], [class*='table-of-contents']).length() > 0`.
- f[40] link_to_pword_ratio — `link_count / p_words` if `p_words > 0` else `0.0`.
  `link_count = select("a").length()`; `p_words = select("p").text().split_whitespace().count()`.
- f[41] paragraph_word_count — `p_words` (the same split-whitespace count).
- f[42] grid_col_card_class_count — `select([class*='grid'], [class*='col-'], [class*='column'], [class*='card']).length()`.
- f[43] svg_count — `select("svg").length()`.
- f[44] cta_button_count — count of `button, a` whose lowercased `.text()` contains
  any of: `"get started"`, `"free trial"`, `"contact us"`, `"sign up"`,
  `"try free"`, `"get pricing"`, `"book a"`, `"schedule"`.
- f[45] has_hero_class — `select([class*='hero']).length() > 0`.
- f[46] has_testimonial_class — `select([class*='testimonial']).length() > 0`.
- f[47] has_pricing_class — `select([class*='pricing']).length() > 0`.
- f[48] has_feature_class — `select([class*='feature']).length() > 0`.
- f[49] has_breadcrumb_class — `select([class*='breadcrumb']).length() > 0`.
- f[50] form_count — `select("form").length()`.
- f[51] img_count — `select("img").length()`.
- f[52] list_count — `select("ul, ol").length()`.
- f[53] table_count — `select("table").length()`.
- f[54] nav_count — `select("nav").length()`.
- f[55] section_count — `select("section").length()`.
- f[56] button_count — `select("button").length()`.
- f[57] input_count — `select("input").length()`.
- f[58] body_text_len — `body_text_len` (byte length of `select("body").text()`).
- f[59] unique_href_count — number of DISTINCT `href` attribute strings over
  `a[href]` (HashSet of raw href strings; exact-string dedup, no normalization).
- f[60] comment_class_count — `select([class*='comment']).length()`.
- f[61] post_class_count — `select([class*='post']).length()`.
- f[62] message_class_count — `select([class*='message']).length()`.

### 500,000-char body-text gate (CRITICAL)

Immediately after f[62], `ml.rs` checks:

```
if body_text_len > 500_000 { return f; }
```

`body_text_len` is the **byte length** of `body.text()` (Rust `String::len`), not a
char count. The threshold is a strict `>` (501_000 triggers; exactly 500_000 does
NOT). When triggered, the function RETURNS EARLY, leaving **f[63..89] all at 0.0**.
The Python and TS extractors MUST replicate this exact early-return so the model sees
identical zeros on huge pages. Compute the gate on the same byte-length definition
(UTF-8 byte length of the body text), not a code-point count.

### Group f[63..73] — Enhanced structural features (DOM-DERIVED; zeroed when gate fires)

- f[63] max_repeated_class — over nodes matched by
  `select("body > *, body > * > *, body > * > * > *")`: for each node with
  `children().length() >= 3`, build a frequency map of each child's RAW `class`
  attribute string; if the max class-count `>= 3`, record it. f[63] = the global max
  such count (0 if none). Children without a `class` attribute are not counted.
- f[64] parents_with_repeats — count of those nodes whose max class-count `>= 3`.
- f[65] price_symbol_count — `body_text.matches('$').count() + matches('€') + matches('£')`
  (count of currency-symbol occurrences in the body text string).
- f[66] image_to_text_ratio — `img_count / (body_text_len / 1000.0)` if
  `body_text_len > 0` else `0.0`. `img_count` reuses `f[51] as usize`. NOTE the
  `/1000.0` normalization is on the DENOMINATOR (text length in kilobytes).
- f[67] heading_breadth_ratio — count headings per level h1..h6 into a 6-slot array;
  `max_same_level / n_levels_used` if `n_levels_used > 0` else `0.0`. Level read from
  the 2nd char of the tag name (`h2` → digit `2`), bounded 1..=6.
- f[68] has_breadcrumblist — `body_text.to_ascii_lowercase().contains("breadcrumblist")`.
  `body_lower` is computed here once and reused by f[75..78], f[84], f[86].
- f[69] repeated_link_text_count — collect lowercased trimmed `.text()` of every `a`
  with `len > 3` (byte length) into a frequency map; f[69] = number of distinct link
  texts with count `>= 3`.
- f[70] section_link_density_variance — iterate `select("section, article, div")`
  nodes in document order. For each node, FIRST flush the PREVIOUS node's accumulator
  (if its `current_text_len > 50`, push `current_links / current_text_len * 1000.0`),
  then set `current_links = node.select("a").length()` and
  `current_text_len = node.text().trim().len()` (byte length). After the loop, flush
  the final accumulator if `>50`. If `>= 3` ratios collected, f[70] = population
  variance (divide by N, not N-1); else `0.0`. WARNING: the flush-before-assign
  ordering means the first node's metrics are computed but discarded before being
  pushed (the accumulator is overwritten before its own flush). This is a quirk of the
  Rust loop — replicate it EXACTLY (each iteration pushes the prior node's stats, the
  current node's stats are only pushed on the next iteration / final flush). See
  "Ambiguities" below.
- f[71] meta_robots_noindex — `select(meta[name="robots"][content*="noindex"]).length() > 0`.
- f[72] url_path_depth — `path.trim_matches('/').split('/').filter(non-empty).count()`
  (URL-DERIVED — needs the URL path; 0 when URL missing → path = "/").

### Group f[73..81] — DOM vocabulary features (DOM-DERIVED; zeroed when gate fires)

- f[73] dom_max_signature — like f[63] but builds a STRUCTURAL signature per child:
  `tag` lowercased, plus the FIRST matching semantic keyword found as a substring of
  the child's lowercased `class` among `["item","card","product","post","entry",
  "result","row","cell"]` (in that order). Signature = `tag` if no keyword else
  `"{tag}|{keyword}"`. Same `body > *` 3-level selector and `children >= 3` /
  `count >= 3` rules. f[73] = global max signature count.
- f[74] dom_parents_with_repeats — count of nodes with a signature count `>= 3`.
- f[75] commercial_vocab_density — over `body_lower.split_whitespace()` word
  frequency map: sum of counts of `["price","buy","cart","shop","order","shipping",
  "delivery","stock","sale","discount","offer","deal","checkout","payment",
  "warranty","returns","refund"]` divided by `total_words`. `0.0` if `total_words==0`.
- f[76] content_vocab_density — same denom; words `["posted","author","published",
  "updated","comments","share","tweet","read","article","blog","opinion","editor",
  "journalist","source","according"]`.
- f[77] tech_vocab_density — words `["api","function","parameter","returns",
  "example","syntax","reference","deprecated","version","module","class","method",
  "interface","configuration","install"]`.
- f[78] forum_vocab_density — words `["reply","thread","post","member","joined",
  "reputation","moderator","admin","quote","likes","views","topic","answered",
  "solution","vote","upvote"]`.
  (Word matching is EXACT token equality after `split_whitespace()` on `body_lower`,
  not substring — tokens are split on ASCII whitespace only; punctuation stays
  attached to tokens, so e.g. "buy," does not match "buy". Replicate exactly.)
- f[79] max_link_text_repeat — `max` count over the f[69] link-text frequency map
  (0 if empty). Reuses the SAME map collected for f[69].
- f[80] repeated_link_text_count_dup — count of link texts with count `>= 3` (this is
  numerically identical to f[69]; both are present as separate features).

### Group f[81..89] — Collection-specific features (DOM-DERIVED; zeroed when gate fires)

- f[81] og_type_product_group — `select(meta[property="og:type"][content*="product.group"]).length() > 0`.
- f[82] has_filter_sidebar — `select([class*='filter'][class*='sidebar'], [class*='filter'][class*='panel'], [class*='filter'][class*='bar'], [class*='filter'][class*='menu']).length() > 0`
  (each selector requires BOTH class substrings on the same element).
- f[83] has_sort_control — `select([class*='sort'][class*='select'], [class*='sort'][class*='dropdown'], [class*='sort'][class*='control'], [class*='sort'][class*='option']).length() > 0`.
- f[84] has_product_count_text — regex `\d+\s*(results|items|products|pieces)`
  matched against `body_lower` (case-insensitive because applied to lowercased text;
  the regex itself has no `i` flag — it relies on `body_lower`).
- f[85] cards_with_price — over `card_selector` =
  `[class*='product-card'], [class*='product-tile'], [class*='product-item'],
  [class*='product-grid-item'], [class*='grid-item'], [class*='collection-item']`:
  count of those cards that contain a descendant matching
  `[class*='price'], [class*='cost'], [class*='amount']`.
- f[86] has_collection_schema — `body_lower.contains("collectionpage") || contains("productcollection")`.
- f[87] total_card_count — `select(card_selector).length()` (same card_selector as f[85]).
- f[88] price_to_card_ratio — `cards_with_price / total_cards` if `total_cards > 0`
  else `0.0`.

## URL parsing (`extract_domain_path`, rs-trafilatura authoritative)

```
strip leading "https://" else "http://" (rs-trafilatura does NOT strip "//")
if remainder contains '/': (domain, path) = split at first '/'  (path KEEPS the '/')
else: (domain, "/")
```

`contains_any(haystack, needles)` = ANY needle is a substring of haystack.

DIVERGENCE: `web-page-classifier/src/url_heuristics.rs`'s `extract_domain_path` ALSO
strips a leading `//` (protocol-relative URLs). `extract_ml_features` calls
rs-trafilatura's `super::extract_domain_path`, which does NOT. Since the feature
vector is built via rs-trafilatura, use the rs-trafilatura version (no `//` strip)
for byte-for-byte feature parity. Flagged for the port author.

## TF-IDF (100 features)

### What text feeds TF-IDF

CONFIRMED from `extract.rs` (~73-77): `title_meta = format!("{} {}", title, description)`
— the metadata title and the meta description joined by a single space (each
defaulting to "" when absent). This single string is the only TF-IDF input. NOT the
body text.

### rs-crate tokenization (reference behavior to mimic at inference)

`Model::compute_tfidf` (model.rs):

- `text_lower = text.to_ascii_lowercase()`; empty → all zeros.
- Tokenize: `split(|c| !c.is_alphanumeric())`, drop empties. This splits on ANY
  non-alphanumeric Unicode char (note: `is_alphanumeric` is Unicode-aware in Rust,
  so letters/digits of any script are kept; everything else is a delimiter). There is
  NO minimum token length and NO stopword removal in the rust path.
- Unigram match: for each token, if it exactly equals a vocabulary entry, increment
  that entry's term frequency.
- Bigram/phrase match: for each vocabulary entry that CONTAINS a space, if the raw
  `text_lower` CONTAINS that phrase as a substring, set its tf to at least 1
  (`entry(idx).or_insert(1)` — does not increment if already present).
- TF normalization: `tf_val = count / n_words` where `n_words` = number of tokens.
- Value: `result[idx] = tf_val * idf[idx]`. NOTE the rust path does NOT apply L2
  normalization and uses a plain `count/n_words` TF — it is an APPROXIMATION of
  sklearn, not an exact reproduction.

### What trafilaturacore SHIPS (the contract to standardize on)

The port does NOT reverse rs-trafilatura's embedded model. It TRAINS a fresh model
with scikit-learn and ships the vocab + idf as `training/.../tfidf-vocab.json`. Use:

```
TfidfVectorizer(
    lowercase=True,
    max_features=100,
    smooth_idf=True,      # idf = ln((1 + n) / (1 + df)) + 1
    norm='l2',            # L2-normalize each document's tf-idf vector
    ngram_range=(?, ?),   # SEE AMBIGUITY — rust path supports unigrams + space-bigrams
    token_pattern=...     # SEE AMBIGUITY — sklearn default drops 1-char tokens
)
```

Both the Python trainer and the TS runtime must reproduce sklearn's transform EXACTLY
(so they agree with the trained idf vector): per-document `tf = raw_count`, multiply
by shipped `idf`, then L2-normalize the 100-dim vector. This is the standardized
TF-IDF — it SUPERSEDES the rust crate's `count/n_words`-without-L2 approximation. The
sklearn quirk (`idf = ln((1+n)/(1+df)) + 1`, L2 norm) is what both sides implement.

The `tfidf-vocab.json` must carry, in column order matching the model's TF-IDF input
slots (vector indices 89..188): the 100 vocabulary terms and their idf weights.

## StandardScaler

`scale_features(raw)` (model.rs), applied to the 89 numeric features only:

```
for each i: out[i] = (raw[i] - mean[i]) / scale[i]   if scale[i] > 0
            else 0.0
```

`mean` and `scale` are per-feature arrays of length 89. A feature with
`scale[i] <= 0` (zero variance) yields `0.0`. The port ships `mean` and `scale`
(89 values each) alongside the model; TS applies this exact formula to numeric
features before concatenating the unscaled TF-IDF block.

## Tree inference

`Tree::eval(features)` (`packages/trafilaturacore/native/src/page_type/gbdt.rs`):

- Start at node 0. A node with `left_children[node] == -1` is a LEAF; return its
  `split_conditions[node]` value (the leaf weight).
- Internal node: `feature_val = features.get(split_indices[node])`, compared in
  **float32** (`(v as f32) < (thr as f32)`) to match XGBoost's own float32 split
  evaluation. Strict `<` goes LEFT, `>=` goes RIGHT (equality goes RIGHT).
- Missing feature (absent, NaN, or out-of-range index) does NOT default to `0.0` —
  it routes via the node's own `default_left` flag instead. This is inert on the
  dense 189-element feature vector the port always builds (every index 0..188 is
  always present), but is the accurate behavior of the shipped evaluator.
- Loop is bounded by node count; cycles/corrupt refs return 0.0.

`Gbdt::predict(features)` (`packages/trafilaturacore/native/src/page_type/gbdt.rs`):

- `margins = [0.0; 7]`. For tree i (0-indexed), `class_idx = tree_info[i]`
  (round-robin `i % n_classes` by construction — round r, class c → tree index
  `r * n_classes + c`); add `tree.eval(features)` to `margins[class_idx]`.
- Softmax over the 7 class margins: subtract max, exp, normalize by sum.
- Argmax → `(best_idx, best_prob)`. `best_prob` is the returned confidence in [0,1].
- `class_idx` → `class_labels[class_idx]` → `PageType::parse(...)`, defaulting to
  `Article` if the label is unknown (`model.rs::label_page_type`).

There is no ONNX export or ONNX runtime in the shipped port — inference is the
pure-Rust GBDT evaluator above, reading the XGBoost native JSON dump
(`model.xgb.json`) directly. Confidence = max softmax probability.

## PageType ordering (integer label → type)

CRITICAL: the integer class index → page-type mapping is determined by the TRAINED
model's `class_labels` vector (stored in the binary, read in `predict`/`classify_ml`),
NOT by the Rust `PageType` enum declaration order. `classify_ml` does
`class_labels[class_idx]` then `PageType::parse`.

The web-page-classifier `PageType` enum is declared ALPHABETICALLY (Article=0,
Collection=1, Documentation=2, Forum=3, Listing=4, Product=5, Service=6) — but this
enum order is NOT necessarily the model's label order. The model emits a class index;
`class_labels[idx]` is a string; that string is parsed to a `PageType`. So the
authoritative source of the index→type mapping is the shipped label list.

For the trafilaturacore trained model, the Python trainer MUST persist the exact
`class_labels` order (the order sklearn/XGBoost assigned to the encoded labels) and
ship it; the TS runtime MUST map `argmax → class_labels[idx] → page type` using that
shipped list. Do NOT hardcode an assumed order. Recommended: store `class_labels` in
the model export sidecar and have both sides read it.

The 7 type strings and their canonical serialization:

- `article`, `forum`, `product`, `collection`, `listing`, `documentation`, `service`.

`PageType::parse` accepts aliases: `"category"` → Collection, `"docs"` →
Documentation. rs-trafilatura's INTERNAL enum variant is `Category` but it SERIALIZES
as `"collection"` (`PageType::Category.as_str() == "collection"`), and its `FromStr`
accepts both `"category"` and `"collection"`. So: internal Category ⇔ wire string
`"collection"`.

## Stage-1 URL heuristics (`classify_url`, ordered)

Empty URL → Article. Else lowercase, split to (domain, path), then in THIS order
(first match wins):

- Forum: `contains_any(domain, FORUM_DOMAINS) || contains_any(path, FORUM_PATHS) || contains_any(url_lower, FORUM_URL_PATTERNS)` → Forum.
- Documentation: `contains_any(domain, DOCS_DOMAINS) || contains_any(path, DOCS_PATHS)` → Documentation. (Checked BEFORE article so `/docs/guide/` is docs.)
- Product: `contains_any(path, PRODUCT_PATHS) || contains_any(domain, PRODUCT_DOMAINS)` → Product. (Before category.)
- Category: `contains_any(path, CATEGORY_PATHS)` → Category (serialized "collection").
- Service: `contains_any(path, SERVICE_PATHS) || contains_any(url_lower, SERVICE_SLUG_PATTERNS)` → Service.
- Listing: `path.trim_end_matches('/')` then any `LISTING_PATH_ENDINGS` is a suffix, OR `contains_any(path, LISTING_PATH_CONTAINS)` → Listing.
- Article: `contains_any(path, ARTICLE_PATHS) || contains_any(url_lower, BLOG_SLUG_PATTERNS)` → Article.
- Default → Article.

### URL pattern constant lists (rs-trafilatura mod.rs — authoritative, verbatim)

FORUM_DOMAINS: `"forum."`, `"forums."`, `"community."`, `"discuss."`,
`"discussion."`, `"users."`, `"bbs."`, `"reddit.com"`, `"stackoverflow.com"`,
`"stackexchange.com"`, `"gamefaqs."`, `"discourse."`, `"news.ycombinator.com"`,
`"quora.com"`, `"lemmy."`, `"tapatalk.com"`, `"webhostingtalk.com"`, `"netmums.com"`,
`"mumsnet.com"`, `"nairaland.com"`, `"lobste.rs"`.

FORUM_PATHS: `"/forum"`, `"/forums/"`, `"/thread/"`, `"/threads/"`, `"/topic/"`,
`"/topics/"`, `"/discussion/"`, `"/discussions/"`, `"/community/"`, `"/t/"`,
`"/questions/"`, `"/question/"`, `"/comments/"`, `"/talk/"`.

FORUM_URL_PATTERNS: `"/viewtopic.php"`, `"/showthread.php"`, `"/item?id="`.

DOCS_DOMAINS: `"docs."`, `"doc."`, `"wiki."`, `"devdocs."`, `"man7.org"`,
`"readthedocs.io"`, `"readthedocs.org"`, `"developer.hashicorp.com"`,
`"developer.mozilla.org"`.

DOCS_PATHS: `"/docs/"`, `"/doc/"`, `"/documentation/"`, `"/reference/"`, `"/api/"`,
`"/guide/"`, `"/tutorial/"`, `"/tutorials/"`, `"/manual/"`, `"/handbook/"`,
`"/wiki/"`, `"/man-pages/"`, `"/man/"`, `"/concepts/"`, `"/userguide/"`,
`"/quickstart"`, `"/getting-started"`, `"/book/"`, `"/glossary/"`, `"/tech_notes/"`.

PRODUCT_PATHS: `"/products/"`, `"/product/"`, `"/shop/"`, `"/dp/"`, `"/ip/"`.

PRODUCT_DOMAINS: `"shop."`, `"store."`.

CATEGORY_PATHS: `"/collections/"`, `"/collection/"`, `"/categories/"`,
`"/category/"`, `"/browse/"`, `"/cat/"`, `"/subcategory/"`.

SERVICE_PATHS: `"/services/"`, `"/service/"`, `"/services.html"`, `"/solutions/"`,
`"/solution/"`, `"/offerings/"`, `"/what-we-do"`.

SERVICE_SLUG_PATTERNS: `"-consulting-services"`, `"-development-services"`,
`"-management-services"`, `"-support-services"`, `"-outsourcing-services"`,
`"-integration-services"`, `"-development-company"`, `"-consulting-company"`,
`"-ai-consulting"`, `"-ai-development"`, `"-ai-solutions"`.

LISTING_PATH_ENDINGS (suffix match on path with trailing '/' trimmed): `"/news"`,
`"/testimonials"`, `"/coupons"`, `"/issues"`, `"/reviews"`, `"/rankings"`,
`"-courses"`.

LISTING_PATH_CONTAINS: `"/awards/"`, `"/trending/"`, `"/list/"`.

ARTICLE_PATHS: `"/blog/"`, `"/blog"`, `"/news/"`, `"/article/"`, `"/articles/"`,
`"/post/"`, `"/posts/"`, `"/insight/"`, `"/insights/"`, `"/resource/"`,
`"/resources/"`, `"/stories/"`, `"/magazine/"`, `"/journal/"`, `"/press/"`,
`"/editorial/"`, `"/opinion/"`, `"/review/"`, `"/column/"`.

BLOG_SLUG_PATTERNS: `"-ways-to-"`, `"-tips-"`, `"-reasons-"`, `"-steps-to-"`,
`"-things-to-"`, `"-best-"`, `"-top-"`, `"-essential-"`, `"beginners-guide"`,
`"complete-guide"`, `"ultimate-guide"`, `"how-to-"`, `"what-is-"`, `"why-"`,
`"when-to-"`, `"-vs-"`, `"-versus-"`, `"-comparison"`, `"-checklist"`, `"-trends-"`,
`"-strategies-"`, `"-challenges-"`, `"-benefits-"`, `"-advantages-"`.

DIVERGENCE (flag): `web-page-classifier/src/url_heuristics.rs` has a SLIGHTLY
different FORUM_DOMAINS list (includes `"board."`, `"boards."`, `"slashdot.org"`,
`"disqus.com"`, `"thestudentroom.co.uk"`, `"mumsnet.com/talk"`; omits `"discussion."`,
`"users."`, `"bbs."`, `"gamefaqs."`, `"lemmy."`, `"tapatalk.com"`,
`"webhostingtalk.com"`, `"netmums.com"`, `"nairaland.com"`) and FORUM_PATHS uses
`"/forum/"` instead of `"/forum"`. The feature extractor and rs-trafilatura's own
`classify_url` use the mod.rs lists above — use THOSE (the mod.rs lists are the port
target). The url_heuristics.rs lists belong to the standalone crate's own
`classify_url` and are NOT used by `extract_ml_features`.

## Stage-2 HTML signals

### `HtmlSignals` struct fields

- `og_type: Option<String>` — copied from `metadata.page_type` (raw og:type).
- `ld_types: Vec<String>` — `@type` values parsed (JSON-parsed, original case) from
  all `script[type="application/ld+json"]` blocks.
- `has_aggregate_offer: bool` — any JSON-LD Product with an AggregateOffer in offers.
- `has_add_to_cart: bool` — `ADD_TO_CART_PATTERNS` in class/id OR cart button text.
- `has_product_grid: bool` — `PRODUCT_GRID_PATTERNS` in class/id.
- `product_element_count: usize` — count of product-class elements.
- `has_pagination: bool` — rel=next / pagination CSS / page-number links.
- `code_block_count: usize` — `select("code, pre").length()`.
- `has_docs_nav: bool` — doc-style sidebar/TOC navigation present.
- `link_ratio: f64` — `link_count / p_word_count` if `p_word_count > 0`, else
  `link_count` (as f64) if `link_count > 0`, else `0.0`.
- `paragraph_word_count: usize` — `select("p").text().split_whitespace().count()`.

PRODUCT_GRID_PATTERNS: `"product-grid"`, `"product-list"`, `"product-listing"`,
`"products-grid"`, `"product-card"`, `"product-tile"`, `"collection-products"`,
`"search-results-products"`.

ADD_TO_CART_PATTERNS: `"add-to-cart"`, `"add_to_cart"`, `"addtocart"`,
`"add-to-bag"`, `"buy-now"`, `"buynow"`.

### `refine_with_html_signals(url_type, signals)` — ONLY overrides Article

`MIN_PRODUCT_ELEMENTS_FOR_CATEGORY = 5`. If `url_type != Article`, return `url_type`
unchanged. Otherwise, in order (first match wins):

- `has_category_signal(signals)` → Category. (See below.)
- `og_type` (lowercased) `== "product.group"` OR `== "product:group"` → Category.
- `product_element_count >= 5` AND (`has_pagination` OR (`has_product_grid` AND `has_add_to_cart`)) → Category.
- `has_product_signal(signals)`:
  - if `has_product_grid` AND NOT `has_single_product_ld(signals)` → Category;
  - else → Product.
- `has_product_grid` AND `has_add_to_cart` → Category.
- `has_docs_nav` AND `code_block_count >= 3` → Documentation.
- `code_block_count >= 500` → Documentation.
- `link_ratio >= 3.0` AND `paragraph_word_count < 30` → Listing.
- Else → Article.

`has_category_signal`: true if any ld_type in `{CollectionPage, OfferCatalog,
ProductCollection}`; OR (any ld_type in `{Product, ProductGroup}` AND
`has_aggregate_offer`); OR (ld_type `ItemList` AND (`has_product_grid` OR
`product_element_count >= 5`)).

`has_product_signal`: false if `has_aggregate_offer`; else true if og_type contains
`"product"` (and not `product.group`/`product:group`); else true if any ld_type in
`{Product, ProductGroup}`.

`has_single_product_ld`: false if `has_aggregate_offer`; else true if any ld_type in
`{Product, ProductGroup}`.

(ld_type string comparisons are EXACT, case-sensitive — they compare against the
original-case `@type` strings parsed from JSON-LD.)

## 3-stage cascade (extract.rs ~55-92) — how the final type+confidence is chosen

When the page type is not manually overridden:

1. `url_type = classify_url(url)`.
2. `html_signals = extract_html_signals(doc, metadata)`; `refined = refine_with_html_signals(url_type, html_signals)`.
3. `ml_features = extract_ml_features(...)`; `title_meta = "{title} {description}"`;
   `(ml_type, ml_conf) = classify_ml(ml_features, title_meta)`.

Selection:

- if `url_type != Article && ml_type == url_type` → `(url_type, 1.0)`.
- else if `refined != Article && ml_type == refined` → `(refined, 0.95)`.
- else → `(ml_type, ml_conf)`.

So URL/HTML heuristics WIN (with synthetic confidence 1.0 / 0.95) only when the ML
agrees with a non-Article heuristic; otherwise the ML is the final authority.

## Quality model (context only — separate model, not the page-type classifier)

`N_QUALITY_FEATURES = 27`, magic `XGBQ`, REGRESSION (not classification): predicts an
estimated F1 in [0,1]. `predict` = `0.5 (base_score) + sum(tree.evaluate)`, clamped
to [0,1]. Feature order is documented in lib.rs (heuristic_conf, content_len,
word_count, vocab_ratio, ..., one-hot is_article..is_service at 13-19, ...,
top_bigram_freq at 26). The page-type spec above is independent of this; included
only so the port author does not confuse the two models. Out of scope for the
classifier port unless explicitly tasked.

## Ambiguities flagged for the port author

- TF-IDF ngram_range and token_pattern: the rust path supports unigram exact-token
  matches PLUS space-containing vocabulary phrases via substring (effectively
  unigrams + bigrams). The shipped sklearn config must choose `ngram_range`
  (likely `(1, 2)`) and `token_pattern` to MATCH whatever produced the shipped vocab.
  sklearn's DEFAULT `token_pattern` (`(?u)\b\w\w+\b`) drops 1-character tokens,
  whereas the rust tokenizer keeps them; pick the config used at training time and
  reproduce it identically on both train and runtime. The vocab/idf JSON is the
  source of truth — both sides transform to match it.
- f[70] section variance flush ordering: the Rust loop flushes the PREVIOUS
  accumulator at the TOP of each iteration, then overwrites it with the current node's
  values, so the FIRST matched node's stats are never the first pushed (they are
  pushed on the next iteration). The final node is flushed after the loop. Whether
  this off-by-one accumulation is intended is unclear, but it is the de-facto behavior
  and MUST be replicated bit-for-bit. The variance is POPULATION variance (÷N).
- f[69] vs f[80]: both compute "count of link texts with frequency >= 3" from the
  same map and are numerically identical. They are intentionally two separate feature
  slots; do not collapse them.
- Byte length vs char count: every `.len()` in `ml.rs` is a Rust `String`/`str`
  byte length (UTF-8 bytes), including the 500_000 gate, f[14]/f[15] paragraph
  thresholds, f[17]/f[58] body_text_len, f[69]/f[73] keyword length checks, and f[70]
  text length. The port MUST use UTF-8 byte length (NOT JS string `.length`, which is
  UTF-16 code units, and NOT Python `len(str)`, which is code points). Encode to UTF-8
  and count bytes for every length comparison/value.
- HashMap iteration determinism: f[63]/f[64]/f[73]/f[74]/f[69]/f[79]/f[80] use
  `HashMap` but only read `.values().max()` / `.filter(count>=3).count()` / `.max()`,
  which are order-independent aggregates — so iteration order does NOT affect outputs.
  No determinism risk there. (Flag retained so the port author does not introduce one
  by adding order-sensitive logic.)
- `extract_domain_path` `//` divergence: documented above — use rs-trafilatura's
  (no `//` strip) for feature parity.
- Stale "81" comments in ml.rs: ignore; the real count is 89.
