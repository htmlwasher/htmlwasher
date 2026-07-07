# trafilaturacore

A TypeScript **HTML-cleanup** library — HTML in → cleaned HTML out — built on a
[Trafilatura](https://github.com/adbar/trafilatura)-derived, page-type-aware
extraction core with a pure-Rust page-type classifier. The published library is
`trafilaturacore` (alpha — see Status below).

trafilaturacore composes two orthogonal pillars behind a single `clean()` API:
**boilerplate removal** (main-content extraction, routed through a per-type
profile by a 7-class classifier, kept as a whitelisted HTML subtree) and
**HTML cleaning** (`sanitize-html`-based cleanup at five levels). It returns
cleaned HTML plus an optional metadata sidecar (title, author, date, sitename,
tags) and the detected page type. It never converts to Markdown/XML/text and
never touches the network: a content-cleanup **library for Node.js**, not a
scraper or browser-automation framework.

## Status

Alpha — implemented (built in phases per `@/prompts/2026-6-24-init/prompt.md`).
The extraction core, metadata extractor, trained pure-Rust GBDT classifier,
per-type profiles, and the five cleaning levels are all in place and exercised
by the test suite (260+ tests). The classifier scores ~0.78 on the held-out
WCXB test split; extraction scores F1 ≈ 0.79 on the adbar evaluation corpus.
APIs may still change before a stable release.

## Repo layout

This is a pnpm + turbo monorepo.

- `@/packages/trafilaturacore/` — the TypeScript library (the npm package
  `trafilaturacore`). Strict TypeScript, Node 22+. Holds metadata extraction and the
  HTML-cleaning levels; the core extraction algorithm, the page-type classifier
  (a 189-feature extractor evaluated by a pure-Rust GBDT, no ONNX), and
  per-page-type profiles live in the `@trafilaturacore/native` Rust crate
  (`@/packages/trafilaturacore/native/`, reached via napi-rs). Exposed both as the
  `clean()` library API and as an offline `trafilaturacore` CLI (reads a file or
  stdin, writes cleaned HTML to stdout; never fetches).
- `@/training/` — an offline Python project (Python 3.12+, uv-managed) that
  trains the page-type classifier from the public WCXB dataset and exports
  `model.xgb.json` (the XGBoost native JSON dump) + `tfidf-vocab.json`. It is
  run offline, is not a pnpm workspace package, and is not shipped at runtime.
- `@/packages/clean-corpus-tester/` — a separate **offline** TypeScript workspace
  package: runs trafilaturacore end-to-end over saved WCXB HTML fixtures (≥3 per page
  type × 7 types) across boilerplate × cleaning-level combos, asserting the
  security invariants + page-type plausibility and emitting a report. No network
  (`pnpm test:corpus`).
- `@/packages/live-crawl-tester/` — a separate scaffold stub for a future live-site
  fetcher; not part of the trafilaturacore pipeline (trafilaturacore itself never fetches).
- `~/r/trafilatura-sources/` — six read-only reference repositories (rs-trafilatura,
  web-page-classifier, go-trafilatura, adbar/trafilatura, trafilatura-rs,
  readability), cloned by `@/clone-other-repos.sh`. These are gitignored inputs
  only; never edit them.
- `@/prompts/2026-6-24-init/` — the build brief (`prompt.md`) and research
  context docs that drive the phased implementation.

## Quick start

```bash
# Fetch the six read-only reference repositories into ~/r/trafilatura-sources/ (outside this repo)
bash clone-other-repos.sh

# Install workspace dependencies
pnpm install

# Build, then run the offline unit test suite (turbo)
pnpm build
pnpm test
```

Use it as a **library**:

```ts
import { clean } from 'trafilaturacore';
const { html, metadata, pageType } = await clean(pageHtml, {
  boilerplate: 'balanced', // precision | balanced | recall | none
  level: 'standard', //      minimal | standard | permissive | styled | correct
  minify: false, //          set true to minify instead of pretty-print
});
```

…or as a **CLI** (offline — reads a file or stdin, writes cleaned HTML to stdout):

```bash
trafilaturacore article.html -b balanced -l standard      # file in → stdout
cat page.html | trafilaturacore --minify                  # stdin → minified stdout
trafilaturacore page.html --json > out.json               # full result (html + metadata + pageType)
```

The classifier is trained offline in `@/training/` (Python, uv-managed) and is
**not** part of the Node.js install at build time — the npm package ships the
`@trafilaturacore/native` crate (a prebuilt `.node` binary) with `model.xgb.json` +
`tfidf-vocab.json` baked in via Rust `include_str!`; there is no `onnxruntime`
at runtime. The `clean-corpus-tester` runs entirely offline; the
`live-crawl-tester` is an unimplemented stub (trafilaturacore itself never fetches).

## Classifier inference

The page-type classifier is not a swappable JS inference backend: it runs
in-crate as a pure-Rust GBDT evaluator over the XGBoost native JSON dump
(`model.xgb.json`), reached from Node via the `@trafilaturacore/native` napi-rs
binding — there is no ONNX runtime and no `onnxruntime-node`/`onnxruntime-web`
backend to swap. DOM parsing on the TypeScript side (metadata extraction, HTML
cleaning) uses `linkedom` (backed by `parse5`).

## License

Licensed under the [Apache License, Version 2.0](@/LICENSE).

This library is a port of Trafilatura. See [`@/NOTICE`](@/NOTICE) for the full
attribution. **Required** credits (their code or the trained model ships in the
package): Adrien Barbaresi (Trafilatura), Markus Mobius (go-trafilatura), and
Murrough Foley (rs-trafilatura, and the WCXB dataset under CC-BY-4.0, used
unmodified — DOI 10.5281/zenodo.19316874). **Courtesy** credits (consulted as
references; no code shipped): Murrough Foley (web-page-classifier), Nathaniel
Chapman (trafilatura-rs), and Arc90/Mozilla (Readability).
