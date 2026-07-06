# PORTING-NOTES.md — htmlwasher port

Working reference for the phased port defined in
[`@/prompts/2026-6-24-init/prompt.md`](prompts/2026-6-24-init/prompt.md). Records the
source→target module mapping, resolved questions, parity gotchas, and open
questions. Kept current as phases land (per the Phase 7 gate and the deliverables
checklist). Built from a Phase 0 reconnaissance of the reference repos under
`~/r/htmlwasher-sources/` and the sibling projects `~/r/tools/packages/htmlprocessing-server`
and `~/r/contextractor`.

---

## v2 — Rust extraction core rebuild (hybrid Rust + TypeScript)

> Everything **below this `## v2` heading down to the `## v1 record` marker** is the living
> v2 migration reference for [`@/prompts/2026-6-24-init/prompt.md`](prompts/2026-6-24-init/prompt.md)
> (the 2026-07-06 rewrite: Rust boilerplate/classifier core, TS-owned sanitization,
> contextractor layout, no ONNX). The sections after the `## v1 record` marker are the
> historical all-TypeScript v1 port notes, kept as the regression oracle.

## v2 status (phase tracker)

- **Operating mode: UPDATE-IN-PLACE.** A working v1 exists (now at `@/packages/*` after Phase
  RESTRUCTURE — originally `@/htmlwasher/` + `@/tools/htmlwasher/`); `pnpm test` is green (28 corpus
  fixtures @ 100% page-type accuracy, 0 security failures; ~369 lib tests). v1 is the regression
  oracle. Branch `rust-core`.
- **Phase ORIENT — done** (this block). Module map, strip list, dormant exclusion, perf
  baseline below. No production code.
- **Phase FLOOR — done.** The TS washing floor is now UNCONDITIONAL: `enforceSecurityFloor`
  then `sanitizeStyledHtml` run as the final pass on EVERY `washHtml` path (preset, custom
  config, and `correct`), no longer gated on `configAllowsStyle`. This closes the doc-09 bypass
  where a custom `{ allowedAttributes: { '*': ['*'] } }` config passed shape validation and kept
  `onclick` plus a `javascript:` CSS URL. New regression tests: the exact wildcard config
  (`wash.test.ts`) and hostile input through the public `wash()` at every level with
  `boilerplate: 'balanced'` (`pipeline.test.ts`); the wash-corpus-tester now hard-asserts security
  at EVERY level incl. `correct` (stale soft-exemption removed from `corpus-runner.ts`/`report.ts`).
  SPECs updated. `pnpm build && lint && test` green (377 lib tests; corpus 28 fixtures,
  security-failures-at-all-levels 0, verdict PASS).
  - **Gotcha (carry into every later phase gate): a cached-green `pnpm test` is NOT a real run.**
    The baseline `pnpm test` reported `FULL TURBO` (all 4 tasks cached), so `htmlwasher#test` never
    actually executed — a hardcoded stale-session scratchpad path in `cli-program.test.ts`
    (`/private/tmp/.../<old-session-id>/scratchpad`) was ENOENT-ing and only surfaced once a source
    edit invalidated the turbo cache. Fixed to a per-run `mkdtemp` temp dir. Lesson: after each phase
    force a genuine run (`turbo run test --force`, or rely on a source edit to bust the cache); never
    trust cached green as the regression oracle. And capture the real exit code — a piped
    `pnpm test | tail` masks it behind `tail`'s exit status.
- **Phase RESTRUCTURE — done.** Adopted the contextractor flat `packages/*` layout via `git mv`:
  `htmlwasher` to `packages/htmlwasher`, `tools/htmlwasher/{wash-corpus-tester,live-crawl-tester}` up
  to `packages/*`, `tools/` dissolved. Package NAMES unchanged (`htmlwasher` published; `@htmlwasher/*`
  testers private). `pnpm-workspace.yaml` set to the three contextractor globs; tsconfig `extends`
  depth fixed (flagship gains one `../`, each tester loses one); `knip.json` workspace keys, the
  `spec-gate.sh`/`test-gate.sh` path matchers, and off-by-one relative doc links (`../../../` to
  `../`/`../../`) all repointed; full `tools/htmlwasher | @/htmlwasher/` sweep across CLAUDE.md
  (structure tree + SPEC mapping), root SPEC.md, READMEs, `.claude/**`, `.gitignore`, and training
  docs. `pnpm ls -r` shows every package at its new path with its name unchanged. Gate green:
  `pnpm build && lint && test` (377 lib tests; corpus 28 fixtures PASS).
