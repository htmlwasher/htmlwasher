---
description: Run the four-engine extraction benchmark (trafilaturacore vs Trafilatura vs rs-trafilatura vs mozilla/readability) over the cached live corpus, then write a detailed, explained, timestamped Markdown report to @/benchmarks/.
argument-hint: "[--refetch] [--pages N]"
allowed-tools: Bash, Read, Write, Glob
---

# Benchmark — run the four-engine token report

Run the external live benchmark and produce a DETAILED, EXPLAINED table plus a timestamped
`.md` report. The benchmark is external by design (it hits the network to fetch a cached
corpus of real pages); trafilaturacore itself never touches the network. Execute the steps in
order; never ask "shall I proceed?".

## Arguments

`$ARGUMENTS` — optional. `--refetch` re-fetches uncached URLs (polite, ~1 req/sec) instead of
using only the on-disk cache; `--pages N` is an informational cap for a quick run (note it in
the report). No arguments = run the full cached corpus.

## Prerequisites

- The external tester at `~/r/trafilatura-external-tester/` (a sibling repo OUTSIDE this one; it
  consumes trafilaturacore as a `file:` dependency). If it is absent, STOP and tell the user to clone
  it — do not fabricate results.
- Toolchains: `node -v` (22+), `uv --version` (Trafilatura runs via `uv run`), `cargo --version`
  (the rs-trafilatura runner). This command produces the TOKEN report only; the visual-judge layer
  (`pnpm visual:prep` + the `visual-extraction-judge` workflow) is separate and needs Playwright.

## Step WIRE

- Confirm the tester's `package.json` depends on `trafilaturacore` at `file:../trafilatura/packages/trafilaturacore`
  AND carries the `pnpm.overrides` entry `@trafilaturacore/native` → `file:../trafilatura/packages/trafilaturacore/native`.
  Without the override, the flagship's `@trafilaturacore/native: workspace:*` dependency will NOT resolve via
  `file:` outside the monorepo (`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`). Add/fix them and run `pnpm install`
  in the tester if either is missing or changed.

## Step BUILD

- Rebuild the trafilaturacore output the tester imports: from `@/`, `pnpm --filter trafilaturacore build`.
- If a Rust toolchain is present AND the native crate changed since the committed prebuild, rebuild +
  refresh the host prebuild: `cd @/packages/trafilaturacore/native && CARGO_HOME=$HOME/.cargo napi build --platform --release --features napi`,
  then copy the fresh `trafilaturacore-native.<host-target>.node` into `npm/<host-target>/` (the committed prebuild).
- In the tester, build the rs-trafilatura runner once: `pnpm build:rust` (compiles rs-trafilatura on first run).
- After ANY trafilaturacore rebuild (TS output or prebuild), run `pnpm install` in the tester before `pnpm bench`:
  pnpm COPIES `file:` dependencies into its store at install time (it does not symlink them), so without a
  re-install the benchmark runs the stale copy.

## Step RUN

- From `~/r/trafilatura-external-tester/`, run `pnpm bench` (add nothing for cached; the tester's fetcher
  caches under `cache/` and only network-fetches URLs not yet cached, ~1 req/sec). It runs all four engines,
  scores token precision/recall/F1 vs the **Trafilatura reference**, and writes
  `reports/{report.md,report.html,results.json,extractions.json}`. Capture the real exit code (a piped
  `| tail` masks it); a non-zero exit or any engine at <100% success is a finding, not a pass.

## Step ANALYZE

Parse `~/r/trafilatura-external-tester/reports/results.json` (do NOT hand-wave the numbers) and build:

- **Overall table**, one row per engine (`trafilaturacore`, `trafilatura`, `rs-trafilatura`, `readability`):
  Success (n/N), Median ms, Mean ms, p90 ms, Mean words, F1, Precision, Recall — all vs the Trafilatura
  reference (Trafilatura's own F1/P/R are the reference, shown as `— (ref)`).
- **Per-page-type F1 table**, one row per type (`article, forum, product, collection, listing,
  documentation, service`): n, trafilaturacore F1, rs-trafilatura F1, the gap (rs − trafilaturacore), and trafilaturacore
  vs rs-trafilatura mean words. This is where regressions and improvement targets live.
- **Worst pages**: the 5–8 pages where trafilaturacore's F1 trails rs-trafilatura most (URL + both F1s + both
  word counts) — the candidate list `/bench:improve` roots-causes.

## Step REPORT

Write a timestamped report to `@/benchmarks/<TS>-benchmark.md` where `TS = $(date '+%Y-%m-%d-%H%M')`
(create `@/benchmarks/` if absent). The report MUST contain, in order:

- A title line with the full date + time, the corpus size (pages used / total), and each engine's
  name + version + language.
- The **Overall table**, the **Per-page-type F1 table**, and the **Worst pages** list from Step ANALYZE.
- An **Explanations** section (MANDATORY — the tables are not self-explanatory; keep the run honest):
  - **Fidelity is reference-relative.** Token P/R/F1 are measured against Trafilatura, not human-labelled
    gold (none exists for arbitrary live pages). It quantifies agreement with the canonical extractor — not
    correctness. rs-trafilatura is a comparison peer, not a target to overfit.
  - **The engines do different jobs.** trafilaturacore returns sanitized, formatted **HTML** plus a page-type
    classification (strictly MORE work); Trafilatura, rs-trafilatura, and readability return plain **text**.
    Outputs are normalized to text for scoring, so **speed and output size are NOT strictly like-for-like**.
  - **Speed is internal extraction time** after one untimed warm-up (isolates algorithm speed from process
    startup / model load).
  - **Precision vs Recall.** High precision = clean output (little boilerplate kept); high recall = complete
    output (little real content missed); F1 balances the two. A precise-but-low-recall engine drops content;
    the reverse keeps boilerplate.
  - **Defaults only** — no per-page or per-corpus tuning; no URL is special-cased.
- Also echo the Overall + Per-type tables to stdout so the user sees them without opening the file.
- Do NOT commit or push (that is the user's call); tell the user the report path.

## Step LEARN

- If a WIRE/BUILD/RUN step needed a fix this command did not anticipate (a new consumability quirk, a
  changed `results.json` schema, a new prerequisite), fold the fix into this command body in the same run
  (minimal diff) so the next run is smoother — per `@/.claude/rules/self-improving-prompts.md`. State
  explicitly when nothing durable was learned.
