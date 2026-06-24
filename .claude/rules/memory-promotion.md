# Memory Promotion

Claude's file-based memory (`~/.claude/projects/<project>/memory/`) is personal and local — it is NOT version-controlled and is not shared with teammates or CI. `CLAUDE.md` and `.claude/rules/` ARE committed and loaded every session. Durable repo knowledge therefore belongs in the committed layer, not only in memory.

## When you write or update a memory, also promote it

If a memory you save is a durable, repo-level fact, promote it into the committed knowledge layer in the SAME session:

- Cross-cutting convention, tech-stack fact, build/tooling gotcha, architecture invariant, or version/deployment fact → add or update it in `CLAUDE.md`.
- A focused, enforceable convention worth its own file → create a `.claude/rules/<name>.md` and wire it into `CLAUDE.md` (see `.claude/rules/rule-coverage.md`).

## Keep in memory only (do NOT promote)

- Personal preferences and interaction-style feedback (how Claude should work for this user)
- Point-in-time event logs and one-off fix records
- Anything specific to a single conversation, or user-private context

## Avoid duplication

If the fact already lives in `CLAUDE.md` or a rule, update that location — do not create a parallel copy. Memory may keep a one-line pointer to the committed location.
