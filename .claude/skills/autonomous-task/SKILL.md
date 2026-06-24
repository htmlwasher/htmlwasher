---
name: autonomous-task
description: Execute tasks end-to-end without user interaction, saving reports and prompts for decisions. Use when running unattended workflows that should complete every subtask they can and defer the rest to a follow-up file.
---

# Autonomous Task

Execute assigned tasks autonomously without user interaction. Save structured output for later review.

## Output Directory

Determine `{agent}` from the AI tool running this command:
- Claude Code → `claude`
- Any other tool → use the tool's lowercase name

All output goes to `autonomous-task-output/{agent}/` at the repo root:
- Reports → `autonomous-task-output/{agent}/reports/`
- Deferred prompts → `autonomous-task-output/{agent}/prompts/`

## Behavior

- Execute the assigned task end-to-end without asking the user any questions
- Save a report to `autonomous-task-output/{agent}/reports/{taskName}-report.md` (relative to repo root)
- The report must include: task name, timestamp, findings, actions taken, and summary

## Handling Decisions

If a subtask requires user interaction or a decision that cannot be made autonomously:

- Do NOT ask the user — do not use `AskUserQuestion`
- Create a prompt file at `autonomous-task-output/{agent}/prompts/{taskName}-prompt.md` describing:
  - Which subtask needs a decision
  - What the options are
  - What context is needed to decide
- Continue with all remaining subtasks that can be completed autonomously
- Note the deferred decision in the report

## Report Format

```markdown
# {Task Name} Report

**Date**: {ISO timestamp}
**Scope**: {what was checked/fixed}

## Findings

{table or list of issues found}

## Actions Taken

{what was fixed, with file paths and descriptions}

## Deferred Decisions

{any subtasks that need user input, or "None"}

## Summary

{counts: issues found, fixed, remaining}
```

## Gitignore

`autonomous-task-output/` is gitignored at the repo root. The directory and agent subdirectories are created automatically on first write.
