---
description: Fix the false "Usage credits required for 1M context" error on Claude Max by repairing the stale s1mAccessCache
allowed-tools: Bash, Read
model: haiku
---

# Fix 1M Context Error

Repair the local cache that triggers a false `API Error: Usage credits required for 1M context · run /usage-credits to turn them on, or /model to switch to standard context` on a Claude **Max** plan.

Max includes Opus 1M context at no extra cost (GA 2026-03-13). The error is a known Claude Code client-side bug: a stale `s1mAccessCache` entry in `~/.claude.json` with `hasAccess: false` (written before Opus 1M GA and never refetched) makes Claude Code gate the 1M model even though the server grants access. This command sets that entry to `true` with a fresh timestamp.

Only Opus 1M is free on Max — Sonnet at 1M genuinely requires usage credits, so this fix targets the Opus case.

## Step BACKUP: Back Up Config

- Copy `~/.claude.json` to `~/.claude.json.bak.1m-fix.<unix-seconds>` so the change is reversible.
- Warn (do not abort) if Claude Code is running (`pgrep -x claude`): a live session can overwrite `~/.claude.json` from stale in-memory state on exit, so the user should quit Claude Code, re-run this command, and relaunch for the fix to stick.

## Step PATCH: Repair s1mAccessCache

Run a single atomic Python patch over `~/.claude.json`:

- Read `oauthAccount.organizationUuid` as the org key (do not hardcode a UUID).
- Set `s1mAccessCache[org] = {"hasAccess": true, "hasAccessNotAsDefault": false, "timestamp": <now_ms>}`.
- Write to a temp file in the same directory with `json.dump(..., indent=2)` (match the existing 2-space style), then `os.replace` onto `~/.claude.json` for an atomic swap.
- Print the before and after value of the patched entry.

```bash
python3 - <<'PY'
import json, os, time, tempfile
p = os.path.expanduser('~/.claude.json')
d = json.load(open(p))
org = d.get('oauthAccount', {}).get('organizationUuid')
if not org:
    raise SystemExit('no oauthAccount.organizationUuid found — run `claude login` first')
before = json.dumps(d.get('s1mAccessCache', {}).get(org))
d.setdefault('s1mAccessCache', {})[org] = {
    "hasAccess": True, "hasAccessNotAsDefault": False, "timestamp": int(time.time()*1000)
}
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix='.claude.json.', suffix='.tmp')
with os.fdopen(fd, 'w') as f:
    json.dump(d, f, indent=2)
os.replace(tmp, p)
print('org:', org)
print('before:', before)
print('after :', json.dumps(d['s1mAccessCache'][org]))
PY
```

## Step VERIFY: Confirm Integrity And 1M Access

- Reload `~/.claude.json` and confirm it is valid JSON and no top-level keys were lost versus the backup.
- Run a fresh headless Opus 1M request to confirm the server grants access and the error is gone. Wrap it in a watchdog so it cannot hang:

```bash
set +e
( claude -p "Reply with exactly: ONE_MILLION_OK" --model 'claude-opus-4-8[1m]' ) > /tmp/1m_verify.out 2> /tmp/1m_verify.err &
PID=$!; ( sleep 90; kill -9 $PID 2>/dev/null ) & WATCH=$!
wait $PID; CODE=$?; kill $WATCH 2>/dev/null
echo "exit: $CODE"; echo "out: $(cat /tmp/1m_verify.out)"; echo "err: $(cat /tmp/1m_verify.err)"
```

- Exit 0 with `ONE_MILLION_OK` and empty stderr confirms 1M works. A non-zero exit or a usage-credits error means the cache fix alone was not enough — report the fallback order below.

## Step REPORT: Summarize

State the org UUID, the before/after cache value, the backup path, and the verification result. If the headless check still failed, give the fallback order:

- Quit Claude Code fully, re-run this command (a live session may have clobbered the edit), relaunch.
- `claude logout && claude login` to refetch entitlement.
- Toggle usage credits at https://claude.ai/settings/usage.
- Contact support to clear a stuck server-side `org_level_disabled` flag (Claude Code issues #47019, #46780).