- **Phase CRATE — done.** `packages/htmlwasher/native/` (crate `htmlwasher-native`, plain lib —
  cdylib/napi land at BIND) ports the live rs-trafilatura path through the tested v1 TS core with
  the doc-09 divergences: bucket-B cleaning (`html_processing.rs` + `tags.rs`), the content-node
  cascade (`selector/{content,discard,utils}.rs`), link density (`link_density.rs`), the relocated
  `prune_unwanted_nodes` (`extractor/fallback.rs`), the 7 profiles + `PageType` (`page_type/mod.rs`),
  and orchestration + the DUAL-mode serializer (`extract.rs`). Gate green: `cargo build/test`
  (63 tests: 8 unit + 55 integration incl. the doc-09 backoff guards + malformed no-panic corpus +
  adbar sanity), `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`. Decisions/deviations:
  - **`html-cleaning` NOT wired.** 0.3.0 pins `dom_query 0.24`, type-incompatible with the mandated
    `dom_query 0.28` (two dom_query trees). Bucket-B cleaning is ported directly from the tested v1
    `clean.ts` instead — faithful + license-clean. (Resolves the CRATE license open question moot.)
  - **dom_query `unwrap_node` is a footgun**: it removes a node's _parent_ (promoting the node + its
    siblings), NOT "replace element with its children". Tag stripping uses `strip_elements` (correct
    keep-children unwrap); `unwrap_node` is never used. This was the root cause of a 93%-content-loss
    bug via `<meta>` in `<body>` (microdata) during cleaning.
  - **Depth guard enforced.** `enforce_max_depth` (iterative, `MAX_TREE_DEPTH=512`) runs before
    cleaning so no downstream recursion (dom_query's recursive `strip_elements`, the serializer)
    overflows; verified on 3000-deep divs / 2000-deep tables in dev AND release. Table caps
    (`MAX_TABLE_CELLS=20_000`, `MAX_TABLE_TEXT_LEN=200_000`) enforced in the serializer.
  - **`remove_comments` implemented for real** (rs's `dom.rs` stub is a no-op) as a DOM comment strip.
  - **`prune_unwanted_nodes` reconciled to ONE copy** in `extractor/fallback.rs`.
  - **`COMMENTS_ARE_CONTENT` thread-local → explicit `comments_are_content` field** on `CoreOptions`.
  - **`textLength` from DOM `text()`** of the kept subtree (the text twin), never regex; `''`-on-
    whitespace contract preserved.
  - **DEFERRED (honest partial):** `aggregate_sections`/`collect_repeated_items` post-passes (dead
    flags in v1; carried as profile config, effect measured at VALIDATE) and the structured
    JSON-LD/Discourse/baseline rescue fallbacks are NOT ported this phase — the v1-equivalent core
    cascade (selector → semantic → scoring → body) + backoff + body fallback is.
  - **RE-BASELINED tests:** the v1 "no class/style/id leakage" assertions invert under preserve-markup
    (attributes SURVIVE); the original whitelist behavior is retained behind `EmitMode::WhitelistParity`
    and tested there. `precision`↔`recall` does not change output on the 4 adbar pages (matches v1's
    documented finding); its observable effect is proven by synthetic link-density tests in `tests/extract.rs`.
- **Phase CLASSIFY — done.** The 3-stage cascade + confidence + 189-feature extractor + pure-Rust GBDT
  landed in `packages/htmlwasher/native/src/page_type/{url,features,tfidf,gbdt,model,signals}.rs` + the
  `classify` fn in `mod.rs`, wired into `lib.rs::extract` (one parse feeds classify + extract; auto-classify
  when `page_type` is `None`, else the override with confidence `None`). Ported from the proven v1
  `src/classifier/*` (100%-parity target). Artifacts `artifacts/{model.xgb.json,tfidf-vocab.json}` are
  `include_str!`-baked + `LazyLock`-validated. **Parity gate GREEN** (`tests/classifier_parity.rs`, 15
  fixtures): numeric ≤ 3.4e-13, tfidf ≤ 2.2e-16, probs ≤ 6.9e-8, **argmax 15/15**. Full gate: 95 tests,
  `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check` all green. Key findings:
  - **GBDT must evaluate splits in float32.** XGBoost stores features/thresholds as f32; comparing in f64
    branches differently for a feature value near a split threshold, shifting probs by up to ~0.31 on one
    fixture (argmax unaffected). Casting `(v as f32) < (thr as f32)` in `gbdt.rs` dropped the worst prob
    diff from 3.1e-1 to 6.9e-8. (Resolves the fixture-0 vs fixture-4853 discrepancy.)
  - **`base_score` (0.5) is inert.** A single scalar added to all 7 class margins → cancels under softmax;
    margins accumulate from 0. `default_left` is present but never set (dense features) — the defensive
    branch never fires. No early stopping (all 1400 trees; `iteration_indptr` = 201, attributes empty).
  - **`<template>` needs NO explicit stripping.** Unlike linkedom (which forced the v1 `parseDocumentSpec`
    template removal), dom_query/html5ever stores template children in a separate `template_contents`
    fragment, so `.text()`/selectors/`children()` never descend into them — matching lexbor natively.
  - **`dom::parse` == `parseDocumentSpec`.** html5ever's spec parse matches lexbor/selectolax on nested
    `<body>` coercion + trailing whitespace text nodes; body-text parity is exact (f[58] within 1e-13).
  - **`onnxruntime` dropped** — the classifier is a pure-Rust GBDT over the XGBoost JSON dump.
  - **Python side (`training/`):** ONNX export removed; `train.py` writes the XGBoost native JSON dump
    (`clf.get_booster().save_model` → `native/artifacts/model.xgb.json`) + `tfidf-vocab.json`;
    `make_parity_fixtures.py` emits `native/tests/fixtures/classifier-parity.json` (15 fixtures). The retrain
    is deterministic: held-out accuracy **0.7769** / macro-F1 0.6632 (matches v1), the model is byte-identical
    to v1's, JSON round-trip argmax 100%. `pytest` + `ruff` green; `onnxmltools`/`skl2onnx` dropped from
    `requirements.txt`; the training-root `model.onnx` removed. v1's shipped `src/classifier/model/*` untouched
    (it leaves at INTEGRATE), so the v1 suite stays green.
  - **Gotcha — biome reformats generated JSON artifacts.** `pnpm build`'s `pnpm fix` (biome) reformatted
    `native/artifacts/tfidf-vocab.json` (biome skips the 1.8 MB `model.xgb.json` — over its size limit — but
    not the small vocab), which breaks artifact reproducibility vs `training/`. Fixed: added
    `!**/native/artifacts` to `biome.json` `files.includes` (alongside `!**/classifier/model` + `!**/fixtures`).
    Always regenerate artifacts from `training/` (canonical `json.dumps`); never let biome touch them.
- Phases BIND → INTEGRATE → VALIDATE → RETEST → POLISH — pending. Gate each
  before advancing; commit per phase; keep `pnpm test` green.

## v1 performance baseline (measured at ORIENT, before the TS core is deleted)

Phase VALIDATE compares the Rust core against these (expect Rust faster). Harness:
`extractContentHTML(html, { focus: 'balanced' })` over every cached adbar page,
5 iters/page after a warmup pass, per-page median.

- Environment: **node v22.13.1**, adbar corpus = **110 pages / 14.04 MB**
  (`~/r/htmlwasher-sources/trafilatura/tests/cache`), errors=0.
- **Sum of per-page median wall time = 1033 ms**; per-page **p50 = 8.42 ms, p95 = 22.54 ms**;
  throughput ≈ 13.6 KB/ms.
- Slowest: `correctiv.org.zusage.html` (409 KB) 37.2 ms; **large-page sample**
  `pcgamer.com.skyrim.html` (906 KB) **20.9 ms** median.
- Harness saved at `scratchpad/perf-baseline.mjs` (session scratchpad) — re-run pattern for
  the Rust comparison at VALIDATE (time the napi `extract()` over the same 110 pages).

## Target crate layout (contextractor pattern)

```text
Cargo.toml                              # root workspace: members=["packages/htmlwasher/native"], resolver="2",
                                        #   [workspace.package] version/edition(2024)/license(Apache-2.0)/repository,
                                        #   [workspace.lints] contextractor's clippy set + unsafe_code="forbid"
                                        #   (contextractor uses "warn"; v2 tightens), [profile.release] lto/opt3/cu1/strip.
                                        #   Cargo.lock IS committed (pnpm-lock gitignore does NOT extend to Cargo).
packages/htmlwasher/native/            # crate `htmlwasher-native` = npm `@htmlwasher/native` (private, publish=false)
  Cargo.toml                            #   [lib] crate-type=["cdylib"]; deps: napi v3 + napi-derive v3, dom_query,
                                        #   tendril, html-cleaning, regex, serde/serde_json, thiserror, url;
                                        #   build-deps: napi-build v3. (contextractor uses napi v2 + a crates.io
                                        #   rs-trafilatura dep — v2 FORKS the live path INTO this crate instead.)
  build.rs                              #   fn main(){ napi_build::setup(); }
  src/
    lib.rs                              #   #[napi] extract/extractSync surface (Phase BIND) + module wiring
    options.rs result.rs error.rs       #   Options/ExtractResult/typed Error (thiserror; napi→JS exceptions)
    dom.rs                              #   dom_query wrappers (from rs dom.rs — live subset)
    patterns.rs                         #   the live regex subset (from rs patterns.rs)
    html_processing.rs                  #   doc_cleaning_with_profile + the html-cleaning trafilatura preset (bucket B)
    link_density.rs                     #   link-density tests
    tags.rs                             #   TAGS_TO_CLEAN/STRIP/EMPTY_TAGS/TABLE_TAGS + VALID_TAG_CATALOG
                                        #     (relocated OUT of dormant extractor/tags.rs)
    selector/{mod,content,utils,discard}.rs   #   content selection + PARTIAL discard (should_discard + OVERALL_DISCARDED_CONTENT)
    extractor/fallback.rs               #   the ONE live extractor submodule (JSON-LD/Discourse/baseline/external-cmp)
    extract.rs                          #   orchestration, node cascade, DUAL-mode serializer + text twin, comments, tables
    page_type/{mod,ml,features,gbdt}.rs #   3-stage cascade + 189-feature extractor + pure-Rust GBDT evaluator
  artifacts/{model.xgb.json,tfidf-vocab.json}   #   include_str!-ed, LazyLock-validated (training/ exports these)
  tests/fixtures/                       #   Python↔Rust parity fixtures (written by training/)
  npm/<target>/                         #   5 platform pkgs w/ COMMITTED prebuilt .node (private, file:-linked optionalDeps)
  package.json / SPEC.md                #   self-skipping build/test scripts (contextractor pattern)
```

`pnpm-workspace.yaml` globs (contextractor, verbatim): `packages/*`, `packages/*/native`,
`packages/*/native/npm/*`. `.gitignore`: `target/` + `packages/htmlwasher/native/*.node`
ignored, `npm/<target>/*.node` tracked. `knip.json`: ignore the generated `native/index.js`
loader. `turbo.json` stays minimal (`build`→`dist/**`; `test`/`lint` dependsOn `^build`).
The napi boundary (consumed only by `pipeline.ts`) is the frozen shape in the brief's
"Project structure" section: `extract(html, {pageType?, focus?, url?})` →
`{ contentHtml, pageType, confidence?, textLength, fallbackUsed, warnings }`.

## rs-trafilatura live-path → crate module map

All anchors are `~/r/htmlwasher-sources/rs-trafilatura/src/` at v0.2.2; bare `NN` = `extract.rs:NN`.
KEEP / STRIP / RELOCATE per the brief's strip list + doc 09. **rs-trafilatura ships two parallel
implementations; only the LIVE path is ported** — namely `extract.rs`, `extractor/fallback.rs`,
`selector/{mod,content,utils,discard}`, `html_processing.rs`, `link_density.rs`, `patterns.rs`,
`dom.rs`, and `page_type/`.

### Orchestration — `extract_content` (`extract.rs:36`, single live entry via `lib.rs:139`)

| Stage (anchor)                                                                                                                                       | Disposition                                   | Note                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `42` `Document::from(html)` parse                                                                                                                    | **KEEP**                                      | dom_query/html5ever root = the FFI DOM root                                                                                |
| `52` `metadata::extract_metadata`                                                                                                                    | **STRIP**                                     | whole `metadata/` module — TS owns the sidecar                                                                             |
| `55-92` 3-stage cascade + confidence                                                                                                                 | **KEEP**                                      | Rust owns cascade + confidence (see classifier section)                                                                    |
| `113` `doc_backup = clone_document`                                                                                                                  | **KEEP**                                      | pre-clean tree for fallbacks                                                                                               |
| `118-132` structured fallbacks (`fallback.rs` JSON-LD articleBody `:150`, Product desc `:188`, Discourse `:44`), gated `MIN_STRUCTURED_BODY_LEN=500` | **KEEP**                                      | live rescue paths                                                                                                          |
| `135` `extraction_profile()` → 7 profiles (`page_type/mod.rs:80-90,155-345`)                                                                         | **KEEP**                                      |                                                                                                                            |
| `138-150` `effective_options`; forum forces `include_comments=true` + sets thread-local                                                              | **KEEP** coupling / **RELOCATE** thread-local | see re-entrancy fix                                                                                                        |
| `154` `html_processing::doc_cleaning_with_profile`                                                                                                   | **KEEP**                                      | bucket-B cleaning (html-cleaning preset + profile preserve/boilerplate selectors)                                          |
| `159` `extract_main_content_with_profile` (`1358`) → node cascade + serializers                                                                      | **KEEP**                                      |                                                                                                                            |
| `175-226` under-extraction + `try_fallback_extraction` (`1007`)                                                                                      | **KEEP**                                      | wraps `fallback::compare_external_extraction`/`candidate_is_usable`/`baseline`                                             |
| `231-247` `try_multi_candidate_merge` (`644`) — profile `aggregate_sections`                                                                         | **KEEP**                                      | **newly live vs v1** (v1 had a dead flag) — may move VALIDATE scores                                                       |
| `252-266` `try_collect_repeated_items` (`524`) — profile `collect_repeated_items`                                                                    | **KEEP**                                      | **newly live vs v1** — may move VALIDATE scores                                                                            |
| `273-286` `extract_collection_description` (`472`) for Category                                                                                      | **KEEP**                                      |                                                                                                                            |
| `292-372` JSON-LD Product rescue + structured-data preference                                                                                        | **KEEP**                                      |                                                                                                                            |
| `379-390` `extract_comments` (`3331`, KEEP) / `extract_images` (`3352`, **STRIP**)                                                                   | mixed                                         | comments KEEP behind include_comments; ImageData collection STRIP                                                          |
| `401-406` `compute_extraction_quality_heuristic` (`880`)                                                                                             | **KEEP**                                      | feeds `warnings`; the ML twin `compute_extraction_quality_ml` (`775`→`predict_quality`) is **STRIP** (dead + `scoring.rs`) |
| `409-421` build `ExtractResult`                                                                                                                      | **KEEP** content fields                       | **STRIP** `content_markdown`, `images`, metadata sub-struct                                                                |
| `425-442` `output_markdown`→`quick_html2md`                                                                                                          | **STRIP**                                     | markdown path + `markdown.rs`                                                                                              |
| `448` `apply_final_validations` (`1081`)                                                                                                             | **KEEP**                                      | min/max len + word-count warnings; **measure textLength from DOM textContent, not regex**                                  |

Dead code inside `extract.rs` to STRIP: `strip_link_dense_sections` (`1150`, disabled `1086`),
`try_length_based_fallback` (`1251`), `strip_navigation_boundaries` (`3719`), back-compat shims
`find_main_content_node` (`1822`) / `find_heuristic_content_node` (`2063`).

### Node cascade — `find_main_content_node_with_profile` (`1831`)

Priority (first hit wins): profile `content_selectors` (`1838`, gated text>100) → content rules
`selector::content::find_content` (`content.rs:618`, the only live `selector/` path besides
`discard.rs`) → `ARTICLE_SELECTOR` (`1864`) → `MAIN_SELECTOR` (`1882`) → heuristic
`find_heuristic_content_node_with_options` (`2068`, `score_content_node` `2182`: text cap 8000,
+200/p, +300/substantive-p, +100/h, +50/sentence, +10/depth, `class_score` `2035`, link-density
mult; threshold **favor_precision 5000 / favor_recall 500 / default 1000** `2149`; coverage <0.3
reject). Bottom-up recovery (text<1000): ancestor walk-up (`1404`) → `find_content_node_bottom_up`
(`1905`, Readability paragraph scoring, min score 10). **KEEP the whole cascade — this is Rust's reason to exist.**

### Serializer — `push_filtered_html_children` (`2700`; entry `2680`) → DUAL-mode

- Current behavior = the v2 **whitelist parity mode** (retained behind an `Options` flag for
  upstream reference-parity testing ONLY). Emit whitelist `2797-2834`
  (`p div section article main h1-h6 blockquote pre code strong em b i a ul ol li dl dt dd table…col`);
  attrs emitted only `a@href`/`code@class`/`td,th@colspan,rowspan`; non-whitelist elements **unwrapped** (`2879`).
- **v2 default = preserve-markup:** emit each kept node's **original tag + ALL original attributes**,
  text/attr values escaped (`escape_html` `2889`), voids handled. SKIP and EMIT never interleave →
  a verbatim branch is ~40-70 LOC. Sanitizes nothing (TS owns tag/attr/scheme/CSS).
- **Skip guards** (`2717-2755`): `script|style|noscript|iframe` → **KEEP** in serializer (zero-cost
  no-script FFI invariant); `header`/`footer`-outside-`article`/`main` (`2717`), `nav|aside|svg|ins`,
  `is_always_excluded_name` (`2727`, list `2934`), BreadcrumbList itemtype (`2750`) → **RELOCATE to DOM
  passes**; `is_boilerplate` when `filter_named_boilerplate` (`2738`) → **KEEP** (bucket A) but relocated
  off the emit path and NOT re-run on the backoff-rescued content; layout-table unwrap (`2759`, `is_layout_table` `2896`).
- Text twin `extract_filtered_text_inner` (`2331`) — **KEEP internal** (fallbacks measure text length; only
  HTML is exposed). Move its `header` look-up (`2403`), name guards, BreadcrumbList check (`2499`) to the same DOM passes.

### Comments + tables

- `extract_comments` (`3331`, the LOCAL fn — NOT dormant `extractor/comments.rs`); `find_comment_section`
  (`3568`). **KEEP** behind `include_comments`, which the **forum** profile force-enables (`138`) while
  flipping `COMMENTS_ARE_CONTENT` (`148`) so `is_boilerplate` uses `BOILERPLATE_CLASS_NO_COMMENTS`.
- Tables: `MAX_TABLE_CELLS = 20_000` (`2969`), `MAX_TABLE_TEXT_LEN = 200_000` (`2970`) — **KEEP exact**;
  `extract_table_text` (`2992`), `is_layout_table` (`2896`). Add a **real recursion/depth guard** (rs's
  `max_tree_depth` option exists but the live path never enforces it — make it enforce; never panic).

### Re-entrancy fix — `COMMENTS_ARE_CONTENT` thread-local (`27-29`, set `149`, reset `446`, read in `is_boilerplate` `3236`)

Becomes an explicit `comments_are_content: bool` threaded through the extraction context /
`is_boilerplate(name, comments_are_content)`. Rationale: a napi AsyncTask runs on the libuv pool;
concurrent extracts on one worker thread corrupt a thread-local, and the `set(true)…set(false)`
bracket is not panic-safe (early return/panic between `149` and `446` leaks the flag).

## Explicit STRIP list + dormant-module exclusion

- **STRIP (whole modules):** `spider_integration.rs` + `bin/` (spider + both CLIs), `markdown.rs` +
  `quick_html2md` dep + `output_markdown` (Markdown path), `encoding.rs`/`encoding_rs` + `extract_bytes*`
  (`lib.rs:179-218` — the crate takes `&str`; TS decodes), `metadata/**`, `scoring.rs` + the 27-feature
  `predict_quality` ML quality regressor, `result::ImageData` + all `extract_image*`/`mark_hero_image`/
  `clean_caption_text` (`3352-3566`), the entire `web-page-classifier` dependency + embedded model binaries.
- **STRIP (dead options in `options.rs`):** `deduplicate`/`dedup_cache_size` (`101`,`207` — never read live;
  also prune the `process_node`/`handle_text_node`/`duplicate_test` branches they gate), `output_markdown`
  (`224`), `include_images` (`42`); of the `min_extracted_size`(`109`)/`min_extracted_len`(`118`) duplication
  only `min_extracted_len` is live.
- **STRIP (dead code, do NOT wire) — the doc-09 trap:** `html_processing.rs::post_cleaning` (`351-396`) is the
  ported attribute stripper — **defined, unit-tested, NEVER called.** Wiring it silently breaks preserve-markup
  (it kills `id`/`class`/`style`/`data-*`). Drop it + its statics `ELEMENT_WITH_SIZE_ATTR` (`27`) and
  `ALLOWED_ATTRIBUTES` (`35`). Also dead: `build_clean_selector`/`build_strip_selector` (`268-318`).
  Also `fallback.rs::sanitize_tree` (`487-535`, whitelist-strips via `VALID_TAG_CATALOG`) is a _sanitization_
  step — drop/gate to reference-parity only (TS washing owns it).
- **DORMANT — do NOT port (go-style parallel impl):** `extractor/{pipeline,handlers,state,comments,pruning}.rs`,
  `extractor/mod.rs` (keep only `pub mod fallback;`), `selector/{precision,comments,meta}.rs`,
  `selector/discard.rs`'s precision/teaser rules (`PRECISION_DISCARDED_CONTENT`, `precision_discard_rule_1`,
  `TEASER_*`, `teaser_rule_1`, `find_discardable` — all zero live refs). **Transitive-live symbols to RELOCATE
  out of dormant files** (do not port the parents): from `extractor/tags.rs` pull `TAGS_TO_CLEAN`,
  `TAGS_TO_STRIP`, `EMPTY_TAGS_TO_REMOVE_SET`, `TABLE_TAGS_TO_STRIP`, `VALID_TAG_CATALOG` (→ live `tags.rs`);
  from `extractor/pruning.rs` pull `prune_unwanted_nodes` — but `html_processing.rs:914` already defines an
  equivalent, so **reconcile to ONE copy**.
- **Gotcha:** `dom.rs::remove_comments` (`326-330`) is a **no-op stub with a TODO** — it does NOT strip comment
  nodes. Bucket B requires comments gone, so the port needs a REAL comment-strip pass (verify at CRATE).

## Doc 09 — the sanitization split (three buckets)

- **Bucket A (boilerplate selection) — STAYS in Rust.** Main-content selection, nav/aside/footer drop, profile
  `boilerplateSelectors`, link-density pruning, `BOILERPLATE_TOKENS`/`COMMENT_TOKENS` name filtering,
  BreadcrumbList drop, empty-node pruning, the backoff. "The crate's reason to exist."
- **Bucket B (extraction hygiene) — STAYS in Rust.** `cleanDocument` kills ~50 tag types on the whole body
  BEFORE scoring (`script/style/noscript/iframe/svg/form/head/…` + HTML comments) — metrics would be garbage
  otherwise. **This is what guarantees `<script>`/`<style>` never reach the serializer, as a pre-scoring side
  effect, not a sanitization pass.**
- **Bucket C (output sanitization) — DELETED from Rust.** The ~60-tag emit whitelist, non-whitelist unwrapping,
  `postCleaning` attribute policy, escaping-as-policy, empty-element unwrap. The washing presets duplicate this
  downstream at every sanitizing level.
- **Preserve-markup serializer contract:** kept nodes emit original tags + ALL attributes (escaped); NO tag
  whitelist / NO attribute policy in Rust. Attributes already survive doc-cleaning (`strip_attributes` never
  set; `post_cleaning` dead); selection _depends_ on attributes (`class_score`, profile CSS selectors) →
  preserve-markup needs zero changes to cleaning/selection.
- **STAYS as serializer hard-skip:** `script/style/noscript/iframe`. **RELOCATES to DOM passes** (the trap at
  v1 `serialize-filtered.ts:339-341`): header/footer-outside-article/main (header has NO other removal path →
  leaks without a replacement pass), the name guards (`is_always_excluded_name` + gated `is_boilerplate`),
  BreadcrumbList drop.
- **Backoff-path trap (the doc-09 regression guard):** the emit-time name guard must NOT act on the backoff
  path. Under preserve-markup it can see `class`/`id` again and would re-empty exactly what the §10 backoff
  saves (v1 `extract.test.ts:133-143`). Move the name filter to a pre-backoff DOM pass; do not re-run it at
  emit time on backoff-rescued content. Companion guard: unconditional bucket-A drops (always-excluded +
  BreadcrumbList) must STILL fire on the backoff path (`extract.test.ts:150-166`).
- **textLength from DOM `textContent`, never regex tag-strip** — an unescaped `>` inside a verbatim attribute
  value (`data-*` JSON, `srcset`) truncates the regex and inflates "text". Preserve the **`''`-on-whitespace
  contract** (`pipeline.ts` reads only `result.html === ''`).
- **Unsanitized-FFI boundary contract:** `contentHtml` = original markup of kept nodes modulo hygiene,
  script-free but otherwise untrusted; **MUST always flow through `washHtml`**, never exposed directly.
  Safe because `washHtml` re-parses from scratch and assumes nothing about pre-sanitization.
- **Known limitation:** when a fallback wins (JSON-LD `articleBody`, baseline rescue) markup is synthesized
  (bare `<p>`) — preservation is best-effort by construction; "original markup" always means "modulo doc-cleaning".
- Supersedes doc 08 §1's "two independent safety passes": script stripping stays two-layered (hygiene + floor);
  the `on*`/scheme/attribute redundancy on `boilerplate ≠ 'none'` paths collapses to ONE hardened TS pass.

## Classifier ground truth (Rust cascade, Python model, no ONNX)

- **3-stage cascade** (`page_type/mod.rs` pieces, orchestrated `extract.rs:55-92`). Manual `options.page_type`
  → override, confidence `None`, no stages run. Else, `url = options.url.unwrap_or("")`:
  - **Stage 1 URL** `classify_url` (`mod.rs:600`): empty→Article; `extract_domain_path` strips `https://` else
    `http://` (**NOT `//`** — mod.rs version is the target, verbatim in `extract_features.py:37-198`; the
    web-page-classifier url_heuristics.rs variant that strips `//` is NOT it); first-match order
    Forum→Documentation→Product→Category→Service→Listing→Article.
  - **Stage 2 HTML signals** `refine_with_html_signals` (`mod.rs:728`): **only ever overrides `Article`**;
    ordered signal rules (category structured data → og product.group → ≥5 product elems+pagination/grid+cart →
    single Product → grid+cart → docs-nav+≥3 code → ≥500 code → link_ratio≥3 & p-word<30 Listing → Article).
    `MIN_PRODUCT_ELEMENTS_FOR_CATEGORY=5`; LD `@type` compares exact + case-sensitive.
  - **Stage 3 ML** `extract_ml_features` + `classify_ml`; TF-IDF input = `"{title} {description}"`.
- **Cascade + confidence (compare ARGMAX class, never float):** `url_type != Article && ml == url_type` →
  `(url_type, 1.0)`; else `refined != Article && ml == refined` → `(refined, 0.95)`; else `(ml_type, ml_conf)`.
  1.0/0.95 are synthetic. Cross-language parity only requires argmax agreement (float probs across
  html5ever/lexbor/linkedom need not match) — but a divergent **body text** shifts the numeric block and can
  flip argmax, so establish byte-exact body-text parity FIRST.
- **189 features = 89 numeric + 100 TF-IDF** (indices 0..88 scaled numeric ++ 89..188 unscaled TF-IDF).
  `ml.rs`'s "81" comment + the classifier README are STALE — trust `training/` (`N_NUMERIC_FEATURES=89`,
  `model.rs` test asserts `scaler_mean.len()==89`, `trees.len()==1400`, `n_classes==7`). Already resolved in
  the v1 "Feature count" note below.
