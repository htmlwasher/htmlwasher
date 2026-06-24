---
description: Examine existing rules, create or update a .claude/rules/ file, then wire it into applicable CLAUDE.md files
argument-hint: <rule-description-or-content>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Add Rule

Add or update a rule in `.claude/rules/` from the description in `$ARGUMENTS`, then ensure every applicable `CLAUDE.md` references it.

## Step READ: Parse the Input

Extract from `$ARGUMENTS`:
- What behavior the rule governs
- The rule's constraints or requirements
- Key terms and phrases to match against existing rules

If `$ARGUMENTS` is a file path that exists, read the file as the rule content.

## Step SCAN: Examine Existing Rules

Read all files in `.claude/rules/`:

```bash
find .claude/rules -name "*.md" | sort
```

Read the full content of each file. For each rule identify:
- What behavior it governs
- Overlap or partial coverage with the input
- Conflicts that must be resolved

## Step DECIDE: Create or Update

- **Update** an existing rule if it governs the same subject — add the new information as additional bullets or a new `##` subsection. Do not duplicate existing content.
- **Create** a new file if no existing rule covers the subject.

**New file naming**: `<subject>.md` — lowercase-with-hyphens, describes the governed behavior (e.g. `commit-messages.md`, `error-handling.md`).

**Rule format** (from `.claude/rules/prompt-engineering-knowledge.md`):
- No frontmatter
- `#` title, `##` section headers
- Under ~80 lines
- Plain markdown — no code blocks for prose lists

## Step WIRE: Reference in CLAUDE.md Files

Find all `CLAUDE.md` files in the repo, excluding `node_modules`:

```bash
find . -name "CLAUDE.md" -not -path "*/node_modules/*"
```

For each file that has a `## Rules` section:
- Check whether the rule is already listed
- If not listed and the rule applies to that context, append:
  `- [Rule title](.claude/rules/<slug>.md) — one-line summary`
- For an **updated** rule: verify the existing entry still accurately describes the rule after the update; edit if it does not

**Applicability**: A rule applies to a `CLAUDE.md` when the behavior it governs is relevant to the codebase or workflows described in that file. When uncertain, add it.

## Step REPORT

State concisely:
- File path created or updated, and what changed
- Which `CLAUDE.md` files were updated and what was added
- Which `CLAUDE.md` files already had a reference (no change needed)
