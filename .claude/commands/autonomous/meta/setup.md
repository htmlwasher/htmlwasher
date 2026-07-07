---
description: Autonomously audit and fix .claude/ setup — frontmatter, stale references, MCP alignment, CLAUDE.md consistency. Saves report to autonomous-task-output/{agent}/.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

Audit `.claude/`, `CLAUDE.md`, `.mcp.json`, `settings.json`. Auto-fix safe issues (frontmatter, stale references, MCP alignment). Flag risky changes (file deletion, trim) for human review. Save a report to `autonomous-task-output/{agent}/`.

## Step INVENTORY

Run in parallel:

```bash
for f in .claude/agents/*.md; do echo "$(wc -l < "$f") $f"; done
for f in .claude/skills/*/SKILL.md; do echo "$(wc -l < "$f") $f"; done
find .claude/commands -name "*.md" -exec sh -c 'echo "$(wc -l < "$1") $1"' _ {} \;
```

Also read: `CLAUDE.md`, `.claude/settings.json`, `.mcp.json`, `.claude/rules/*.md`.

## Step SCAN: Codebase Scan

Read the root `package.json` / `pnpm-workspace.yaml`, the TypeScript sources (`packages/htmlwasher/src`, `packages/live-crawl-tester/src`), and `training/pyproject.toml` to build a technology domain map. Identify frameworks, tools, and key domains actually in use. The `training/` project is an offline uv-managed Python project — not a pnpm workspace member, so it never surfaces through `package.json`; treat it as a first-class surface alongside the TS workspace packages. The reference repos live OUTSIDE this repo at `~/r/htmlwasher-sources/` (rs-trafilatura, web-page-classifier, go-trafilatura, trafilatura, trafilatura-rs, readability) — never treat them as in-repo source.

## Step ANALYZE: Gap Analysis

Compare inventory against codebase. Find:

**Cleanup candidates:**
- Orphaned agents/skills for technologies not in this repo
- Commands referencing paths/projects that don't exist here
- Stale references to removed tools (e.g., ESLint when using Biome) or to dropped contextractor concepts (Apify, Crawlee, Playwright, napi-rs/cargo builds, proxy rotation, `@contextractor/*` package names)
- Bloated files over 100 lines — trim generic content, keep actionable parts
- `CLAUDE.md` referencing agents/skills/MCP servers that don't exist as files or `.mcp.json` entries
- `CLAUDE.md` not listing the `python-pro` agent, the python skills (`python`, `python-packaging`, `python-testing-patterns`, `async-python-patterns`, `python-performance-optimization`), or the `training/` Python project
- Every `.claude/rules/*.md` lacking rule coverage — each must be referenced in `CLAUDE.md`, an agent, or a command (per `.claude/rules/rule-coverage.md`)
- `.mcp.json` ↔ `settings.json` `enabledMcpjsonServers` misalignment (every key in one must appear in the other) — only if a `.mcp.json` exists
- `.mcp.json` stale tool category names — verify `--tools` flags match current MCP server docs
- `.mcp.json` deprecated transport — prefer `type: http` with hosted URL over stdio `npx` when available
- Skills with stale SDK API references — grep for method names and verify against installed package versions
- `CLAUDE.md` missing a `## Security` section with content-handling rules (treat all scraped/parsed HTML as untrusted)

**Gaps:**
- Missing agents for technology domains in use
- Missing skills for patterns used repeatedly
- `CLAUDE.md` not listing all actual agents/skills/MCP servers

**Frontmatter validation:**
- Agents: must have `name`, `description` (with activation keywords like `Use PROACTIVELY`/`Use when`/`Use for`), `tools`, `model`
- Agent `tools:` must include file access tools (Read, Write, Edit) if the agent writes code
- Skills: must have `name`, `description`
- Commands: must have `description`
- All `skills:` references in agents must resolve to `.claude/skills/{name}/SKILL.md`

## Step FIX: Auto-fix Safe Issues

Apply fixes immediately without confirmation:
- Fix invalid or incomplete frontmatter in agents, skills, commands
- Fix stale tool references (e.g., ESLint → Biome) and dropped contextractor concepts (Apify/Crawlee/Playwright/napi-rs/proxy)
- Sync `.mcp.json` ↔ `settings.json` `enabledMcpjsonServers` alignment (only if a `.mcp.json` exists)
- Fix stale SDK method references in skills
- Remove empty directories

Do NOT auto-delete agent or skill files, and do NOT trim bloated files — flag these in the report instead.

## Step VALIDATE

```bash
grep -h "^skills:" .claude/agents/*.md 2>/dev/null | tr ',' '\n' | sed 's/skills: //' | xargs -I{} sh -c 'test -f ".claude/skills/{}/SKILL.md" && echo "OK: {}" || echo "MISSING: {}"'

if [ -f .mcp.json ]; then
  diff <(grep -oE '"[a-z]+":' .mcp.json | tr -d '":' | sort) \
       <(grep -A20 enabledMcpjsonServers .claude/settings.json | grep '"' | tr -d ' ",' | sort) \
    && echo "OK: MCP alignment" || echo "WARN: MCP alignment mismatch"
else
  echo "OK: no .mcp.json (nothing to align)"
fi

grep -q '## Security' CLAUDE.md && echo "OK: Security section" || echo "MISSING: Security section in CLAUDE.md"

test -f .claude/agents/python-pro.md && echo "OK: python-pro agent" || echo "MISSING: python-pro agent"
for s in python python-packaging python-testing-patterns async-python-patterns python-performance-optimization; do test -f ".claude/skills/$s/SKILL.md" && echo "OK: skill $s" || echo "MISSING: skill $s"; done
grep -q 'training' CLAUDE.md && echo "OK: training project in CLAUDE.md" || echo "MISSING: training/ project in CLAUDE.md"

# Rule coverage: every rule must be referenced in CLAUDE.md, an agent, or a command
for r in .claude/rules/*.md; do
  name=$(basename "$r" .md)
  grep -rq "$name" CLAUDE.md .claude/agents .claude/commands 2>/dev/null \
    && echo "OK: rule $name covered" || echo "MISSING: rule $name coverage"
done
```

## Step REPORT: Save Report

Save `autonomous-task-output/{agent}/reports/meta-setup-report.md` with:
- Files fixed (frontmatter, stale references, MCP alignment)
- Orphaned or bloated files flagged for human review (do not delete)
- Validation results (pass/fail per check)
- Gaps identified (missing agents/skills)
- Any issues that could not be auto-fixed (save to `autonomous-task-output/{agent}/prompts/meta-setup-prompt.md`)