- **Pure-Rust GBDT evaluator** over the **XGBoost native JSON dump** (`multi:softprob`, 7 classes, 200 rounds
  → 1400 trees). Node = {feature i32 (<0 leaf), threshold f64, left/right}. `evaluate`: strict `<` → LEFT,
  `>=` → RIGHT; missing/out-of-range feature → 0.0; cycle guard → 0.0. `predict`: `class_idx = tree_i % 7`
  round-robin accumulate → softmax(margins) → argmax `(best_idx, best_prob)`. Read `tree_info` for the
  round-robin class layout, honor `default_left` + string-typed `base_score`; read the shipped `class_labels`
  for index→type (NOT enum order). Scaler `(x-mean)/scale if scale>0 else 0.0`. **Do NOT use** the reference
  crate's `compute_tfidf` (`count/n_words`, no L2 — an approximation).
- **Locked parity rules (target = `training/extract_features.py`, byte-level):** scikit-learn TF-IDF
  (`smooth_idf=True`: `idf=ln((1+n)/(1+df))+1`, `norm='l2'`; per-doc `tf=raw_count × idf` then L2; token
  pattern `(?u)\b\w\w+\b` drops 1-char, unigrams only); baked StandardScaler (89 mean/scale); enhanced-group
  gate `if body_text_len > 500_000: f[63..89]=0` (strict `>`; `body_text_len` = UTF-8 bytes of `select("body")`
  text; 500*000 does NOT trigger); **UTF-8 byte lengths everywhere** (Rust `str::len` matches naturally);
  **CPython `str.split`/`str.strip` whitespace class** (adds U+001C–U+001F, U+0085; does NOT include U+FEFF —
  reproduce, do not use Rust `char::is_whitespace`); **selectolax comma-union NO-dedup** (a node counts once
  per matching sub-selector, in document order). Quirks: f[70] flush-before-assign accumulator, population
  variance ÷N, ≥3 ratios; f[63]/f[64] count only children with a \_present* `class`; `<template>` exclusion
  (html5ever/dom_query must keep template children out of `.text()`/selectors).
