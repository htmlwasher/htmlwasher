# htmlwasher — Specification

Status: implemented (alpha). This document tracks the public API surface and module
layout of the `htmlwasher` library (build brief:
[`@/prompts/2026-6-24-init/prompt.md`](../prompts/2026-6-24-init/prompt.md);
port map: [`@/PORTING-NOTES.md`](../PORTING-NOTES.md)). Every module below is
implemented and covered by a green test suite; APIs may still change before a
stable release. Keep this spec in sync with the source.

## Purpose

`htmlwasher` is a TypeScript HTML-cleanup library: **HTML in → cleaned HTML out**.
It never converts to Markdown, XML, XML/TEI, or plain text, and never fetches the
network. It has two orthogonal, composable pillars:

- **Boilerplate removal** — a Trafilatura-derived, page-type-aware main-content
  extractor (article/main detection, fallback cascade, comment + table handling)
  that keeps the result as an HTML subtree. It now lives in the **`@htmlwasher/native`
  Rust crate** (napi binding), which classifies the page (a pure-Rust GBDT
  page-type classifier — 7 types, **no ONNX**) and routes extraction through the
  matching per-type profile internally, then emits **preserve-markup** HTML: the
  kept nodes' original tags + all attributes, script-free but otherwise
  UNSANITIZED (bucket-C output sanitization is deleted from the crate per doc 09).
  Gated by a boilerplate-removal mode.
- **HTML washing** — a sanitize-html-based sanitize + normalize + format stage,
  exposed as five washing levels. It owns ALL sanitization: the Rust core's
  unsanitized `contentHtml` MUST flow through `washHtml` (it always does).

## Public API surface

### wash() — _implemented (`src/pipeline.ts`)_

The single entry point. Combines both pillars (async — the washing formatter is
loaded lazily):

```ts
wash(html: string, options?: WashOptions): Promise<WashResult>
```

Stages: metadata sidecar (from the original document) → boilerplate(mode) →
wash(level). For any mode other than `none`, `pipeline.ts` calls the
`@htmlwasher/native` Rust core's async `extract(html, { focus, url })`, which
classifies the page and routes extraction through the matching per-type profile
**internally** and returns the preserve-markup content HTML plus the detected
`pageType` + `confidence` (both surfaced on the result). The public `wash()` never
passes a `pageType` override — the classifier always auto-runs. When extraction
yields empty content, `wash()` keeps the whole document and warns. `mode: 'none'`
bypasses the FFI call entirely (no extraction, no classification) and washes the
whole document.

#### Native diagnostics and degradation

The native module is loaded **lazily** (a cached dynamic import) on the first
non-`none` wash — `boilerplate: 'none'`, metadata-only use, and any platform
without a loadable prebuilt `.node` never touch the FFI module (package import
and the CLI keep working). The core's non-fatal `warnings` (`body-fallback-used`,
`content-very-short`, `json-ld-rescue`, `baseline-rescue`) surface in
`WashResult.messages` as `{ type: 'warning', text: 'boilerplate: <warning>' }`;
`fallbackUsed` gets no message of its own — every fallback/rescue result already
carries one of those warnings. If the native call fails (an `extract()` rejection
or a missing/unloadable binding), `wash()` does **not** reject: it degrades to
washing the whole document, pushes a `boilerplate removal failed: …; washing the
whole document` warning, and omits `pageType`/`confidence`. `wash()` still throws
`TypeError`/`RangeError` for its own boundary validation (below).

### Markup-preservation semantics (doc 09)

