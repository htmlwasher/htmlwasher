#!/usr/bin/env bash
# Stop hook — blocks turn completion when source files were edited but documentation was not updated.
# Enforces: correct per-package SPEC.md + README.md for public API surface changes.
# Fires once per turn; stop_hook_active=true on the re-entry prevents an infinite loop.
set -euo pipefail

input=$(cat)

# Loop guard: when Claude re-enters after a block, stop_hook_active is true — let it finish.
if echo "$input" | jq -e '.stop_hook_active == true' > /dev/null 2>&1; then
  exit 0
fi

# Extract file paths from all Write and Edit calls made this turn.
transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')
edited=""
if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
  last_user_line=$(jq -r 'if .role == "user" then input_line_number else empty end' \
    "$transcript_path" 2>/dev/null | tail -1 || true)
  if [[ -n "$last_user_line" ]]; then
    edited=$(awk "NR > ${last_user_line}" "$transcript_path" | jq -r '
      select(.role == "assistant") |
      .content[]? |
      select(.type == "tool_use") |
      select(.name == "Write" or .name == "Edit") |
      .input.file_path // empty
    ' 2>/dev/null || true)
  fi
fi

spec_files=$(printf '%s\n' "$edited" | grep 'SPEC\.md$' || true)
readme_files=$(printf '%s\n' "$edited" | grep 'README\.md$' || true)

# Map each edited source file to the SPEC.md it requires.
# Flag public API surface files that also require README updates.
required_specs=""
api_surface_changed=false

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  case "$f" in
    */trafilatura-alpha/src/*)
      required_specs+=$'\n'"trafilatura-alpha/SPEC.md"
      [[ "$f" == */index.ts ]] && api_surface_changed=true ;;
    */tools/live-crawl-tester/src/*)
      required_specs+=$'\n'"tools/live-crawl-tester/SPEC.md" ;;
    */training/*.py)
      required_specs+=$'\n'"training/SPEC.md" ;;
  esac
done < <(printf '%s\n' "$edited" | grep -E '\.(ts|py)$' | grep -v 'SPEC\.md' || true)

# Deduplicate.
required_specs=$(printf '%s\n' "$required_specs" | sort -u | grep -v '^$' || true)

# --- Check 1: SPEC.md per-package ---
missing_specs=""
if [[ -n "$required_specs" ]]; then
  while IFS= read -r spec; do
    if ! printf '%s\n' "$spec_files" | grep -qF "$spec"; then
      missing_specs+=" $spec"
    fi
  done <<< "$required_specs"
fi

# --- Check 2: README.md for public API surface changes ---
missing_readme=""
if [[ "$api_surface_changed" == true && -z "$readme_files" ]]; then
  missing_readme=" README.md"
fi

# Build block message if anything is missing.
if [[ -n "$missing_specs" || -n "$missing_readme" ]]; then
  msg="Documentation was not updated after source changes."

  if [[ -n "$missing_specs" ]]; then
    list="${missing_specs# }"
    list="${list// /, }"
    msg+=" Missing SPEC.md: $list."
  fi

  if [[ -n "$missing_readme" ]]; then
    msg+=" Public API surface changed — update the package README.md."
  fi

  msg+=" See .claude/rules/spec-maintenance.md."
  printf '{"decision":"block","reason":"%s"}' "$msg"
  exit 0
fi

exit 0
