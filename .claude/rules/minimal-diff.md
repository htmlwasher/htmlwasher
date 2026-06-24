# Minimal Git Diff Guidelines

Make only necessary changes. Preserve everything else exactly.

## Tool Selection

**Always use Edit tool** for existing files:
- Surgical, targeted changes
- Preserves exact formatting
- Minimal diffs
- Shows only what changed

**Never use Write tool** on existing files (unless doing a complete intentional rewrite):
- Replaces entire file
- Creates massive diffs
- Makes review impossible

## Edit Tool Best Practices

**Provide unique context:**
- Include surrounding text to make `old_string` unique
- Match exact spacing and line breaks
- Include whitespace exactly

**Preserve formatting:**
- Match indentation (spaces vs tabs)
- Keep line break patterns
- Preserve blank lines
- Maintain markdown structure

## What NOT to Change

**Formatting:**
- Line breaks
- Blank lines
- Indentation
- Whitespace
- Markdown style choices

**Content:**
- Existing wording (unless necessary)
- Sentence structure
- Paragraph breaks
- Section order (unless requested)

**Markdown style:**
- List markers (-, *, +, 1.)
- Emphasis style (** vs __)
- Code fences (``` vs ~~~)
- Link style

## Making Changes

**Insert new section:**
```markdown
old_string: "## Existing\n\nContent."
new_string: "## Existing\n\nContent.\n\n## New\n\nNew content."
```

**Append to section:**
```markdown
old_string: "Last paragraph."
new_string: "Last paragraph.\n\nNew paragraph."
```

**Fix error:**
```markdown
old_string: "incorrect spelling"
new_string: "incorrect spelling"
```

**Remove section:**
```markdown
old_string: "before\n\n## Remove\n\nContent.\n\nafter"
new_string: "before\n\nafter"
```

## Success Criteria

- Git diff shows only necessary changes
- No reformatting of unchanged content
- Easy to review
- Original structure preserved
