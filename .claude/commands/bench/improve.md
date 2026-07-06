---
description: Root-cause the benchmark's per-type token-F1 gaps, apply DEFAULTS-ONLY fixes to htmlwasher (Rust core / classifier / washing), re-run the offline gates after each fix, then re-benchmark and write a before/after timestamped report to @/benchmarks/.
argument-hint: "[--target rs|trafilatura] [--max-iters N]"
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task
---

# Benchmark — improve the scores, then benchmark

Close benchmark gaps by fixing ROOT CAUSES in htmlwasher — **never by tuning the benchmark, never by
special-casing a URL**. A fix that only moves the benchmark is a regression in disguise. Execute the
steps in order; never ask "shall I proceed?".

## Arguments

`$ARGUMENTS` — optional. `--target rs` (default) closes the gap to rs-trafilatura; `--target trafilatura`
closes the gap to the Trafilatura reference. `--max-iters N` caps the improve loop (default 3).

## The non-negotiable rules (from the build brief's Phase RETEST)

- **Defaults only.** No per-page or per-corpus precision/recall tuning; never special-case a URL. Prefer
  robustness fixes that help ALL similar pages over anything page-specific.
- **Fidelity is reference-relative** (agreement with Trafilatura, not human gold); speed is internal
  extraction time; htmlwasher does more (HTML out + classification + formatting), so its time/size are not
  like-for-like — do not chase those.
- **After EVERY fix, re-run the OFFLINE gates** (`pnpm test`, `cargo test --workspace`, the adbar eval, the
  wash-corpus-tester) so a live-page win never regresses the offline oracle. A live win that breaks the
  oracle is not a win.

## Step BASELINE

- Run the token benchmark exactly as `/bench:run` (its WIRE → BUILD → RUN → ANALYZE steps). Record the
  baseline: overall F1/P/R per engine, the per-type F1 (htmlwasher vs Trafilatura AND vs rs-trafilatura),
  and the worst pages.

## Step ROOT-CAUSE

Rank the gaps by impact (per-type F1 gap × page count) and root-cause EACH honestly into exactly one layer.
For each worst page, run `wash()` on its cached HTML (`~/r/htmlwasher-external-tester/cache/<id>.html`, with
its `url` from `results.json`) and inspect `pageType` / `confidence` / `textLength` / the output — this
tells you which layer is at fault:

- **Rust core** — `@/packages/htmlwasher/native/src/{extract,extractor/fallback,selector/*,html_processing,link_density}.rs`:
  over- or under-extraction, a missing structured rescue, a serializer issue.
- **Classifier** — `@/packages/htmlwasher/native/src/page_type/*`: a wrong page type routes the wrong profile
  (the most common catastrophic under-extraction cause).
- **Washing** — `@/packages/htmlwasher/src/washing/*`: over- or under-stripping in the sanitize/normalize pass.

Heuristics: a page where htmlwasher "dropped real content" is usually over-aggressive boilerplate removal,
a misrouted profile, or an under-extraction a profile-independent rescue would fix; "kept boilerplate" is the
opposite; a token-F1 cliff isolated to one page type points at that type's profile or its classifier accuracy.

## Step FIX

- Apply a defaults-only fix per root-caused gap via the domain agent (`Task`): `rust-pro` for the crate,
  `ts-pro` for washing/pipeline, `python-pro` for the classifier model/features. Give each agent the exact
  root cause, the before/after page(s) to check, and the non-negotiable rules above.
- If a fix touches the crate, rebuild + refresh the host prebuild (see `/bench:run` Step BUILD).

## Step GATE

- After EACH fix: `pnpm build && pnpm lint && pnpm test` (flagship + wash-corpus-tester) and
  `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --check`,
  plus the adbar eval floors (`packages/htmlwasher/test/validation/`). If any offline gate regresses,
  revert or refine the fix before continuing.

## Step REBENCH

- Rebuild the htmlwasher output + prebuild, then re-run `pnpm bench`. Compare per-type F1 before/after.
- Iterate ROOT-CAUSE → FIX → GATE → REBENCH until there are no further defaults-only gains, `--max-iters`
  is reached, or the remaining gaps are content-SELECTION / architecture issues to document rather than tune.

## Step REPORT

- Write a timestamped report to `@/benchmarks/<TS>-benchmark.md` (`TS = $(date '+%Y-%m-%d-%H%M')`) exactly
  as `/bench:run` Step REPORT, but with BEFORE/AFTER columns in the overall AND per-type tables, plus a
  **Changes** section naming each fix: its root cause, the layer it touched (Rust core / classifier /
  washing), the concrete page(s) it fixed, and its F1 effect. Keep the mandatory Explanations section.
- Record the run + the fixes it drove in `@/PORTING-NOTES.md`.

## Step COMMIT

- Commit the htmlwasher improvements (crate / TS / training, plus the rebuilt committed prebuild) with a
  message stating the token-F1 before→after and explicitly that no benchmark-tuning / URL special-casing was
  done, and commit the refreshed `reports/` in the tester repo. Do NOT push unless the user asks.

## Step LEARN

- Fold any durable procedure fix back into this command (minimal diff) per
  `@/.claude/rules/self-improving-prompts.md`. State explicitly when nothing durable was learned.
