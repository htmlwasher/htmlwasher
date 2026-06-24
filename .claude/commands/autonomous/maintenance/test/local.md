---
description: Build all projects and run local unit tests, auto-fixing lint and format issues
allowed-tools: Bash(pnpm:*), Bash(biome:*), Bash(ruff:*), Bash(uv:*), Bash(pytest:*)
skills: autonomous-task, python-testing-patterns, typescript
---

Build all projects in the repository, run local unit tests, and auto-fix lint and format issues. Save a report to `autonomous-task-output/{agent}/`.

IMPORTANT: Only run unit tests. Do NOT run integration tests that hit external sites (the live-crawl-tester's real-URL E2E runs are out of scope here).

## Repository Root

All commands use **relative paths from the repo root** (`@/`). Run them from there.

## Step FORMAT: Auto-fix Format Issues

```bash
pnpm format
ruff format training
```

Automatically fix any formatting issues before running tests. `training/` is an offline uv-managed Python project and is NOT a pnpm workspace member, so `pnpm format` does not touch it — `ruff format training` is a separate step.

## Step BUILD: Build All Packages

```bash
pnpm build
```

This builds the TypeScript workspace members (`trafilatura-alpha`, `tools/live-crawl-tester`). If the build fails, read the error output, identify the root cause, fix the code, and retry.

## Step TEST_TS: Run TypeScript Tests

```bash
pnpm test
```

This runs vitest in `trafilatura-alpha` and `tools/live-crawl-tester` (and any package whose `test` script is wired up). Packages without tests use `vitest run --passWithNoTests`.

If tests fail:
- Read the error output for each failing test
- Fix obvious issues (wrong assertions, missing fixtures, import errors)
- Retry — do NOT skip failing tests

## Step TEST_PYTHON: Run Training Tests

```bash
uv sync --project training
uv run --project training pytest
```

The training project at `training/` is an offline uv-managed Python project outside the pnpm workspace, so its tests run separately under its own uv environment.

If tests fail:
- Read the error output for each failing test
- Fix obvious issues (wrong assertions, missing fixtures, import errors)
- Retry — do NOT skip failing tests

## Step LINT: Lint and Fix

```bash
biome check --write .
ruff check training
```

For `training/`, auto-fix ruff findings with `ruff check --fix training`, then fix the rest by editing the code.

## Step REPORT: Save Report

Save `autonomous-task-output/{agent}/reports/test-local-report.md` with:
- Build result (TS: pass/fail)
- TS test counts (passed / failed) per package
- Python test counts (pytest passed / failed)
- Lint results (Biome, ruff check)
- First failing trace, with `path:line` link
- Code changes made (if any)
- Any issues that could not be auto-fixed (save to `autonomous-task-output/{agent}/prompts/test-local-prompt.md`)
