# trafilaturacore

[![Build](https://github.com/trafilatura/trafilatura/actions/workflows/build-native.yml/badge.svg)](https://github.com/trafilatura/trafilatura/actions/workflows/build-native.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](https://github.com/trafilatura/trafilatura/blob/main/LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](https://github.com/trafilatura/trafilatura)

A TypeScript **HTML-cleanup** library — HTML in → cleaned HTML out — built on a
[Trafilatura](https://github.com/adbar/trafilatura)-derived, page-type-aware
extraction core with a pure-Rust page-type classifier. The published library is
`trafilaturacore` (alpha — see Status below).

trafilaturacore composes two orthogonal pillars behind a single `clean()` API:
**boilerplate removal** (main-content extraction, routed through a per-type
profile by a 7-class classifier, kept as a whitelisted HTML subtree) and
**HTML cleaning** (`sanitize-html`-based, Trafilatura-aligned cleanup). It returns
cleaned HTML plus an optional metadata sidecar (title, author, date, sitename,
tags) and the detected page type. It never converts to Markdown/XML/text and
never touches the network: a content-cleanup **library for Node.js**, not a
scraper or browser-automation framework.

## Status

Alpha — implemented. The extraction core, metadata extractor, trained pure-Rust GBDT classifier,
per-type profiles, and the Trafilatura-aligned cleaning stage are all in place
and exercised by the test suite (260+ tests). The classifier scores ~0.78 on the
held-out WCXB test split; extraction scores F1 0.835 on the adbar evaluation corpus.
APIs may still change before a stable release.

## Repo layout

This is a pnpm + turbo monorepo.

- `@/packages/trafilaturacore/` — the TypeScript library (the npm package
  `trafilaturacore`). Strict TypeScript, Node 22+. Holds metadata extraction and the
  Trafilatura-aligned HTML-cleaning stage; the core extraction algorithm, the page-type classifier
  (a 189-feature extractor evaluated by a pure-Rust GBDT, no ONNX), and
  per-page-type profiles live in the `@trafilaturacore/native` Rust crate
  (`@/packages/trafilaturacore/native/`, reached via napi-rs). Exposed both as the
  `clean()` library API and as an offline `trafilaturacore` CLI (reads a file or
  stdin, writes cleaned HTML to stdout; never fetches).
- `@/packages/standalone-python/` — the PyPI package `trafilaturacore`: a thin
  Python wrapper that drives the bundled Node CLI via subprocess. Alpha and
  experimental — maintained, but not fully tested or officially supported.
- `@/examples/` — runnable examples for each surface: the npm CLI
  (`examples/npm-cli/`), the npm library (`examples/npm-library/`), and the PyPI
  library (`examples/pypi-library/`), all cleaning the shared
  `examples/sample.html`.
- `@/docs/` — third-party licence notes and the per-phase port map
  (`docs/PORTING-NOTES.md`).
- `@/media/` — the brand assets used by the registry READMEs.

The page-type classifier is trained offline from the public WCXB dataset; the
trained artifacts (`model.xgb.json`, `tfidf-vocab.json`) are committed into the
Rust crate and baked in via `include_str!`, so no training step is needed to
build or use the library.

## Quick start

```bash
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
  boilerplate: 'balanced', // precision | balanced | recall | keep
  includeImages: false, //   tri-state include* toggles; default keeps everything
  minify: false, //          set true to minify instead of pretty-print
});
```

…or as a **CLI** (offline — reads a file or stdin, writes cleaned HTML to stdout):

```bash
trafilaturacore article.html -b balanced                  # file in → stdout
cat page.html | trafilaturacore --minify                  # stdin → minified stdout
trafilaturacore page.html --no-images --no-links          # drop images, flatten links
trafilaturacore page.html --json > out.json               # full result (html + metadata + pageType)
```

The classifier is trained offline and is **not** part of the Node.js install at
build time — the npm package ships the `@trafilaturacore/native` crate (a
prebuilt `.node` binary) with `model.xgb.json` + `tfidf-vocab.json` baked in via
Rust `include_str!`; there is no `onnxruntime` at runtime.

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
