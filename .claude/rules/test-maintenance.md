# Test Maintenance

Unit tests must be added or updated in the **same response** as the source change — never defer to a follow-up.

## When to update tests

Update the corresponding test file in the **same response** as the source change.

Add or update tests when:
- A new public function, method, or class is added
- Existing logic changes — new branches, edge-case handling, algorithm change
- A bug is fixed — add a regression test for the exact input that triggered the bug
- A schema field, CLI flag, or output format is added, renamed, or removed
- A new error path or validation rule is added

No test update needed when:
- Only types or type signatures change with no logic change (TypeScript-only refactors)
- A private helper is extracted and callers already have tests that exercise the code path
- Changes are limited to comments, formatting, or documentation files
- Generated artifacts are produced by a build/export script (`*.d.ts`, the trained `model.xgb.json` / `tfidf-vocab.json` exported from `training/`)

## Test locations

### TypeScript

`*.test.ts` co-located next to source (e.g., `packages/trafilaturacore/src/core/extract.test.ts` for `extract.ts`); vitest preferred, or `node:test` for zero-dep scripts. Golden-fixture tests for `trafilaturacore` use HTML fixtures under `packages/trafilaturacore/fixtures/` and live in `packages/trafilaturacore/test/`. Run `pnpm test` from the repo root (turbo). Packages without tests need `vitest run --passWithNoTests` in their `test` script, otherwise the recursive `pnpm test` fails.

### Python

The `training/` project's tests run via `pytest` (Python 3.12+, uv-managed). Add or update a test in the same response as a training source change. `training/` is offline and not shipped at runtime, but its tests still keep the export pipeline honest.

## How to update

Read the changed source file, identify the new or changed logic, and write or update the minimal set of test cases that covers the change. Use the Edit tool for surgical additions. Do not rewrite passing tests.

## Dead-code analysis

Run `npx knip --reporter compact` from the repo root to detect unused exports, files, and dependencies (config in `knip.json`). `prompts/`, `sources/`, and `training/` are excluded: `prompts/` holds one-shot artifacts that nothing imports, `sources/` is read-only reference repos (gitignored inputs), and `training/` is an offline Python project that is not a pnpm workspace package. `.claude/hooks/**` is also excluded: hook scripts (e.g. `claude-setup-snapshot.mjs`) are invoked by the Claude Code harness via `.claude/settings.json`, not imported by any TS code, so knip always reports them as "unused files" — they are live, never delete them. Do not add any of these to `pnpm-workspace.yaml` to "fix" this — the correct fix is the `ignore` entry in `knip.json`.
