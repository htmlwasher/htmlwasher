# Nest dev-tool packages under `tools/htmlwasher/`

## Goal

Group this repo's dev-tool packages under a per-product subfolder of `tools/`, so
the layout is consistent with the other repos (`tools`, `contextractor`,
`external-tester`): every tool lives at `tools/<product>/<tool>`. Here that means
the two testers move under `tools/htmlwasher/`.

Tool **names stay scoped and unchanged** (`@htmlwasher/wash-corpus-tester`,
`@htmlwasher/live-crawl-tester`) — this is a folder move plus path-reference fix
only. The published flagship library `htmlwasher` (folder `@/htmlwasher/`) stays
where it is and unscoped; that folder already serves as the product folder for the
library, and its `package.json` `repository.directory` would change if moved, so
it is intentionally left in place.

## Constraints

- **Minimal diff.** Move the two tool folders and fix only the references the move
  breaks. No package renames, no reformatting.
- **No `package.json` at the grouping directory** `tools/htmlwasher/` — plain
  folder (Turborepo errors on a package.json at a group level).
- The offline `training/` Python project is not a pnpm workspace package and is
  out of scope.
- No confirmation prompts — execute end to end, autofix, and only commit once
  green.

## Step MOVE

`git mv` (creates `tools/htmlwasher/` implicitly; do not add a package.json
there):

- `tools/wash-corpus-tester` -> `tools/htmlwasher/wash-corpus-tester`
- `tools/live-crawl-tester` -> `tools/htmlwasher/live-crawl-tester`

## Step WORKSPACE-GLOBS

Edit `@/pnpm-workspace.yaml`:

```yaml
packages:
  - "htmlwasher"
  - "tools/htmlwasher/*"
```

## Step TSCONFIG-DEPTH

Each moved tool's `tsconfig.json` extends the repo-root tsconfig by relative path
and is now one directory deeper:

- `tools/htmlwasher/wash-corpus-tester/tsconfig.json`: `"extends": "../../tsconfig.json"`
  -> `"../../../tsconfig.json"`.
- `tools/htmlwasher/live-crawl-tester/tsconfig.json`: same fix.

Also scan each moved tool for any other `../../` reference targeting the repo root
(per-package `vitest.config.*`, scripts) and add the extra `../`.

## Step SWEEP

Find every remaining hard-coded path to a moved tool and update it (exclude
`node_modules`, `dist`, `.git`):

```bash
grep -rn -E 'tools/(wash-corpus-tester|live-crawl-tester)([/"'\'' ]|$)' . \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git
```

Check in particular `@/CLAUDE.md` (the Project Structure tree and the SPEC.md
mapping reference `tools/wash-corpus-tester/...` and `tools/live-crawl-tester/...`),
`@/.github/workflows/*`, and any root config. Leave name-based references
(`@htmlwasher/...`, `htmlwasher` workspace dep) unchanged — the tools depend on
`htmlwasher` by name, which is unaffected.

## Step INSTALL-BUILD

- `pnpm install` (never a frozen/CI install — lockfiles are gitignored by repo
  convention).
- `pnpm build` (`pnpm fix` then `turbo build`).

## Step AUTOFIX (iterate to green)

"Autofix" means fix the actual errors and re-run — not just `biome --fix`. Loop
until `pnpm build` and `pnpm test` are clean:

- A path error (tsconfig extends not found, module not found) -> a missed depth
  fix or stale path from Step SWEEP; fix it.
- A workspace resolution error -> the `pnpm-workspace.yaml` glob; fix and
  re-`pnpm install`.
- Lint errors -> `biome check . --fix --unsafe`, then hand-fix the rest.

## Step TEST

- `pnpm test` (`turbo test` — vitest, including the offline
  `@htmlwasher/wash-corpus-tester` end-to-end corpus run, which must still find its
  fixtures at the new path).
- `pnpm lint`.

## Step VERIFY

- `git status`: two folder renames plus a few edited tsconfig/config files. No
  unexpected content churn (minimal-diff check).
- `pnpm ls -r --depth -1`: `htmlwasher`, `@htmlwasher/wash-corpus-tester`,
  `@htmlwasher/live-crawl-tester` all present at their new paths with names
  unchanged.

## Step COMMIT-PUSH

- `git add -A`
- `git commit -m "refactor: nest dev tools under tools/htmlwasher/"`
- `git push` (current branch to its upstream). Do not create a branch or open a
  PR. If rejected because the remote advanced, `git pull --rebase`, re-run
  `pnpm install && pnpm build && pnpm test` if anything material merged, then push
  again.

## Notes

- Flagship `htmlwasher` stays at `@/htmlwasher/` (unscoped, its own product
  folder). Fully mirroring the `contextractor` repo's `packages/<product>/*` shape
  would also move the flagship into `packages/htmlwasher/` and require updating its
  published `repository.directory` and all internal references — out of scope for
  this change; do it only if explicitly requested.
