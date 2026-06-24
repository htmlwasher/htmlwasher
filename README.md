# htmlwasher

A TypeScript port of [Trafilatura](https://github.com/adbar/trafilatura) with
page-type-aware extraction and an ONNX page-type classifier. The published
library is `htmlwasher` (alpha — see Status below).

htmlwasher extracts the main content of a web page — clean text plus structured
metadata (title, author, date, sitename, tags) — and classifies the page type
(article, forum, product, collection, listing, documentation, service) to route
extraction through a type-specific profile. It is a content-extraction
**library for Node.js**: not a scraper, not a browser automation framework.

## Status

Early-stage scaffold. The implementation is being built in phases per the build
brief at `@/prompts/2026-6-24-init/prompt.md`. There is no published package
yet, and the extraction, classifier, and training logic are not implemented in
this scaffold. Treat everything here as a work in progress.

## Repo layout

This is a pnpm + turbo monorepo.

- `@/htmlwasher/` — the TypeScript library (the npm package
  `htmlwasher`). Strict TypeScript, Node 22+. Holds the core extraction
  algorithm, metadata extraction, the page-type classifier (181-feature
  extractor plus ONNX backends), and per-page-type profiles.
- `@/training/` — an offline Python project (Python 3.12+, uv-managed) that
  trains the page-type classifier from the public WCXB dataset and exports
  `model.onnx` + `tfidf-vocab.json`. It is run offline, is not a pnpm workspace
  package, and is not shipped at runtime.
- `@/tools/live-crawl-tester/` — a separate TypeScript workspace package: an
  end-to-end live-site fetcher (polite fetcher — robots.txt, rate limiting, disk
  cache) that runs extraction and classification over real URLs. It is a thin
  polite fetcher, not a browser-automation crawler.
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
