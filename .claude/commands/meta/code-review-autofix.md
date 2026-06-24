---
description: Review recently written code, log and implement additional instructions, automatically fix every problem found, and save a report — with domain-aware checklists, web research, retest loop, and prompt learning
argument-hint: "[addition.md | addition text...] <prompt.md> [prompt2.md...] [commit...] [file...]"
allowed-tools: Read, Write, Edit, Bash, Skill, WebSearch, WebFetch, Glob, Grep, AskUserQuestion
---

You are an expert code reviewer with auto-fix capability. Fix every finding — listing issues without fixing them is failure. Execute all steps in order.

Only ask the user if you genuinely cannot determine the correct fix. Never ask "should I continue?" or "shall I proceed?".

## Arguments

`$ARGUMENTS` is a space/quote-separated mix of:
- **Additions** (optional): extra instructions or change requests — free-form text, or a path to an instruction file (`.md`/`.txt`) containing them passed as its own argument preceding the prompt file token(s) (e.g. `@/prompts/{date}-{slug}/addition.md`). Each addition is logged to the prompt's `user-entry-log/`, integrated into the prompt file, AND implemented in code (Steps AMEND and IMPLEMENT). Pure review-focus text (e.g. "focus on the classifier feature extraction") only directs the review
- **Prompt files** (required, one or more): remaining tokens ending in `.md`
- **Commit refs** (optional): tokens matching `[0-9a-f]{7,40}`, `HEAD~N`, `HEAD^`, or ranges like `abc..def`
- **File paths** (optional): tokens containing `/` or ending in `.ts`, `.py`, `.json`

If no `.md` prompt files found in `$ARGUMENTS`, stop immediately with: `Error: at least one prompt .md file is required.`

## Step PARSE

Classify each token into: `additions[]`, `prompt_files[]`, `commits[]`, `files[]`.

- **`additions[]`**: a leading token that is a path to an existing `.md`/`.txt` instruction file and precedes the prompt file token(s) — its content is an addition; plus any free-form text that amends requirements rather than merely directing review priority. Pure review-focus text stays out of `additions[]` and only steers Steps REVIEW and AUGMENT.
- Tie-breakers: tokens matching the `files[]` patterns (`.ts`, `.py`, `.json`) are never additions, regardless of position. When multiple `.md` tokens are present, the leading one is an addition only if it is not itself a prompt file — when in doubt, read it: a change request is an addition; a structured prompt (the `{slug}.md` of a `prompts/{date}-{slug}/` folder) belongs in `prompt_files[]`.

## Step AMEND

Apply each addition as an amendment to the corresponding prompt file(s). This rewrites the prompt to incorporate the addition — not as an annotation but as corrected content. Run the two read bullets below even when `additions[]` is empty — the per-addition bullets then no-op:

- Read each prompt file in `prompt_files[]`
- Read every entry in each prompt's sibling `user-entry-log/` directory in numeric order — it is the durable, verbatim record of user intent for that prompt; later entries override earlier ones on conflict; legacy unnumbered entries (`entry-*`) precede all numbered ones
- For each item in `additions[]`:
  - Identify which prompt file it relates to (the one it names or topically matches; if none, the first in `prompt_files[]`)
  - Log the addition verbatim into the related prompt's sibling `user-entry-log/` — exactly one log, never duplicated — as the next numbered entry: two-digit sequence prefix plus descriptive kebab-case name (e.g., `05-fix-error-handling.md`, never an `entry-` prefix), continuing from the highest existing number (`01` if no numbered entries exist); create the directory if missing. **Move** addition files into the log exactly as-is — no headers, no modifications, no reformatting (`@/.claude/commands/meta/write-prompt.md` Step SAVE convention); save inline addition text verbatim the same way
  - Edit the prompt file with the minimum necessary change to integrate the addition into the section where it belongs — surgical Edit diffs, never a full rewrite
- After all amendments: re-read each modified prompt file to verify it is internally consistent

## Step IMPLEMENT

Execute every addition in code — integrating it into the prompt is not enough; the instructions themselves must be carried out:

- Derive the concrete work items each addition requires (features, fixes, config, content) from the addition and the amended prompt
- Implement them fully in the codebase, following the amended prompt's specs and the repo's conventions
- An addition is done only when the working code change exists — a prompt-only amendment is failure
- Track every file created or modified; these join the change set in Step COLLECT and are reviewed like any other change

## Step COLLECT

Build the unified change set:
- **Commits**: `git show --stat <ref>` then `git show <ref>` per commit ref
- **Explicit files**: read current content of each file path
- **Implemented additions**: every file created or modified in Step IMPLEMENT

Result: list of `(file_path, diff_or_null, current_content)`.

## Step CLASSIFY