- Panic policy: the reference `classify_ml`/`predict` `assert_eq!`/`unwrap` become typed `Result`s.

## v1 test → cargo test mapping seed

Crate root `packages/htmlwasher/native/`. Internal-fn tests → inline `#[cfg(test)] mod tests` in the ported
module; cross-cutting goldens/parity/malformed-corpus → integration under `native/tests/`. ~155 v1 tests in
scope across 15 files. Full disposition (record final mapping at CRATE/CLASSIFY per the INTEGRATE gate):

| v1 test file                          | ~n  | Cargo target                                    | Disposition                                                                                                                                                                                   |
| ------------------------------------- | --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/extract.test.ts`                | 12  | `tests/extract.rs` (e2e)                        | PORT; **lines 38-45 (no class/style/id leakage) RE-BASELINE** under preserve-markup; **lines 133-143 backoff = THE doc-09 regression guard; 150-166 unconditional-drop-on-backoff companion** |
| `core/clean.test.ts`                  | 8   | inline `html_processing.rs` + `link_density.rs` | PORT (bucket B, attribute-independent)                                                                                                                                                        |
| `core/dom.test.ts`                    | 6   | inline `dom.rs`                                 | PORT (watch html5ever-vs-linkedom parse)                                                                                                                                                      |
| `core/main-content.test.ts`           | 5   | inline `selector/content.rs`                    | PORT (node cascade)                                                                                                                                                                           |
| `core/profile.test.ts`                | 3   | `tests/profile.rs`                              | PORT (profile options steer extraction)                                                                                                                                                       |
| `profiles/index.test.ts`              | 8   | inline `page_type` profiles                     | PORT (config table; aggregation passes newly live)                                                                                                                                            |
| `classifier/classifier.test.ts`       | 6   | inline/integration `page_type/`                 | PORT cascade+confidence; the `InferenceBackend`/ONNX-WASM-parity 3 cases COLLAPSE to the GBDT argmax test                                                                                     |
| `classifier/url-heuristics.test.ts`   | 10  | inline `page_type/mod.rs`                       | straight PORT                                                                                                                                                                                 |
| `classifier/html-signals.test.ts`     | 7   | inline `page_type`                              | PORT (incl. CPython-whitespace refine)                                                                                                                                                        |
| `classifier/parity.test.ts`           | ~45 | `tests/classifier_parity.rs`                    | PORT retargeted ONNX→GBDT; numeric+TFIDF ≤1e-6, **argmax 100%** = Phase CLASSIFY gate                                                                                                         |
| `classifier/features/index.test.ts`   | 10  | inline vocab loader                             | PORT as `include_str!`+`LazyLock` load-time validation                                                                                                                                        |
| `classifier/features/numeric.test.ts` | 7   | inline numeric                                  | PORT (CPython split/strip; keep exotic codepoints)                                                                                                                                            |
| `classifier/features/text.test.ts`    | 4   | inline text/meta                                | PORT (TF-IDF input assembly)                                                                                                                                                                  |
| `classifier/features/tfidf.test.ts`   | 4   | inline tfidf                                    | PORT (sklearn smooth_idf L2)                                                                                                                                                                  |
| `core/serialize-filtered.test.ts`     | 22  | split                                           | **PORT ≈17** (skip-layer/escaping/empty-node → DOM-pass tests) / **RETIRE ≈5** (emit-whitelist + attribute-policy = bucket C; port only vs the retained whitelist parity mode)                |

## v2 open questions (resolve at the named phase)

- **CRATE — `html-cleaning` crate license — RESOLVED (moot).** 0.3.0 is MIT OR Apache-2.0 but pins
  `dom_query 0.24`, type-incompatible with the mandated `dom_query 0.28`; NOT wired (bucket-B cleaning
  ported directly from v1 `clean.ts`). No `@/NOTICE` entry needed for it.
- **CRATE — `remove_comments` no-op stub — RESOLVED.** Implemented as a real DOM comment-strip pass
  (`html_processing.rs::remove_comments`, iterating comment nodes).
- **CRATE — two `prune_unwanted_nodes` copies — RESOLVED.** Reconciled to ONE copy in
  `extractor/fallback.rs::prune_unwanted_nodes`.
- **CRATE — dom_query `unwrap_node` footgun — RESOLVED.** It removes a node's PARENT, not the node;
  tag stripping uses `strip_elements` instead. Flagged so CLASSIFY/BIND avoid it.
- **CLASSIFY — does `default_left` ever activate? — RESOLVED (no).** The exported dump has `default_left`
  present but 0 nodes set it (dense f[], never NaN). The evaluator honors it defensively but it never fires;
  strict-`<` with 0.0-for-absent is the whole story. NEW finding: the split comparison must be **float32**
  (see the CLASSIFY phase bullet) — that, not missing-routing, was the probs-parity blocker.
- **CLASSIFY — `token_pattern`/`ngram_range` — RESOLVED.** `tfidf-vocab.json` ships
  `tokenPattern="(?u)\b\w\w+\b"`, `ngramRange=[1,1]`, 100 unigram terms; the Rust tokenizer reproduces the
  column order (tfidf parity ≤ 2.2e-16).
- **VALIDATE — score movement from `aggregate_sections`/`collect_repeated_items`.** CRATE carried these as
  profile config only (dead flags in v1, not yet functional in Rust) — so VALIDATE should match v1 scores, not
  see a lift. If they are made functional later, they may move P/R/F1: investigate any drop, document any gain.
- **RETEST-deferred — rs-trafilatura structured rescues + aggregation passes (the "newly live" behavior).**
  The crate reproduces v1's extraction (selector → semantic → scoring → body cascade + name-filter backoff +
  whole-body fallback); it does NOT yet port `extractor/fallback.rs`'s structured rescues (JSON-LD `articleBody`,
  Discourse `data-preloaded`, external-candidate comparison, baseline `should_discard` pruning) or the
  `aggregate_sections`/`collect_repeated_items` post-passes. Intentional for regression parity (v1 lacked them
  → no VALIDATE regression), but they are the enhancements the brief wanted. Port them if RETEST's live corpus
  shows DOM-extraction failures a structured rescue would fix, or a per-type F1 gap the aggregation passes would
  close. Caveat: a fallback win synthesizes markup (preservation is best-effort by construction).
- **BIND — Zig + WASI SDK.** Cross-building linux-gnu needs `cargo-zigbuild` (`napi build -x`); the
  wasm32-wasip1-threads fallback needs `WASI_SDK_PATH`. Install at BIND/CI, not before.

---

## v1 record (historical — the all-TypeScript port, the regression oracle)

## Status

- Phase 0 (orientation) — done (this document).
- Phase 1 (scaffold) — done. Type surface in `src/types.ts`; baseline gate green.
- Phase 2 (boilerplate core) — done. `src/core/` extracts main-content HTML; 45
  unit tests + 4 real adbar pages pass. See "Phase 2 notes" below.
- Phase 3 (metadata) — done. `src/metadata/` ports adbar's OG→JSON-LD→meta→DOM
  precedence; 60 unit tests pass; correct title/author/date/sitename on real adbar
  pages. `date.ts` is a reduced htmldate equivalent; DOM XPaths translated to CSS
  (regex-anchored class/id predicates loosened to substring — documented per module).
- Phase 6 (washing levels) — done. `src/washing/` ports the htmlprocessing-server
  pipeline; 5 levels, security at every level + the styled CSS-URL allow-list
  (closes sanitize-html's gap), optional DOMPurify/jsdom hardened backend; 71
  tests pass. `washHtml`/`washBuffer` are async (prettier/minifier lazily imported)
  — so the public `wash()` will be async too. parse5 bumped to `^8`.
- Orchestration — done. `src/pipeline.ts` exposes the public async `wash()`
  composing metadata + boilerplate(mode) + wash(level); 6 integration tests pass.
  Classifier-based profile routing plugs into the boilerplate stage in Phase 5.
- Phase 5 (part 1) — done. The 7 profiles + core profile wiring
  (`contentSelectors`/`preserveTags`/`boilerplateSelectors`). Classifier routing
  pending the trained model (part 2).
- Phase 7 (validation vs adbar corpus) — done. `test/validation/` scores the full
  `wash()` pipeline over the 100 adbar eval pages present locally (skips in CI).
  **Result: precision ≈ 0.79, recall ≈ 0.81, F1 ≈ 0.80** (balanced + minimal) —
  in the same ballpark as upstream Trafilatura on this set. (Pre code-review the
  name-based boilerplate filter was dead, scoring P 0.75 / R 0.84 / F1 0.79;
  activating it lifted precision — see "Post-implementation code review".)
  Expectations fixture (`fixtures/validation/eval-expectations.json`) derived from
  adbar's `tests/evaldata.py` (Apache-2.0; attribution in NOTICE).
- Phase 4 (classifier) — done. Real model trained on full WCXB (test acc 0.777,
  macro-F1 0.663; ONNX↔native argmax 100%). TS runtime at 100% feature parity
  (numeric 1246/1246, tfidf 1400/1400, argmax 14/14). Cross-DOM fixes: selectolax
  comma-unions don't dedup; linkedom vs lexbor parsing → `parseDocumentSpec`
  (parse5 normalize → linkedom) for byte-exact body text.
- Phase 5 (part 2) — done. `pipeline.ts` classifies → selects profile → extracts;
  `wash()` returns `pageType` + `confidence`. `none` skips classification.
- Phase 8 (offline wash-corpus tester) — done. `packages/wash-corpus-tester/`: 28
  WCXB fixtures (≥3 per type × 7), 196 runs (7 boilerplate×level combos each),
  asserting security invariants + page-type plausibility, with a stdout table +
  `report.json`/`report.md`. Offline, deterministic, `pnpm test:corpus`.

### Phase 8 notes

- **Accuracy caveat:** the 28 fixtures are WCXB **dev-split** pages the model
  trained on, so the tester's 100% page-type accuracy is inflated. The unbiased
  number is the held-out **test-split accuracy 0.777** from training (Phase 4).
  The tester is an end-to-end smoke/regression check, not an accuracy benchmark.
- The security floor holds at EVERY level, including `correct`: no
  script/on\*/javascript: survives any level. `correct` is normalize-only for the
  tag _allow-list_ — it applies no preset, so benign/deprecated tags and attributes
  pass through unchanged (recorded as soft warnings, not failures) — but the
  no-config path still runs `enforceSecurityFloor` + `sanitizeStyledHtml`, so
  `<script>`/`on*`/dangerous-URL/dangerous-CSS are stripped even there.
- **`packages/live-crawl-tester/` decision:** the brief's offline Phase 8 deliverable
  is `wash-corpus-tester` (built). The pre-existing scaffold `live-crawl-tester`
  (an unimplemented network-fetch stub) is left untouched — deleting it would churn
  ~15 incidental references across the `.claude/` config for no functional gain,
  and the stub never actually fetches. The two are complementary: offline fixtures
  here vs a future live-fetch harness there.

### Post-implementation code review

A whole-repo multi-agent review (7 subsystem reviewers → adversarial verify)
surfaced 25 findings; 16 were confirmed real and fixed, 9 rejected as style nits.
Highlights:

- **(critical) The name-based boilerplate filter was dead in the real pipeline.**
  `postCleaning` strips `class`/`id` (ALWAYS_DROP_ATTRS) BEFORE the whitelist
  serializer's `isBoilerplateNamed` guard reads them, so `BOILERPLATE_TOKENS`/
  `COMMENT_TOKENS` never dropped anything during extraction. Fix: a name-based
  boilerplate pass over the content-node DESCENDANTS in `extractFrom()` BEFORE
  `postCleaning` (honoring `commentsAsContent`), with a **backoff**: if removing
  boilerplate-named nodes empties the content (collection/listing pages whose
  whole body is in boilerplate-named containers), keep the unfiltered extraction
  (go-trafilatura's "do not delete all the content" rule). This lifted precision
  0.75 → 0.79 and F1 0.79 → 0.80 on the adbar eval.
- (warning) `linkDensityTest` used `nextSibling` (node) where go-trafilatura uses
  `NextElementSibling` — on pretty-printed HTML a whitespace text node made every
  last block use the lower limit. Fixed via `HElement.nextElementSibling`.
- (warning) `postCleaning` empty-strip used `childNodes.length` instead of
  element-children + leading-text (go's `etree.Text`); now strips whitespace-only
  `<div>   </div>`.
- (warning) `PRODUCT_BOILERPLATE_SELECTORS` was missing `[class*='recommend']` vs
  rs-trafilatura — restored.
- (info) classifier feature whitespace (`splitWhitespace`/`strip`/`paragraphWordCount`)
  now uses the exact CPython `str.split`/`str.strip` codepoint class (was JS `\s`/
  `.trim()`), tightening the byte-for-byte parity contract (parity stayed 100%).
- ONNX runtimes pinned to exactly 1.27.0 (both backends in lockstep); vocab artifact
  validated at load; `css-sanitizer` rejects backslash-escaped `url()` schemes;
  pipeline catch blocks narrow `unknown`; CLI error path no longer double-newlines;
  unused `washing/index.ts` barrel removed; stale "181-feature" comment → 189;
  `training/uv.lock` gitignored.

The earlier "precision is the weak dimension" gap is the same root cause (the dead
filter) and is now addressed. Remaining: `precision`/`balanced` modes still score
near-identically on this coarse substring eval; the focus thresholds have only a
small effect there.

### Phase 2 notes

- **Emit path:** we follow rs-trafilatura's filter-serialize approach (select a
  content node → `postCleaning` → whitelist re-serialize via
  `serialize-filtered.ts`), NOT go-trafilatura's per-element body rebuild
  (`main-extractor.go` `handle*` handlers). The brief §5 sanctions this. The
  per-element handlers were therefore not ported.
- **Cleaning** (`clean.ts`) is a faithful port of `html-processing.go`
  (`docCleaning`, `pruneHTML`, `linkDensityTest(+Tables)`, `deleteByLinkDensity`)
  with the precision/recall thresholds. Tag catalogs in `constants.ts` are
  verbatim from `settings.go`.
- **Selectors:** content rules 1–5 ported from `internal/selector/content.go`
  (rule 2 = any bare `<article>`), then `<article>`/`<main>`/`[role=main]`, then a
  readability-style scoring fallback, then the body.
- **linkedom gotcha:** `parseHTML` does not wrap loose input in `<html><body>`
  (it promotes the first element to the root). `parseDocument` normalizes: full
  docs as-is, stray `<body>` wrapped in `<html>`, bare fragments in
  `<html><body>`.
- **Deferred:** comment extraction, the per-type profile post-passes
  (aggregate/collect), and the `extraction_quality` heuristic move to Phase 5;
  the 27-feature ML quality model stays out of scope.

## Authority hierarchy (recap)

- `rs-trafilatura` + `web-page-classifier` define **WHAT** (page-type-aware
  architecture, the 7 types, per-type profiles, confidence, the 89+100 feature
  classifier). Treat its extraction internals as _intent_.
- `go-trafilatura` + `adbar/trafilatura` define **HOW** extraction behaves. Defer to
  these for the core algorithm, thresholds, and metadata semantics.
- `trafilatura-rs` (nchapman) is the cross-check / tiebreaker.
- `readability` (mozilla) is a TS/DOM idiom reference only.
- `htmlprocessing-server` defines the **HTML-washing** pillar (sanitize-html presets +
  normalize/format pipeline).
- `contextractor` defines the **boilerplate-mode → favor_precision/favor_recall** mapping.

## Resolved questions

### Feature count: 89 numeric + 100 TF-IDF = 189 (NOT 81/181)

The brief §3.8 is correct and is confirmed by source: `web-page-classifier/src/lib.rs:35`
declares `N_NUMERIC_FEATURES = 89`, and `rs-trafilatura/src/page_type/ml.rs`
`extract_ml_features` fills `f[0..89]`. Context docs 03 and 07 say 81/181 — that traces
to the stale README _body_ and the `ml.rs` doc comment (which says 81 while the array is
89). **Trust the code: 89 numeric, 189 total.** Numeric feature groups:

- `f[0..14]` — URL flags
- `f[14..63]` — HTML structural
- `f[63..73]` — enhanced structural (GATED: `extract_ml_features` early-returns after
  `f[62]`, leaving `f[63..89] = 0`, when body text > 500,000 chars — reproduce this gate)
- `f[73..81]` — DOM-vocabulary density
- `f[81..89]` — collection-specific

### TF-IDF: match scikit-learn training, NOT the Rust crate

The Rust crate's `compute_tfidf` (`web-page-classifier/src/model.rs:179`) uses raw
`tf = count/n_words` × baked IDF with **NO L2 normalization** and ad-hoc bigram substring
matching. We are retraining fresh, so we reproduce **scikit-learn `TfidfVectorizer`** on
both the Python and TS sides: sklearn default `smooth_idf=True` →
`idf = ln((1+n)/(1+df)) + 1`, with `norm='l2'`. Lock vocabulary + IDF weights in
`tfidf-vocab.json`. Compare **argmax class**, not probabilities, in parity tests.

### Page-type taxonomy + the `collection`/`category` alias

7 types: `article, forum, product, collection, listing, documentation, service`. The Rust
enum variant is `Category` but `as_str()` serializes it to the string `"collection"`
(`page_type/mod.rs:28-72`); `FromStr` accepts both `category` and `collection`, and `docs`
→ `documentation`. Output metadata must use `"collection"`.

### onnxruntime pin ≥ 1.23.0

1.21.x–1.22.x carry two `TreeEnsemble` correctness bugs that hit small/shallow XGBoost
trees (exactly this model): the `is_leaf`/root-branch-as-leaf bug (#24679→#25410) and the
category-only-trees `same_node_` bug (#24636→#24654), both fixed in 1.23.0. The package
pins both `onnxruntime-node` and `onnxruntime-web` to exactly `1.27.0` (in lockstep,
no caret), satisfying the ≥ 1.23.0 floor; any future bump must move both packages
together to preserve lockstep. Ship a golden test asserting ONNX argmax ==
trained-model argmax.

## Source → target module map

### Boilerplate-removal core → `@/packages/htmlwasher/src/core/`

The core follows go-trafilatura's **keep-HTML** route (its `convertTags` keeps HTML,
`html-processing.go:481-484`), NOT adbar's XML round-trip. Shared pipeline stages (adbar
`core.py` / go `core.go`): load/parse → metadata → prune → clean → convert-tags(keep HTML)
→ comments → main-content → fallback cascade → baseline → postCleaning → **whitelist
re-serialize**.

- **Whitelist re-serializer** — port `rs-trafilatura push_filtered_html_children`
  (`src/extract.rs:2700-2894`) + go-trafilatura `postCleaning` (`html-processing.go:401-448`)
  → `core/serialize-filtered.ts`. Walk children; **unwrap** non-whitelisted elements
  (recurse, emit no tag); **drop** the explicit skip set (`nav|aside|script|style|noscript|iframe|svg|ins`),
  `is_always_excluded_name` (class/id substring list), `itemtype*=BreadcrumbList`
  microdata, and `is_boilerplate` nodes; escape all text/attr values. Never
  `outerHTML` the kept node verbatim. **`is_always_excluded_name` IS ported** as a
  distinct UNCONDITIONAL check: `ALWAYS_EXCLUDED_NAME_TOKENS` in `core/constants.ts`,
  matched by `isAlwaysExcludedName` (`core/serialize-filtered.ts`, which also drops
  `itemtype*=BreadcrumbList` microdata, case-insensitively) and applied by `removeAlwaysExcludedNamed`
  (`core/extract.ts`) in a pre-`postCleaning` DOM pass in BOTH `renderClone`
  branches — independent of the §10 boilerplate-token backoff (which only gates the
  recall-able `BOILERPLATE_TOKENS`).
- **Block+inline tag whitelist** (generous, per brief §5 Phase 2): `p, div, section,
article, main, h1-h6, blockquote, pre, code, strong, em, b, i, a, ul, ol, li, dl, dt, dd,
table, thead, tbody, tfoot, tr, td, th, caption, colgroup, col, br`, plus images. The
  washing **level** does the final tag narrowing — do NOT re-expose
  `include_tables/links/images`.
- **Attribute allow-list** — go `settings.go:79-116`: always drop
  `id, class, align, background, bgcolor, border, cellpadding, cellspacing, frame, hspace,
