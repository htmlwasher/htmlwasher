---
description: Sync READMEs with the current htmlwasher library, live-crawl-tester, and training project state
allowed-tools: Bash(*), Read(*), Edit(*), Write(*), Glob(*), Grep(*)
---

# Sync htmlwasher Repo Documentation

Ensure every README under this repo reflects the current state of its source: the `htmlwasher` library API, the live-crawl-tester surface, and the training project. Public exports, option/flag lists, and behaviour descriptions must be in sync across all surfaces. Every README should describe htmlwasher as a faithful **TypeScript port of Trafilatura** with page-type-aware extraction and an ONNX page-type classifier — a content-extraction **library for Node.js**, not a scraper.

**Scope:** This command only updates files inside the `htmlwasher` repo. The `htmlwasher/README.md` is the published npm package page (alpha); keep it written for that audience. The root, training, and live-crawl-tester READMEs are repo-internal developer docs.

## Source of Truth

The source files are canonical for what each README must document. When they disagree, surface the mismatch in **Step VERIFY** rather than silently picking a winner.

- **Library public API** — `htmlwasher/src/index.ts` (exported functions, classes, types, options interfaces). This drives every extraction and classification surface documented in the package README.
- **Live-crawl-tester** — `tools/htmlwasher/live-crawl-tester/src/index.ts` (or its main entry) plus its CLI/option surface. It is a separate workspace package: a polite live-site fetcher (robots.txt, rate limit, disk cache) that runs extraction + classification over real URLs. It is NOT Crawlee/Playwright.
- **Training project** — `training/*.py` and `training/pyproject.toml`. The offline Python project (uv-managed, Python 3.12+) trains an XGBoost model from the public WCXB dataset and exports `model.onnx` + `tfidf-vocab.json`. It is NOT a pnpm workspace package, NOT shipped at runtime.
- **Output/format set and behaviour** — whatever the library's `src/index.ts` declares (e.g. output formats, page-type labels). Keep README format/label lists equal to source everywhere they appear.

## Step EXTRACT: Extract Current State

Read every source-of-truth file above and build one inventory covering all surfaces:

- Every exported library symbol (name, kind, signature, JSDoc) — note that it lives in **`htmlwasher/src/index.ts`**.
- Every live-crawl-tester option/flag (name, type, default, help text) — note that it lives in **`tools/htmlwasher/live-crawl-tester/src/`**.
- Every training entry point and its inputs/outputs (dataset, `model.onnx`, `tfidf-vocab.json`) — note that it lives in **`training/`**.
- Every output format / page-type label the library accepts — record the canonical set so README lists can be checked against it.

Each row in the inventory must record where the entry lives so mismatches between the library, the tester, and the training project are visible.

## Step SYNC: Update READMEs

Enumerate READMEs at runtime so newly added ones are covered automatically:

```bash
find . -type f -name 'README.md' \
  -not -path './node_modules/*' \
  -not -path './dist/*' \
  -not -path './.git/*' \
  -not -path './sources/*' \
  -not -path './prompts/*'
```

At minimum the following READMEs are expected to exist:

- `README.md` (repo root)
- `htmlwasher/README.md` (npm package page — alpha)
- `tools/htmlwasher/live-crawl-tester/README.md`
- `training/README.md`

For each README found, sync:

- The "what it is" line — htmlwasher is a faithful TypeScript port of Trafilatura (page-type-aware extraction + ONNX page-type classifier), a Node.js content-extraction library.
- Edit prose by hand with the Edit tool. The repo has **no** codegen-driven README regions and **no** hand-tuned HTML info-tables — there is nothing to regenerate and no fragile scaffolding to preserve. Make minimal, surgical prose edits only.
- Per `@/.claude/rules/json-config-only.md`, document only JSON config files.
- The library API table (exports with signature and description) lives in `htmlwasher/README.md`; the live-crawl-tester options live in `tools/htmlwasher/live-crawl-tester/README.md`; the training workflow (dataset → `model.onnx` + `tfidf-vocab.json`) lives in `training/README.md`.
- The output-format / page-type label list — must equal the canonical set declared in `htmlwasher/src/index.ts` everywhere it appears.
- Local prerequisites where applicable (Node 22+, pnpm; uv + Python 3.12+ for the training project).

If a README does not yet have a section for the library API, the tester options, or the "what it is" line, add it at the natural insertion point rather than skipping the file.

## Step VERIFY: Verify Consistency

Cross-check across all surfaces:

- Every exported library symbol appears in `htmlwasher/README.md`.
- Every live-crawl-tester option appears in `tools/htmlwasher/live-crawl-tester/README.md`.
- The training README's inputs/outputs match `training/`'s actual scripts (dataset → `model.onnx` + `tfidf-vocab.json`).
- The output-format / page-type label set in every README equals the canonical set in `htmlwasher/src/index.ts`.
- Every README describes htmlwasher as a TypeScript port of Trafilatura (library, not a scraper).
- No removed export, option, or format is still documented.

Report any inconsistencies found and fix the docs side. Mismatches between source files themselves are out of scope for this command — fix those at the source.

## Step REPORT: Save Report

Save `autonomous-task-output/{agent}/reports/sync-docs-report.md` with:
- READMEs updated
- Inconsistencies found and fixed
- Any issues requiring human review (save to `autonomous-task-output/{agent}/prompts/sync-docs-prompt.md`)
