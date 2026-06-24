---
name: claude-setup-auditor
description: >
  Audit and improve THIS repo's Claude Code setup — CLAUDE.md, .claude/rules,
  skills, agents, commands, hooks, settings/permissions, MCP servers, and
  plugins — against the latest official Claude Code docs. Use it periodically, at
  the start of significant work, or whenever asked to "review / audit / improve
  the Claude setup", "is the setup right", or "download / add new skills". It
  reads the config, fetches current docs, runs a gap analysis on 8 dimensions,
  and proposes changes by category (Adopt / Improve / Remove / Security / Parked)
  with per-item confirmation.
allowed-tools: "Read, Glob, Grep, WebFetch, WebSearch, Edit, Write, Bash(npx:*), Bash(npm:*), Bash(node:*), Bash(ls:*), Bash(cat:*), Bash(git status:*), Bash(git diff:*)"
---

# Claude Code setup auditor (self-improving loop)

Keep this repo's Claude Code configuration current and well-matched to the work.
You review the **configuration around the prompt**, not the product's application
code (other reviewers / the test suite cover that).

This is a **mature setup** — there are already many skills, agents, commands, and
rules. So weight **Remove** (dead / duplicate / superseded config) and **Improve**
at least as heavily as **Adopt**; more config is not better config.

## When to run
- Periodically, or when the `SessionStart` snapshot says the audit is stale.
- Before starting significant work (so it uses the best available setup).
- After work that revealed a gap — a manual step that should be a skill/hook, a
  rule that keeps getting violated, a new official feature worth adopting.
- On request, including "add / download new skills".

## Procedure

### 1. Inventory — read and JUDGE (don't just list)
- `CLAUDE.md` (+ `@`-imports) and every file in `.claude/rules/`
- `.claude/settings.json` (+ `settings.local.json`): permissions allow/deny,
  modes, env, **hooks**, enabled MCP servers and plugins
- `.claude/agents/**`, `.claude/skills/**/SKILL.md`, `.claude/commands/**`
- `.mcp.json`

### 2. Fetch the latest official docs (don't audit from memory — standards shift)
- Hooks: https://code.claude.com/docs/en/hooks  (events + which inject context)
- Skills: https://code.claude.com/docs/en/skills
- Subagents: https://code.claude.com/docs/en/sub-agents
- Plugins / marketplace: https://code.claude.com/docs/en/plugins
- Settings & permissions: https://code.claude.com/docs/en/settings , `/en/permissions`
- Best practices: https://code.claude.com/docs/en/best-practices
- Index of all pages: https://code.claude.com/docs/llms.txt

### 3. Score on 8 dimensions
1. **CLAUDE.md quality** — specific, explicit constraints, not bloated.
2. **Development workflow** — test/lint/build + slash commands documented.
3. **Skills coverage** — domain knowledge captured; reference files; no dead/dupes.
4. **Agent architecture** — specialized subagents with clear roles & handoffs.
5. **Automation (hooks)** — SessionStart/Stop/PreToolUse/PostToolUse earning use.
6. **Tool integration** — MCP servers + scoped permissions.
7. **Guard rails** — anti-patterns enforced, deny rules, path-scoped rules.
8. **Context efficiency** — lean CLAUDE.md; progressive disclosure into skills/rules.

### 4. Categorize findings (present with citations to the docs)
- **Adopt** — a new official feature worth adding here.
- **Improve** — existing config to refine (tighten a rule, fix a hook, dedupe).
- **Remove** — deprecated / redundant / dead (empty dirs, unused perms, skills
  that overlap, stale recommendations).
- **Security** — hardening (permission scoping, MCP sandboxing, secret handling).
- **Parked** — interesting but not a clear fit right now.

### 5. Apply, with confirmation
- **Per-item confirmation** before editing config or installing anything.
- **Respect this repo's conventions** — read `CLAUDE.md` and `.claude/rules/`
  first and follow them (stack, formatting, minimal-diff, security, etc.).
- **Installing skills:** only from vetted sources — `anthropics/skills` and named
  partners (Vercel, Trail of Bits, Remotion). Use
  `npx skills add anthropics/skills --skill <name>` (it prints a Gen/Socket/Snyk
  security assessment — require it clean). **Read the installed `SKILL.md` and
  audit any bundled scripts before relying on it.** Never auto-install unvetted
  community skills; flag them as Parked with the source.
- Update any docs you change.

### 6. Record the audit
Write `.claude/.last-audit.json`:
```json
{ "date": "YYYY-MM-DD", "summary": "one line", "adopted": [], "removed": [], "parked": [], "notes": "" }
```
Use the real date (this file drives the SessionStart staleness nudge).

## Guard rails
- Configuration only — do not refactor the product's application code here.
- No silent installs, no unvetted sources, no secrets in committed files.
- Prefer the smallest change that closes a real gap. A reviewer-style audit will
  always find *something*; only act on gaps that actually help the work.
