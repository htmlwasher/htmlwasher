# trafilatura — Specification

Status: implemented (alpha). This document tracks the public API surface and module
layout of the `trafilaturacore` library (build brief:
[`@/prompts/2026-6-24-init/prompt.md`](../../prompts/2026-6-24-init/prompt.md);
port map: [`@/PORTING-NOTES.md`](../../PORTING-NOTES.md)). Every module below is
implemented and covered by a green test suite; APIs may still change before a
stable release. Keep this spec in sync with the source.

## Purpose

`trafilaturacore` is a TypeScript HTML-cleanup library: **HTML in → cleaned HTML out**.
It never converts to Markdown, XML, XML/TEI, or plain text, and never fetches the
network. It has two orthogonal, composable pillars:

- **Boilerplate removal** — a Trafilatura-derived, page-type-aware main-content
  extractor (article/main detection, fallback cascade, comment + table handling)
  that keeps the result as an HTML subtree. It now lives in the **`@trafilaturacore/native`
  Rust crate** (napi binding), which classifies the page (a pure-Rust GBDT
  page-type classifier — 7 types, **no ONNX**) and routes extraction through the
  matching per-type profile internally, then emits **preserve-markup** HTML: the
  kept nodes' original tags + all attributes, script-free but otherwise
  UNSANITIZED (bucket-C output sanitization is deleted from the crate per doc 09).
  Gated by a boilerplate-removal mode.
- **HTML cleaning** — a sanitize-html-based sanitize + normalize + format stage,
  driven by the single Trafilatura-aligned `DEFAULT_CLEAN_CONFIG` (replaceable
  with a custom `CleanConfig`; there is no "cleaning level" concept — upstream
  Trafilatura has none either). It owns ALL sanitization: the Rust core's
  unsanitized `contentHtml` MUST flow through `cleanHtml` (it always does).

## Public API surface

### clean() — _implemented (`src/pipeline.ts`)_

The single entry point. Combines both pillars (async — the cleaning formatter is
loaded lazily):

```ts
clean(html: string, options?: CleanOptions): Promise<CleanResult>
```

Stages: metadata sidecar (from the original document) → boilerplate(mode) →
clean(config). For any mode other than `clean-keep-boilerplate`, `pipeline.ts` calls the
`@trafilaturacore/native` Rust core's async `extract(html, { focus, url })`, which
classifies the page and routes extraction through the matching per-type profile
**internally** and returns the preserve-markup content HTML plus the detected
`pageType` + `confidence` (both surfaced on the result). The public `clean()` never
passes a `pageType` override — the classifier always auto-runs. When extraction
yields empty content, `clean()` keeps the whole document and warns.
`mode: 'clean-keep-boilerplate'` bypasses the FFI call entirely (no extraction, no
classification) and cleans the whole document.

#### Native diagnostics and degradation

The native module is loaded **lazily** (a cached dynamic import) on the first
non-`clean-keep-boilerplate` clean — `boilerplate: 'clean-keep-boilerplate'`, metadata-only use, and any platform
without a loadable prebuilt `.node` never touch the FFI module (package import
and the CLI keep working). The core's non-fatal `warnings` (`body-fallback-used`,
`content-very-short`, `json-ld-rescue`, `baseline-rescue`) surface in
`CleanResult.messages` as `{ type: 'warning', text: 'boilerplate: <warning>' }`;
`fallbackUsed` gets no message of its own — every fallback/rescue result already
carries one of those warnings. If the native call fails (an `extract()` rejection
or a missing/unloadable binding), `clean()` does **not** reject: it degrades to
cleaning the whole document, pushes a `boilerplate removal failed: …; cleaning the
whole document` warning, and omits `pageType`/`confidence`. `clean()` still throws
`TypeError`/`RangeError` for its own boundary validation (below).

### Markup-preservation semantics (doc 09)

