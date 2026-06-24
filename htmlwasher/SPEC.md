# htmlwasher — Specification

Status: pending — not implemented. This document describes the intended public
API surface and module layout of the `htmlwasher` library. None of it is
built yet; the package is a scaffold. The implementation lands in phases per the
build brief at [`@/prompts/2026-6-24-init/prompt.md`](../prompts/2026-6-24-init/prompt.md).
Keep this spec in sync with the source as the port is implemented.

## Purpose

`htmlwasher` is a TypeScript port of Trafilatura. Given the HTML of a web
page, it extracts the main content (clean text plus structured metadata) and
classifies the page type so extraction can be routed through a profile tuned for
that type. It is a Node.js library — not a scraper or a browser automation
framework.

## Intended public API surface

The shapes below are a sketch of intent, not a committed contract. Names,
fields, and signatures will be finalized as the phases land.

### extract()

The primary entry point. Accepts page HTML (and optional context such as the
source URL and extraction options) and returns the extracted content together
with metadata, the detected page type, and a confidence score.

- Input: HTML string, optional source URL, optional extraction options
  (output format, metadata toggles, fallback behavior).
- Output: extracted main text, structured metadata (title, author, date,
  sitename, tags), the detected page type, and a confidence value.

### PageTypeClassifier (interface)

The page-type classifier interface. Implementations consume page features and
return a page-type label with a confidence score. ONNX inference runs behind
this interface, with `onnxruntime-node` as the default backend and
`onnxruntime-web` (WASM) as an alternative — both satisfy one interface.

- Page types under consideration: article, forum, product, collection, listing,
  documentation, service.

### Per-type extraction profiles

Each page type maps to an extraction profile that tunes the core algorithm for
that type. The classifier's output selects the profile; the profile drives the
type-specific extraction pass.

### Confidence

Both classification and extraction report a confidence signal so callers can
gate on or fall back from low-confidence results.

## Module layout

Pending — directories are scaffolded and currently empty.

- `src/index.ts` — public entry point and re-exports (currently exposes only
  `VERSION`).
- `src/core/` — the core Trafilatura extraction algorithm (DOM traversal,
  content scoring, cleanup).
- `src/metadata/` — metadata extraction (title, author, date, sitename, tags).
- `src/classifier/features/` — the page-type feature extractor (classifier
  feature hot-path; uses htmlparser2).
- `src/classifier/model/` — the ONNX model assets and inference backends
  (`model.onnx`, `tfidf-vocab.json`); shipped in the npm tarball.
- `src/profiles/` — per-page-type extraction profiles.
- `test/` — fixture-based and unit tests.
- `fixtures/` — HTML fixtures for tests.

## Dependencies

- DOM parsing: `linkedom` + `parse5`, with `htmlparser2` in the classifier
  feature hot-path.
- ONNX inference: `onnxruntime-node` (default) and `onnxruntime-web` (WASM,
  optional) behind one interface.

The classifier model is trained offline in the separate `@/training/` Python
project (see [`@/training/SPEC.md`](../training/SPEC.md)) and exported as
`model.onnx` + `tfidf-vocab.json`. No Python loads at runtime.
