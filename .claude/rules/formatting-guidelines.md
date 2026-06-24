# Claude Code Prompt Formatting Guidelines

Standard formatting conventions for all Claude Code prompts (agents, commands, rules, skills, and general prompts).

## Header Formatting

Use `#`, `##`, `###`, etc. markdown headers consistently throughout prompts. Do not use just `**strongly named subsection**`.

Headers should be actual markdown headers (`##` or `###`), not bold text or emoji-enhanced bold text masquerading as headers. Use simple header text like "### Correct" and "### Incorrect" for subsections instead of bold text with emojis.

## Code Block Usage

Use triple backticks (```) only for actual code blocks, bash commands, and file structure examples.

Avoid wrapping markdown checklists, plain text sections, or regular lists in code blocks. Use bullet points for lists instead.

## List Formatting

Use bullet points (`-`) for lists. Never use numbered lists or pipe separators.

## Headers Without Numbering

Never use numbers in any headers.

Use named steps e.g. `Step ANALYZE` if you need to give steps ids. Name steps, phases, sections by descriptive names. **Never use numbers in headers or bullets.**

### Correct

```markdown
## Implementation Steps

### Step ANALYZE: Audit Current Configuration
- Check for configuration files
- Review dependencies

### Step FETCH: Fetch Latest Documentation
- Query MCP server
- Review best practices
```

### Incorrect

```markdown
## Implementation Steps

### Step 1. Audit Current Configuration
- 1. Check for configuration files
- 2. Review dependencies

### Step 2. Fetch Latest Documentation
- 1. Query MCP server
- 2. Review best practices
```

**Why**: Numbered headers and bullets create maintenance overhead when steps are added/removed/reordered. Descriptive names are clearer and more maintainable.

## Structure Guidelines

Keep prompts compact and scannable:
- Use clear section headers
- Group related content logically
- Avoid excessive nesting
- Remove redundant information
- Use unnumbered bullet points for readability

## Check Spelling

Do not place typos from a source prompt into the prompt being built. Also check misspelled names of frameworks, programming languages, online tools, products, etc. for typos and proper casing. If you do not know, browse the official website or Wikipedia to determine the proper name.
