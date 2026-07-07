# trafilaturacore

A TypeScript **HTML-cleanup** library: **HTML in → cleaned HTML out**. It never
converts to Markdown, XML, or plain text, and never touches the network. It
combines two composable pillars:

- **Boilerplate removal** — a [Trafilatura](https://github.com/adbar/trafilatura)-derived,
  page-type-aware main-content extractor. A pure-Rust GBDT page-type classifier
  (7 types) routes extraction through a per-type profile; the kept content is
  re-serialized through a tag/attribute whitelist (never verbatim `outerHTML`).
- **HTML cleaning** — a [`sanitize-html`](https://www.npmjs.com/package/sanitize-html)-based
  sanitize → normalize → format stage, exposed as five cleaning levels.

It is a content-cleanup **library for Node.js**: not a scraper, not a browser
automation framework.

## Status

Alpha — implemented. The extraction core, metadata extractor, page-type
classifier (a pure-Rust GBDT shipped as `model.xgb.json`), per-type profiles,
and the five cleaning levels are all in place, exposed via a single `clean()`
API. The classifier scores ~0.78 accuracy on the held-out WCXB test split;
extraction scores F1 ≈ 0.79 on the adbar evaluation corpus. APIs may still
change before a stable release.

## Usage

```ts
import { clean } from 'trafilaturacore';

const { html, metadata, pageType, confidence, messages } = await clean(pageHtml, {
  boilerplate: 'balanced', // 'precision' | 'balanced' | 'recall' | 'none'
  level: 'standard', //       'minimal' | 'standard' | 'permissive' | 'styled' | 'correct'
  minify: false,
  url: 'https://example.com/article', // optional context; never fetched
});
```

`clean()` returns cleaned **HTML** plus an optional `metadata` sidecar (title,
author, date, sitename, tags, …), the detected `pageType` + `confidence` (when
extraction runs), and diagnostic `messages`. It is `async` (the formatter loads
lazily).

The two knobs are orthogonal — any boilerplate mode combines with any cleaning
level. They (plus `minify`) are the entire surface: there are deliberately no
`includeComments`/`includeTables`/`includeImages`/`includeLinks` toggles. The
cleaning `level` is the single tag-inclusion control; `boilerplate: 'none'` skips
extraction and cleans the whole document.

### Custom cleaning config

Beyond the five named levels, you can pass a fully-custom `config` — a
`CleanConfig` of plain JSON data (no JavaScript). When set it drives the
sanitize stage and **takes precedence over `level`**:

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

The security floor is enforced at **every** cleaning level — including `correct`:
`<script>` (tag + text), every `on*` event handler, `javascript:`/`vbscript:`/
untrusted `data:` URLs, and dangerous inline CSS (`url(javascript:)`,
`expression()`, `@import`) are always stripped; the `styled` level (and any custom
config that permits inline `style`) adds the CSS-URL allow-list on top. `correct`
is the one **normalize-only** level for the tag _allow-list_ — it runs no preset,
so it preserves all benign tags, attributes, and deprecated tags unchanged — but
it still runs the mandatory security floor (`enforceSecurityFloor` +
`cleanStyledHtml`), so it never leaks active content even though it never
narrows benign markup.

### Boundary validation and input cap

`clean()` validates its inputs at the boundary and never processes untrusted input
unchecked:

- It throws a `TypeError` when `html` is not a string, when `options.boilerplate`
  or `options.level` is provided but invalid, or when `options.config` is provided
  but is not a valid `CleanConfig`.
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
# Clean a file with the default knobs (balanced + standard)
trafilaturacore article.html -b balanced -l standard

# Pipe HTML in via stdin and minify the output
cat page.html | trafilaturacore --minify

# Emit the full result (html + metadata + pageType + confidence + messages) as JSON
trafilaturacore page.html --json > out.json

# Write cleaned HTML to a file instead of stdout (stays quiet on stdout)
trafilaturacore page.html -o clean.html

# Use a fully-custom cleaning config (JSON file; takes precedence over --level)
trafilaturacore page.html -c my-cleaning-config.json
```

It reads a single file argument, or stdin when the argument is omitted or `-`.
Cleaned HTML (or `--json`) goes to **stdout**; diagnostics and a
`[pageType confidence]` line go to **stderr** (silence them with `-q, --quiet`).
Options: `-b, --boilerplate <precision|balanced|recall|none>`,
`-l, --level <minimal|standard|permissive|styled|correct>`,
`-c, --config <file.json>` (a custom `CleanConfig`; precedence over `--level`),
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
