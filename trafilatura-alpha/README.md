# trafilatura-alpha

A TypeScript port of [Trafilatura](https://github.com/adbar/trafilatura) with
page-type-aware extraction and an ONNX page-type classifier. It extracts the
main content of a web page — clean text plus structured metadata (title, author,
date, sitename, tags) — and classifies the page type to route extraction through
a type-specific profile. It is a content-extraction library for Node.js: not a
scraper, not a browser automation framework.

## Status

Alpha — scaffolded, not yet implemented. This package is an empty skeleton: the
extraction, classifier, and training logic are not present. The implementation
lands in phases per the build brief at
[`@/prompts/2026-6-24-init/prompt.md`](../prompts/2026-6-24-init/prompt.md). See
[`SPEC.md`](./SPEC.md) for the intended public API surface. Do not depend on this
package yet.

## Attribution

trafilatura-alpha is a TypeScript port of Trafilatura and references several
upstream projects. The full attribution lives in the root
[`@/NOTICE`](../NOTICE) file, including the required credit for:

- Adrien Barbaresi — Trafilatura (the canonical original)
- markusmobius — go-trafilatura
- Murrough Foley — rs-trafilatura, web-page-classifier, and the WCXB dataset
  (Web Content Extraction Benchmark) under CC-BY-4.0 (attribution required)
- nchapman — trafilatura-rs
- Mozilla — Readability

The `model.onnx` shipped with this library is trained fresh from the public WCXB
dataset; it is not vendored from any upstream model binary.

## License

Licensed under the [Apache License, Version 2.0](../LICENSE).