rules, style, valign, vspace`; drop `width/height` except on `table/th/td/hr/pre`. Minimal
  conditional keep set from rs: `href` on `<a>`, `class` on `<code>`, `colspan/rowspan` on
  `td/th`.
- **Boilerplate predicates** — `is_always_excluded_name` + `is_boilerplate`
  (`extract.rs:2934`, `3215`; regexes in `patterns.rs`) are distilled into the
  `ALWAYS_EXCLUDED_NAME_TOKENS` (unconditional) + `BOILERPLATE_TOKENS` (gated) lists
  in `core/constants.ts` and matched by `isAlwaysExcludedName` /
  `boilerplateTokenMatches` / `isBoilerplateNamed` in `core/serialize-filtered.ts`
  (token / substring match). There is no `core/boilerplate-class.ts`. The
  rs `is_boilerplate` false-positive guards are ported into `boilerplateTokenMatches`:
  the elementor-widget skip, the position-aware `sidebar` guard
  (`sidebarTokenMatches`), and the `l-`/`c-` layout-component exemption when the only
  hit is `sidebar`/`social`.
- **`COMMENTS_ARE_CONTENT`** thread-local (`extract.rs:28,149,446,3236`) → an explicit TS
  context param (not a global). Forum profile flips `is_boilerplate` to the
  `NO_COMMENTS` regex so `comment*`-classed nodes are kept.
- **favor_precision/favor_recall thresholds** (`extract.rs:2149-2155`, `pruning.rs:156-203`,
  `pipeline.rs:215`, `link_density.rs:71,174`, `html_processing.rs:324,416-417`):
  min content-node score 5000(P)/1000(bal)/500(R); link short-text length 10(P)/100(else);
  paragraph-sufficiency factor 1(P)/3(else); child-depth 1(P)/3(else); recall adds div/lb/list
  potential tags; precision adds extra prune passes; `keep_tail = !precision`. Precision wins
  when both set. **Cross-check these numbers against go/adbar** (open question).
- **Fallback cascade + recovery + post-passes** (`extract.rs:228-318, 437-441`): short-extraction
  ancestor walk (accept >2×), bottom-up readability scorer (accept >2× and >500), under-extraction
  fallback on a pre-cleaning backup, then profile post-passes (`aggregate_sections`,
  `collect_repeated_items`, Category description prepend, Product JSON-LD description).

### Metadata → `@/packages/htmlwasher/src/metadata/` (optional sidecar)

Orchestrator: adbar `metadata.py:extract_metadata` (457-561). Per-field MERGE (not a
blanket override): meta/OpenGraph fill first; then JSON-LD fills EMPTY
title/categories/pageType, APPENDS authors, and conditionally replaces sitename
(`is_plausible_sitename`) — it never overrides an already-set title and never touches
description; XPath/DOM heuristics then fill any remaining empties. The orchestrator
ends with `clean_and_trim` (cap each string field to 10000 chars, then
`unescape` + line-process). Modules to create:

- `opengraph.ts` — `OG_PROPERTIES` map (`metadata.py:136`), `examine_meta` bootstrap.
- `meta-tags.ts` — `METANAME_*` allow-lists, twitter/itemprop handling (`X = X or content`).
- `json-ld.ts` — `extract_json`/`process_parent` (well-formed) + `extract_json_parse_error`
  (regex fallback); `@context` must match `^https?://schema.org`.
