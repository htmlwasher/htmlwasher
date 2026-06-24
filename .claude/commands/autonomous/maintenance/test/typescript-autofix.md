---
description: Review TypeScript code for type safety violations and auto-fix issues
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
skills: autonomous-task
---

Review all TypeScript source files in this repo for type safety violations and auto-fix what can be safely resolved. Save a report to `autonomous-task-output/{agent}/`.

## Scope

Review `.ts` files under `trafilatura-alpha/` and `tools/live-crawl-tester/`. Exclude `node_modules/`, `dist/`, `sources/`, and `*.test.ts` files from manual review (tests are reviewed by the test commands).

## Step BIOME: Auto-fix Biome Issues

```bash
biome check --write .
```

Apply all auto-fixable Biome lint and format issues.

## Step REVIEW: Review TypeScript Files

For recently changed `.ts` files (or all if no recent changes):

```bash
git diff --name-only HEAD~10 | grep -E '\.ts$' | grep -v '\.test\.ts$'
```

Check each file for:
- `any` type usage (replace with proper types where inferrable)
- Type assertions (`as` casts) that could be removed
- Missing return types on exported functions
- Non-null assertions (`!`) that could be replaced with proper guards
- `@ts-ignore` / `@ts-expect-error` comments

## Step FIX: Fix Issues

Fix issues that can be resolved autonomously:
- Replace `any` with `unknown` or a proper inferred type
- Add explicit return types to exported functions
- Remove unnecessary type assertions where the type is inferrable
- Replace non-null assertions with proper null guards where possible

Do NOT fix:
- Issues that require understanding business logic
- Type assertions in test files (they may be intentional)
- Issues that require changing function signatures in public APIs

## Step TYPECHECK: Verify Types

```bash
pnpm build
```

TypeScript compilation is the type check. Fix any new type errors introduced.

## Step REPORT: Save Report

Save `autonomous-task-output/{agent}/reports/test-typescript-autofix-report.md` with:
- Files reviewed
- Issues found per file (type, line, description)
- Fixes applied
- Issues deferred to `autonomous-task-output/{agent}/prompts/test-typescript-autofix-prompt.md`
