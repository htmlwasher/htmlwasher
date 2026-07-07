---
description: Research, structure, and produce or update a single polished prompt file in a prompts/ subfolder
argument-hint: [existing-prompt-path] <raw-meta-prompt | meta-prompt-file> [--- extra notes]
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch, AskUserQuestion, Task, SlashCommand
---

# Write Prompt

Transform a raw prompt idea into a single polished prompt file saved to `@/prompts/{date}-{slug}/`, or apply a change request to an existing prompt file. Produces one output file — no research scaffold, no splitting, no review/test steps.

## Arguments

`$ARGUMENTS` format: `[existing-prompt-path] <meta-prompt> [--- extra notes]`

- `<meta-prompt>` (required): the raw meta-prompt or change request — inline text, or a path to a file containing it (the file is moved into `user-entry-log/`, see Step SAVE)
- `[existing-prompt-path]` (optional, first argument): path to an existing prompt file or folder under `@/prompts/` — forces UPDATE mode targeting that prompt; omit it when the meta-prompt content already names the target
- `[--- extra notes]` (optional): everything after the `---` separator is treated as instructions/overrides for how to process the meta-prompt, logged as its own numbered entry

## Principles

- **Add only critically required text** — every added word must earn its place
- **Super concise** — no filler, no fluff, no motivational phrasing
- **No code examples** — reference documentation or MCP servers instead
- **Preserve original intent** — fix the prompt, don't rewrite its purpose
- Follow `@/.claude/rules/formatting-guidelines.md`

## Step CLEAN_GIT: Verify Clean Working Directory

Run `git status --porcelain`. If output is not empty (ignore the meta-prompt file passed in `$ARGUMENTS`), stop with error:

> "Git working directory must be clean. Commit or stash changes before running this command."

## Step MODE: Detect Create vs Update

- **UPDATE**: an `[existing-prompt-path]` argument was given, or the meta-prompt content names an existing prompt file or folder under `@/prompts/` as the target to change (e.g., "add those to the prompt ..."). All later steps operate on that prompt's folder and file.
- **CREATE** (default): no existing target — produce a new prompt folder and file.

## Step SAVE: Create Directory and Log Input

- CREATE mode: derive a topic slug from the raw prompt content (kebab-case, concise) and create `@/prompts/{today's date}-{slug}/`
- UPDATE mode: reuse the target prompt's existing folder and `user-entry-log/` — do not create a new folder
- **Sequential numbering**: every file in `user-entry-log/` gets a two-digit sequence prefix (`01-...`, `02-...` — never an `entry-` prefix) in the order the entries were entered; when appending to an existing log, continue from the highest existing number — if the log has only legacy unnumbered entries (`entry-*` names), start at `01`
- If the meta-prompt is a file path that exists, **move** the file exactly as-is into `user-entry-log/` as the next numbered entry — no headers, no modifications, no reformatting
- If the meta-prompt is raw text, save it **verbatim** the same way
- Entry names: `01-initial-prompt.md` in CREATE mode; a descriptive name for the change in UPDATE mode (e.g., `04-add-export-tabs.md`)
- If extra notes were provided (after `---` separator), save as the next numbered entry (e.g., `user-entry-log/02-notes.md`)
- If the user pasted attachments (images, screenshots, diagrams), save each as the next numbered entry with a descriptive name (e.g., `02-playground-screenshot.png`) and add a markdown link to it from the entry that references it

## Step RESEARCH: Deep Analysis

Read the raw input. Research **every technical claim, tool, library, API, and approach** mentioned:

- **Web search**: Current documentation, changelogs, deprecation notices, known issues
- **Codebase**: Grep for related files, configs, and patterns already in use
- **Documentation**: Fetch official docs for any referenced frameworks or tools

Build analysis covering:

- **Typos and grammar** — fix all spelling, punctuation, and formatting errors
- **Outdated approaches** — flag deprecated APIs, removed features, superseded patterns
- **Logical problems** — contradictions, impossible sequences, missing prerequisites
- **Anti-patterns** — practices that conflict with current best practices
- **Missing structure** — add headers and named steps where the prompt lacks them
- **Clutter** — identify filler text, redundant instructions, unnecessary verbosity

Retain all findings in working memory — applied directly in Step WRITE.

## Step QA_BEFORE: Pre-Fix Questions (MANDATORY Review)

**Default: ASK.** If anything is even slightly unclear, ambiguous, or open to interpretation — ask. It is always better to ask too many questions than to implement something wrong.

Use AskUserQuestion to clarify:

- Ambiguous scope or boundaries ("does this apply to X or also Y?")
- Unclear intent behind a phrase or instruction
- Multiple valid interpretations of a requirement
- Missing context that affects implementation approach
- Assumptions you'd need to make without asking

Log each Q&A exchange as a separate numbered file in `user-entry-log/`, continuing the existing sequence (e.g., `03-qa-redirect-scope.md`). Only skip if the prompt is unambiguous and every requirement has a single clear interpretation.

## Step RESOLVE_TOOLS: Identify Applicable Skills and Agents

Analyze the prompt's scope to determine which skills and agents are relevant.

**Discovery**: Scan `@/.claude/skills/` and `@/.claude/agents/` directories. Read the frontmatter (`description` field) of each skill and agent to understand what it does and when it activates. Match against the prompt's technologies, file paths, and verification needs.

**Selection criteria**:
- Which directories does the prompt touch? (`trafilaturacore/`, `tools/`, `training/`, etc.)
- Which technologies are involved? (TypeScript, Python, ONNX, etc.)
- What verification is needed? (type safety, unit tests, smoke tests, etc.)
- Are there implementation agents that match the work? (TypeScript, Python, etc.)

Add a "Skills and Agents" section near the top of the output file listing which skills to activate and which agents to use. Only include skills/agents that are actually relevant — do not list everything. In UPDATE mode, revise the existing section only if the change alters the prompt's scope.

## Step WRITE: Write Final File

Apply all research findings and QA answers.

- CREATE mode: write the single polished file to `@/prompts/{date}-{slug}/{slug}.md` with Write; if the input was already a structured prompt, preserve its structure and change only what needs fixing
- UPDATE mode: apply the change request to the existing prompt file with Edit — surgical, minimal diffs; integrate each change into the section where it belongs and preserve all unchanged content exactly; never rewrite the whole file
- Never add motivational language, disclaimers, or boilerplate
- Every sentence must convey actionable information

## Step FIX: Polish Output File

Run `/meta:fix-prompt` on the written or updated file (`@/prompts/{date}-{slug}/{slug}.md`).
