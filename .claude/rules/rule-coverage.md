# Rule Coverage

Every rule file in `.claude/rules/` must be referenced in at least one appropriate location so it is actually applied. An unreferenced rule is dead weight — it will never be loaded into context.

## Required reference for every rule

Each rule must appear in one of:
- Root `CLAUDE.md` — for rules that apply broadly across all work in the repo
- A specific agent `.md` body — for rules that apply only within a particular agent's domain
- A specific command `.md` body — for rules used only in a specific workflow

## When adding a new rule

After creating the rule file, immediately wire it in:
- Decide the appropriate location (CLAUDE.md for broad scope, agent for domain-specific, command for workflow-specific)
- Add a one-line reference with a brief description of what it covers
- Never commit a rule without wiring it in

## When running the setup audit

The setup audit (`/autonomous:meta:setup`) must verify that every `.claude/rules/*.md` file is referenced in at least one of the three locations above. Flag any unreferenced rule as a coverage gap requiring wiring.

## Rationale

Rules are only applied when Claude Code loads them into context. Claude Code loads rules from CLAUDE.md references and from agent/command bodies at activation time. A rule file that exists but is never referenced in any of those locations will never be read, so it provides no enforcement.
