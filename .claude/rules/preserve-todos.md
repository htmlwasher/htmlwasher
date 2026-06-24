# Preserve TODO Comments

Never delete a TODO comment unless the fix directly and completely resolves the issue it describes.

## When Fixing Code

- If a TODO is in code you are modifying and you cannot resolve it, leave it exactly as-is.
- If a TODO is resolved by your fix, remove it.
- If a TODO is unrelated to your fix, do not touch it.

## Never

- Delete a TODO to "clean up" the code.
- Delete a TODO because it is inconvenient or seems stale.
- Silently drop a TODO when rewriting or refactoring a block that contains one.

## Why

TODOs mark known gaps, deferred decisions, and future work. Deleting them erases that intent and makes the codebase appear more complete than it is. Stale TODOs are a problem to be reviewed by the team — not silently removed during unrelated fixes.
