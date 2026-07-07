# trafilaturacore

[![Build](https://github.com/trafilatura/trafilatura/actions/workflows/build-native.yml/badge.svg)](https://github.com/trafilatura/trafilatura/actions/workflows/build-native.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](https://github.com/trafilatura/trafilatura/blob/main/LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](https://github.com/trafilatura/trafilatura)

A TypeScript **HTML-cleanup** library: **HTML in → cleaned HTML out**. It never
converts to Markdown, XML, or plain text, and never touches the network. It
combines two composable pillars:

- **Boilerplate removal** — a [Trafilatura](https://github.com/adbar/trafilatura)-derived,
  page-type-aware main-content extractor. A pure-Rust GBDT page-type classifier
  (7 types) routes extraction through a per-type profile; the kept content is
  emitted as preserve-markup HTML (original tags + attributes, script-free but
  otherwise unsanitized) — the cleaning stage below owns all sanitization.
- **HTML cleaning** — a [`sanitize-html`](https://www.npmjs.com/package/sanitize-html)-based
  sanitize → normalize → format stage, driven by a single Trafilatura-aligned
  default config (replaceable with a custom `CleanConfig`).

It is a content-cleanup **library for Node.js**: not a scraper, not a browser
automation framework.

## Status

Alpha — implemented. The extraction core, metadata extractor, page-type
classifier (a pure-Rust GBDT shipped as `model.xgb.json`), per-type profiles,
and the Trafilatura-aligned cleaning stage are all in place, exposed via a
single `clean()` API. The classifier scores ~0.78 accuracy on the held-out WCXB
test split; extraction scores F1 ≈ 0.835 on the adbar evaluation corpus. APIs
may still change before a stable release.

## Usage

```ts
import { clean } from 'trafilaturacore';

const { html, metadata, pageType, confidence, messages } = await clean(pageHtml, {
  boilerplate: 'balanced', // 'precision' | 'balanced' | 'recall' | 'clean-only'
  minify: false,
  url: 'https://example.com/article', // optional context; never fetched
});
```

`clean()` returns cleaned **HTML** plus an optional `metadata` sidecar (title,
author, date, sitename, tags, …), the detected `pageType` + `confidence` (when
extraction runs), and diagnostic `messages`. It is `async` (the formatter loads
lazily).

The two knobs are orthogonal — any boilerplate mode combines with the default or
a custom cleaning config. They (plus `minify`) are the entire surface: there are
deliberately no `includeComments`/`includeTables`/`includeImages`/`includeLinks`
toggles. The sanitize stage always runs, driven by the exported
`DEFAULT_CLEAN_CONFIG` — a single Trafilatura-aligned config derived from
Trafilatura 2.1.0: its tag allow-list is Trafilatura's HTML output vocabulary
union rs-trafilatura's serializer whitelist; Trafilatura's `MANUALLY_CLEANED`
list maps to `nonTextTags` (subtree discarded with content: `nav`, `aside`,
`form`, `iframe`, `script`, …); its `MANUALLY_STRIPPED` list is simply not
allowed, so those tags are unwrapped with content kept (`div`, `span`,
`section`, …). `boilerplate: 'clean-only'` skips extraction and classification
entirely and cleans the whole document.

### Custom cleaning config

Instead of the default, you can pass a fully-custom `config` — a `CleanConfig`
of plain JSON data (no JavaScript). When set it drives the sanitize stage and
**replaces the default Trafilatura-aligned config**:

```ts
import { clean, type CleanConfig } from 'trafilaturacore';

const config: CleanConfig = {
  allowedTags: ['p', 'a', 'strong', 'em'],
  allowedAttributes: { a: ['href'] },
};
const { html } = await clean(pageHtml, { boilerplate: 'balanced', config });
```

`CleanConfig` fields: `allowedTags`, `allowedAttributes`, `allowedClasses`,
`selfClosing`, `nonTextTags`, `transformTags` — all JSON-serializable. The config
is validated at the boundary (`clean()` throws a `TypeError` on an unknown or
wrong-typed field; the guards `isCleanConfig` / `cleanConfigError` are
exported). The security floor always holds: `<script>` and `on*` handlers are
stripped even if the config lists them, and a config that allows inline `style`
still runs the CSS-URL allow-list.

The security floor is enforced on **every** path — the default config and any
custom config alike: `<script>` (tag + text), every `on*` event handler,
`javascript:`/`vbscript:`/untrusted `data:` URLs, and dangerous inline CSS
(`url(javascript:)`, `expression()`, `@import`) are always stripped
(`enforceSecurityFloor` + `cleanStyledHtml` run as the final pass), and any
custom config that permits inline `style` adds the CSS-URL allow-list on top —
so no config can leak active content.

### Boundary validation and input cap

`clean()` validates its inputs at the boundary and never processes untrusted input
unchecked:

- It throws a `TypeError` when `html` is not a string, when `options.boilerplate`
  is provided but invalid, or when `options.config` is provided but is not a
  valid `CleanConfig`.
- It accepts `maxInputBytes?: number` (default 10 MB UTF-8, the exported
  `DEFAULT_MAX_INPUT_BYTES`) and throws a `RangeError` when the input's UTF-8 byte
  length exceeds it — a resource bound. Pass a larger value to opt into bigger
  documents.

## CLI

trafilaturacore ships a command-line tool with the same `clean()` pipeline. It is
**offline only**: it reads HTML from a file argument or stdin and writes cleaned
HTML to stdout (Unix-pipe friendly). It **never fetches the network** — `--url` is
context only (classifier/metadata heuristics), exactly like the library option.

```sh
npm install -g trafilaturacore        # or: npx trafilaturacore …
```

```sh
# Clean a file with the default knobs (balanced boilerplate mode)
trafilaturacore article.html -b balanced

# Pipe HTML in via stdin and minify the output
cat page.html | trafilaturacore --minify

# Emit the full result (html + metadata + pageType + confidence + messages) as JSON
trafilaturacore page.html --json > out.json

# Write cleaned HTML to a file instead of stdout (stays quiet on stdout)
trafilaturacore page.html -o clean.html

# Use a fully-custom cleaning config (JSON file; replaces the default config)
trafilaturacore page.html -c my-cleaning-config.json
```

It reads a single file argument, or stdin when the argument is omitted or `-`.
Cleaned HTML (or `--json`) goes to **stdout**; diagnostics and a
`[pageType confidence]` line go to **stderr** (silence them with `-q, --quiet`).
Options: `-b, --boilerplate <precision|balanced|recall|clean-only>`,
`-c, --config <file.json>` (a custom `CleanConfig`; replaces the default config),
`-m, --minify`, `-u, --url <url>` (never fetched), `-o, --output <file>`,
`--json`, `-q, --quiet`. Invalid option values, an invalid/malformed config file,
and a missing input file exit non-zero with a clear stderr message.

## Attribution

trafilaturacore is a TypeScript port of Trafilatura. Full attribution is in the bundled
[`NOTICE`](./NOTICE) file.

Required credits (their code or the trained model ships in this package):

- Adrien Barbaresi — Trafilatura (the canonical original) — Apache-2.0
- Markus Mobius — go-trafilatura — Apache-2.0
- Murrough Foley — rs-trafilatura — MIT OR Apache-2.0 (used under Apache-2.0)
- Murrough Foley — WCXB dataset (Web Content Extraction Benchmark) — CC-BY-4.0,
  used unmodified (DOI 10.5281/zenodo.19316874). The shipped `model.xgb.json` +
  `tfidf-vocab.json` are trained fresh from it, not vendored from any upstream
  model binary.

Courtesy credits (consulted as references; no code shipped): Murrough Foley
(web-page-classifier), Nathaniel Chapman (trafilatura-rs), and Arc90/Mozilla
(Readability). The cleaning and DOM layers (TypeScript) use permissive npm
dependencies (MIT / ISC — `sanitize-html`, `parse5`, `linkedom`, and others),
each shipping its own license under `node_modules`; the extraction and
inference layers are the `@trafilaturacore/native` Rust crate, shipped as a
prebuilt `.node` binary rather than an npm dependency tree.

## License

Licensed under the [Apache License, Version 2.0](./LICENSE). See [`NOTICE`](./NOTICE)
for the required third-party attributions.
