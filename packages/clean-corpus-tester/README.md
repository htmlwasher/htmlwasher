# @trafilaturacore/clean-corpus-tester

Offline, deterministic end-to-end corpus tester for [`trafilaturacore`](../trafilaturacore). It proves the
library works end-to-end over a small set of saved real-world HTML fixtures — **entirely offline**
(no network, no fetching, local files only).

For the live, network-hitting equivalent see [`packages/live-crawl-tester`](../live-crawl-tester).

## What it does

For each fixture in [`corpus.json`](./corpus.json) it reads the saved HTML from
[`fixtures/<type>/<id>.html`](./fixtures) and runs `clean()` across a matrix of label-keyed
combos, recording the detected page type, confidence, cleaned-HTML length,
title, and PASS/FAIL for a set of assertions. It then writes `report.json` + `report.md` and exits
non-zero if any **hard** assertion failed.

## The combo matrix

Every fixture is cleaned through these five combos — each boilerplate mode with the default
Trafilatura-aligned config, plus one custom-config combo:

- `balanced` (the default path; also the page-type reference)
- `precision`
- `recall`
- `clean-keep-boilerplate` (no extraction, no classification; whole-document cleaning)
- `balanced+styled-config` (`balanced` with a custom config that adds the `<style>` tag and
  `class`/`style` attributes, keeping the CSS-URL allow-list exercised)

## What it asserts

Hard assertions (any failure fails the run):

- **Security (core invariant)** — no `<script>`, no `on<event>=` handler attribute, and no
  `javascript:` URL survives for **every** combo (default and custom config). The security floor
  is unconditional — there is no exempt path.
- **Non-empty output** — cleaned HTML is non-empty, unless the input is a JS-shell / near-empty page
  with no substantial body text (then empty extraction output is legitimate).
- **Styled-config superset** — `balanced+styled-config` keeps at least as many distinct tag names
  as `balanced` on the same extraction input (its allow-list is a strict superset of the default
  config).

Soft assertions (recorded, never fail a single fixture):

- **Page-type plausibility** — detected vs. expected page type. The classifier is ~78% accurate, so
  a single mismatch is a warning. The run only fails if aggregate page-type accuracy across all
  fixtures drops below the floor (`0.4`).

## Running

```bash
pnpm install                                          # from the repo root (links trafilaturacore)
pnpm -C packages/clean-corpus-tester run test:corpus      # vitest (non-zero exit on hard failure)
pnpm -C packages/clean-corpus-tester run corpus           # CLI: prints the table + writes the reports
pnpm -C packages/clean-corpus-tester run typecheck        # tsc --noEmit
pnpm -C packages/clean-corpus-tester run lint             # biome check
```

`pnpm test` (the offline turbo suite) runs this package's `test` script, which is
`vitest run --passWithNoTests`. The full corpus run is `test:corpus`.

## Determinism

Same fixtures in → same `report.json` / `report.md` out. The runner never touches the network; it
reads only the local fixture files and the bundled `trafilaturacore` model.

## Attribution

The fixtures are pages from the **WCXB** dataset
(`murrough-foley/web-content-extraction-benchmark`), licensed **CC-BY-4.0**. See `corpus.json`'s
`_attribution` field. Fixtures are committed; the generated `report.json` / `report.md` are
git-ignored.
