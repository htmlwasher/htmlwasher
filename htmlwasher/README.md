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

### Custom washing config

Beyond the five named levels, you can pass a fully-custom `config` — a
`SanitizeConfig` of plain JSON data (no JavaScript). When set it drives the
sanitize stage and **takes precedence over `level`**:

```ts
import { wash, type SanitizeConfig } from 'htmlwasher';

const config: SanitizeConfig = {
  allowedTags: ['p', 'a', 'strong', 'em'],
  allowedAttributes: { a: ['href'] },
};
const { html } = await wash(pageHtml, { boilerplate: 'balanced', config });
```

`SanitizeConfig` fields: `allowedTags`, `allowedAttributes`, `allowedClasses`,
`selfClosing`, `nonTextTags`, `transformTags` — all JSON-serializable. The config
is validated at the boundary (`wash()` throws a `TypeError` on an unknown or
wrong-typed field; the guards `isSanitizeConfig` / `sanitizeConfigError` are
exported). The security floor always holds: `<script>` and `on*` handlers are
stripped even if the config lists them, and a config that allows inline `style`
still runs the CSS-URL allow-list.

Security is enforced at every washing level: `<script>`, `on*` event handlers,
and `javascript:`/`data:` URLs are always stripped; the `styled` level adds a
CSS-URL allow-list. `correct` is normalize-only (the caller's trust boundary).

## CLI

htmlwasher ships a command-line tool with the same `wash()` pipeline. It is
**offline only**: it reads HTML from a file argument or stdin and writes cleaned
HTML to stdout (Unix-pipe friendly). It **never fetches the network** — `--url` is
context only (classifier/metadata heuristics), exactly like the library option.

```sh
npm install -g htmlwasher        # or: npx htmlwasher …
```

```sh
# Clean a file with the default knobs (balanced + standard)
htmlwasher article.html -b balanced -l standard

# Pipe HTML in via stdin and minify the output
cat page.html | htmlwasher --minify

# Emit the full result (html + metadata + pageType + confidence + messages) as JSON
htmlwasher page.html --json > out.json

# Write cleaned HTML to a file instead of stdout (stays quiet on stdout)
htmlwasher page.html -o clean.html

# Use a fully-custom washing config (JSON file; takes precedence over --level)
htmlwasher page.html -c my-washing-config.json
```

It reads a single file argument, or stdin when the argument is omitted or `-`.
Cleaned HTML (or `--json`) goes to **stdout**; diagnostics and a
`[pageType confidence]` line go to **stderr** (silence them with `-q, --quiet`).
Options: `-b, --boilerplate <precision|balanced|recall|none>`,
`-l, --level <minimal|standard|permissive|styled|correct>`,
`-c, --config <file.json>` (a custom `SanitizeConfig`; precedence over `--level`),
`-m, --minify`, `-u, --url <url>` (never fetched), `-o, --output <file>`,
`--json`, `-q, --quiet`. Invalid option values, an invalid/malformed config file,
and a missing input file exit non-zero with a clear stderr message.

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
