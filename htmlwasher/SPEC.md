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

Stages: metadata sidecar (from the original document) → classify → select profile
→ boilerplate(mode) → wash(level). For any mode other than `none`, the page is
classified and extraction is routed through the matching per-type profile; the
detected `pageType` + `confidence` are returned. `mode: 'none'` bypasses
extraction (and classification) and washes the whole document.

The two knobs are orthogonal — any boilerplate mode combines with any washing
level. These options (plus the optional `url` context) are the entire user-facing
surface; there are deliberately no `includeComments`/`includeTables`/
`includeImages`/`includeLinks` toggles.

### CLI — _implemented (`src/cli.ts` + `src/cli-program.ts`)_

The same `wash()` pipeline, exposed as an **offline** command-line tool. Installed
via the `bin` entry (`htmlwasher → dist/cli.js`) and importable as `htmlwasher/cli`.
It reads HTML from a file argument or stdin and writes cleaned HTML (or the full
JSON result) to stdout or a file. **It NEVER fetches a URL** — `--url` is passed to
`wash()` as classifier/metadata context only, exactly like the library `url` option.

```text
htmlwasher [input] [options]
```

- Positional `[input]` — path to an HTML file. Omit it (or pass `-`) to read HTML
  from **stdin**. A bare invocation with an interactive TTY and no piped input
  fails with exit code 1 rather than hanging.

| Option                     | Maps to `wash()` | Notes                                                                            |
| -------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| `-b, --boilerplate <mode>` | `boilerplate`    | `precision\|balanced\|recall\|none`; default `balanced`. Validated.              |
| `-l, --level <level>`      | `level`          | `minimal\|standard\|permissive\|styled\|correct`; default `standard`. Validated. |
| `-m, --minify`             | `minify`         | minify the output instead of pretty-formatting.                                  |
| `-u, --url <url>`          | `url`            | context only — **never fetched**.                                                |
| `-o, --output <file>`      | —                | write the result to a file instead of stdout.                                    |
| `--json`                   | —                | emit `{ html, metadata, pageType, confidence, messages }` as pretty JSON.        |
| `-q, --quiet`              | —                | suppress the stderr diagnostics + `[pageType conf]` line.                        |

I/O semantics: stdout carries the cleaned HTML (or JSON); stderr carries the
`messages` diagnostics and a `[pageType confidence]` line (suppressed by `--quiet`,
and skipped under `--json`, whose payload already carries them). A reader that
closes early (`| head`) ends the stream quietly (EPIPE is treated as success).

The testable core is `runWash(opts: ResolvedCliOptions, io: { stdin, stdout, stderr })`
→ `Promise<number>` (exit code: 0 success, 1 handled error — missing input file,
empty stdin, write failure). It never calls `process.exit()`. `buildProgram()` builds
the commander program; its action parses argv into `ResolvedCliOptions` and runs
`runWash` against the real process streams. `runCli(program, argv)` parses and maps
thrown errors to `process.exitCode = 1` (never `process.exit()` mid-pipe, so stdout
flushes). `isMainEntry(import.meta.url)` realpath-compares so `cli.ts` self-runs only
as the program entry point.

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
- `WashResult` = `{ html: string; messages: Message[]; metadata?: Metadata;
pageType?: PageType; confidence?: number }` (`pageType`/`confidence` set when
  extraction runs, omitted for `boilerplate: 'none'`).
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

### Per-type extraction profiles — _implemented (Phase 5)_

Each page type maps to a profile (`src/profiles/`, `getProfile(pageType)`) ported
from rs-trafilatura: content selectors (tried first), preserved tags, extra
boilerplate selectors, `commentsAreContent`, and the aggregate/collect flags. The
classifier's predicted type selects the profile, which feeds the core via
`CoreOptions` (`contentSelectors`/`preserveTags`/`boilerplateSelectors`/
`commentsAsContent`). `aggregateSections`/`collectRepeatedItems` post-passes and
the dead `lenientBoilerplate`/`minParagraphDensity` fields are carried but not yet
consumed (matching rs-trafilatura).

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
- `src/profiles/` — the 7 per-page-type extraction profiles + `getProfile`. _implemented (Phase 5)_
- `src/washing/` — HTML washing. Entry: `washHtml(html, level, { minify?, hardened? })`
  / `washBuffer(buffer, level, opts)` → `Promise<{ html, messages }>` (async:
  prettier/minifier are lazily imported). Pipeline: normalize (parse5) → sanitize
  (sanitize-html + level preset; skipped for `correct`) → re-normalize (if
  transformTags) → DOCTYPE → format. Security at every level (script/on\*/
  javascript:/data: stripped; styled adds a CSS-URL allow-list). Optional
  DOMPurify/jsdom hardened backend behind the `Sanitizer` seam. _implemented (Phase 6)_
- `src/pipeline.ts` — orchestrates metadata + boilerplate(mode) → wash(level),
  exposing the public `wash()`. _implemented_
- `src/cli-program.ts` — the offline CLI core: `buildProgram()` (commander),
  `runWash(opts, io)` (testable, stream-injected, returns an exit code), `runCli`,
  `isMainEntry`. Wraps `wash()`; never fetches. _implemented_
- `src/cli.ts` — `#!/usr/bin/env node` entry (`bin: htmlwasher`, export
  `htmlwasher/cli`); self-runs `runCli` only when it is the program entry point. _implemented_
- `test/`, `fixtures/` — golden-fixture + unit tests; HTML fixtures. _pending_

## Dependencies

- DOM parsing: `linkedom` (primary) + `parse5` (WHATWG normalization), with
  `htmlparser2` in the classifier feature hot-path.
- HTML washing: `sanitize-html` (default sanitizer), `prettier` (format),
  `html-minifier-terser` (minify), `chardet` + `iconv-lite` (decode non-UTF-8
  buffers). _added in Phase 6._
- ONNX inference: `onnxruntime-node` (default) + `onnxruntime-web` (WASM,
  optional) behind one interface; pinned to exactly 1.27.0.

The classifier model is trained offline in the separate `@/training/` Python
project (see [`@/training/SPEC.md`](../training/SPEC.md)) and exported as
`model.onnx` + `tfidf-vocab.json`. No Python loads at runtime.
