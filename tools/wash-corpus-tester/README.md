# @htmlwasher/wash-corpus-tester

Offline, deterministic end-to-end corpus tester for [`htmlwasher`](../../htmlwasher). It proves the
library works end-to-end over a small set of saved real-world HTML fixtures — **entirely offline**
(no network, no fetching, local files only).

For the live, network-hitting equivalent see [`tools/live-crawl-tester`](../live-crawl-tester).

## What it does

For each fixture in [`corpus.json`](./corpus.json) it reads the saved HTML from
[`fixtures/<type>/<id>.html`](./fixtures) and runs `wash()` across a matrix of
`boilerplate` x `level` combos, recording the detected page type, confidence, cleaned-HTML length,
title, and PASS/FAIL for a set of assertions. It then writes `report.json` + `report.md` and exits
non-zero if any **hard** assertion failed.

## The combo matrix

Every fixture is washed through these four combos:

- `balanced` x `standard` (the default path; also the page-type reference)
- `balanced` x `minimal`
- `none` x `correct` (no extraction; normalize-only)
- `recall` x `permissive`

## What it asserts

Hard assertions (any failure fails the run):

- **Security (core invariant)** — no `<script>`, no `on<event>=` handler attribute, and no
  `javascript:` URL survives at any **sanitizing** washing level (`minimal`, `standard`,
  `permissive`, `styled`). The `correct` level is normalize-only and skips sanitization _by design_,
  so survivals there are recorded as documented **soft** warnings, not failures.
- **Non-empty output** — cleaned HTML is non-empty, unless the input is a JS-shell / near-empty page
  with no substantial body text (then empty extraction output is legitimate).
- **`correct` is a superset of `minimal`** — `correct` (normalize-only) keeps at least as many
  distinct tag names as `minimal` on the same fixture.

Soft assertions (recorded, never fail a single fixture):

- **Page-type plausibility** — detected vs. expected page type. The classifier is ~78% accurate, so
  a single mismatch is a warning. The run only fails if aggregate page-type accuracy across all
  fixtures drops below the floor (`0.4`).

## Running

```bash
pnpm install                                          # from the repo root (links htmlwasher)
pnpm -C tools/wash-corpus-tester run test:corpus      # vitest (non-zero exit on hard failure)
pnpm -C tools/wash-corpus-tester run corpus           # CLI: prints the table + writes the reports
pnpm -C tools/wash-corpus-tester run typecheck        # tsc --noEmit
pnpm -C tools/wash-corpus-tester run lint             # biome check
```

`pnpm test` (the offline turbo suite) runs this package's `test` script, which is
`vitest run --passWithNoTests`. The full corpus run is `test:corpus`.

## Determinism

Same fixtures in → same `report.json` / `report.md` out. The runner never touches the network; it
reads only the local fixture files and the bundled `htmlwasher` model.

## Attribution

The fixtures are pages from the **WCXB** dataset
(`murrough-foley/web-content-extraction-benchmark`), licensed **CC-BY-4.0**. See `corpus.json`'s
`_attribution` field. Fixtures are committed; the generated `report.json` / `report.md` are
git-ignored.
