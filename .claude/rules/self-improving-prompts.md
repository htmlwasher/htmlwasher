# Self-Improving Prompts (Learn After Run)

After a command, skill, agent, or workflow finishes its work, fold durable learnings back into the prompt ecosystem so the next run is better. This is the "learn after run" convention — the per-run layer that sits between periodic `claude-setup-auditor` passes.

## Mechanism: an in-body `## Step LEARN`, not a hook

The robust mechanism is a final `## Step LEARN` step baked into the command/skill/agent body. Reflection needs the model's full run context and judgment — what actually failed, what the user corrected — which a shell hook cannot see.

Do NOT hang reflection on a `PostToolUse` hook: PostToolUse hooks are confirmed to fire unreliably across Claude Code versions. `SessionEnd` output is ignored by the model, so it cannot drive reflection either. A `Stop` hook is the only event that fires reliably AND can continue the turn, so it may serve as an optional deterministic *backstop* (clone the loop-safe `stop_hook_active`-guarded pattern used by this repo's `spec-gate.sh`) — but the reflection itself stays in the prompt body.

## What to capture

At the end of any non-trivial run, once the work is verifiably done, reflect on: what the prompt got wrong, missing context, a gotcha discovered, a step that needed retrying, or a user correction. Capture only what changes future behavior — if it does not, write nothing (avoid bloat).

## Where it goes (destination)

Pick the destination per `@/.claude/rules/memory-promotion.md`:

- A fix to the *procedure* of the specific command/skill/agent → edit that prompt's own body (minimal diff, `@/.claude/rules/minimal-diff.md`).
- A durable, repo-level or cross-cutting fact → `@/CLAUDE.md` or a `@/.claude/rules/<name>.md`, wired per `@/.claude/rules/rule-coverage.md`.
- A personal preference, point-in-time event, or single-conversation detail → Claude's memory only; do not promote.

## How to apply

Apply the edit in the SAME turn with the Edit tool — never ask "shall I update the docs?" (`@/.claude/rules/no-confirmation-prompts.md`). State explicitly when nothing durable was learned.

## Foundation

This sits on top of the existing self-improving loop: the `SessionStart` `claude-setup-snapshot.mjs` hook surfaces the setup inventory + audit staleness, and the `claude-setup-auditor` skill is the periodic reasoning pass. "Learn after run" is the lightweight per-run layer between those audits.
