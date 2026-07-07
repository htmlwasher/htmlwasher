---
name: typescript
description: TypeScript development guidelines for this workspace. Use when writing or modifying TypeScript in the `trafilaturacore/` library or any `tools/*` package.
---

# TypeScript Guidelines

Standards for the TypeScript that ships the product: the `trafilaturacore` extraction library and the `packages/live-crawl-tester/` E2E fetcher. pnpm + Turborepo monorepo, Node 22+, strict TypeScript, `module`/`moduleResolution` = `NodeNext`.

## Type system

Root `tsconfig.json` is `"strict": true` with `noUncheckedIndexedAccess`, `noImplicitOverride`, `module`/`moduleResolution` = `NodeNext`. Treat `tsc --noEmit` as ground truth. Never `any` — use `unknown` and narrow. No `// @ts-ignore` without an adjacent `// @ts-expect-error: <reason>`. Use `import type { … }` for type-only imports. Annotate exported signatures and module boundaries; trust inference inside functions.

## Bundling: keep emitted ESM un-bundled

Packages build with plain `tsc -p tsconfig.json` (`module: NodeNext`, `type: module`), emitting un-bundled ESM. **Keep it that way.** The `@trafilaturacore/native` napi loader (`index.js`) resolves its prebuilt `.node` binary at runtime via `require`/`__dirname`, so it breaks under esbuild / ncc / SEA single-file bundling. The model artifacts (`model.xgb.json`, `tfidf-vocab.json`) are baked INTO the Rust crate via `include_str!`, so they ship inside the `.node` — nothing to co-locate on the TS side.

## Lint & format — Biome only

Biome handles both lint and format (not ESLint or Prettier) for JS/TS/JSON. `pnpm lint` / `pnpm check` run `biome check .` (read-only); `pnpm fix` runs `biome check . --fix --unsafe && biome format --write . && biome check .` and is invoked at the start of every package's `build`. Prettier + markdownlint-cli2 own Markdown; cspell owns spelling. The `biome.json` ignore list must keep `.claude/**`, `prompts/**`, `sources/**`, and `**/fixtures/**` out of scope.

## Testing — vitest

`*.test.ts` next to source; vitest preferred (`node:test` for zero-dep scripts). HTML fixture tests for the extraction library live in `packages/trafilaturacore/test/` with fixtures under `packages/trafilaturacore/fixtures/`. AAA pattern, light mocking, dependency injection over heavy mocks. Run `pnpm test` from the repo root.

- **`vitest run` exits 1 with zero `*.test.ts` files** — packages without tests need `vitest run --passWithNoTests` in their `test` script, or the recursive `pnpm test` fails.

## Validation & async

Narrow input at the boundary with hand-written type guards, then trust the typed value downstream. `Promise.all` for fan-out, `Promise.allSettled` for tolerated partial failure; thread `AbortSignal` through cancellable I/O; bound concurrency with `p-limit` or a semaphore. Never swallow rejections.

## Dead-code analysis

Run `npx knip --reporter compact` from the repo root to find unused exports, files, and deps. Config is `knip.json`; `prompts/` and `sources/` are ignored there by design — don't "fix" their false positives by adding them to `pnpm-workspace.yaml`.

## Output formats

Supported output formats are `txt | markdown | json | html`, mirroring upstream Trafilatura's faithful behavior.
