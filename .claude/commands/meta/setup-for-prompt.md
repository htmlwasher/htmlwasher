---
description: Read a prompt (file or inline task), derive every capability it needs, deep-research official docs (Anthropic/Claude Code, language/framework docs, MCP registries, industry discussions) as applicable, install the required MCP servers/plugins/skills/agents/rules into THIS repo only (project scope), wire the prompt to use the new or existing capabilities, verify, and report.
argument-hint: <prompt-file-path | task description>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, Agent, Skill, AskUserQuestion
---

# Setup For Prompt — Equip THIS Repo To Run A Prompt Well

Given one prompt, work out what it needs and install everything **into this repo only, at project scope**. Never install to user scope (`~/.claude`), never touch other repos. The ONLY prompt file this command may modify is the input prompt itself (Step WIRE_PROMPT, minimal diff) — never rewrite other `@/prompts/` content.

## Step READ_PROMPT: Resolve Input and Extract Capabilities

- Resolve `$ARGUMENTS`: try it as a literal file path, then relative to `@/prompts/`; if no file matches, treat it as inline task text.
- Extract explicit AND implicit capability requirements: technologies/frameworks, external services/APIs, docs-lookup needs, testing needs, content/SEO needs, languages (Rust/Python/TypeScript). This repo's stack is a TypeScript library + a Rust extraction core (napi-rs) + an offline Python training pipeline (XGBoost/ONNX) — weigh candidates against that.
- Produce a capability list — one line per capability with the evidence from the prompt.

## Step INVENTORY: Catalog What the Repo Already Has

Never assume absence — state goes stale. Before judging gaps, catalog:

- `@/.claude/{commands,skills,agents,rules}` — names + one-line purposes.
- `@/.mcp.json` — configured servers (if present; this repo currently configures none — a first MCP install creates the file).
- `@/.claude/settings.json` — `enabledPlugins`, `enabledMcpjsonServers`, `permissions.allow` MCP entries.
- The built-in `LSP` tool already provides `typescript-language-server`, `pyright`, and `rust-analyzer` (per `@/CLAUDE.md`) — do not add a language-server MCP/plugin that duplicates them.
- Plugins — the documented surfaces first: `claude plugin list` (installed/enabled state) and `claude plugin details <name>`. The raw caches (`~/.claude/plugins/plugin-catalog-cache.json` with per-plugin `tokens.<model>.always_on`, `installed_plugins.json`, `known_marketplaces.json`) are undocumented internals — best-effort fallback for bulk scans only.

## Step RESEARCH: Deep Web Research Per Capability

Choose sources by applicability to the prompt's domain; official-first always:

- Claude Code docs: `https://code.claude.com/docs/en/mcp`, `/en/mcp-quickstart`, `/en/discover-plugins`, `/en/plugins-reference`, `/en/plugin-marketplaces`, `/en/skills`, `/en/sub-agents`, `/en/settings`, `/en/permissions`.
- Anthropic announcements and engineering blog (Agent Skills, code-execution-with-MCP) for current best practice.
- This repo's stack, as applicable: Rust — crates.io + `https://docs.rs/`, napi-rs (`https://napi.rs/`); Python — PyPI + the project's own docs (XGBoost, scikit-learn, imbalanced-learn, selectolax); TypeScript — the library's npm dependency docs. Prefer the vendor's own `llms.txt` / raw-markdown docs where offered.
- MCP discovery: the Anthropic Directory first (`https://claude.ai/directory` — reviewed connectors; any remote server listed there can be added with `claude mcp add`), then the official registry API — `curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=<term>&limit=10"` (preview status; it verifies namespaces only, no security scanning) — plus curated directories (PulseMCP for curation, Glama "Official" tier).
- Industry discussions (GitHub, community forums) to confirm each candidate is the current best option and maintained, not deprecated/renamed: `gh repo view <owner>/<repo> --json pushedAt,stargazerCount,latestRelease,openIssues`.

Save substantial notes to `@/temp/setup-research-notes/` (gitignored working area).

## Step PLAN: Map Capabilities to Decisions

For each capability decide: **already-covered** (name the covering item) | **install MCP server** | **install plugin** | **install skill** | **create agent** | **add rule** | **install CLI prerequisite** (a tool a verification recipe or gate shells out to — a `gh` extension, a `uvx`/`uv run`-invokable renderer or checker). Gate every install candidate:

- **Official-first** — prefer `claude-plugins-official` / `anthropics/*` marketplaces, the vendor's own MCP server (reverse-DNS namespace matching the vendor domain), the official registry. Third-party = opt-in security posture: review source, verify maintainer identity, check dependencies for typosquats.
- **Maintenance/trust signals** — recent commits/releases, responsive issues, more than one maintainer. Read the server's tool descriptions before approving (tool poisoning hides instructions there); avoid unpinned `npx -y pkg@latest` invocations where a rug pull matters.
- **Credential hygiene** — no secrets committed; tokens live as env vars, referenced via `${VAR}` / `${VAR:-default}` expansion in `@/.mcp.json` (works in `command`, `args`, `env`, `url`, `headers`); least-privilege, read-only scoped tokens; prefer OAuth remote servers. Honor `@/.claude/rules/security.md` (no secrets in logs, no `.env*` in the repo).
- **Least-privilege permissions** — allow only the needed server (`mcp__<server>__*` or specific tools). The server segment of an allow rule must be literal — an unanchored `mcp__*` allow is skipped with a warning.
- **Low always-on token cost** — quote the plugin's Context cost from the `/plugin` Discover detail pane (fallback: `tokens.<model>.always_on` in the catalog cache); prefer a skill (only its name+description load until invoked) over an always-on MCP server for procedural knowledge.
- **Stack-applicable and non-duplicative** — skip anything an existing capability already covers: the `LSP` tool covers TS/Python/Rust language servers; the enabled `context7` plugin covers library-docs lookup (so a docs.rs/crates.io/package-docs MCP is duplicative — skip it); the `security-guidance` plugin + `@/.claude/rules/security.md` cover the untrusted-HTML posture; existing skills cover Rust/Python packaging and testing patterns; existing agents cover TS/Python/Rust work (`rust-pro` reads references AND authors the crate), code review, and web research.

