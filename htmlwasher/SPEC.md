# htmlwasher — Specification

Status: in progress. This document tracks the public API surface and module
layout of the `htmlwasher` library as the phased port lands (build brief:
[`@/prompts/2026-6-24-init/prompt.md`](../prompts/2026-6-24-init/prompt.md);
port map: [`@/PORTING-NOTES.md`](../PORTING-NOTES.md)). Sections marked _pending_
are not implemented yet. Keep this spec in sync with the source.

## Purpose

`htmlwasher` is a TypeScript HTML-cleanup library: **HTML in → cleaned HTML out**.
It never converts to Markdown, XML, XML/TEI, or plain text, and never fetches the
network. It has two orthogonal, composable pillars:

- **Boilerplate removal** — a Trafilatura-derived, page-type-aware main-content
  extractor (article/main detection, fallback cascade, comment + table handling)
  that keeps the result as an HTML subtree, re-serialized through a tag/attribute
  whitelist. An ONNX page-type classifier (7 types) routes extraction through a
  per-type profile. Gated by a boilerplate-removal mode.
- **HTML washing** — a sanitize-html-based sanitize + normalize + format stage,
  exposed as five washing levels.

## Public API surface

### wash() — _implemented (`src/pipeline.ts`)_

The single entry point. Combines both pillars (async — the washing formatter is
loaded lazily):

```ts
wash(html: string, options?: WashOptions): Promise<WashResult>
```

Stages: metadata sidecar (from the original document) → boilerplate(mode) →
wash(level). `mode: 'none'` bypasses extraction and washes the whole document.
Page-type classification + per-type profile routing (Phase 4/5) plug into the
boilerplate stage as the trained classifier lands.

The two knobs are orthogonal — any boilerplate mode combines with any washing
level. These options (plus the optional `url` context) are the entire user-facing
surface; there are deliberately no `includeComments`/`includeTables`/
`includeImages`/`includeLinks` toggles.

### Types — _implemented in `src/types.ts`_