- `authors.ts` — `normalize_authors` (`json_metadata.py:290`): split, strip, title-case,
  dedup; drop single-word author; apply `author_blacklist`.
- `title.ts, url.ts, sitename.ts, catstags.ts, license.ts` — DOM/XPath fallbacks
  (`xpaths.py`; this checkout inlines what older trafilatura called `metaxpaths.py`).
- `date.ts` — adbar delegates to the external **htmldate** `find_date`. htmlwasher must port
  a JSON-LD/meta/url/text date heuristic or a minimal htmldate equivalent (open question on scope).

### Classifier → `@/packages/htmlwasher/src/classifier/` + training

- `classifier/features/` (TS, htmlparser2 hot-path) + `training/extract_features.py` (Python,
  selectolax) — the **same** 89-numeric + 100-TF-IDF extractor, byte-for-byte. Reproduce
  rs `ml.rs` selectors, `[class*=]` substring matchers, and the 500KB gate exactly.
- 3-stage cascade (`extract.rs:54-92`, `page_type/mod.rs:600-655,728-793`) →
  `classifier/{url-heuristics,html-signals,classify}.ts`: Stage 2 (`refine_with_html_signals`)
  only overrides `Article`. Agreement rule: URL+ML agree → conf 1.0; HTML+ML agree → 0.95;
  else ML softmax.
