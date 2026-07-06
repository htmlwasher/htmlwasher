# htmlwasher-native — SPEC

The Rust boilerplate-removal + page-type extraction core for htmlwasher v2. A simplified
fork of rs-trafilatura's LIVE extraction path, ported through the tested v1 TypeScript core
(`packages/htmlwasher/src/core/*`) with the doc-09 divergences applied. **Rust owns boilerplate
removal + the extraction profiles; the TypeScript layer owns sanitization, metadata, and the
public `wash()` API.** Phase CRATE deliverable (plain lib; napi bindings arrive at Phase BIND).

## Public API

```rust
pub fn extract(html: &str, options: &Options) -> Result<ExtractResult, Error>;
pub fn extract_default(html: &str) -> Result<ExtractResult, Error>;
```

- **`Options`** (`camelCase` serde): `focus: Focus` (`Precision|Balanced|Recall`), `page_type:
Option<PageType>` (drives profile selection; `None` = the `Article` profile / classifier-less),
  `url: Option<String>` (reserved for the classifier phase), `emit_mode: EmitMode`
  (`PreserveMarkup` default / `WhitelistParity`), `include_links`, `include_images`, `exclude_tables`.
- **`ExtractResult`** (`camelCase` serde): `content_html: String`, `page_type: PageType`,
  `confidence: Option<f64>` (`None` this phase), `text_length: usize`, `fallback_used: bool`,
  `warnings: Vec<String>`.
- **`PageType`**: 7 variants; the internal `Category` variant serializes/`as_str()`es to the wire
  string `"collection"` (`FromStr`/serde accept both `category` and `collection`; `docs` →
  `documentation`).
- **`Error`** (thiserror, `#[non_exhaustive]`): `InvalidOption`, `TooDeep`.

## Contract (doc-09)

- **Preserve-markup default emit:** kept nodes keep their ORIGINAL tag + ALL attributes (escaped
  via `html-escape`). The ONLY serializer hard-skip is `script`/`style`/`noscript`/`iframe` (the
  no-script FFI invariant; those are also removed doc-wide by cleaning). Rust sanitizes nothing
  else — `content_html` is script-free but otherwise UNTRUSTED and MUST always flow through the TS
  washing stage.
- **`WhitelistParity`** reproduces the upstream rs-trafilatura fixed tag/attribute whitelist emit
  (non-whitelisted elements unwrapped). Reference-parity testing ONLY.
