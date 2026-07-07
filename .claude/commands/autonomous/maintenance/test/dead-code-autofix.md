---
description: Detect and remove dead code, unused exports, and unused dependencies
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
skills: autonomous-task
---

Detect and remove dead code, unused exports, and unused dependencies across the repo. Save a report to `autonomous-task-output/{agent}/`.

## Step SCAN: Run knip

```bash
npx knip --reporter compact 2>&1
```

If knip is not installed: `pnpm add -D knip` at the repo root. knip's config (`knip.json`) must ignore `prompts/`, `sources/` (read-only reference repos), and `training/` (the offline Python project is not a pnpm workspace member) so they never produce false positives.

Categorize findings:
- Unused files (safe to delete)
- Unused exports (verify before removing — may break external consumers)
- Unused dependencies (safe to remove from `package.json`)
- Unused dev dependencies

## Step SCAN PYTHON: Run ruff

`training/` is an offline uv-managed Python project outside the pnpm workspace, so knip never sees it. Its dead-code pass is ruff:

```bash
ruff check training 2>&1
```

ruff's `F401` (unused imports) and `F841` (unused variables) are the Python analogue of knip's dead-code detection. Categorize findings:
- Unused imports (`F401` — safe to delete)
- Unused local variables (`F841` — safe to remove)
- Unused module-level exports or files (verify before removing — may break external consumers)

## Step FIX: Remove Dead Code

Fix issues that can be resolved autonomously:
- Remove unused `devDependencies` from `package.json`
- Remove unused dependencies that have no external consumers
- Delete clearly unused files (confirmed by knip and no external references)
- Remove unused exports where the function is also unused internally

Do NOT remove:
- Public API exports (types, classes, functions exported from `packages/htmlwasher/src/index.ts`)
- Dependencies that are used at runtime but may not be detected by knip (e.g., peer deps, the ONNX runtimes loaded behind one interface)
- Exports with `// @public` or similar annotations

For `training/`, clean ruff findings the same conservative way:
- Remove `F401` unused imports and `F841` unused variables
- Remove unused module-level exports only when also unused internally
- Keep entry points that are invoked as scripts (e.g. via `python -m` or `[project.scripts]`), even if unused inside the package

## Step VERIFY: Rebuild After Changes

```bash
pnpm build
pnpm test
```

For `training/`, re-run ruff and the test suite separately (it is outside the pnpm workspace):

```bash
ruff check training
uv run --project training pytest
```

Ensure nothing broke after removing dead code.

## Step REPORT: Save Report

Save `autonomous-task-output/{agent}/reports/test-dead-code-autofix-report.md` with:
- Total findings by category
- Items removed
- Items deferred (save to `autonomous-task-output/{agent}/prompts/test-dead-code-autofix-prompt.md`)
