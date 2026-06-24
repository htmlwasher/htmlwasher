---
description: Delete agent/skill/command/rule and remove all references across repo
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
argument-hint: <path to .md file in .claude/>
---

# Delete Claude Code Configuration

Safely delete an agent, skill, command, or rule and clean up all references.

## Input

`$ARGUMENTS` = path to .md file (e.g., `.claude/agents/old-agent.md`)

## Process

- **Validate target exists**
  ```bash
  test -f "$ARGUMENTS" || echo "File not found"
  ```

- **Extract identifier**
  - Agent: `name:` from frontmatter
  - Skill: directory name or `name:` from frontmatter
  - Command: filename without extension
  - Rule: filename without extension

- **Find all references** (search all .md files)
  ```bash
  rg -l "<identifier>" --glob "*.md" .
  rg -l "<filename>" --glob "*.md" .
  rg -l "<path>" --glob "*.md" .
  ```

- **Show references for confirmation**
  - List all files containing references
  - Show context snippets
  - Ask user to confirm deletion

- **Remove references**
  - Edit each file to remove/comment out references
  - Handle: `skills:` lists, CLAUDE.md mentions, agent descriptions, imports

- **Delete the file**
  ```bash
  rm "$ARGUMENTS"
  ```

- **Clean up empty directories**
  ```bash
  find .claude -type d -empty -delete
  ```

## Reference Patterns to Search

| Type | Patterns |
|------|----------|
| Agent | `@agent-<name>`, `agents/<name>`, `name` in skills: field |
| Skill | `skills/<name>`, `skills: ...<name>...`, skill directory references |
| Command | `/<command-name>`, `commands/<category>/<name>` |
| Rule | `rules/<name>`, rule file references |

## Output

- List of removed references with file locations
- Confirmation of file deletion
- Any manual cleanup needed