Determine domain per file:

| Path pattern | Domain |
|---|---|
| `trafilatura-alpha/src/core/**/*.ts` | TypeScript (extraction core) |
| `trafilatura-alpha/src/metadata/**/*.ts` | TypeScript (metadata) |
| `trafilatura-alpha/src/classifier/**/*.ts` | TypeScript (ONNX classifier) |
| `trafilatura-alpha/src/profiles/**/*.ts` | TypeScript (page-type profiles) |
| `trafilatura-alpha/src/**/*.ts` | TypeScript (library) |
| `tools/live-crawl-tester/src/**/*.ts` | TypeScript (live-crawl tester) |
| `training/**/*.py` | Python (offline training) |

## Step RESEARCH

For each non-trivial pattern or API usage in the change set:
- **Repo grep**: search `trafilatura-alpha/`, `tools/`, and `training/` for existing usage — establishes convention vs. new introduction
- **SPEC.md / CLAUDE.md**: read the SPEC.md colocated with the changed package/tool (`trafilatura-alpha/SPEC.md`, `tools/live-crawl-tester/SPEC.md`, `training/SPEC.md`, and root `SPEC.md` for architecture changes); re-read relevant `.claude/rules/` files
- **Web fetch**: for unfamiliar library APIs (linkedom, parse5, htmlparser2, onnxruntime), fetch their official docs
- **Security**: WebSearch for CVEs or OWASP issues on security-adjacent patterns (untrusted HTML parsing, input handling)

## Step REVIEW

Run the native `/code-review` skill at `high` effort level (or `max` if an addition or focus text explicitly requests deeper coverage):
- With commit range: `code-review high <commit-range>`
- With single commit: `code-review high <commit-ref>`
- With no commits (explicit files, implemented additions, or current diff only): `code-review high`

If commits were parsed in Step PARSE, pass the first commit ref or range as the target. If only explicit files were provided, use the current diff (no target). If Step IMPLEMENT created or modified files, additionally run `code-review high` on the current diff (no target) and merge those findings into the baseline.

Collect the output findings. These are the baseline from the multi-agent review.

## Step AUGMENT

Apply the htmlwasher-specific checks below for each domain in the change set, in addition to the native review findings from Step REVIEW. Merge all findings into a single list before Step FIX.

Treat the additions and the `user-entry-log/` entries read in Step AMEND as authoritative spec: any code or prompt content contradicting the latest applicable entry is a `confident-fix` finding, and an addition not actually implemented in code (Step IMPLEMENT) is a `confident-fix` finding — implement it.

Classify each finding:

| Bucket | Description | Action |
|---|---|---|
| `auto-fix` | Obvious anti-patterns, missing `import type` | Fix immediately |
| `confident-fix` | Clear Critical/Warning with unambiguous correct form | Fix immediately |
| `best-judgment` | Architectural tradeoffs, behavior-changing changes | Fix immediately — never ask the user |
| `info` | Minor suggestions with no clear correct form | Record in report only |

### TypeScript checks

- No `any` types — use `unknown` and narrow before use
- No `// @ts-ignore` — use `// @ts-expect-error: <reason>` with a real reason
- No `as SomeType` casts without an accompanying type guard
- `import type` for all type-only imports — check re-exports specifically
- No floating promises — every async call is awaited or explicitly handed off
- No `console.log` in production library paths — the library must not emit to stdout/stderr by default
- DOM parsing stays behind the established interface — `linkedom` + `parse5` for full-document work, `htmlparser2` only in the classifier feature hot-path; do not introduce a new parser
- ONNX inference goes through the single runtime interface that wraps `onnxruntime-node` (default) and `onnxruntime-web` (WASM) — do not import a runtime directly in feature/profile code

### Python checks (training/)

- Type hints on every public function; no bare `except:` — catch the specific exception
- No mutable default arguments
- Pin no logic into module import side effects — training entry points run under a `if __name__ == "__main__"` guard or a CLI function
- The training project is offline-only and uv-managed — it must never be imported by or shipped with the TypeScript runtime
- Model export writes `model.onnx` + `tfidf-vocab.json`; keep the export reproducible (fixed random seeds where applicable)

### Security checks

- No `eval()`, `Function(...)`, or unsafe template injection of scraped/parsed HTML — treat all fetched content as untrusted
- No secrets or tokens in log messages
- Validate at every input boundary before use; sanitize parsed DOM nodes before any downstream interpolation
- The live-crawl tester must stay polite: respect robots.txt, honor the rate limiter, and use the disk cache — never bypass them

## Step FIX

Apply all `auto-fix`, `confident-fix`, and `best-judgment` findings using the Edit tool.
Priority: security → correctness → type safety → architecture → style.
Minimal, targeted diffs — preserve unrelated code and formatting.

