---
description: Review the Python training project for lint/format/correctness violations and auto-fix issues
allowed-tools: Read, Edit, Grep, Bash
skills: autonomous-task, python, python-testing-patterns, python-packaging
---

Review the `training/` Python project and auto-fix what can be safely resolved. This drives the `python-pro` agent's domain. Save a report to `autonomous-task-output/{agent}/`.

## Scope

`training/` ONLY. It is an offline, uv-managed Python project (Python 3.12+) that trains an XGBoost model from the public WCXB dataset and exports `model.onnx` + `tfidf-vocab.json`. It is NOT a pnpm workspace member and NOT shipped at runtime, so `pnpm`, `turbo`, and `biome` never touch it — its checks run separately. Do NOT duplicate the pnpm build-and-test work that `/autonomous:maintenance:test:local` owns.

Sync the uv environment before the test step:

```bash
uv sync --project training
```

## Step RUFF: Auto-fix Lint and Format Issues

```bash
ruff check --fix training
ruff format training
```

Apply all auto-fixable ruff lint and format issues (config in `training/pyproject.toml`: line-length 100, target py312, select E,F,I,UP,B,SIM,S). Ruff's F401/F841 cover unused imports/vars — the Python analogue of dead-code detection. Fix remaining lint findings ruff cannot auto-apply.

## Step REVIEW: Review Training Modules

Check each training module for correctness:
- Feature extraction — features computed for the classifier match what the TypeScript classifier feature hot-path expects (column order and names align with `tfidf-vocab.json`).
- Model training — the XGBoost training step is deterministic where it should be (fixed seeds) and reads the WCXB dataset paths correctly.
- ONNX export — `skl2onnx`/`onnxmltools` export produces a `model.onnx` whose input/output signature matches what `onnxruntime-node`/`onnxruntime-web` load on the TypeScript side.
- Vocab export — `tfidf-vocab.json` is written in the format the TS classifier reads.

## Step FIX: Fix Issues

Fix issues that can be resolved autonomously:
- Remove `F401` unused imports and `F841` unused variables
- Correct obvious feature/column-order mismatches against the exported vocab
- Bump deps in `training/pyproject.toml` within their declared ranges

Do NOT fix:
- Issues that require understanding the modelling/training methodology
- Changes that would alter the model's input/output signature without verifying the TS loader side
- Public function signatures without a clear mechanical equivalent

## Step TEST: Run Tests

```bash
uv run --project training pytest
```

If tests fail, read the error, fix obvious issues (wrong assertions, import errors), and retry — do NOT skip failing tests.

## Step REPORT: Save Report

Save `autonomous-task-output/{agent}/reports/test-python-autofix-report.md` with:
- Modules reviewed
- Issues found per file (type, line, description)
- Fixes applied (ruff, correctness, dep bumps)
- pytest counts (passed / failed)
- Issues deferred to `autonomous-task-output/{agent}/prompts/test-python-autofix-prompt.md`
