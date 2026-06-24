# htmlwasher — Specification

## Status

This SPEC describes the **intended architecture** of a scaffolded repository. The
implementation is **pending** and is being built in phases (Phase 0 through Phase 7) per the build brief at `@/prompts/2026-6-24-init/prompt.md`. At the time of
writing, the root workspace configuration exists but the component directories
(`@/htmlwasher/`, `@/tools/live-crawl-tester/`, `@/training/`) and their
source skeletons are not yet created.

Treat every API, module, and artifact named below as a **design target**, not an
implemented contract. Do not assume any function, class, schema field, or output
format described here is callable yet. As each phase lands, this SPEC and the
per-component SPEC files are updated to reflect what actually exists (see
`@/.claude/rules/spec-maintenance.md`).

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

Inference runs behind a single `PageTypeClassifier` interface with swappable
backends: **`onnxruntime-node`** (default) and **`onnxruntime-web`** (WASM, for
zero-native-binary / serverless deployment). The onnxruntime version is pinned to
a known-good release. Lives under `@/htmlwasher/src/classifier/`, with the
feature extractor in `@/htmlwasher/src/classifier/features/` and the
shipped model artifacts in `@/htmlwasher/src/classifier/model/`.

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
  src/index.ts              Public entry point
  test/                     Unit tests (mirrors src/)
  fixtures/                 Saved HTML + expected output (golden tests)
tools/
  live-crawl-tester/        Separate TS workspace package: live-site E2E fetcher
training/                   Offline Python pipeline (NOT a workspace member, NOT shipped)
prompts/2026-6-24-init/     Build brief (prompt.md) + research context docs
# (the six read-only reference repos live OUTSIDE this repo at ~/r/htmlwasher-sources/)
```

### Component — htmlwasher (the library)

The published npm package `htmlwasher`. Strict TypeScript (Node 22+,
NodeNext modules). Holds the core extraction algorithm, metadata extraction, the
page-type classifier (189-feature extractor + ONNX backends), and the
per-page-type profiles. The model artifacts (`model.onnx`, `tfidf-vocab.json`)
are committed shipped artifacts — they are deliberately **not** gitignored.
See `@/htmlwasher/SPEC.md` for the public API and module-level behavior.

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

### Component — tools/live-crawl-tester (E2E harness)

A **separate** TypeScript workspace package that proves the library works on the
real web. It depends on the local `htmlwasher` package, reads a
configurable URL list (at least 3 real URLs per page type across all 7 types,
including multilingual / EU sources), fetches each page, runs extraction +
classification, and reports per-URL PASS/FAIL against simple assertions.

It is a **thin polite fetcher** — it respects `robots.txt`, sets a descriptive
User-Agent, rate-limits, times out with backoff retry, and caches fetched HTML to
disk so reruns are reproducible offline. It is **not** a browser-automation or
anti-bot crawler. It hits the network and is **not** part of the offline
`pnpm test`. See `@/tools/live-crawl-tester/SPEC.md` for usage.

## Stack

- **TypeScript** — strict mode (`"strict": true`), Node 22+, `NodeNext` module
  resolution, ES2022 target.
- **DOM parsing** — **linkedom** (primary) backed by **parse5**; **htmlparser2**
  in the classifier feature hot-path (it is the speed leader for the tight
  feature-extraction inner loop).
- **ONNX inference** — **onnxruntime-node** (default) and **onnxruntime-web**
  (WASM) behind one `PageTypeClassifier` interface; version pinned.
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

The offline `pnpm test` never hits the network. The live-crawl tester is run
separately (its own script under `@/tools/live-crawl-tester/`) and is excluded
from `pnpm test`. The Python training pipeline is run offline under `@/training/`
via uv and is independent of the Node toolchain.

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
- `@/tools/live-crawl-tester/SPEC.md` — the live-crawl E2E harness.
- `@/training/SPEC.md` — the offline Python training pipeline.

## Build phases

The implementation lands in phases, gated by an explicit definition-of-done per
phase, tracked in `@/prompts/2026-6-24-init/prompt.md`:

- **Phase 0 — Orientation:** read the research context docs; map the source repos
  to the planned `src/` layout; record findings in `PORTING-NOTES.md`.
- **Phase 1 — Scaffold:** initialize the `htmlwasher` package (strict
  tsconfig, vitest, lint); gate is a passing `pnpm test` and clean type-check.
- **Phase 2 — Core extraction:** port the core algorithm from go-trafilatura.
- **Phase 3 — Metadata:** port metadata extraction.
- **Phase 4 — Feature extraction + ML model:** build the 189-feature extractor in
  both Python and TypeScript, train the model, export `model.onnx` +
  `tfidf-vocab.json`, wire the 3-stage cascade; gate is >=99% TS/Python feature
  parity and matching argmax predictions.
- **Phase 5 — Per-type profiles + confidence:** route extraction by page type.
- **Phase 6 — Validation:** run the full pipeline over adbar's test corpus;
  document gaps in `PORTING-NOTES.md`.
- **Phase 7 — Live-crawl tester:** build `@/tools/live-crawl-tester/`.
