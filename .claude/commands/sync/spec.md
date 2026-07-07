---
description: Sync all SPEC.md files with source — autofix stale specs, ask for direction on ambiguous gaps, then commit and push
allowed-tools: Bash(git:*), Read, Edit, Glob, Grep, AskUserQuestion
---

# Sync SPEC.md (Interactive)

Scan all SPEC.md files against their source counterparts. Apply unambiguous fixes immediately, pause and ask the user for direction on each genuinely ambiguous discrepancy, then commit the result.

This is the interactive counterpart to the autonomous `/autonomous:maintenance:sync:spec` command. The distinction: this command pauses on ambiguous cases rather than logging them for later review.

## Source → SPEC mapping

- `packages/trafilaturacore/src/**` → `packages/trafilaturacore/SPEC.md`
- `packages/live-crawl-tester/src/**` → `packages/live-crawl-tester/SPEC.md`
- `training/**/*.py` → `training/SPEC.md`
- Architecture or data-flow changes in any of the above → root `SPEC.md`

## Step SCAN: Read specs and source side-by-side

Run `git diff --name-only HEAD~1..HEAD` and `git status --short` to identify recently changed files — prioritise specs for those packages.

For each SPEC.md file, read the spec and its corresponding source entry points:

- `packages/trafilaturacore/src/index.ts` — library public exports
- `packages/live-crawl-tester/src/index.ts` (or its main entry) — live-crawl-tester public surface
- `training/*.py` — training scripts and model/vocab export entry points

Read every relevant file. Do not skip a package because its source did not appear in the recent diff — drift can accumulate silently.

## Step DETECT: Classify each discrepancy

For each spec, identify every discrepancy and classify it as one of two kinds.

**Autofixable** — the right answer is unambiguously derivable from source:

- A new export or field appears in source but is absent from the spec
- A signature, type, or option name changed in source; the spec still shows the old one
- A field or export was removed from source; the spec still documents it as present
- A description is factually wrong in a way the code clearly resolves (e.g., wrong default value)
- The spec contains a **"what changed" / historical note** — a migration callout, breaking-change notice, or any phrasing like "no longer", "there is no separate X", "previously", "was removed", "renamed from", "force-add fallback removed". Specs describe current state only; remove the note (keep only the current-behaviour sentence around it)

**Needs user decision** — the right answer requires human judgement:

- Spec documents a feature or export that no longer exists in source — could mean it was intentionally removed (remove from spec) or accidentally deleted (restore in code)
- A naming divergence where both spec and code could plausibly be correct
- Spec and code contradict each other on behaviour in a non-obvious way with no clear winner

## Step AUTOFIX: Apply all autofixable edits

Use the Edit tool for every change. Never use Write on an existing SPEC.md. Update only the drifted sections. Preserve heading structure, prose style, and all accurate content.

Never write a "what changed" / migration / historical note into a SPEC.md — document only the current behaviour and current API surface. When a sync removes a feature, delete its documentation rather than annotating that it was removed; when something is renamed, document the new name without noting the old one. A current-state limitation ("X is not supported") is fine; a transition note ("X was removed", "no longer accepts Y") is not.

After each edit, do a coherence check — the spec must read correctly end-to-end after the patch.

Apply all autofixable edits before moving to the Ask step.

## Step ASK: Interactive resolution for ambiguous discrepancies

For each "needs user decision" discrepancy, use `AskUserQuestion` with one question per discrepancy (or group two or three closely related ones in a single question when they have the same resolution options).

Each question must:

- Name the file and describe the specific discrepancy in one sentence
- Offer exactly the options that apply to that case, e.g.:
  - "Fix SPEC.md to remove the stale entry"
  - "Restore the missing implementation in source"
  - "Skip for now"

Apply the user's chosen fix immediately after each answer before asking the next question.

## Step README-CHECK: Verify README accuracy

After applying spec edits, skim each affected README (`packages/trafilaturacore/README.md`, `packages/live-crawl-tester/README.md`, `training/README.md`, root `README.md`) for prose that drifted from the same source change. Fix any stale description by hand with the Edit tool. The repo has no codegen-driven README regions, so there is nothing to regenerate — commit any README prose fixes alongside the SPEC.md edits as part of the same sync.

> **Context**: SPEC.md and README prose are both derived from the same source truth. The `spec-gate.sh` Stop hook enforces SPEC.md updates during development; this command handles catch-up syncs when drift has accumulated.

## Step COMMIT: Commit and push

After all fixes are applied, stage and commit with a message listing which SPEC.md files were updated and a one-line summary of the change in each. Then push.

```bash
git add -A
git commit -m "docs(spec): sync SPEC.md files with source

- packages/trafilaturacore/SPEC.md: <what changed>
- packages/live-crawl-tester/SPEC.md: <what changed>"
git push
```

If nothing changed (all specs were already in sync), skip the commit step and tell the user which specs were checked and found accurate.
