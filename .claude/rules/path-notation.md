# Path Notation

Use the `@/` prefix for all repo-root-relative paths in prompts, commands, rules, skills, and agent descriptions. Never use absolute filesystem paths.

## Format

- `@/.claude/commands/sync/spec.md`
- `@/packages/htmlwasher/src/core/extract.ts`
- `@/packages/live-crawl-tester/src/index.ts`
- `@/training/SPEC.md`
- `@/prompts/2026-6-24-init/prompt.md`

## Prohibited

- `/Users/miroslavsekera/r/htmlwasher/.claude/commands/sync/spec.md`
- Any path starting with `/Users/`, `/home/`, or other absolute prefixes

## Cross-repo references

`@/` only addresses paths inside this repo. For a path in a sibling repo (e.g. a reference repo under `~/r/<repo>`), use a descriptive, home-relative reference (`~/r/<repo>/...`) rather than a hardcoded `/Users/<name>/` path. In runnable bash blocks, write any in-repo destination relative to the repo root (`./htmlwasher`) and any cross-repo source home-relative (`~/r/<repo>/...`) so no username is baked in. (Note: the read-only reference repos live OUTSIDE this repo at `~/r/htmlwasher-sources/` — they are a sibling directory, not in-repo, so address them home-relative as `~/r/htmlwasher-sources/...`, never `@/sources/...`.)

## Exempt

- `.claude/settings.json` permission globs (`Read`/`Write`/`Edit(/Users/...)`) and hook `command` paths are functional matchers the harness resolves literally — leave them as absolute paths.

## Scope

This applies to path references written in `.claude/` configuration files (commands, rules, skills, agents) and `prompts/` directory files. Source code paths (TypeScript imports, `tsconfig` paths, Cargo paths) follow their own conventions.

When writing or fixing a prompt that contains absolute filesystem paths, convert them to `@/` notation (or a home-relative cross-repo reference) before saving.