## Step VERIFY

Always run — even if no findings:

```bash
pnpm build
pnpm lint
```

If a Python file under `training/` was part of the change set, additionally run its lint/type checks (e.g. `uvx ruff check training` and the project's type checker).

If any check fails: fix the issue (never add `any` or `@ts-ignore` to silence it), re-run until every command exits 0. Do not proceed to RETEST until all pass.

## Step RETEST

Always run:
- Read each prompt file in `prompt_files[]` fully
- Extract every section whose heading contains: `Verify`, `Self-Verification`, `Tests`, `Check`, `Auto-fix loop`, `Verification`
- Also collect every inline shell command (lines containing `pnpm`, `vitest`, `biome`, `pytest`, `uv`)
- Run ALL collected commands in order, including `pytest training` if Python under `training/` changed
- For any failure: apply fix, re-run until it passes

## Step LEARN

Always run last.

**Primary — fix the prompt files.** For each prompt in `prompt_files[]`:
- Missing verification steps that would have caught a finding → add them
- Vague or incomplete specs that caused ambiguity → clarify
- Outdated commands or wrong assumptions → correct

Use Edit tool directly on the prompt files.

**Secondary — update the active work prompt.** After fixing code, identify and update the prompt that describes the work being reviewed:
- Get current branch: `git rev-parse --abbrev-ref HEAD`
- List prompts: `find prompts/ -name "*.md" -maxdepth 3 2>/dev/null | head -10`
- Match: compare branch name keywords and recent commit messages against prompt directory names; pick the best match
- If matched: read the prompt, then update it to mark completed steps as `[DONE]`, update the "Current State" section if one exists, and add any new patterns or constraints discovered during this review
- Also update the relevant `SPEC.md` for any package or tool whose source files were modified this session (`trafilatura-alpha/SPEC.md`, `tools/live-crawl-tester/SPEC.md`, `training/SPEC.md`, or root `SPEC.md` for architecture changes) — check if the exported API, types, or entry points changed

**Tertiary — fix this command.** Extract repo-specific patterns (not generic best-practices) and integrate into `## Project-Specific Checks` below. Only edit if a genuinely new project-specific pattern emerged.

## Step REPORT

Save to `temp/code-review-autofix-report.md`:
- Date, additions received, and files reviewed
- Every fix applied (file path, line, bucket, what changed) — including AMEND step prompt edits and Step IMPLEMENT changes
- `info` findings not auto-fixed

Print brief summary: N files fixed, top issues, `info` items needing manual attention.

## Project-Specific Checks

Project conventions accumulated from past reviews. Apply in Step AUGMENT alongside the domain checks above.

This section starts lean and accumulates as reviews surface durable, repo-specific patterns. Add a new subsection only when a genuinely htmlwasher-specific invariant emerges — never generic best-practice advice (those live in Step AUGMENT's domain checks).

### Trafilatura port fidelity
- htmlwasher is a faithful TypeScript port of Trafilatura — when porting behavior, match the reference implementations in `sources/` (adbar `trafilatura`, `go-trafilatura`, `trafilatura-rs`, `rs-trafilatura`); never invent extraction heuristics that diverge from upstream without an explicit reason
- `sources/` repos are READ-ONLY reference inputs (gitignored) — never edit them and never import from them at runtime

### DOM and parser boundary
- `linkedom` + `parse5` handle full-document parsing; `htmlparser2` is reserved for the classifier feature hot-path. Do not introduce a new DOM/HTML parser or move `htmlparser2` outside the classifier
- Treat all parsed HTML as untrusted — sanitize node content before any downstream interpolation

### ONNX runtime interface
- All inference goes through the single runtime interface wrapping `onnxruntime-node` (default) and `onnxruntime-web` (WASM); feature and profile code must not import a runtime package directly
- The model artifacts (`model.onnx`, `tfidf-vocab.json`) are produced by the offline `training/` project and consumed at runtime — keep the loading path tolerant of a missing/optional model

### Workspace boundaries
- `training/` is offline-only, Python, uv-managed, and NOT a pnpm workspace package — it must never be imported by or shipped with the TypeScript library
- `tools/live-crawl-tester/` is a separate TS workspace package and a polite live fetcher (robots.txt, rate limit, disk cache) — it is not Crawlee/Playwright; keep its politeness guarantees intact

### Import hygiene
- `import type` for every import that carries no runtime value
- Re-export files (`index.ts`) are a common source of missing `import type` — check them specifically

### Dead-code (knip) scope
- knip ignores `prompts/**` (one-shot research/diagnostic artifacts that nothing imports) — fix knip "unused file" hits on research artifacts by extending the `ignore` list, never by deleting committed evidence
