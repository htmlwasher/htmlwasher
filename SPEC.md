# htmlwasher — Specification

## Status

The phased port (Phases 0–8 of the build brief at
`@/prompts/2026-6-24-init/prompt.md`) is **implemented**. The component directories
(`@/htmlwasher/`, `@/tools/htmlwasher/wash-corpus-tester/`, `@/training/`) exist with their
source, tests, and shipped artifacts (`model.onnx`, `tfidf-vocab.json`), and the
full offline test suite is green. `htmlwasher` is published as an **alpha** npm
package — APIs may still change before a stable release.

Each component's SPEC.md describes its current implemented contract; see
`@/PORTING-NOTES.md` for the port map and known gaps, and
`@/.claude/rules/spec-maintenance.md` for the ongoing spec-maintenance rule.
(`@/tools/htmlwasher/live-crawl-tester/` is an out-of-brief, unimplemented scaffold — see its
component note below.)

## Overview

htmlwasher is the product repository for **htmlwasher**: a faithful
**TypeScript port of [Trafilatura](https://github.com/adbar/trafilatura)** with
**page-type-aware extraction** and an **ONNX page-type classifier**.

It extracts the main content of a web page — clean text plus structured metadata
(title, author, date, sitename, description, tags) — and classifies the page
into one of seven page types to route extraction through a type-specific profile.
It is a content-extraction **library for Node.js**: not a scraper, not a browser
automation framework, not a cloud actor.

The seven page types are: `article`, `forum`, `product`, `collection`,
`listing`, `documentation`, `service`.

This is a **port with a divergent classifier**, not a from-scratch design. It
leans on the upstream and reference implementations cloned into `~/r/htmlwasher-sources/`
(see the Source authority hierarchy below). The published library is named
`htmlwasher` and is **alpha** — early-stage and not yet production-ready.

## Architecture

The pipeline is a linear cascade: parse HTML once into a DOM, extract the main
content, extract metadata, classify the page type, then apply a per-page-type
profile and produce a confidence score.

```
HTML → DOM (linkedom + parse5) → core extraction → metadata → classifier → profile + confidence → result
                                                                 │
                                                 3-stage URL → HTML → ML cascade
                                                 (189 features, ONNX inference)
```

### Core extraction

The main-content detection, the readability/dom-distiller-style fallback
cascade, comment extraction, table handling, and the precision/recall toggles
are ported from **go-trafilatura** (the cleanest readable reference),
disambiguated against **adbar/trafilatura** semantics. Lives under
`@/htmlwasher/src/core/`.

### Metadata

Title, author, date, URL, sitename, description, and tags — including JSON-LD,
OpenGraph, and meta-tag handling — ported from adbar/go-trafilatura. Lives under
`@/htmlwasher/src/metadata/`.

### Page-type classifier (the crux)

A 3-stage cascade equivalent to web-page-classifier's, returning
`(pageType, confidence)`:

- **URL heuristics** — fast path on URL structure.
- **HTML signal analysis** — DOM/structural signals.
- **ML inference** — an XGBoost model evaluated over **189 features** (89 numeric
  DOM/URL signals + 100 TF-IDF features), trained offline and exported to ONNX.
  The reference web-page-classifier's code (`N_NUMERIC_FEATURES = 89`) and binary
  header use 89 numeric (189 total); its README body still says 81/181 — trust
  the code.

Inference runs behind a single `InferenceBackend` interface (the swappable seam;
`PageTypeClassifier` is the concrete cascade class that holds one) with swappable
backends: **`onnxruntime-node`** (default) and **`onnxruntime-web`** (WASM, for
zero-native-binary / serverless deployment). The onnxruntime version is pinned
exactly (`1.27.0`, both backends in lockstep). Lives under
`@/htmlwasher/src/classifier/`, with the feature extractor in
`@/htmlwasher/src/classifier/features/` and the shipped model artifacts in
`@/htmlwasher/src/classifier/model/`.

Feature parity is the hard constraint: the TypeScript feature extractor MUST
produce the same feature vectors as the Python training pipeline, or predictions
diverge. The TF-IDF vocabulary and IDF weights are shipped as a locked
`tfidf-vocab.json` artifact (scikit-learn's nonstandard idf is replicated exactly:
its default `smooth_idf=True` form is `idf = ln((1+n)/(1+df)) + 1` with L2
normalization; the bare `ln(n/df) + 1` is only the non-default `smooth_idf=False`).
Cross-language parity tests compare the
**argmax class**, not exact probabilities, since float-handling differences across
runtimes can flip borderline probability values.

### Per-page-type profiles + confidence

Once classified, extraction is routed through a type-specific extraction profile
with type-specific tuning, and a confidence score is produced — ported from
**rs-trafilatura**. Lives under `@/htmlwasher/src/profiles/`.

## Monorepo layout

This is a **pnpm + turbo** monorepo. Workspace members are defined in
`@/pnpm-workspace.yaml` (`htmlwasher`, `tools/*`).

```
htmlwasher/          The TypeScript library (the npm package, alpha)
  src/core/                 Core extraction algorithm
  src/metadata/             Metadata extraction
  src/classifier/           Page-type classifier (interface + ONNX backends)
    features/               189-feature extractor (parity with training/)
    model/                  Shipped artifacts: model.onnx + tfidf-vocab.json
  src/profiles/             Per-page-type extraction profiles + confidence
  src/washing/              HTML washing levels (sanitize-html presets + format)
  src/pipeline.ts           Orchestration: the public async wash()
  src/index.ts              Public entry point (wash + types + VERSION)
  src/cli.ts                CLI entry (bin: htmlwasher) + src/cli-program.ts
  test/                     Unit tests (mirrors src/)
  fixtures/                 Saved HTML + expected output (golden tests)
tools/
  live-crawl-tester/        Out-of-brief, UNIMPLEMENTED scaffold (network fetcher; not in pnpm test)
  wash-corpus-tester/       Separate TS workspace package: OFFLINE corpus E2E tester (the delivered Phase 8 tester)
training/                   Offline Python pipeline (NOT a workspace member, NOT shipped)
prompts/2026-6-24-init/     Build brief (prompt.md) + research context docs
# (the six read-only reference repos live OUTSIDE this repo at ~/r/htmlwasher-sources/)
```

### Component — htmlwasher (the library)

The published npm package `htmlwasher`. Strict TypeScript (Node 22+,
NodeNext modules). Holds the core extraction algorithm, metadata extraction, the
page-type classifier (189-feature extractor + ONNX backends), the per-page-type
profiles, and the HTML-washing levels. It exposes two surfaces over the same
pipeline:

- **Library** — the async `wash(html, { boilerplate, level, config, minify, url })`
  (`minify: true` emits minified HTML instead of prettier-formatted; `config` is a
  fully-custom JSON `SanitizeConfig` that takes precedence over the named `level`)
  returning `{ html, messages, metadata?, pageType?, confidence? }`.
- **CLI** — `bin: htmlwasher` (`src/cli.ts` + `src/cli-program.ts`, commander):
  reads an HTML file argument or stdin and writes cleaned HTML to stdout (or
  `-o <file>`), with `-b/--boilerplate`, `-l/--level`, `-c/--config <file.json>`,
  `-m/--minify`, `-u/--url`, `--json`, `-q/--quiet`. It is **offline** — it never
  fetches a URL.

The model artifacts (`model.onnx`, `tfidf-vocab.json`) are committed shipped
artifacts — they are deliberately **not** gitignored. See `@/htmlwasher/SPEC.md`
for the public API and module-level behavior.

### Component — training (offline Python pipeline)

An offline Python project (Python 3.12+, uv-managed). It is **not** a pnpm
workspace member, is **not** shipped at runtime, and loads no extraction engine.
It trains the page-type classifier from the public **WCXB** dataset
(Web Content Extraction Benchmark, CC-BY-4.0) and exports the two artifacts the
library ships:

- `download_wcxb.py` — fetches the WCXB dataset from Hugging Face / Zenodo on
  demand (datasets are gitignored, never committed).
- `extract_features.py` — reproduces the 189 features exactly, for parity with
  the TypeScript extractor.
- `train.py` — trains an `XGBClassifier` (multi-class softprob over 7 classes),
  exports `model.onnx` via skl2onnx / onnxmltools, and emits `tfidf-vocab.json`
  (vocabulary + IDF weights). Both artifacts are copied into
  `@/htmlwasher/src/classifier/model/`.

Training runs on CPU (no GPU required) at this scale. See
`@/training/SPEC.md` for the pipeline detail.

### Component — tools/htmlwasher/live-crawl-tester (scaffold stub)

A **separate** TypeScript workspace package reserved for a future live-site E2E
harness (a thin polite fetcher — `robots.txt`, descriptive User-Agent, rate
limit, disk cache — never a browser-automation crawler). It is currently an
**unimplemented stub** and is NOT part of the htmlwasher pipeline; htmlwasher
itself never fetches. The actual offline end-to-end tester is
`tools/htmlwasher/wash-corpus-tester` (below). See `@/tools/htmlwasher/live-crawl-tester/SPEC.md`.

### Component — tools/htmlwasher/wash-corpus-tester (offline corpus E2E)

A **separate** TypeScript workspace package — the **offline** counterpart to the
live-crawl tester. It depends on the local `htmlwasher` package, reads saved WCXB
HTML fixtures (≥3 per page type across all 7 types) plus a `corpus.json` manifest,
and runs `wash()` over a fixed `boilerplate` x `level` combo matrix. It asserts
hard security invariants (no `<script>` / `on*=` handler / `javascript:` URL
survives any sanitizing level), structural invariants (non-empty output;
`correct` ⊇ `minimal` tags), and soft page-type plausibility (aggregate accuracy
floor). It is **entirely offline + deterministic** — it reads only local files,
never the network — so it **is** part of the offline `pnpm test`. It emits
`report.json` + `report.md` (git-ignored). See
`@/tools/htmlwasher/wash-corpus-tester/SPEC.md` for the full assertion matrix.

## Stack

- **TypeScript** — strict mode (`"strict": true`), Node 22+, `NodeNext` module
  resolution, ES2022 target.
- **DOM parsing** — **linkedom** (primary) backed by **parse5**; **htmlparser2**
  in the classifier feature hot-path (it is the speed leader for the tight
  feature-extraction inner loop).
- **ONNX inference** — **onnxruntime-node** (default) and **onnxruntime-web**
  (WASM) behind one `InferenceBackend` interface; version pinned exactly to
  `1.27.0` (both backends in lockstep).
- **vitest** — TypeScript unit tests (offline, headless, deterministic golden
  fixtures).
- **Biome** — JS / TS / JSON lint + format.
- **Prettier + markdownlint-cli2** — Markdown lint + format (Biome owns JS/TS/JSON;
  Prettier and markdownlint own Markdown).
- **cspell** — spelling.
- **knip** — dead-code and unused-export analysis.
- **pnpm 10** workspace + **turbo** task runner.
- **Python 3.12+ (uv-managed)** — the offline `training/` pipeline only:
  **XGBoost** + **scikit-learn** + **skl2onnx** / **onnxmltools**. No Python runs
  at library runtime.

## Build and test

Run from the repo root (`@/package.json`):

```bash
pnpm install            # Install workspace dependencies
pnpm run clone-sources  # Clone the six read-only reference repos into ~/r/htmlwasher-sources/
pnpm build              # pnpm fix, then turbo build across workspace packages
pnpm test               # turbo test — the offline vitest suite
pnpm lint               # Biome check + markdownlint + Prettier --check on Markdown
pnpm fix                # Biome --fix --unsafe + format, then markdownlint --fix + Prettier
pnpm format             # Biome format + Markdown fix
```

The offline `pnpm test` never hits the network; it includes the offline
`@/tools/htmlwasher/wash-corpus-tester/` E2E run. The out-of-brief `@/tools/htmlwasher/live-crawl-tester/`
scaffold is unimplemented and (if ever implemented) would hit the network, so it is
excluded from `pnpm test`. The Python training pipeline is run offline under
`@/training/` via uv and is independent of the Node toolchain.

## Source authority hierarchy

The six reference repos under `~/r/htmlwasher-sources/` are **read-only inputs**, cloned by
`@/clone-other-repos.sh` and gitignored — never edit them. When sources disagree,
follow this authority hierarchy:

- **rs-trafilatura** — primary port target; defines **what** to build
  (page-type-aware architecture, per-type profiles, confidence scoring,
  classifier wiring). A divergent fork — treat its extraction internals as intent
  and verify behavior against go-trafilatura / adbar.
- **web-page-classifier** — defines the **classifier behavior and features** to
  replicate (the 189 features, the 3-stage cascade, the 7 page types).
- **go-trafilatura** — faithful, cleanly readable core reference; the
  **disambiguator** for extraction logic when rs-trafilatura is unclear.
- **adbar/trafilatura** — the canonical original; the **final authority** on
  extraction semantics and option behavior, and the validation oracle (its test
  corpus).
- **trafilatura-rs** (nchapman) — faithful Rust port; cross-check / tiebreaker.
- **readability** (Mozilla) — not Trafilatura; a TypeScript/DOM idiom reference
  only (how to structure DOM traversal in JavaScript).

Rust appears in `~/r/htmlwasher-sources/` (rs-trafilatura, trafilatura-rs, web-page-classifier)
purely as read-only reference — it is **never built** in this repo.

## Licensing and attribution

htmlwasher is licensed under the **Apache License, Version 2.0**
(`@/LICENSE`). It is a port of Trafilatura and references several upstream
projects; full attribution is in `@/NOTICE`, including the required credit for
Adrien Barbaresi (Trafilatura), markusmobius (go-trafilatura), Murrough Foley
(rs-trafilatura, web-page-classifier, and the WCXB dataset under **CC-BY-4.0,
attribution required**), nchapman (trafilatura-rs), and Mozilla (Readability).

The shipped `model.onnx` is trained fresh from the public WCXB dataset — it is
**not** vendored or copied from rs-trafilatura's embedded model binary.

## Per-component SPEC files

- `@/htmlwasher/SPEC.md` — the library's public API and module behavior.
- `@/tools/htmlwasher/live-crawl-tester/SPEC.md` — the live-crawl E2E harness.
- `@/tools/htmlwasher/wash-corpus-tester/SPEC.md` — the offline corpus E2E tester.
- `@/training/SPEC.md` — the offline Python training pipeline.

## Build phases

The implementation lands in phases, gated by an explicit definition-of-done per
phase, tracked in `@/prompts/2026-6-24-init/prompt.md`:

- **Phase 0 — Orientation:** read the research context docs; map the source repos
  to the planned `src/` layout; record findings in `PORTING-NOTES.md`.
- **Phase 1 — Scaffold:** initialize the `htmlwasher` package (strict
  tsconfig, vitest, lint); gate is a passing `pnpm test` and clean type-check.
- **Phase 2 — Boilerplate-removal core:** port the core algorithm from
  go-trafilatura (emits HTML).
- **Phase 3 — Metadata:** port metadata extraction (optional sidecar).
- **Phase 4 — Feature extraction + the ML classifier:** build the 189-feature
  extractor in both Python and TypeScript, train the model, export `model.onnx` +
  `tfidf-vocab.json`, wire the 3-stage cascade; gate is >=99% TS/Python feature
  parity and matching argmax predictions.
- **Phase 5 — Per-type profiles + confidence + boilerplate modes:** route
  extraction by page type.
- **Phase 6 — HTML washing levels:** reproduce the htmlprocessing-server presets
  (`minimal`/`standard`/`permissive`/`styled`/`correct`).
- **Phase 7 — Validation against the reference corpus:** run the full pipeline over
  adbar's eval corpus; document gaps in `PORTING-NOTES.md`.
- **Phase 8 — Offline wash-corpus tester:** build `@/tools/htmlwasher/wash-corpus-tester/`
  (the delivered offline E2E tester).

`@/tools/htmlwasher/live-crawl-tester/` is not a brief phase — it is an out-of-brief,
unimplemented scaffold (see the per-component SPEC list above), not the delivered
E2E tester.
