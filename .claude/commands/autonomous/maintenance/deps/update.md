---
description: Update all packages to latest — pnpm workspaces and the Python training project
allowed-tools: Bash(pnpm:*), Bash(uv:*), Bash(pytest:*)
---

Update all dependencies to their latest compatible versions.

## Step NPM: Update pnpm packages

```bash
pnpm update --latest --recursive
```

This covers the TypeScript workspace members (`trafilaturacore`, `packages/live-crawl-tester`).

## Step PYTHON: Bump training deps within ranges

`training/` is an offline, uv-managed Python project (Python 3.12+), not a pnpm workspace member, so `pnpm update` never touches it. Edit `training/pyproject.toml` to bump the deps (XGBoost, scikit-learn, skl2onnx/onnxmltools, plus the test pins) within their declared ranges, then sync the uv environment.

The training venv is **uv-managed and has no `pip`** (Homebrew pip is PEP-668 blocked), so install/sync with `uv`, not bare `pip`:

```bash
uv sync --project training
```

To resolve "latest within range" for a `>=x,<y` pin without guessing, query the PyPI JSON API (e.g. `curl -s https://pypi.org/pypi/<pkg>/json`). If every pin already permits the latest available version, leave `pyproject.toml` unchanged.

## Step VERIFY: Confirm builds and tests pass

`pytest` runs from the uv-managed training environment, not the global PATH. (`pnpm build` may run a format/lint `fix` step first; a major `markdownlint-cli2` bump can enable a new rule that fails on existing tables — disable Prettier-owned formatting rules in `.markdownlint-cli2.jsonc` rather than reformatting.)

After the lockfile refresh, watch for **open-ended `pnpm.overrides` targets pulling a breaking major.** A security-floor override like `"js-yaml@<=4.1.1": ">=4.2.0"` will silently resolve to a newly published major once `pnpm update --latest` refreshes. The fix is to **cap the override below the next major** (`">=4.2.0 <5"`), keeping the floor while excluding the breaking major, then `pnpm install`.

```bash
pnpm build
pnpm test
uv run --project training pytest
```