- `classifier/model/` — `model.onnx` + `tfidf-vocab.json` loaded via onnxruntime-node
  (default) / onnxruntime-web (WASM) behind the `InferenceBackend` interface (the
  swappable seam; the brief's `interface PageTypeClassifier` was deliberately renamed
  to `InferenceBackend`, and `PageTypeClassifier` is the concrete cascade class that
  holds an `InferenceBackend` — see `classifier/classifier.ts`). `OnnxWebClassifier`
  loads the model via `readFileSync → Uint8Array` (not a filesystem-path string) so
  the WASM backend resolves identically in Node and the browser. StandardScaler
  `(x-mean)/scale` (scale ≤ 0 → 0) baked into training; tree split is strict `<` → left;
  missing feature → 0.0. For TS↔Python (lexbor) feature parity, `parseDocumentSpec`
  strips `<template>` subtrees before counting features.

### Per-type profiles → `@/packages/htmlwasher/src/profiles/`

`ExtractionProfile` (`page_type/mod.rs:98-345`) LIVE fields: `comments_are_content`,
`content_selectors`, `preserve_tags`, `boilerplate_selectors`, `aggregate_sections`,
`collect_repeated_items`. **Deferred / not yet ported** (LIVE in rs-trafilatura but
not yet consumed by this TS port — a known Phase-5 gap, NOT parity):
`aggregate_sections` (Step-7 multi-candidate merge, `extract.rs:231`) and
`collect_repeated_items` (Step-7b repeated-item collection, `extract.rs:252`) — the
TS profile carries the flags but the post-passes are not implemented yet.
**DEAD fields** (declared, never read in rs either — grep-confirmed):
`lenient_boilerplate`, `min_paragraph_density` — do not invent behavior; omit or wire
deliberately. Copy the 7 profile selector/tag arrays verbatim. Confidence:
`classification_confidence` (agreement) + `extraction_quality` heuristic (`extract.rs:880-985`;
the 27-feature ML quality model `predict_quality` is a _second_ model — out of scope unless
confirmed).