Because the Rust core is preserve-markup, `class`/inline `style`/`data-*`/`id`
survive extraction (v1's TS core stripped them before cleaning) — so a custom
`config` that permits those attributes lets them flow all the way through. The
default Trafilatura-aligned config drops them per its scoped attribute
allow-list. **Fallback-path limitation:** when a structured/baseline fallback
wins, the crate synthesizes markup (e.g. bare `<p>`), so markup preservation is
best-effort by construction — "original markup" always means "modulo
doc-cleaning".

The two core knobs are orthogonal — any boilerplate mode combines with the default
or a custom cleaning config. The sanitize stage ALWAYS runs, driven by
`DEFAULT_CLEAN_CONFIG`; callers may pass a fully-custom `config` (a
`CleanConfig` — pure JSON data) that **replaces** the default Trafilatura-aligned
config. On top of the config, the four tri-state `include*` toggles
(`includeComments`/`includeTables`/`includeImages`/`includeLinks`) subtract a
content family on an explicit `false` (see `deriveContentConfig` under Types).
The security floor is **unconditional**: `enforceSecurityFloor` + the CSS-URL
cleaner (`cleanStyledHtml`) run as the final cleaning pass on **every** path —
the default config and every custom `config`. `<script>` (tag + text), every
`on*` handler, `javascript:`/`vbscript:`/untrusted `data:`
URLs, and dangerous inline CSS (`expression()`, `-moz-binding`,
`url(javascript:|data:)`, `@import`) are always stripped — **not** gated on
whether the config happens to allow inline `style`. This closes the
wildcard-config bypass a `{ "allowedAttributes": { "*": ["*"] } }` custom config
previously exploited (it passes shape validation, keeps `onclick`, and defeats the
CSS gate).

#### Boundary validation and input cap

`clean()` validates inputs at the boundary: it throws a `TypeError` when `html` is
not a string, when `options.boilerplate` is provided-but-invalid,
or when `options.config` is provided-but-invalid. It accepts
`CleanOptions.maxInputBytes?: number` (default `DEFAULT_MAX_INPUT_BYTES` = 10 MB
UTF-8) and throws a `RangeError` when the input's UTF-8 byte length exceeds it — a
resource bound (validate input at every boundary).

### CLI — _implemented (`src/cli.ts` + `src/cli-program.ts`)_

The same `clean()` pipeline, exposed as an **offline** command-line tool. Installed
via the `bin` entry (`trafilaturacore → dist/cli.js`) and importable as `trafilaturacore/cli`.
It reads HTML from a file argument or stdin and writes cleaned HTML (or the full
JSON result) to stdout or a file. **It NEVER fetches a URL** — `--url` is passed to
`clean()` as classifier/metadata context only, exactly like the library `url` option.

```text
trafilaturacore [input] [options]
```

- Positional `[input]` — path to an HTML file. Omit it (or pass `-`) to read HTML
  from **stdin**. A bare invocation with an interactive TTY and no piped input
  fails with exit code 1 rather than hanging.

| Option                     | Maps to `clean()` | Notes                                                                                 |
| -------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `-b, --boilerplate <mode>` | `boilerplate`     | `precision\|balanced\|recall\|clean-keep-boilerplate`; default `balanced`. Validated. |
| `-c, --config <file.json>` | `config`          | custom `CleanConfig` JSON file; read + validated; replaces the default config.        |
| `--no-comments`            | `includeComments` | soft no-op (comment retention follows the page-type profile).                         |
| `--no-tables`              | `includeTables`   | drop table subtrees (`table`/`caption`/`tr`/`td`/`th`/`colgroup`/`col`).              |
| `--no-images`              | `includeImages`   | drop image subtrees (`img`/`figure`/`figcaption`/`picture`/`source`).                 |
| `--no-links`               | `includeLinks`    | unwrap `<a>` (keep the anchor text, drop `href`).                                     |
| `-m, --minify`             | `minify`          | minify the output instead of pretty-formatting.                                       |
| `-u, --url <url>`          | `url`             | context only — **never fetched**.                                                     |
| `-o, --output <file>`      | —                 | write the result to a file instead of stdout.                                         |
| `--json`                   | —                 | emit `{ html, metadata, pageType, confidence, messages }` as pretty JSON.             |
| `-q, --quiet`              | —                 | suppress the stderr diagnostics + `[pageType conf]` line.                             |

I/O semantics: stdout carries the cleaned HTML (or JSON); stderr carries the
`messages` diagnostics and a `[pageType confidence]` line (suppressed by `--quiet`,
and skipped under `--json`, whose payload already carries them). A reader that
closes early (`| head`) ends the stream quietly (EPIPE is treated as success).

The testable core is `runClean(opts: ResolvedCliOptions, io: { stdin, stdout, stderr })`
→ `Promise<number>` (exit code: 0 success, 1 handled error — missing input file,
empty stdin, write failure). It never calls `process.exit()`. `buildProgram()` builds
the commander program; its action parses argv into `ResolvedCliOptions` and runs
`runClean` against the real process streams. `runCli(program, argv)` parses and maps
thrown errors to `process.exitCode = 1` (never `process.exit()` mid-pipe, so stdout
flushes). `isMainEntry(import.meta.url)` realpath-compares so `cli.ts` self-runs only
as the program entry point.

### Types — _implemented in `src/types.ts`_

- `BOILERPLATE_MODES` (`as const`) + `BoilerplateMode` =
  `'precision' | 'balanced' | 'recall' | 'clean-keep-boilerplate'`. Default `'balanced'`. Maps
  to Trafilatura's `favor_precision`/`favor_recall`; `clean-keep-boilerplate` skips
  boilerplate removal + classification entirely (cleans the whole document,
  never loads the FFI binding — trafilaturacore's addition).
- `DEFAULT_CLEAN_CONFIG` (a `CleanConfig`, defined in `src/cleaning/config.ts`,
  re-exported from the root via `types.ts`) — the single Trafilatura-aligned
  cleaning config, derived from Trafilatura 2.1.0: `allowedTags` = Trafilatura's
  HTML output vocabulary (`TEI_VALID_TAGS` rendered via `HTML_CONVERSIONS` —
  `p`, `h1`–`h6`, `ul`/`li`, `table`/`tr`/`td`/`th`, `blockquote`, `pre`, `br`,
  `img`, `a`, `i`/`strong`/`u`/`var`/`sub`/`sup`, `del`, plus
  `html`/`head`/`meta`/`body` scaffolding and `title` for whole-document
  cleaning) union rs-trafilatura's serializer whitelist additions (`ol`, `code`,
  `hr`, `dl`/`dt`/`dd`, `caption`/`colgroup`/`col`, `q`, `em`/`b`/`s`,
  `kbd`/`samp`, `figure`/`figcaption`/`picture`/`source`). Trafilatura's
  `MANUALLY_CLEANED` list maps to `nonTextTags` (subtree discarded WITH content:
  `nav`, `aside`, `form` + form controls, `video`/`audio`, `time`,
  `svg`/`canvas`, `iframe`/`object`/`embed`, `style`/`script`/`noscript`, … —
  minus the image-mode rescues `figure`/`picture`/`source`, minus `head`
  (scaffolding), minus `header`/`footer`, which the Rust core emits inside
  `article`/`main`, so they are unwrapped instead). Trafilatura's
  `MANUALLY_STRIPPED` list is simply NOT allowed = tag unwrapped, content kept
  (`div`, `span`, `section`, `article`, `main`, `header`, `footer`, `abbr`,
  `cite`, `mark`, `small`, `thead`/`tbody`/`tfoot`, …; the HTML5 re-normalizer
  (parse5) re-synthesizes a bare `<tbody>` around rows, like a browser).
  `CUT_EMPTY_ELEMS` is NOT mirrored (no sanitize-html equivalent; the Rust core
  prunes empties during extraction). `allowedAttributes` is scoped:
  `a[href,title]`, `img[src,alt,title,width,height]`, `td[colspan,rowspan]`,
  `th[colspan,rowspan,scope]`, `blockquote[cite]`, `q[cite]`,
  `ol[start,type,reversed]`, `code[class]`, `col`/`colgroup[span]`,
  `source[src,srcset,type,media]`, `html[lang]`, `meta[charset,name,content]`.
  `transformTags` normalizes legacy tags: `strike`→`del`, `tt`→`var`,
  `dir`→`ul`, `listing`→`pre`, `xmp`→`pre`, `plaintext`→`pre`.
- `PAGE_TYPES` (`as const`) + `PageType` = the 7 types
  (`article, forum, product, collection, listing, documentation, service` — note
  `collection`, not `category`).
- `CleanOptions` = `{ boilerplate?, includeComments?, includeTables?,
includeImages?, includeLinks?, config?, minify?, maxInputBytes?, url? }`.
  `minify` defaults to `false` (prettier-format); `url` is context-only and never
  fetched. `config?: CleanConfig` is a fully-custom cleaning config that replaces
  the default Trafilatura-aligned config. The four `include*` toggles are tri-state
  (default keep; only an explicit `false` subtracts) and mirror Trafilatura's
  `include_*` flags for the Contextractor consumer: `includeTables`/`includeImages`/
  `includeLinks: false` subtract their content family via `deriveContentConfig`
  (below), while `includeComments` is a soft no-op (comment retention follows the
  classified page-type profile). `maxInputBytes?` (default
  `DEFAULT_MAX_INPUT_BYTES` = 10 MB UTF-8) caps the input size. `clean()` throws
  a `TypeError` when `html` is not a string, when `boilerplate`/`config` is
  provided-but-invalid, or when any `include*` toggle is provided but not a boolean,
  and a `RangeError` when the input exceeds `maxInputBytes`.
- `CleanConfig` = `{ allowedTags?, allowedAttributes?, allowedClasses?,
selfClosing?, nonTextTags?, transformTags? }` — all JSON-serializable (plain data,
  no functions). `isCleanConfig(value)` / `cleanConfigError(value)` are the
  boundary guards (reject unknown/wrong-typed fields with a clear message); both
  the library and the CLI validate with them.
- `deriveContentConfig(base: CleanConfig, toggles): CleanConfig` (exported from
  `src/cleaning/config.ts`) — derives an effective config from `base` per the
  `include*` toggles: `includeImages: false` drops `img`/`figure`/`figcaption`/
  `picture`/`source` from `allowedTags` (adding `figure`/`picture`/`img`/`source`
  to `nonTextTags` and dropping their `allowedAttributes`/`selfClosing` entries);
  `includeTables: false` drops `table`/`caption`/`tr`/`td`/`th`/`colgroup`/`col`
  (adding `table` to `nonTextTags`); `includeLinks: false` removes `a` from
  `allowedTags` (unwrapped, not discarded — anchor text kept). Returns the `base`
  reference unchanged when nothing subtracts (so the default cleaning path is
  byte-identical) and never mutates `base`. `pipeline.ts` calls it and forwards
  `options.config` verbatim when nothing subtracts.
- `CleanResult` = `{ html: string; messages: Message[]; metadata?: Metadata;
pageType?: PageType; confidence?: number }` (`pageType`/`confidence` set when
  extraction runs, omitted for `boilerplate: 'clean-keep-boilerplate'`).
- `Message` = `{ type: 'info' | 'warning' | 'error'; text: string }`.
- `Metadata` (optional sidecar) = `{ title?, author?, url?, hostname?,
description?, sitename?, date?, categories?, tags?, image?, pageType?, license? }`.
- Runtime guards: `isBoilerplateMode`, `isPageType` (plus the `CleanConfig`
  guards `isCleanConfig`/`cleanConfigError` above).

Both enumerations are plain string-union / `as const`-array types, **not**
TypeScript `enum`s (locked decision #4).

### Page-type classifier + per-type profiles — _in the `@trafilaturacore/native` Rust crate_

The 3-stage classifier cascade and the 7 per-type extraction profiles no longer
have a TypeScript implementation — they moved into the `@trafilaturacore/native` Rust
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
truth. `clean()` never passes a `pageType` override, so `confidence` is always
present when extraction runs.

## Module layout

- `src/index.ts` — public entry point; re-exports the type surface + `VERSION`
  (the `clean()` pipeline is wired at the orchestration step). _implemented (re-exports)_
- `src/types.ts` — the public type surface (option unions, `CleanOptions`,
  `CleanResult`, `Metadata`, `PageType`, guards). _implemented_
- The extraction algorithm, page-type classifier, and per-type profiles live in
  the `@trafilaturacore/native` Rust crate — there is no longer a `src/core/`,
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
- `src/cleaning/` — HTML cleaning. Entry: `cleanHtml(html, options?)`
  / `cleanBuffer(buffer, options?)` → `Promise<{ html, messages }>` (async:
  prettier/minifier are lazily imported; options: `{ minify?, hardened?, config? }`).
  `config.ts` holds the `CleanConfig` interface + the exported
  `DEFAULT_CLEAN_CONFIG` (it replaces the former `presets/` directory). Pipeline:
  normalize (parse5) → sanitize (sanitize-html + the default Trafilatura-aligned
  config or a custom config; ALWAYS runs) → re-normalize (if transformTags) →
  **security floor (UNCONDITIONAL)** → DOCTYPE → format. The **security floor
  runs on every path — the default config and every custom `config`**:
  `enforceSecurityFloor` + `cleanStyledHtml` run as
  the final pass, force-stripping `<script>` (tag + text), every `on*` handler,
  `javascript:`/`vbscript:`/untrusted `data:` URLs, and dangerous inline CSS (the
  CSS-URL allow-list is applied unconditionally, not only when a config permits
  inline `style`), while leaving every benign tag/attribute in place — closing the
  `{ "allowedAttributes": { "*": ["*"] } }` wildcard-config bypass. Optional
  DOMPurify/jsdom hardened backend behind the `Cleaner` seam. _implemented (Phase 6)_
- `src/pipeline.ts` — orchestrates metadata + boilerplate(mode) → clean(config),
  exposing the public `clean()`. Loads `@trafilaturacore/native` lazily (never for
  `mode: 'clean-keep-boilerplate'`), starts the Rust extraction before the synchronous metadata
  parse so the threadpool work overlaps it, surfaces native `warnings` as
  `boilerplate: <warning>` messages, and degrades a native failure to
  whole-document cleaning with a warning. _implemented_
- `src/cli-program.ts` — the offline CLI core: `buildProgram()` (commander),
  `runClean(opts, io)` (testable, stream-injected, returns an exit code), `runCli`,
  `isMainEntry`. Wraps `clean()`; never fetches. _implemented_
- `src/cli.ts` — `#!/usr/bin/env node` entry (`bin: trafilaturacore`, export
  `trafilaturacore/cli`); self-runs `runCli` only when it is the program entry point. _implemented_
- `src/native-types.test.ts` — a compile-time guard that the frozen public
  `PageType` union stays byte-identical to `@trafilaturacore/native`'s
  `ExtractResult['pageType']` (both are the 7 wire strings). _implemented_
- `test/`, `fixtures/` — unit tests under `src/` and `test/` (incl.
  `test/validation/` — the adbar eval regression oracle over the full `clean()`
  pipeline); HTML fixtures under `fixtures/{classifier,validation}/`. _implemented_

## Dependencies

- Extraction + classification: `@trafilaturacore/native` (`workspace:*`) — the Rust
  core (napi binding). It is the only extraction/classifier dependency; there is
  no ONNX runtime in this package anymore.
- DOM parsing (metadata + cleaning): `linkedom` (primary) + `parse5` (WHATWG
  normalization). (`htmlparser2` is no longer a declared dependency — it was
  never directly imported.)
- HTML cleaning: `sanitize-html` (default cleaner), `prettier` (format),
  `html-minifier-terser` (minify), `chardet` + `iconv-lite` (decode non-UTF-8
  buffers); optional `dompurify`/`jsdom` hardened backend. _added in Phase 6._

The classifier model + `tfidf-vocab.json` are trained offline in the separate
`@/training/` Python project (see [`@/training/SPEC.md`](../../training/SPEC.md))
and baked into the `@trafilaturacore/native` crate as `include_str!`-ed artifacts. No
Python or ONNX loads at runtime.
