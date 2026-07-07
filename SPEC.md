# trafilatura — Specification

## Status

**v2 hybrid Rust + TypeScript rebuild — implemented.** The extraction + page-type-classification
core is a Rust crate (`packages/trafilaturacore/native/`) reached from Node via napi-rs; the public
`clean()` API, the HTML-cleaning levels, the metadata sidecar, and the CLI stay TypeScript. The
classifier is a pure-Rust GBDT evaluator over the XGBoost native JSON dump (`model.xgb.json`) —
**no ONNX/onnxruntime at runtime**. Shipped artifacts (`packages/trafilaturacore/native/artifacts/{model.xgb.json,tfidf-vocab.json}`)
are trained offline in `training/` and baked into the crate via `include_str!`. Alpha — APIs may
still change. See [`@/PORTING-NOTES.md`](PORTING-NOTES.md) for the per-phase migration map, gotchas,
and scores, and [`@/.claude/rules/spec-maintenance.md`](.claude/rules/spec-maintenance.md) for the
ongoing spec-maintenance rule.

Key numbers: Rust↔Python feature parity exact (numeric ≤ 3.4e-13, TF-IDF ≤ 2.2e-16, argmax 100%);
adbar eval P≈0.81 / R≈0.85 / F1≈0.83 (a lift over v1's ≈0.80); classifier ≈ 0.777 held-out WCXB
accuracy; the Rust extraction core is ~3× faster than the v1 TS core; the external live benchmark
puts trafilaturacore token-F1 at ≈0.873 vs the Trafilatura reference (within −0.008 of rs-trafilatura).

## Overview

trafilaturacore is a content-extraction **library for Node.js**: **HTML in → cleaned HTML out**. It never
converts to Markdown/XML/TEI/plain text and never fetches the network. Two composable pillars split
across languages:

- **Boilerplate removal + page typing (Rust).** A Trafilatura-derived main-content extractor with a
  3-stage page-type cascade → one of 7 page types (`article, forum, product, collection, listing,
documentation, service`), per-type extraction profiles, confidence scoring, and a **preserve-markup**
  serializer that emits the kept content with its original tags + attributes (script-free via extraction
  hygiene, but otherwise **UNSANITIZED**). Gated by the boilerplate mode `precision | balanced | recall |
none` (`none` bypasses the Rust core).
- **HTML cleaning (TypeScript).** The `sanitize-html`-based sanitize + normalize + format pipeline — five
  cleaning levels (`minimal | standard | permissive | styled | correct`) plus a fully-custom JSON
  `CleanConfig` — and the **unconditional security floor**. In v2 the cleaning stage is the **sole
  sanitization authority** for every output path (context doc 09).

Also TypeScript: the public async `clean()` API + types, the metadata sidecar, buffer decoding
(`chardet`/`iconv-lite`), and the offline CLI. Python owns training only.

## Architecture

Data flow of `clean(html, options)`:

```
clean()  (TypeScript, packages/trafilaturacore/src/pipeline.ts)
  ├─ validate options + maxInputBytes (BEFORE the FFI call)
  ├─ metadata sidecar        (TS, src/metadata/*, linkedom — overlaps the native extraction)
  ├─ runBoilerplate(mode)    (started before the metadata parse; awaited after)
  │     mode='none' → skip (clean the whole document; the native binding is never loaded)
  │     else → @trafilaturacore/native.extract(html, { focus, url })   ← napi boundary (async AsyncTask)
  │              Rust: parse → classify (3-stage cascade) → select profile → extract main content
  │                    → preserve-markup serialize (UNSANITIZED) + baseline rescue on under-extraction
  │              returns { contentHtml, pageType, confidence, textLength, fallbackUsed, warnings }
  └─ cleanHtml(contentHtml, level | config)   (TS, src/cleaning/*)
        normalize (parse5) → sanitize (preset/config) → re-normalize → SECURITY FLOOR (unconditional)
        → DOCTYPE → format (prettier/minify)   →  { html, messages }
```

**The doc-09 sanitization split.** The Rust core does boilerplate selection + extraction hygiene only:
scripts/style/etc. die before scoring (a pre-scoring hygiene side effect that guarantees no `<script>`
ever crosses the FFI), but the core applies **no tag/attribute/scheme/CSS policy** — it emits kept nodes
with their original markup. `contentHtml` is therefore unsanitized-but-script-free and **must always flow
through `cleanHtml`**; it is never exposed directly. The TS cleaning stage owns ALL sanitization, and its
**security floor is unconditional**: `enforceSecurityFloor` + `cleanStyledHtml` run as the final pass
on EVERY path (preset, custom config, `correct`), stripping `<script>`/`<iframe>`/`<object>`/`<embed>`/
`<base>`/`<meta http-equiv>`, every `on*` handler + `srcdoc`, dangerous URL schemes, and dangerous inline
CSS — closing the wildcard-config bypass a `{ "allowedAttributes": { "*": ["*"] } }` config could exploit.

**The napi boundary** (generated `packages/trafilaturacore/native/index.d.ts`, consumed only by `pipeline.ts`):

```ts
extract(html: string, options?: { pageType?: PageType; focus?: 'precision'|'balanced'|'recall'; url?: string })
  → Promise<{ contentHtml: string; pageType: PageType; confidence?: number;
              textLength: number; fallbackUsed: boolean; warnings: string[] }>
extractSync(html, options?) → the same object synchronously
```

`pageType`/`focus` are typed as string-literal UNIONS (not const enums — bundlers erase those); the Rust
crate converts to/from its enums. `pipeline.ts` lazy-loads the binding on the first non-`'none'` clean;
native `warnings` surface in `clean().messages` (prefixed `boilerplate:`), and a native failure — including
a missing platform prebuild — degrades to cleaning the whole document with a warning instead of rejecting.

### The Rust extraction crate (`packages/trafilaturacore/native/`)

A simplified fork of rs-trafilatura's **live** extraction path (MIT OR Apache-2.0; derived under
Apache-2.0). Modules: `extract.rs` (orchestration, content-node cascade, dual-mode serializer + internal
text twin, comments, tables with `MAX_TABLE_CELLS`/`MAX_TABLE_TEXT_LEN` caps + a real depth guard),
`extractor/fallback.rs` (JSON-LD `articleBody` + baseline rescue + external-candidate comparison),
`selector/*`, `html_processing.rs` (bucket-B doc-cleaning), `link_density.rs`, `dom.rs` (dom_query),
`tags.rs`, `patterns.rs`, and `page_type/` (the classifier). Re-entrancy fix: rs-trafilatura's
`COMMENTS_ARE_CONTENT` thread-local is an explicit threaded parameter (the crate is entered from Node
worker threads). No panics — all errors are typed `Result`s mapped to JS exceptions; `unsafe_code` denied
(allowed only inside napi-derive codegen).

