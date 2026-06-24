# htmlwasher

A TypeScript **HTML-cleanup** library: **HTML in → cleaned HTML out**. It never
converts to Markdown, XML, or plain text, and never touches the network. It
combines two composable pillars:

- **Boilerplate removal** — a [Trafilatura](https://github.com/adbar/trafilatura)-derived,
  page-type-aware main-content extractor. An ONNX page-type classifier (7 types)
  routes extraction through a per-type profile; the kept content is re-serialized
  through a tag/attribute whitelist (never verbatim `outerHTML`).
- **HTML washing** — a [`sanitize-html`](https://www.npmjs.com/package/sanitize-html)-based
  sanitize → normalize → format stage, exposed as five washing levels.

It is a content-cleanup **library for Node.js**: not a scraper, not a browser
automation framework.

## Status

Alpha — implemented. The extraction core, metadata extractor, page-type
classifier (trained ONNX model shipped), per-type profiles, and the five washing
levels are all in place, exposed via a single `wash()` API. The classifier scores
~0.78 accuracy on the held-out WCXB test split; extraction scores F1 ≈ 0.79 on the
adbar evaluation corpus. APIs may still change before a stable release.

## Usage

```ts
import { wash } from 'htmlwasher';

const { html, metadata, pageType, confidence, messages } = await wash(pageHtml, {
  boilerplate: 'balanced', // 'precision' | 'balanced' | 'recall' | 'none'
  level: 'standard', //       'minimal' | 'standard' | 'permissive' | 'styled' | 'correct'
  minify: false,
  url: 'https://example.com/article', // optional context; never fetched
});
```

`wash()` returns cleaned **HTML** plus an optional `metadata` sidecar (title,
author, date, sitename, tags, …), the detected `pageType` + `confidence` (when
extraction runs), and diagnostic `messages`. It is `async` (the formatter loads
lazily).

The two knobs are orthogonal — any boilerplate mode combines with any washing
level. They (plus `minify`) are the entire surface: there are deliberately no
`includeComments`/`includeTables`/`includeImages`/`includeLinks` toggles. The
washing `level` is the single tag-inclusion control; `boilerplate: 'none'` skips
extraction and washes the whole document.

Security is enforced at every washing level: `<script>`, `on*` event handlers,
and `javascript:`/`data:` URLs are always stripped; the `styled` level adds a
CSS-URL allow-list. `correct` is normalize-only (the caller's trust boundary).

## Attribution

htmlwasher is a TypeScript port of Trafilatura and references several upstream
projects. The full attribution lives in the root [`@/NOTICE`](../NOTICE) file,
including the required credit for:

- Adrien Barbaresi — Trafilatura (the canonical original)
- markusmobius — go-trafilatura
- Murrough Foley — rs-trafilatura, web-page-classifier, and the WCXB dataset
  (Web Content Extraction Benchmark) under CC-BY-4.0 (attribution required)
- nchapman — trafilatura-rs
- Mozilla — Readability
- the `sanitize-html` authors and the other permissive npm dependencies that
  power the washing and DOM/inference layers

The `model.onnx` shipped with this library is trained fresh from the public WCXB
dataset; it is not vendored from any upstream model binary.

## License

Licensed under the [Apache License, Version 2.0](../LICENSE).
