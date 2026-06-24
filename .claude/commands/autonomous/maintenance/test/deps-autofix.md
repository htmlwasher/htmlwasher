---
description: Audit dependencies for security vulnerabilities and auto-fix
allowed-tools: Read, Write, Edit, Bash
skills: autonomous-task
---

Audit all dependencies for security vulnerabilities and apply safe fixes. Save a report to `autonomous-task-output/{agent}/`.

## Step AUDIT: Security Audit

```bash
pnpm audit --audit-level=high 2>&1
```

Summarize: total vulnerabilities by severity (critical, high, moderate, low).

## Step OUTDATED: Check Outdated Versions

```bash
pnpm outdated 2>&1 | head -50
```

## Step FIX: Apply Safe Fixes

```bash
pnpm audit --fix
```

Apply auto-fixable vulnerabilities (`--fix` adds `package.json` overrides forcing non-vulnerable versions).

Do NOT automatically update:
- Major versions (breaking changes)
- Direct dependencies that affect the public API of `htmlwasher`

## Step PYTHON: Audit Training Dependencies

The training project at `training/` is an offline uv-managed Python project outside the pnpm workspace, so `pnpm audit` never touches it. Audit its dependencies separately against its uv environment:

```bash
uvx pip-audit --project training 2>&1
```

If `uvx` cannot resolve `pip-audit`, export the locked requirements and audit those (e.g. `uv export --project training | uvx pip-audit -r -`).

Review `training/pyproject.toml` pins (XGBoost, scikit-learn, skl2onnx/onnxmltools, and the test pins).

Apply safe fixes by bumping pins within their existing ranges. Do NOT automatically:
- Widen or cross a major-version ceiling
- Change a dependency in a way that alters the trained model's ONNX input/output signature

## Step REPORT: Save Report

Save `autonomous-task-output/{agent}/reports/test-deps-autofix-report.md` with:
- TS vulnerabilities found and fixed
- Python (training) advisories found and pins bumped within range
- Outdated major versions requiring manual update (save to `autonomous-task-output/{agent}/prompts/test-deps-autofix-prompt.md`)
