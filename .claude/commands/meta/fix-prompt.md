---
description: Research, fix, and compact a prompt file. Optionally execute it to validate and refine.
argument-hint: <prompt-file-or-folder> [prompt-file-or-folder ...] [-- extra instructions]
allowed-tools: Read, Edit, Grep, Glob, WebSearch, WebFetch, AskUserQuestion
---

# Fix Prompt

Deep-research one or more prompt files or folders using mandatory detailed web research, find outdated or wrong approaches, fix them. Process each file in full (RESEARCH → QA → FIX → TLDR) before moving to the next.

## Arguments

- `$ARGUMENTS`: One or more paths to prompt files or folders (at least one required). If a folder is given, all `.md` files directly inside it (non-recursive, top-level only) are processed.
- **Additional instructions** (optional, last): everything after a ` -- ` separator is free-text guidance applied to every file in this run. It takes precedence over the defaults and may extend the minimum-touch scope (e.g. "focus on the tool list", "make the RESEARCH step terser").

## Principles

- **Preserve original intent** — fix the prompt, don't rewrite its purpose
- **Preserve original structure** — no new headings, no rephrasing for style. Keep the author's wording wherever it is correct. 
- Reorder items, parts of the text when the original order is logically broken (e.g. a step references state created by a later step)
- **Minimum-touch fixes only** — grammar, typos, factual errors, broken URLs/paths/versions, mistakes uncovered in research. Nothing else
- **Keep it a prompt** — never convert to a slash command, redirect, or stub
- **Super concise** — no filler, no fluff

## Step EXPAND: Resolve File List and Instructions

Split `$ARGUMENTS` on the first ` -- ` separator: tokens before it are file/folder paths; everything after it is the free-text **additional instructions** for this run (may be absent). Then iterate over each path argument:

- If it ends in `.md`, treat it as a single file.
- Otherwise, treat it as a folder: use Glob to find all `*.md` files directly inside it (pattern `<folder>/*.md`, non-recursive). Add each result to the file list.

Continue the pipeline using the expanded file list, applying the additional instructions (if any) to every file processed.

## Step RESEARCH: Deep Analysis

For each prompt file in the expanded file list, run the full pipeline below. Read the prompt file. Research **every technical claim, tool, library, API, and approach** mentioned. **Web research is mandatory and must not be skipped — even if a claim seems obviously correct, verify it.** Let any additional instructions from EXPAND scope and prioritize the analysis.

- **Web search** (required for every technical claim): current documentation, changelogs, deprecation notices, known issues — search deeply, do not skim
- **Codebase**: Grep for related files, configs, and patterns already in use
- **Documentation**: Fetch official docs for any referenced frameworks or tools

Build an analysis covering:

- **Outdated approaches** — deprecated APIs, removed features, superseded patterns
- **Logical problems** — contradictions, impossible sequences, missing prerequisites
- **Anti-patterns** — practices that conflict with current best practices
- **Clutter** — filler text, redundant instructions, unnecessary verbosity

## Step QA: Ask Questions (If Needed)

If research found things that can be improved, ask the user via AskUserQuestion. Skip if analysis is clear and no improvements needed.

## Step FIX: Apply Fixes

Edit the prompt file applying all findings:

- Fix typos, grammar, and broken URLs / paths / versions in place
- Replace factually wrong claims (deprecated APIs, missing features, wrong identifiers) with correct ones, keeping the surrounding sentence
- When an instruction asks to surface exact code identifiers (enums, types, functions), pair each named identifier with its concrete source-file path (in `@/` notation), not just the bare name
- Resolve logical contradictions with the smallest possible edit
- Integrate answers from QA step as natural prompt content — never append Q&A transcripts
- Carry out any additional instructions from EXPAND, which take precedence over the default minimum-touch scope

**Constraints**:
- Always use Edit tool. Never use Write — that destroys structure. If the prompt is unstructured notes, leave it unstructured; do not impose headings, sections, or bullet hierarchies the author did not write
- Do not add new headings or rephrase correct sentences for style. Reorder only when sequence is logically broken
- Never add motivational language, disclaimers, or boilerplate
- Every sentence must convey actionable information

## Step TLDR: Write or Fix TLDR

Check whether the prompt has a TLDR blockquote as the first content block after the frontmatter (before any other content):

- **No TLDR exists**: insert one immediately after the frontmatter — a one-to-three sentence summary of what the prompt does and when to use it, formatted as:
  ```
  > **TLDR**: One-to-three sentence summary of what this prompt does and when to use it.
  ```
- **TLDR already exists**: review it against the now-fixed prompt content. If it is stale or inaccurate, fix it in place with the Edit tool. If it is still accurate, leave it unchanged.