### The page-type classifier (Rust, no ONNX)

3-stage cascade: (1) URL heuristics → (2) HTML-signal refinement (only overrides `Article`) → (3) a GBDT
over **189 features (89 numeric + 100 TF-IDF)**. Confidence: URL/signal type agrees with ML → 1.0/0.95;
else the softmax argmax probability (compared by **argmax class**, not float). The evaluator is a pure-Rust
walk over the XGBoost native JSON dump (`multi:softprob`, 7 classes, 1400 trees, round-robin
`tree_info[i]%7`, strict `<` splits in **float32**, softmax→argmax). Feature parity with
`training/extract_features.py` is byte-level (sklearn `smooth_idf` L2 TF-IDF, baked StandardScaler, UTF-8
byte lengths, CPython whitespace class, selectolax comma-union non-dedup, the 500k enhanced-feature gate),
validated by `native/tests/classifier_parity.rs` against fixtures `training/` regenerates.

### The TypeScript shell (`packages/trafilaturacore/src/`)

`pipeline.ts` (the public `clean()`), `cleaning/` (the five levels + custom `CleanConfig` + the
unconditional floor + the optional DOMPurify/jsdom hardened backend), `metadata/` (the sidecar + its own
`dom.ts` linkedom helper), `cli*.ts` (offline `-b/-l/-c/-m/-u/--json/-o/-q`), `types.ts` (the FROZEN public
surface — plain string unions, no enums; `native-types.test.ts` asserts the public `PageType` union equals
the napi one). Public API: `clean(html, options?) → Promise<{ html, messages, metadata?, pageType?, confidence? }>`
with `boilerplate` (default `balanced`), `level` (default `standard`), `config?`, `minify?`,
`maxInputBytes?` (default 10 MB, enforced before the FFI), `url?` (context only, never fetched).

### Training (offline Python, `training/`)

Trains XGBoost from WCXB (200 rounds, depth 8, `multi:softprob`, SMOTE), exports `model.xgb.json` (via
`Booster.save_model`) + `tfidf-vocab.json` (vocab + IDF + StandardScaler stats) + the Rust↔Python parity
fixtures into `packages/trafilaturacore/native/`. Not a pnpm workspace member; not shipped at runtime.

## Monorepo layout