- `BOILERPLATE_MODES` (`as const`) + `BoilerplateMode` =
  `'precision' | 'balanced' | 'recall' | 'none'`. Default `'balanced'`. Maps to
  Trafilatura's `favor_precision`/`favor_recall`; `none` skips boilerplate removal
  entirely (washes the whole document — htmlwasher's addition).
- `WASHING_LEVELS` (`as const`) + `WashingLevel` =
  `'minimal' | 'standard' | 'permissive' | 'styled' | 'correct'`. Default
  `'standard'`. The single tag-inclusion control. No `*-reader` variants.
- `PAGE_TYPES` (`as const`) + `PageType` = the 7 types
  (`article, forum, product, collection, listing, documentation, service` — note
  `collection`, not `category`).
- `WashOptions` = `{ boilerplate?, level?, minify?, url? }`. `minify` defaults to
  `false` (prettier-format); `url` is context-only and never fetched.
- `WashResult` = `{ html: string; messages: Message[]; metadata?: Metadata }`.
- `Message` = `{ type: 'info' | 'warning' | 'error'; text: string }`.
- `Metadata` (optional sidecar) = `{ title?, author?, url?, hostname?,
description?, sitename?, date?, categories?, tags?, image?, pageType?, license? }`.
- Runtime guards: `isBoilerplateMode`, `isWashingLevel`, `isPageType`.

Both enumerations are plain string-union / `as const`-array types, **not**
TypeScript `enum`s (locked decision #4).

### PageTypeClassifier — _implemented (Phase 4)_

`new PageTypeClassifier(backend?).classifyPage(html, url?)` →
`Promise<{ pageType, confidence }>`; module-level `classifyPage(html, url?)` uses a
cached default. ONNX inference runs behind the `InferenceBackend` interface
(`run(features: number[]) => Promise<number[]>`): `OnnxNodeClassifier`
(`onnxruntime-node`, default) and `OnnxWebClassifier` (`onnxruntime-web` WASM,
lazily imported optionalDependency) are swappable. The classifier runs the 3-stage
cascade with the agreement rule from `extract.rs`:

- Stage-1 `classifyUrl(url)` — ordered URL heuristics (mod.rs constant lists).
- Stage-2 `refineWithSignals` / `refineWithHtmlSignals` — refines ONLY `article`.
- Stage-3 ML — `buildFeatureVector` (189) → ONNX → argmax via `classLabels`.
- Selection: URL+ML agree on non-article → conf `1.0`; refined+ML agree → `0.95`;
  else ML argmax + max softmax prob.

Feature parity with the Python extractor is verified by `parity.test.ts` against
`fixtures/classifier/parity.json` (numeric + TF-IDF within `1e-6`, ONNX argmax
exact). To match lexbor's spec-compliant tree, the classifier parses HTML via
`parseDocumentSpec` (parse5 normalize → linkedom).

### Per-type extraction profiles — _pending (Phase 5)_

Each page type maps to a profile (content selectors, preserve/boilerplate tags,
`comments_are_content`, aggregate/collect post-passes) that tunes the core
extraction pass selected by the classifier output.

## Module layout

- `src/index.ts` — public entry point; re-exports the type surface + `VERSION`
  (the `wash()` pipeline is wired at the orchestration step). _implemented (re-exports)_
- `src/types.ts` — the public type surface (option unions, `WashOptions`,
  `WashResult`, `Metadata`, `PageType`, guards). _implemented_
- `src/core/` — Trafilatura extraction algorithm + whitelist re-serializer (emits
  the kept content as an HTML subtree). Entry: `extractContentHTML(html, opts?)` →
  `{ html, textLength, fallbackUsed }`. Modules: `dom` (linkedom helpers),
  `constants` (go-trafilatura tag catalogs + content selectors), `clean`
  (docCleaning + link-density), `main-content` (selector/semantic/scoring
  cascade), `serialize-filtered` (postCleaning + whitelist re-serializer),
  `extract` (orchestration). _implemented (Phase 2)_
- `src/metadata/` — optional metadata sidecar. Entry:
  `extractMetadata(html, url?)` / `extractMetadataFromDocument(doc, url?)` →
  `Metadata`. Field precedence OG → JSON-LD (override) → meta → DOM, ported from
  adbar `metadata.py`/`json_metadata.py`/`xpaths.py`. `date.ts` is a reduced
  htmldate equivalent. _implemented (Phase 3)_
- `src/classifier/features/` — the 189-feature extractor (89 numeric + 100
  TF-IDF); byte-for-byte parity with `training/extract_features.py`. Entries:
  `extractNumericFeatures(html, url)` (89), `titleMetaText(html)` + `computeTfidf`
  (100), `buildFeatureVector(html, url)` (189 = scaled numeric ++ tfidf). `dom-query`
  (selectolax-parity helpers: UTF-8 byte lengths, non-deduped comma-union matching).
  _implemented (Phase 4)_
- `src/classifier/` — `classifier` (`PageTypeClassifier`, backends, cascade),
  `url-heuristics` (`classifyUrl`), `html-signals` (Stage-2 refinement),
  `url-constants` (mod.rs lists), `model-paths` (artifact resolver). _implemented (Phase 4)_
- `src/classifier/model/` — shipped `model.onnx` (float `[1,189]` → `label` int64 +
  `probabilities` `[1,7]`) + `tfidf-vocab.json` (vocab/idf/scaler/classLabels).
  Shipped in the npm tarball; loaded once at runtime. _implemented (Phase 4)_
- `src/profiles/` — per-page-type extraction profiles + confidence. _pending (Phase 5)_
- `src/washing/` — HTML washing. Entry: `washHtml(html, level, { minify?, hardened? })`
  / `washBuffer(buffer, level, opts)` → `Promise<{ html, messages }>` (async:
  prettier/minifier are lazily imported). Pipeline: normalize (parse5) → sanitize
  (sanitize-html + level preset; skipped for `correct`) → re-normalize (if
  transformTags) → DOCTYPE → format. Security at every level (script/on\*/
  javascript:/data: stripped; styled adds a CSS-URL allow-list). Optional
  DOMPurify/jsdom hardened backend behind the `Sanitizer` seam. _implemented (Phase 6)_
- `src/pipeline.ts` — orchestrates metadata + boilerplate(mode) → wash(level),
  exposing the public `wash()`. _implemented_
- `test/`, `fixtures/` — golden-fixture + unit tests; HTML fixtures. _pending_

## Dependencies

- DOM parsing: `linkedom` (primary) + `parse5` (WHATWG normalization), with
  `htmlparser2` in the classifier feature hot-path.
- HTML washing: `sanitize-html` (default sanitizer), `prettier` (format),
  `html-minifier-terser` (minify), `chardet` + `iconv-lite` (decode non-UTF-8
  buffers). _added in Phase 6._
- ONNX inference: `onnxruntime-node` (default) + `onnxruntime-web` (WASM,
  optional) behind one interface; pinned ≥ 1.23.0.

The classifier model is trained offline in the separate `@/training/` Python
project (see [`@/training/SPEC.md`](../training/SPEC.md)) and exported as
`model.onnx` + `tfidf-vocab.json`. No Python loads at runtime.