Ask about at most ONE genuinely-ambiguous or risky third-party item via AskUserQuestion, then proceed (per `@/.claude/rules/no-confirmation-prompts.md`).

## Step INSTALL: Execute Per Type, Project Scope Only

- **MCP servers** — from the repo root (`--scope project` is the only scope that writes the shared `@/.mcp.json`; HTTP is the recommended transport, SSE is deprecated):

```bash
claude mcp add --transport http <name> --scope project <url>
claude mcp add --transport http <name> --scope project <url> --header "Authorization: Bearer <token>"
claude mcp add --scope project <name> -- npx -y <package>
claude mcp add --env KEY=value --transport stdio --scope project <name> -- npx -y <package>
```

  The `--` separates Claude's options from the server command. Keep at least one option between `--env` and the server name, or the CLI reads the name as another pair. After adding, replace any literal secret in `@/.mcp.json` with `${VAR}` expansion before committing. Then keep settings parity in `@/.claude/settings.json`: add the server to `enabledMcpjsonServers` and `mcp__<server>__*` to `permissions.allow` (creating those keys if this is the first MCP server).

- **Plugins** — non-interactive install; `--scope project` writes `enabledPlugins` into `@/.claude/settings.json` for the team:

```bash
claude plugin marketplace add <owner/repo>   # only for non-default marketplaces
claude plugin install <name>@<marketplace> --scope project
```

  De-dupe cross-marketplace duplicates, preferring the official marketplace.

- **Skills** — vetted installs into `@/.claude/skills/`, or author new ones via the `skill-creator` skill. Audit bundled scripts, resources, and any network-access instructions before enabling (Anthropic guidance).
- **Agents** — create any NEW agent or command prompt file via the `prompt-engineer` agent (repo convention): agents land under `@/.claude/agents/`, commands under `@/.claude/commands/<category>/`. New skills go through the `skill-creator` skill (see Skills above).
- **Rules** — create under `@/.claude/rules/` and wire per `@/.claude/rules/rule-coverage.md` — an unreferenced rule is never applied.
- **CLI prerequisites** — tools a prompt's verification recipes or gates shell out to (a `gh` extension, a markdown renderer, a `uvx`-invokable checker). Verify availability first (`command -v <tool>`, `gh extension list`); install only directly-named, vetted ones — for a `gh` extension run a `gh repo view <owner>/<repo> --json pushedAt,stargazerCount,isArchived,latestRelease` maintenance check, then `gh extension install <owner>/<repo>`. For on-demand tools prefer a no-install `uvx <tool>` / `uv run --no-project --with <pkg>` invocation and record that exact form in the report. The "no user scope" rule targets Claude config (`~/.claude`), not CLI binaries — a `gh` extension is inherently user-scoped, so installing it is a legitimate equip action.

## Step WIRE_PROMPT: Update the Input Prompt

If the input was a prompt FILE and wiring applies, Edit it (minimal diff per `@/.claude/rules/minimal-diff.md`, `@/` path notation per `@/.claude/rules/path-notation.md`) so it explicitly instructs use of the resolved capabilities — covering BOTH newly installed items and pre-existing ones the prompt should use but does not mention:

- Name the specific skills to invoke, the MCP servers/tools now available, and the agents to delegate to.
- Usual shape: a short "Required tooling" section mapping capability → skill/MCP server/agent.
- Preserve the prompt's voice, structure, and all other content; follow the target file's own path/formatting conventions.

If the input was inline text (no file), skip the edit and put the suggested wiring text in the report instead.

## Step VERIFY: Validate

- `claude mcp list` and `claude plugin list` from the repo root — every new server connects, shows pending OAuth, or shows `⏸ Pending approval` (the documented project-scope approval gate: approve interactively in `claude`, or redo with `claude mcp reset-project-choices`); every plugin is enabled.
- Frontmatter validity of any new prompt files (per `@/.claude/rules/prompt-engineering-knowledge.md` and the live docs).
- Settings parity: every `@/.mcp.json` server ↔ `enabledMcpjsonServers` ↔ `permissions.allow` entry.
- Every new rule is wired; no dangling cross-references anywhere.
- If the input prompt was edited, re-read it and confirm every skill/MCP server/agent it now names actually exists and resolves.

## Step REPORT: Summarize

Emit a capability → decision → installed-item table, plus the prompt-wiring changes applied (or the suggested wiring text for inline input). Always surface these caveats:

- New MCP servers and plugins load on the next session start (or `/reload-plugins` for plugin components); a hand-edited `@/.mcp.json` needs a session restart.
- LSP plugins no-op until their language-server binary is on PATH (`Executable not found in $PATH` in the /plugin Errors tab).
- Teammates cloning the repo still need the one-time `claude plugin install`, and committed `@/.mcp.json` servers stay pending approval until they trust the workspace (v2.1.196+ trust gate).

## Step LEARN: Self-Improvement

Per `@/.claude/rules/self-improving-prompts.md`: after the run is verified, fold durable learnings (a wrong step, a moved doc, a gotcha, a user correction) into THIS command body, `@/CLAUDE.md`, or a rule in the same turn (minimal diff). State explicitly when nothing durable was learned.
