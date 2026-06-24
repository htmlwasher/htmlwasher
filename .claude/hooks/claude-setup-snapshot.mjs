#!/usr/bin/env node
/**
 * SessionStart hook: surface a compact inventory of this repo's Claude Code
 * setup plus an audit-staleness line. SessionStart stdout is injected into
 * context, so every session starts aware of what's wired up and when the config
 * was last reviewed against the docs.
 *
 * The deterministic "surface" half of the self-improving loop; the reasoning
 * half is the `claude-setup-auditor` skill. Always exits 0 (informational).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root =
  process.env.CLAUDE_PROJECT_DIR || fileURLToPath(new URL("../../", import.meta.url));
const claude = join(root, ".claude");

function walk(dir, test) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try { isDir = statSync(p).isDirectory(); } catch { isDir = false; }
    }
    if (isDir) n += walk(p, test);
    else if (test(e.name)) n += 1;
  }
  return n;
}
const md = (sub) => walk(join(claude, sub), (f) => f.endsWith(".md"));
const skills = walk(join(claude, "skills"), (f) => f === "SKILL.md");

let mcp = [];
try { mcp = Object.keys(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers ?? {}); } catch {}
let hooks = [];
try { hooks = Object.keys(JSON.parse(readFileSync(join(claude, "settings.json"), "utf8")).hooks ?? {}); } catch {}

let audit = "never — run /claude-setup-auditor";
try {
  const a = JSON.parse(readFileSync(join(claude, ".last-audit.json"), "utf8"));
  const days = Math.floor((Date.now() - new Date(a.date + "T00:00:00Z").getTime()) / 86_400_000);
  audit = `${a.date} (${days}d ago)` + (days > 30 ? " — STALE, run /claude-setup-auditor" : "");
} catch {}

process.stdout.write(
  `claude-setup snapshot (${basename(root)}):\n` +
    `  skills:${skills} commands:${md("commands")} agents:${md("agents")} ` +
    `rules:${md("rules")} mcp:${mcp.length} hooks:[${hooks.join(",")}]\n` +
    `  last audit: ${audit}\n`,
);