### HTML washing → `@/packages/htmlwasher/src/washing/`

Faithful port of `htmlprocessing-server/src/process-html.ts`. Pipeline order:
decode (chardet, iconv-lite; buffers only), then normalize (parse5), then sanitize
(sanitize-html with the level preset; skipped for `correct`), then re-normalize (only if
`transformTags`), then DOCTYPE prepend (full documents), then format (prettier by default;
html-minifier-terser when `minify`). Returns `{ html, messages }`.

- `washing/modes.ts` — washing-level union as `as const` (NEVER a TS enum), mirroring
  `PROCESSING_MODES`. **htmlwasher uses exactly 5 levels** —
  `minimal | standard | permissive | styled | correct` — and **drops the four `*-reader`
  variants** (the Readability concern is handled by the boilerplate pillar; do not bundle
  jsdom/@mozilla/readability).
- `washing/presets/{minimal,standard,permissive,styled}.ts` — `SanitizeConfig` objects
  (`allowedTags, allowedAttributes, allowedClasses, selfClosing, nonTextTags, transformTags`),
  copied from `htmlprocessing-server/src/presets/`. `standard` is the default.
- `washing/sanitize.ts` — wraps sanitize-html; runs `filterEventHandlers` (strip every `on*`
  attr) on `allowedAttributes` first. `correct` skips this stage entirely (normalize + DOCTYPE
  - format only) but is still a security boundary.
- Security at EVERY level: rely on sanitize-html defaults (`allowedSchemes
[http,https,ftp,mailto,tel]` on `href/src/cite`) to strip `javascript:`/`data:`, plus
  `filterEventHandlers`. The **`styled` level must add an explicit CSS-URL allow-list** —
  sanitize-html does NOT scheme-filter `url()` inside `style` attrs or `<style>` blocks, so
  `url(javascript:|data:)`, `expression()`, `@import`, `-moz-binding` survive by default.

### Orchestration → `@/packages/htmlwasher/src/pipeline.ts` + `index.ts`

`wash(html, { boilerplate?, level?, minify? })` → `{ html, messages, metadata? }`. Defaults:
`boilerplate: 'balanced'`, `level: 'standard'`, `minify: false`. `boilerplate: 'none'`
bypasses extraction (washes the whole document). The two knobs are orthogonal; these three
options are the **entire** user surface — no `includeComments/Tables/Images/Links`.

## Parity gotchas (carry into the relevant phase)

- Never `outerHTML` the kept subtree — always whitelist re-render (still contains boilerplate
  wrappers, tracking attrs, untrusted markup otherwise).
- `push_filtered_html_children` **unwraps** non-whitelisted elements vs **drops** the skip
  set / boilerplate-named nodes — getting unwrap-vs-drop wrong changes output substantially.
- Match scikit-learn TF-IDF (`smooth_idf=True`, L2 norm), not the Rust crate's un-normalized path.
- Reproduce the 500KB feature gate and the strict-`<` tree comparison + 0.0 missing-default.
- `correct` mode and the `styled` CSS-URL gap are both security boundaries — test them.
- prettier is the DEFAULT formatter in htmlprocessing-server (`shouldMinify` defaults false).
- parse5 pin: source uses `^8`; htmlwasher pins `^7.3.0` — serializer output can differ
  (whitespace/attr order) and break golden fixtures. **Bump htmlwasher to parse5 `^8`** for
  washing parity (decision: align to the washing engine).
- contextractor's modes do NOT use the ML classifier (its `PageType` import is a dead shim);
  htmlwasher DOES route extraction through the per-type profile — don't copy the no-classifier behavior.
- WCXB dataset is CC-BY-4.0 — attribution REQUIRED (Murrough Foley / DOI 10.5281/zenodo.19316874).
  Do NOT vendor rs-trafilatura's embedded `~1.1 MB` binary model.

## Open questions

- **Phase 4 — exhaustive 89-feature enumeration.** The per-feature computation list for
  `f[0..89]` must be read line-by-line from `rs-trafilatura/src/page_type/ml.rs` when building
  the extractor (deferred from Phase 0 — the recon's full-enumeration reader hit the structured-output
  cap; re-run as a focused read at Phase 4).
- **Phase 2 — go-trafilatura core line-by-line.** Same deferral: read the actual `.go` handlers
  (`handle_titles/formatting/lists/quotes/code_blocks/paragraphs/table/image/other`) at Phase 2.
- **WCXB download feasibility.** Phase 4 needs the dataset from Hugging Face / Zenodo — network
  access from this environment is unverified. If unavailable, train.py + extract_features.py +
  the TS extractor + ONNX-load path are still built and unit-tested with a small synthetic/fixture
  set, and the real training run is documented as a follow-up. (Will be confirmed at Phase 4.)
- **htmldate scope.** Port a minimal date heuristic vs a fuller htmldate equivalent — decide at Phase 3.
- **Quality model.** The 27-feature `predict_quality` ONNX is a second model; brief emphasizes the
  page-type classifier only — treat as out of scope unless directed.
- **Cross-check rs thresholds vs go/adbar.** Verify `min_score 1000`, `max_link_density 0.8`, the
  2-pass `delete_by_link_density`, and the precision/recall numbers against go-trafilatura at Phase 2/5.

## tools/ tester: brief vs scaffold drift (Phase 8)

The brief (§4, §7, §8) specifies an **offline** `packages/wash-corpus-tester/` (saved HTML
fixtures in → cleaned HTML out, **no network**, ≥3 fixtures per page type × 7 types). The
current scaffold instead has `packages/live-crawl-tester/` (a polite network fetcher per
CLAUDE.md). The brief and the §8 non-goals are explicit that htmlwasher never touches the
network. **Decision: build `packages/wash-corpus-tester/` per the brief** and reconcile the
scaffold at Phase 8 (repoint the workspace, retire or repurpose the live-crawl-tester, and
update CLAUDE.md / SPEC.md accordingly).
