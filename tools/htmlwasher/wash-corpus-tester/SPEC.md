# SPEC — @htmlwasher/wash-corpus-tester

Offline end-to-end corpus tester for `htmlwasher` (Phase 8 of the build). It proves the library
works end-to-end over saved real-world HTML fixtures, **entirely offline** — no network, no fetching,
local files only. It is the offline counterpart to `tools/htmlwasher/live-crawl-tester`.

## Scope

- Reads the WCXB-derived fixtures committed under `fixtures/<type>/<id>.html` and the `corpus.json`
  manifest. It never modifies them.
- Runs the public `wash()` API (workspace dependency `htmlwasher`) across a fixed combo matrix.
- Emits a deterministic report (`report.json` + `report.md`) and a non-zero exit on hard failure.
- Does NOT fetch, crawl, or otherwise touch the network. Does NOT train or export models.

## Inputs

### `corpus.json` (committed, not modified here)

```jsonc
{
  "_attribution": "Pages from WCXB ..., CC-BY-4.0.",
  "fixtures": [
    { "file": "<type>/<id>.html", "expectedPageType": "<one of 7>", "domain": "...", "url": "https://<domain>/" }
  ]
}
```

28 fixtures, ≥3 per page type across all 7 page types
(`article | forum | product | collection | listing | documentation | service`). Includes one
hand-authored Czech (`cs`) article fixture (`article/cs-9001.html`, NOT from WCXB) so the offline
harness exercises the classifier on non-English input and surfaces English-bias regressions
(brief §7 / context doc 04).

### `fixtures/<type>/<id>.html` (committed)

Saved real pages from the WCXB dataset. Read-only inputs.

## Combo matrix

Every fixture is washed through these `boilerplate` x `level` combos:

- `balanced` x `standard` — default path; the page-type **reference** combo
- `balanced` x `minimal`
- `none` x `correct` — no extraction; normalize-only washing
- `none` x `minimal` — same full-document input as `none` x `correct`, sanitizing; the baseline
  for the `correct` superset assertion (so both sides share the same boilerplate input)
- `recall` x `permissive`
- `balanced` x `styled` — exercises the `styled` sanitizing level (the only level that keeps inline
  `style`/`class` and the `<style>` tag), where a CSS-URL allow-list regression would surface
- `precision` x `minimal` — exercises the `precision` boilerplate mode end-to-end

## Assertions

### Hard (any failure fails the run)

- **Security (core invariant)** — at **every** washing level, **including `correct`**, the cleaned
  output contains no `<script>` tag, no `on<event>=` handler attribute, and no `javascript:` URL.
  This is a HARD assertion everywhere: the v2 `htmlwasher` washing floor is unconditional (context
  doc 09) — `enforceSecurityFloor` + `sanitizeStyledHtml` run as the final pass on every level
  including `correct` — so a survival is always a real failure, never a normalize-only soft exemption.
- **Non-empty output** — cleaned HTML is non-empty, unless the input lacks substantial body text
  (< `SUBSTANTIAL_BODY_TEXT` = 200 chars of tag-stripped text — a JS-shell / near-empty page), in
  which case empty extraction output is legitimate.
- **`correct` superset of `minimal` (same input)** — the normalize-only `none` x `correct` combo
  preserves at least as many distinct tag names as the sanitizing `none` x `minimal` combo. Both run
  `boilerplate: 'none'` (the whole document, no extraction) and differ only by washing level, so the
  check truly validates that normalize-only `correct` does not drop tags the sanitizing `minimal`
  level keeps — a same-input guarantee, not a cross-mode (full-doc vs extracted-subset) comparison.

### Soft (recorded, non-fatal per fixture)

- **Page-type plausibility** — detected (from the `balanced` x `standard` reference combo) vs.
  expected page type. A single mismatch is a warning. The run fails only if aggregate page-type
  accuracy across all fixtures drops below `PAGE_TYPE_ACCURACY_FLOOR` = `0.4`.

## Public API (`src/corpus-runner.ts`)

- `runCorpus(): Promise<CorpusReport>` — load `corpus.json` (resolved relative to the package dir),
  read every fixture, run the combo matrix, and produce the report. Fully offline + deterministic.
- `COMBOS` — the `{ boilerplate, level }` combos (`as const`).
- `PAGE_TYPE_ACCURACY_FLOOR` (`0.4`) and `SUBSTANTIAL_BODY_TEXT` (`200`) — the run thresholds.
- Types: `CorpusReport`, `FixtureResult`, `ComboResult`, `AssertionFailure`.

### `CorpusReport` shape (abridged)

- `attribution`, `generatedFromFixtureCount`, `comboCount`
- `fixtures: FixtureResult[]` — per-fixture rollup (expected/detected type, confidence, per-combo
  results, `hardPassCount`)
- `pageTypeAccuracy`, `pageTypeAccuracyFloor`, `pageTypeMismatches`
- `hardFailures`, `softFailures`, `securityFailureCount`
- `ok` — overall verdict: zero hard failures AND accuracy ≥ floor

## Outputs

- `report.json` — the full `CorpusReport` (git-ignored).
- `report.md` — a human-readable summary + per-fixture table (git-ignored).
- Both are written into the package directory by `writeReports()` (`src/report.ts`).

## Entry points

- `src/cli.ts` — `pnpm run corpus` (tsx). Runs `runCorpus`, prints the table to stdout, writes the
  reports, and `process.exit(1)` if `!report.ok`.
- `src/corpus.test.ts` — `pnpm run test:corpus` (vitest). Runs `runCorpus`, logs the table, writes
  the reports, and asserts zero security failures, zero hard failures, and page-type accuracy ≥
  floor. vitest provides the non-zero exit on failure.

## Commands

- `test` — `vitest run --passWithNoTests` (part of the offline turbo `pnpm test`).
- `test:corpus` — `vitest run` (the full corpus run).
- `corpus` — `tsx src/cli.ts` (CLI run + report generation).
- `lint` — `biome check .`
- `typecheck` — `tsc --noEmit`

## Attribution

Fixtures are pages from the WCXB dataset (`murrough-foley/web-content-extraction-benchmark`),
CC-BY-4.0. Attribution is carried in `corpus.json`'s `_attribution` field and surfaced in both
generated reports.
