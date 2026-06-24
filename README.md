# htmlwasher

A TypeScript **HTML-cleanup** library — HTML in → cleaned HTML out — built on a
[Trafilatura](https://github.com/adbar/trafilatura)-derived, page-type-aware
extraction core with an ONNX page-type classifier. The published library is
`htmlwasher` (alpha — see Status below).

htmlwasher composes two orthogonal pillars behind a single `wash()` API:
**boilerplate removal** (main-content extraction, routed through a per-type
profile by a 7-class classifier, kept as a whitelisted HTML subtree) and
**HTML washing** (`sanitize-html`-based cleanup at five levels). It returns
cleaned HTML plus an optional metadata sidecar (title, author, date, sitename,
tags) and the detected page type. It never converts to Markdown/XML/text and
never touches the network: a content-cleanup **library for Node.js**, not a
scraper or browser-automation framework.

## Status

Alpha — implemented (built in phases per `@/prompts/2026-6-24-init/prompt.md`).
The extraction core, metadata extractor, trained ONNX classifier, per-type
profiles, and the five washing levels are all in place and exercised by the test
suite (260+ tests). The classifier scores ~0.78 on the held-out WCXB test split;
extraction scores F1 ≈ 0.79 on the adbar evaluation corpus. APIs may still change
before a stable release.

## Repo layout

This is a pnpm + turbo monorepo.

- `@/htmlwasher/` — the TypeScript library (the npm package
  `htmlwasher`). Strict TypeScript, Node 22+. Holds the core extraction
  algorithm, metadata extraction, the page-type classifier (189-feature
  extractor plus ONNX backends), per-page-type profiles, and the HTML-washing
  levels, all behind the `wash()` API.
- `@/training/` — an offline Python project (Python 3.12+, uv-managed) that
  trains the page-type classifier from the public WCXB dataset and exports
  `model.onnx` + `tfidf-vocab.json`. It is run offline, is not a pnpm workspace
  package, and is not shipped at runtime.
- `@/tools/wash-corpus-tester/` — a separate **offline** TypeScript workspace
  package: runs htmlwasher end-to-end over saved WCXB HTML fixtures (≥3 per page
  type × 7 types) across boilerplate × washing-level combos, asserting the
  security invariants + page-type plausibility and emitting a report. No network
  (`pnpm test:corpus`).
- `@/tools/live-crawl-tester/` — a separate scaffold stub for a future live-site
  fetcher; not part of the htmlwasher pipeline (htmlwasher itself never fetches).
- `~/r/htmlwasher-sources/` — six read-only reference repositories (rs-trafilatura,
  web-page-classifier, go-trafilatura, adbar/trafilatura, trafilatura-rs,
  readability), cloned by `@/clone-other-repos.sh`. These are gitignored inputs
  only; never edit them.
- `@/prompts/2026-6-24-init/` — the build brief (`prompt.md`) and research
  context docs that drive the phased implementation.

## Quick start

These are placeholders for the scaffold; full functionality lands as the phases
complete.

```bash
# Fetch the six read-only reference repositories into ~/r/htmlwasher-sources/ (outside this repo)
bash clone-other-repos.sh

# Install workspace dependencies
pnpm install

# Run the offline unit test suite
pnpm test
```

The classifier is trained offline in `@/training/` (Python, uv-managed) and is
not part of the Node.js install. The live-crawl tester hits the network and is
not part of the offline `pnpm test`.

## Inference backends

The page-type classifier runs ONNX inference behind a single interface, with
`onnxruntime-node` as the default backend and `onnxruntime-web` (WASM) as an
alternative. DOM parsing uses linkedom + parse5, with htmlparser2 in the
classifier feature hot-path.

## License

Licensed under the [Apache License, Version 2.0](@/LICENSE).

This library is a port of Trafilatura and references several upstream projects.
See [`@/NOTICE`](@/NOTICE) for the full attribution, including the required
credit for Adrien Barbaresi (Trafilatura), markusmobius (go-trafilatura),
Murrough Foley (rs-trafilatura, web-page-classifier, and the WCXB dataset under
CC-BY-4.0), nchapman (trafilatura-rs), and Mozilla (Readability).
