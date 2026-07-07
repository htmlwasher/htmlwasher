#!/usr/bin/env bash
# Stop hook — blocks turn completion when:
#   1. TypeScript source files were edited but no test files were updated, OR
#   2. Rust native-crate source files were edited but no Rust tests were updated, OR
#   3. Test files were edited but the tests fail when run.
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

# TypeScript source files in the TS package roots (not test files, not declaration files).
ts_source=$(printf '%s\n' "$edited" | \
  grep -E '/src/.+\.ts$' | \
  grep -E '/packages/(htmlwasher|live-crawl-tester)/src/' | \
  grep -v '\.test\.ts$' | \
  grep -v '\.d\.ts$' || true)

# Any .test.ts file edited this turn.
ts_tests=$(printf '%s\n' "$edited" | grep '\.test\.ts$' || true)

# Check 1: source changed without test updates.
if [[ -n "$ts_source" && -z "$ts_tests" ]]; then
  files=$(printf '%s\n' "$ts_source" | sed -E 's|.*/packages/(htmlwasher\|live-crawl-tester)/|packages/\1/|' | head -3 | tr '\n' ' ' | sed 's/ $//')
  msg="Source changed without test updates ($files). Add or update the corresponding *.test.ts file in the same response. See .claude/rules/test-maintenance.md."
  printf '{"decision":"block","reason":"%s"}' "$msg"
  exit 0
fi

# Rust source files in the native crate (packages/htmlwasher/native/src/**).
rs_source=$(printf '%s\n' "$edited" | \
  grep -E '/packages/htmlwasher/native/src/.+\.rs$' || true)

# A Rust test change: an edited file under native/tests/, or an edited native/src file
# that itself carries a #[cfg(test)] mod (inline unit tests edited alongside the code).
rs_tests=$(printf '%s\n' "$edited" | grep -E '/packages/htmlwasher/native/tests/.+\.rs$' || true)
if [[ -n "$rs_source" && -z "$rs_tests" ]]; then
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if [[ -f "$f" ]] && grep -q '#\[cfg(test)\]' "$f"; then
      rs_tests="$f"
      break
    fi
  done < <(printf '%s\n' "$rs_source")
fi

# Check 2: Rust source changed without Rust test updates.
if [[ -n "$rs_source" && -z "$rs_tests" ]]; then
  files=$(printf '%s\n' "$rs_source" | sed -E 's|.*/packages/htmlwasher/native/|packages/htmlwasher/native/|' | head -3 | tr '\n' ' ' | sed 's/ $//')
  msg="Rust source changed without test updates ($files). Add or update a #[cfg(test)] mod or a packages/htmlwasher/native/tests/ test in the same response. See .claude/rules/test-maintenance.md."
  printf '{"decision":"block","reason":"%s"}' "$msg"
  exit 0
fi

# Check 3: test files were edited — run them to verify they pass.
if [[ -n "$ts_tests" ]]; then
  # Resolve the package name for each edited test file via the nearest package.json.
  pkgs=""
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    dir=$(dirname "$f")
    while [[ "$dir" != "/" && "$dir" != "$CLAUDE_PROJECT_DIR" ]]; do
      if [[ -f "$dir/package.json" ]]; then
        name=$(jq -r '.name // empty' "$dir/package.json" 2>/dev/null || true)
        [[ -n "$name" ]] && pkgs+=$'\n'"$name"
        break
      fi
      dir=$(dirname "$dir")
    done
  done < <(printf '%s\n' "$ts_tests")

  pkgs=$(printf '%s\n' "$pkgs" | sort -u | grep -v '^$' || true)

  if [[ -n "$pkgs" ]]; then
    filter_args=()
    while IFS= read -r pkg; do
      filter_args+=(--filter "$pkg")
    done <<< "$pkgs"

    if ! output=$(cd "$CLAUDE_PROJECT_DIR" && pnpm "${filter_args[@]}" test 2>&1); then
      printf '%s' "$output" | tail -c 4000 | jq -Rcs \
        '{"decision":"block","reason":("Tests failed. Fix failures before completing this turn.\n\n" + .)}'
      exit 0
    fi
  fi
fi

exit 0
