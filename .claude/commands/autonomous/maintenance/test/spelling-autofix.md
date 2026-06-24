---
description: Check and fix typos and grammar errors in source files and documentation
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
skills: autonomous-task
---

Check all source files and documentation for typos and grammar errors, and fix them. Save a report to `autonomous-task-output/{agent}/`.

## Step BOOTSTRAP: Verify Configuration

Check that `cspell.json` exists at the repo root:

```bash
test -f cspell.json && echo "OK" || echo "MISSING"
```

If `cspell.json` is missing, write an error to `autonomous-task-output/{agent}/reports/test-spelling-autofix-report.md` explaining that `cspell.json` must exist before running this command, and exit. Do not run cspell without configuration — it will produce 100% false positives.

### cspell runner

cspell needs Node ≥22.18.0. If the global Node is too old, run cspell's JS entry directly with a newer Node on PATH; otherwise `npx cspell` works:

```bash
CSPELL=(npx cspell)
```

Use `"${CSPELL[@]}"` in place of bare `cspell` in the commands below (recompute `CSPELL` in each Bash call — shell vars don't persist across calls). cspell scans the repo paths in the commands below; it must not descend into `sources/` (read-only reference repos) — ensure `cspell.json` ignores `sources/`, `node_modules/`, and `dist/`.

## Step COUNT: Count Flagged Words

```bash
"${CSPELL[@]}" lint "**/*.ts" "**/*.py" "**/*.md" "**/*.json" "**/*.toml" --no-progress --words-only --unique --dot 2>/dev/null | sort -u | wc -l
```

If the count is 0, skip to Step REPORT.

## Step REVIEW: Review Flagged Words

Run to get the full list:

```bash
"${CSPELL[@]}" lint "**/*.ts" "**/*.py" "**/*.md" "**/*.json" "**/*.toml" --no-progress --dot 2>/dev/null
```

For each flagged word, determine the correct action:
- **Genuine prose typo** — fix the word in-place
- **Valid domain term not yet in config** — add to `words` in `cspell.json`
- **External identifier or proper noun** — add to `ignoreWords` in `cspell.json`

Do NOT change:
- Technical identifiers (variable names, function names, package names)
- Intentional abbreviations in code
- Words in test fixtures or HTML files

## Step FIX: Apply Fixes

Apply in-place edits for genuine typos. Record each fix: file path, line number, original word, corrected word.

Update `cspell.json` with any new `words` or `ignoreWords` entries identified in Step REVIEW.

## Step REPORT: Save Report

Save `autonomous-task-output/{agent}/reports/test-spelling-autofix-report.md` with:
- Files scanned
- Unique flagged words before and after fix
- Words added to `cspell.json words`
- Words added to `cspell.json ignoreWords`
- Genuine typos fixed (file, line, original → corrected)
- Words deferred for human review (if any)