```
Cargo.toml                     # root Rust workspace: members=["packages/trafilaturacore/native"]; Cargo.lock committed
packages/
  trafilaturacore/                  # npm `trafilaturacore` (published): src/{cleaning,metadata}, pipeline.ts, cli*, types.ts
    native/                    # crate `trafilaturacore-native` = npm `@trafilaturacore/native` (private): the Rust core +
                               #   #[napi] surface + artifacts/ + npm/<target>/ committed prebuilds
  clean-corpus-tester/          # @trafilaturacore/clean-corpus-tester — offline E2E corpus tester (in `pnpm test`)
  live-crawl-tester/           # @trafilaturacore/live-crawl-tester — out-of-brief unimplemented stub
training/                      # offline Python (uv): XGBoost → model.xgb.json + tfidf-vocab.json + fixtures
```

`pnpm-workspace.yaml` globs (contextractor): `packages/*`, `packages/*/native`, `packages/*/native/npm/*`.
The native package `build`/`test` scripts self-skip when no Rust toolchain is configured (committed prebuilds
cover `pnpm build`/`test`); CI rebuilds + refreshes the prebuilds for the 5 native targets + a
`wasm32-wasip1-threads` fallback.

## Stack

- **Rust** (crate): `dom_query` (html5ever DOM), `tendril`, `regex`, `serde`/`serde_json`, `thiserror`,
  `url`, `html-escape`; napi-rs v3 (`napi`/`napi-derive`) + `napi-build` for the addon. edition 2024;
  clippy `unwrap_used`/`expect_used`/`missing_errors_doc` denied, `unsafe_code` denied.
- **TypeScript** (Node 22+, pnpm 10+, Turborepo, Biome, vitest): `sanitize-html`, `parse5`, `linkedom`,
  `prettier`, `html-minifier-terser`, `chardet`/`iconv-lite`, `commander`; optional `dompurify`/`jsdom`.
- **Python** (3.12+, uv): `xgboost`, `scikit-learn`, `imbalanced-learn`, `selectolax`.

## Build and test

`pnpm build` (turbo `tsc`; native self-skips to prebuilds), `pnpm lint` (Biome + markdownlint + Prettier),
`pnpm test` (turbo vitest incl. the offline clean-corpus-tester); `cargo test --workspace` + `cargo clippy
--all-targets -- -D warnings` + `cargo fmt --check` for the crate; `uv run pytest` + `uvx ruff` for training.
The adbar eval harness (`packages/trafilaturacore/test/validation/`) and the clean-corpus-tester are the offline
integration oracles; the external `~/r/trafilatura-external-tester/` runs the four-engine live token/visual
benchmark (network, out-of-repo). Lockfiles: `pnpm-lock.yaml` gitignored (plain `pnpm install`); `Cargo.lock`
committed.

## Operating modes

The build brief runs either **update-in-place** (a green v1 exists → migrate: v1 is the regression oracle)
or **from-scratch** (greenfield → build every pillar fresh against the reference engines + the brief's target
contracts). This build ran update-in-place.

## Source authority hierarchy

`rs-trafilatura` + `web-page-classifier` define WHAT (the page-type architecture + the primary code-level
port target); `go-trafilatura` + `adbar/trafilatura` define HOW extraction behaves (deferred to when
rs-trafilatura's live path is thin); `trafilatura-rs` is the tiebreaker; `readability` is a DOM idiom
reference. They live read-only OUTSIDE this repo at `~/r/trafilatura-sources/`.

## Licensing and attribution

Apache-2.0. The Rust core is a code-level derivative of rs-trafilatura (MIT OR Apache-2.0, used under
Apache-2.0); the metadata subsystem ports adbar/trafilatura; go-trafilatura's tag catalogs reach the crate
through the port lineage; the WCXB dataset is CC-BY-4.0 (attribution required). Full attribution in
[`@/NOTICE`](NOTICE).

## Per-component SPEC files

- [`@/packages/trafilaturacore/SPEC.md`](packages/trafilaturacore/SPEC.md) — the library's public API + cleaning behavior.
- [`@/packages/trafilaturacore/native/SPEC.md`](packages/trafilaturacore/native/SPEC.md) — the Rust crate + napi boundary.
- [`@/packages/live-crawl-tester/SPEC.md`](packages/live-crawl-tester/SPEC.md) — the out-of-brief stub.
- [`@/packages/clean-corpus-tester/SPEC.md`](packages/clean-corpus-tester/SPEC.md) — the offline corpus E2E tester.
- [`@/training/SPEC.md`](training/SPEC.md) — the offline XGBoost → JSON training pipeline.