- **Never panics** on malformed/deeply-nested input — returns a `Result`/total value. All dom_query
  traversal is iterative; the only recursion (the serializer, dom_query's `strip_elements`) is
  bounded by an up-front iterative depth guard (`MAX_TREE_DEPTH = 512`). Table caps
  `MAX_TABLE_CELLS = 20_000`, `MAX_TABLE_TEXT_LEN = 200_000`.
- **`text_length`** is measured from the DOM `text()` of the kept subtree (the "text twin"), never a
  regex tag-strip; the `''`-on-whitespace contract is preserved (empty content → empty HTML).
- **No hidden thread-local state**: rs-trafilatura's `COMMENTS_ARE_CONTENT` is an explicit
  `comments_are_content` field on `CoreOptions` (forums treat `comment*` nodes as content).

## Pipeline (`extract.rs::extract_content`)

parse (`dom_query`/html5ever) → `enforce_max_depth` → `clean_document` (bucket B) → `find_content_node`
(profile selectors → content rules → `article`/`main`/`[role=main]` → readability scoring → body) →
per-render clone (`to_fragment`) with the relocated DOM passes [`prune_unwanted_nodes` link density →
header/footer-outside-`article`/`main` → unconditional `is_always_excluded_name` + BreadcrumbList →
gated `is_boilerplate` (skipped on the backoff path) → empty-node prune] → DUAL-mode serializer →
short-extraction backoff + whole-body fallback.

The **doc-09 backoff guard**: when the gated name filter would empty the content it backs off to the
unfiltered render, while the unconditional always-excluded + BreadcrumbList drops still fire.

## Page-type classifier (3-stage cascade, no ONNX)

When `options.page_type` is `None`, `extract` runs `page_type::classify(&doc, url)` over the raw
document (one parse feeds both classify + extract) and reports `(pageType, confidence)`; `Some` skips it
(confidence `None`). Stages:

- **Stage 1 — URL** (`page_type/url.rs::classify_url`): ordered first-match; `extract_domain_path`
  strips `https://` else `http://` (NOT `//`); empty URL → `Article`.
- **Stage 2 — HTML signals** (`page_type/signals.rs`): `refine_with_signals` ONLY ever overrides
  `Article` (JSON-LD `@type` exact/case-sensitive, og:type, product-grid/cart/pagination, docs-nav+code).
- **Stage 3 — ML**: 189 features (89 numeric scaled by the baked StandardScaler ++ 100 TF-IDF over
  `"{title} {description}"`) → the pure-Rust GBDT over the XGBoost native JSON dump.
- **Confidence** (compare ARGMAX, never floats): `url != Article && ml == url` → `1.0`;
  else `refined != Article && ml == refined` → `0.95`; else `(ml_type, ml_prob)`.

**GBDT** (`page_type/gbdt.rs`): `multi:softprob`, 7 classes, 1400 trees, round-robin `tree_info[i]==i%7`;
strict `<` → left, leaf weight = `split_conditions`; **splits evaluated in float32** (XGBoost stores
features/thresholds as f32 — comparing in f64 shifts probs by up to ~0.3, though argmax is unaffected);
`base_score` cancels under softmax (accumulate from 0). Artifacts (`artifacts/model.xgb.json`,
`artifacts/tfidf-vocab.json`) are `include_str!`-baked and validated once behind a `LazyLock`.

**Locked parity** (target = `training/extract_features.py`, byte-level; verified ≤1e-6 on 15 fixtures):
UTF-8 byte lengths (`str::len`); the CPython `str.split()`/`str.strip()` whitespace class (adds
U+001C–U+001F, U+0085; excludes U+FEFF); selectolax comma-union NO-dedup (one count per matching
sub-selector, document order); the 500_000-byte body-text gate; scikit-learn TF-IDF (smooth_idf, L2);
`<template>` content excluded natively by dom_query/html5ever (matches lexbor).

## napi binding (Phase BIND) — `@htmlwasher/native`

The napi-rs v3 addon surface (`src/binding.rs`), behind the `napi` cargo feature (default
OFF so `cargo test`/`build`/`clippy` build the pure-Rust `lib` with no Node-API symbols;
only `napi build --features napi` compiles the cdylib addon). Deps: `napi` v3 (optional,
`napi9`+`async`), `napi-derive` v3 (optional), `napi-build` v2 (build-dep).

- `extract(html, options?) → Promise<ExtractResult>` — async on the libuv threadpool
  (napi `AsyncTask`; never blocks the event loop).
- `extractSync(html, options?) → ExtractResult` — synchronous.
- `ExtractOptions { pageType?: PageType, focus?: 'precision'|'balanced'|'recall', url?: string }`
  → mapped to the crate `Options` (default emit = preserve-markup).
- `ExtractResult { contentHtml, pageType, confidence?, textLength, fallbackUsed, warnings }`
  — `pageType` is a `PageType` string enum whose 7 values are the wire strings
  (`Category → "collection"`); `confidence` is omitted on a `pageType` override. Typed crate
  errors become JS exceptions (nothing panics). `index.d.ts` is auto-generated.

Packaging (contextractor committed-prebuild pattern): `package.json` (`@htmlwasher/native`,
private) with a self-skipping `build` (skips when no `CARGO_HOME`/`npm_config_rebuild_native`
and a prebuild is present) and a `test` that runs `cargo test` + the vitest smoke test when a
toolchain is present, vitest-only otherwise. `optionalDependencies` = 5 native targets +
`wasm32-wasi`, each `npm/<target>/` a private os/cpu-scoped package. The generated loader
(`index.js`/`index.d.ts` + wasm glue) is committed; the crate-root `*.node` is gitignored while
`npm/<target>/*.node` prebuilds are committed. `test/smoke.test.ts` loads the built binding and
extracts a fixture end-to-end.

## Modules

- `options.rs`/`result.rs`/`error.rs` — the public surface.
- `dom.rs` — dom_query helpers (parse, tag/class/id, scoped `select_all`/`select_first`, `text_len`,
  ancestor walk).
- `tags.rs` — the tag catalogs (`TAGS_TO_CLEAN`/`TAGS_TO_STRIP`/`EMPTY_TAGS_TO_REMOVE`/void/hard-skip).
- `patterns.rs` — token/word split + whitespace-collapse helpers.
- `html_processing.rs` — bucket-B `clean_document`, real `remove_comments`, `prune_empty_elements`,
  `enforce_max_depth`.
- `link_density.rs` — `link_density_test(_tables)`, `delete_by_link_density`.
- `selector/{content,discard,utils}.rs` — the content-node cascade, name-based discard predicates,
  content-rule matching.
- `extractor/fallback.rs` — `prune_unwanted_nodes` (reconciled single copy).
- `binding.rs` — the napi-rs v3 addon surface (`extract`/`extractSync`), behind the `napi` feature.
- `build.rs` — `napi_build::setup()` (cdylib link args).
- `page_type/mod.rs` — `PageType` + the 7 `ExtractionProfile` constants (verbatim) + the `classify`
  cascade.
- `page_type/{url,features,tfidf,gbdt,model,signals}.rs` — the 3-stage classifier: URL heuristics, the
  89-numeric extractor, the sklearn TF-IDF, the pure-Rust GBDT evaluator, the baked-artifact loader +
  ML inference, and the HTML-signal refinement.
- `extract.rs` — orchestration (`extract_from_doc` runs on the already-parsed, post-classify document),
  the DUAL-mode serializer + text twin, relocated DOM passes, table caps.

## Deviations from the reference

- **`html-cleaning` NOT a dependency** — 0.3.0 pins `dom_query 0.24`, incompatible with the mandated
  `dom_query 0.28`; bucket-B cleaning is ported directly from the tested v1 `clean.ts`.
- **dom_query `unwrap_node` is never used** — it removes a node's PARENT, not the node; tag stripping
  uses `strip_elements`.
- **GBDT splits evaluated in float32** to match XGBoost (f64 comparison shifts probs; argmax unaffected).
- **`onnxruntime` NOT used** — the classifier is a pure-Rust GBDT over the XGBoost JSON dump (no ONNX).
- **`unsafe_code = "deny"` (not `forbid`)** at the workspace — our code never writes `unsafe`, but
  napi-derive's generated addon code requires it via a local `#[allow(unsafe_code)]`, which `forbid`
  (unlike `deny`) would reject, making the binding uncompilable. The `napi` feature is default-OFF so
  the deny is trivially satisfied on the pure-Rust builds.
- **Deferred this phase:** `aggregate_sections`/`collect_repeated_items` post-passes (carried as
  profile config; measured at VALIDATE) and the structured JSON-LD/Discourse/baseline rescue paths.
  The v1-equivalent core cascade + backoff + body fallback is ported.

## Gate

`cargo build --workspace`, `cargo test --workspace` (95 tests), `cargo clippy --workspace
--all-targets -- -D warnings` (+ `--features napi` to lint the binding), `cargo fmt --check` — all
green. Monorepo: `pnpm build` (native self-skips to the committed prebuild), `pnpm lint`, `pnpm test`
(flagship v1 suite + the native vitest smoke test) all green. `tests/classifier_parity.rs` is the
CLASSIFY gate: numeric ≤ 1e-6, tfidf ≤ 1e-6, probs ≤ 1e-4, argmax 100% on all 15 fixtures (actual:
numeric ≤ 3.4e-13, tfidf ≤ 2.2e-16, probs ≤ 6.9e-8, argmax 15/15). Production code uses `Result` + `?`
(no `unwrap`/`expect`/`unsafe`); tests permit unwrap/expect via `clippy.toml` + a per-file allow.
The adbar sanity test skips gracefully when `~/r/htmlwasher-sources/trafilatura/tests/cache` is absent.
