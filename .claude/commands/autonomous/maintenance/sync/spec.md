---
description: Sync SPEC.md files with current source — propagate API changes, schema updates, and behavioral changes to all package and app specs
allowed-tools: Bash(*), Read(*), Edit(*), Write(*), Glob(*), Grep(*)
---

# Sync SPEC.md Files

Scan all packages for drift between source code and their SPEC.md files. Apply surgical edits to bring specs current. Do not rewrite sections that are already accurate.

## Source → SPEC Mapping

- `htmlwasher/src/**` → `htmlwasher/SPEC.md`
- `tools/live-crawl-tester/src/**` → `tools/live-crawl-tester/SPEC.md`
- `training/**/*.py` → `training/SPEC.md`
- Architecture or data-flow changes in any of the above → root `SPEC.md`

## Step DETECT: Find changed source files

Run `git diff --name-only HEAD~1..HEAD` and `git status --short` to identify what changed recently. If the working tree is clean, read key public API surfaces directly and compare to spec prose.

Public API surfaces to prioritize:
- `htmlwasher/src/index.ts` — library public exports
- `tools/live-crawl-tester/src/index.ts` (or its main entry) — live-crawl-tester public surface
- `training/*.py` — training scripts and model/vocab export entry points

## Step MAP: Identify affected specs

From the changed file paths, identify which SPEC.md files need review using the mapping above. A single source file may affect both its package SPEC.md and the root SPEC.md if the data flow changed.

## Step READ: Load source and spec side-by-side

For each affected SPEC.md, read:
- The entry point (`src/index.ts` for TS, or the training `*.py` scripts) for exported names and signatures
- The existing SPEC.md to see what is currently documented

Identify drift:
- New exports, renamed functions, changed signatures
- New or removed interface fields
- New/removed behavior or options
- Stale descriptions referencing removed functionality

## Step PATCH: Apply targeted edits

Use the Edit tool for every change. Never use Write on an existing SPEC.md. Update only the drifted sections. Preserve heading structure, prose style, and all accurate content.

After patching each spec, do a quick coherence check — the spec must read correctly end-to-end.

## Step REPORT: Save report

Save `autonomous-task-output/{agent}/reports/sync-spec-report.md` with:
- Which SPEC.md files were updated and a one-line summary of what changed in each
- Which SPEC.md files were already in sync
- Any inconsistencies requiring human review (also save to `autonomous-task-output/{agent}/prompts/sync-spec-prompt.md`)