Because the Rust core is preserve-markup, `class`/inline `style`/`data-*`/`id`
survive extraction (v1's TS core stripped them before washing) — so at washing
levels that permit those attributes they now flow all the way through: `styled`
keeps `class` + inline `style`; `correct` (normalize-only) keeps everything the
security floor allows, incl. `data-*`. The lower presets (`minimal`/`standard`/
`permissive`) still drop `class`/`style` per their allow-lists. **Fallback-path
limitation:** when a structured/baseline fallback wins, the crate synthesizes
markup (e.g. bare `<p>`), so markup preservation is best-effort by construction —
"original markup" always means "modulo doc-cleaning".

The two knobs are orthogonal — any boilerplate mode combines with any washing
level. Instead of a named `level`, callers may pass a fully-custom `config` (a
`SanitizeConfig` — pure JSON data); when set it drives the sanitize stage and
takes precedence over `level`. These options (plus the optional `url` context)
are the entire user-facing surface; there are deliberately no
`includeComments`/`includeTables`/`includeImages`/`includeLinks` toggles. The
security floor is **unconditional**: `enforceSecurityFloor` + the CSS-URL
sanitizer (`sanitizeStyledHtml`) run as the final washing pass on **every** path —
every preset level (including `correct`) and every custom `config`. `<script>`
(tag + text), every `on*` handler, `javascript:`/`vbscript:`/untrusted `data:`
URLs, and dangerous inline CSS (`expression()`, `-moz-binding`,
`url(javascript:|data:)`, `@import`) are always stripped — **not** gated on
whether the config happens to allow inline `style`. This closes the
wildcard-config bypass a `{ "allowedAttributes": { "*": ["*"] } }` custom config
previously exploited (it passes shape validation, keeps `onclick`, and defeats the
CSS gate). `correct` is normalize-only only for the tag _allow-list_ (it runs no
preset, preserving all benign tags/attributes); it still runs the mandatory floor.

#### Boundary validation and input cap

`wash()` validates inputs at the boundary: it throws a `TypeError` when `html` is
not a string, when `options.boilerplate`/`options.level` is provided-but-invalid,
or when `options.config` is provided-but-invalid. It accepts
`WashOptions.maxInputBytes?: number` (default `DEFAULT_MAX_INPUT_BYTES` = 10 MB
UTF-8) and throws a `RangeError` when the input's UTF-8 byte length exceeds it — a
resource bound (validate input at every boundary).

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
| `-c, --config <file.json>` | `config`         | custom `SanitizeConfig` JSON file; read + validated; precedence over `--level`.  |
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
- `WashOptions` = `{ boilerplate?, level?, config?, minify?, maxInputBytes?, url? }`.
  `minify` defaults to `false` (prettier-format); `url` is context-only and never
  fetched. `config?: SanitizeConfig` is a fully-custom washing config that takes
  precedence over `level`. `maxInputBytes?` (default `DEFAULT_MAX_INPUT_BYTES` =
  10 MB UTF-8) caps the input size. `wash()` throws a `TypeError` when `html` is
  not a string or when `boilerplate`/`level`/`config` is provided-but-invalid, and
  a `RangeError` when the input exceeds `maxInputBytes`.
- `SanitizeConfig` = `{ allowedTags?, allowedAttributes?, allowedClasses?,
selfClosing?, nonTextTags?, transformTags? }` — all JSON-serializable (plain data,
  no functions). `isSanitizeConfig(value)` / `sanitizeConfigError(value)` are the
  boundary guards (reject unknown/wrong-typed fields with a clear message); both
  the library and the CLI validate with them.
- `WashResult` = `{ html: string; messages: Message[]; metadata?: Metadata;
pageType?: PageType; confidence?: number }` (`pageType`/`confidence` set when
  extraction runs, omitted for `boilerplate: 'none'`).
- `Message` = `{ type: 'info' | 'warning' | 'error'; text: string }`.
- `Metadata` (optional sidecar) = `{ title?, author?, url?, hostname?,
description?, sitename?, date?, categories?, tags?, image?, pageType?, license? }`.
- Runtime guards: `isBoilerplateMode`, `isWashingLevel`, `isPageType`.

Both enumerations are plain string-union / `as const`-array types, **not**
TypeScript `enum`s (locked decision #4).

### Page-type classifier + per-type profiles — _in the `@htmlwasher/native` Rust crate_

The 3-stage classifier cascade and the 7 per-type extraction profiles no longer
have a TypeScript implementation — they moved into the `@htmlwasher/native` Rust
core (a **pure-Rust GBDT** over the XGBoost native JSON dump, **no ONNX runtime**).
`pipeline.ts` calls the crate's `extract(html, { focus, url })`; the crate runs the
cascade (Stage-1 URL heuristics → Stage-2 HTML-signal refinement of `article` →
Stage-3 GBDT ML), selects the matching profile, extracts, and returns
`{ contentHtml, pageType, confidence?, textLength, fallbackUsed, warnings }`. The
classifier is byte-identical to v1's model (same XGBoost weights + `tfidf-vocab.json`,
retrained deterministically); cross-language feature/argmax parity is proven by
cargo `tests/classifier_parity.rs`. See
[`native/SPEC.md`](native/SPEC.md) for the crate surface and
[`@/PORTING-NOTES.md`](../../PORTING-NOTES.md) (`## v2`) for the classifier ground
truth. `wash()` never passes a `pageType` override, so `confidence` is always
present when extraction runs.

## Module layout

- `src/index.ts` — public entry point; re-exports the type surface + `VERSION`
  (the `wash()` pipeline is wired at the orchestration step). _implemented (re-exports)_
- `src/types.ts` — the public type surface (option unions, `WashOptions`,
  `WashResult`, `Metadata`, `PageType`, guards). _implemented_
- The extraction algorithm, page-type classifier, and per-type profiles live in
  the `@htmlwasher/native` Rust crate — there is no longer a `src/core/`,
  `src/classifier/`, or `src/profiles/` in this package. See
  [`native/SPEC.md`](native/SPEC.md). `pipeline.ts` consumes the crate via its
  async `extract()`.
- `src/metadata/` — optional metadata sidecar. Entry:
  `extractMetadata(html, url?)` / `extractMetadataFromDocument(doc, url?)` →
  `Metadata`. Per-field merge (NOT a blanket override), ported from adbar
  `metadata.py`/`json_metadata.py`/`xpaths.py`: meta/OpenGraph fill first; then
  JSON-LD fills EMPTY `title`/`categories`/`pageType`, APPENDS authors
  (`normalizeAuthors`), and conditionally replaces `sitename`
  (`isPlausibleSitename`) — it never overrides an already-set title and never
  touches `description`; DOM/XPath then fills any remaining empties. The extractor
  ends with a `cleanAndTrim()` pass over each string field (cap to 10000 chars,
  then `unescape` + line-process). `date.ts` is a reduced htmldate equivalent.
  `dom.ts` is the metadata-scoped linkedom wrapper (`parseDocument`, `trim`,
  `TEXT_NODE`, and the node/element/document interfaces) — relocated from the former
  `core/dom.ts` at Phase INTEGRATE, trimmed to the metadata-used subset. _implemented (Phase 3)_
- `src/washing/` — HTML washing. Entry: `washHtml(html, level, { minify?, hardened?, config? })`
  / `washBuffer(buffer, level, opts)` → `Promise<{ html, messages }>` (async:
  prettier/minifier are lazily imported). Pipeline: normalize (parse5) → sanitize
  (sanitize-html + level preset or custom config; skipped for bare `correct`) →
  re-normalize (if transformTags) → **security floor (UNCONDITIONAL)** → DOCTYPE →
  format. The named-preset sanitize stage is skipped for `correct` (no allow-list),
  but the **security floor runs on every path — every level (including `correct`)
  and every custom `config`**: `enforceSecurityFloor` + `sanitizeStyledHtml` run as
  the final pass, force-stripping `<script>` (tag + text), every `on*` handler,
  `javascript:`/`vbscript:`/untrusted `data:` URLs, and dangerous inline CSS (the
  CSS-URL allow-list is applied unconditionally, not only when a config permits
  inline `style`), while leaving every benign tag/attribute in place — closing the
  `{ "allowedAttributes": { "*": ["*"] } }` wildcard-config bypass. Optional
  DOMPurify/jsdom hardened backend behind the `Sanitizer` seam. _implemented (Phase 6)_
- `src/pipeline.ts` — orchestrates metadata + boilerplate(mode) → wash(level),
  exposing the public `wash()`. Loads `@htmlwasher/native` lazily (never for
  `mode: 'none'`), starts the Rust extraction before the synchronous metadata
  parse so the threadpool work overlaps it, surfaces native `warnings` as
  `boilerplate: <warning>` messages, and degrades a native failure to
  whole-document washing with a warning. _implemented_
- `src/cli-program.ts` — the offline CLI core: `buildProgram()` (commander),
  `runWash(opts, io)` (testable, stream-injected, returns an exit code), `runCli`,
  `isMainEntry`. Wraps `wash()`; never fetches. _implemented_
- `src/cli.ts` — `#!/usr/bin/env node` entry (`bin: htmlwasher`, export
  `htmlwasher/cli`); self-runs `runCli` only when it is the program entry point. _implemented_
- `src/native-types.test.ts` — a compile-time guard that the frozen public
  `PageType` union stays byte-identical to `@htmlwasher/native`'s
  `ExtractResult['pageType']` (both are the 7 wire strings). _implemented_
- `test/`, `fixtures/` — unit tests under `src/` and `test/` (incl.
  `test/validation/` — the adbar eval regression oracle over the full `wash()`
  pipeline); HTML fixtures under `fixtures/{classifier,validation}/`. _implemented_

## Dependencies

- Extraction + classification: `@htmlwasher/native` (`workspace:*`) — the Rust
  core (napi binding). It is the only extraction/classifier dependency; there is
  no ONNX runtime in this package anymore.
- DOM parsing (metadata + washing): `linkedom` (primary) + `parse5` (WHATWG
  normalization). `htmlparser2` is retained as a declared metadata/washing helper
  dependency (knip flags it as not directly imported — it was already unused at the
  pre-INTEGRATE HEAD, not a regression from the classifier removal).
- HTML washing: `sanitize-html` (default sanitizer), `prettier` (format),
  `html-minifier-terser` (minify), `chardet` + `iconv-lite` (decode non-UTF-8
  buffers); optional `dompurify`/`jsdom` hardened backend. _added in Phase 6._

The classifier model + `tfidf-vocab.json` are trained offline in the separate
`@/training/` Python project (see [`@/training/SPEC.md`](../../training/SPEC.md))
and baked into the `@htmlwasher/native` crate as `include_str!`-ed artifacts. No
Python or ONNX loads at runtime.
