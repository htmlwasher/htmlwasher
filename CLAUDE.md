# htmlwasher — htmlwasher

htmlwasher hosts **`htmlwasher`**, a faithful **TypeScript port of [Trafilatura](https://github.com/adbar/trafilatura)** with page-type-aware extraction and an ONNX page-type classifier. It extracts a page's main content — clean text plus structured metadata (title, author, date, sitename, tags) — and classifies the page into one of 7 page types (article, forum, product, collection, listing, documentation, service) to route extraction through a type-specific profile. Alongside the library, this repo holds an offline Python `training/` pipeline (XGBoost → ONNX) and the offline `tools/wash-corpus-tester/` end-to-end fixture harness (the brief's Phase 8 deliverable). It is a **content-extraction library for Node.js — not a scraper, not a browser-automation crawler, not an Apify Actor.**

## Project Structure

```
htmlwasher/         # the TypeScript library (npm package `htmlwasher`, alpha)
                           #   src/{core,metadata,classifier/{features,model},profiles}, test/, fixtures/
training/                  # OFFLINE Python project (3.12+, uv-managed): trains XGBoost from the
                           #   WCXB dataset, exports model.onnx + tfidf-vocab.json. Not a pnpm
                           #   workspace package; not shipped at runtime.
tools/
├── wash-corpus-tester/    # THE offline E2E tester (brief Phase 8 / §7): runs wash() over saved HTML
│                          #   fixtures across the 7 page types; reports PASS/FAIL; no network; in `pnpm test`.
└── live-crawl-tester/     # OUT-OF-BRIEF, OPTIONAL, UNIMPLEMENTED scaffold stub (index.ts only logs
                           #   "not yet implemented"). Would hit the network, so NOT in offline `pnpm test`.
# (the six READ-ONLY reference repos are cloned OUTSIDE this repo into ~/r/htmlwasher-sources/, by clone-other-repos.sh)
prompts/2026-6-24-init/    # build brief (prompt.md) + research context docs — do not modify
```

## Current status

The phased port (Phases 0–8 of [`@/prompts/2026-6-24-init/prompt.md`](@/prompts/2026-6-24-init/prompt.md)) is **implemented**. `htmlwasher` exposes the public async `wash()` composing the boilerplate-removal core (Trafilatura-derived extraction + the trained ONNX page-type classifier + per-type profiles), the metadata sidecar, and the five HTML-washing levels. `training/` trains the classifier from WCXB and exports `model.onnx` + `tfidf-vocab.json`; `tools/wash-corpus-tester/` is the offline E2E tester. The TS↔Python feature extractor is at 100% parity; extraction scores F1 ≈ 0.79 on the adbar eval corpus, the classifier ~0.78 on the held-out WCXB test split. See [`@/PORTING-NOTES.md`](@/PORTING-NOTES.md) for the port map, per-phase notes, and known gaps, and each package's `SPEC.md` for the current API. Alpha — APIs may still change.

## Commands

```bash
pnpm fix               # Biome check --fix --unsafe + format, then markdownlint --fix + Prettier on Markdown
pnpm build             # `pnpm fix`, then build all TS packages via turbo
pnpm test              # All vitest tests via turbo (offline; incl. the offline wash-corpus-tester E2E)
pnpm lint              # Biome check + markdownlint + Prettier --check on Markdown (read-only)
pnpm lint:md           # Markdown only: markdownlint + Prettier --check
pnpm fix:md            # Markdown only: markdownlint --fix + Prettier --write (Biome owns JS/TS/JSON)
pnpm clone-sources     # `bash clone-other-repos.sh` — fetch the six read-only reference repos into ~/r/htmlwasher-sources/
npx cspell "**/*.md"   # Spell check (cspell dictionaries: bash, en-gb, git, rust)
npx knip               # Dead-code: unused exports/files/deps (config in knip.json)
# Offline Python training (run from training/):
uv sync                # Create/refresh the uv-managed venv
uv run pytest          # Run training unit tests
uvx ruff check .       # Lint Python
uvx ruff format .      # Format Python
```

Biome owns JS/TS/JSON lint+format; Prettier + markdownlint-cli2 own Markdown; cspell owns spelling; knip owns dead-code. Lockfiles (`pnpm-lock.yaml`) are gitignored by repo convention — use plain `pnpm install`, never a frozen/CI install.

## Local Prerequisites

- **Node 22+**, **pnpm 10+** — the library and the offline `tools/wash-corpus-tester/`
- **Python 3.12+ with [uv](https://docs.astral.sh/uv/)** — only for the offline `training/` pipeline
- **git** — to clone the six read-only reference repos into `~/r/htmlwasher-sources/`
- **No Rust toolchain is required to build htmlwasher.** Rust appears only as read-only reference under `~/r/htmlwasher-sources/` (never built here); `rust-analyzer` is enabled solely to READ those references.

## Reference sources are read-only (external)

The reference repos live at **`~/r/htmlwasher-sources/`** — an external sibling directory **outside** this repo (NOT inside it, NOT committed), cloned by `@/clone-other-repos.sh`. **Never edit them.** They define the port's behavior by an authority hierarchy:

- **`rs-trafilatura` + `web-page-classifier`** define **WHAT** to build (the divergent fork with ML page-typing — the primary port target).
- **`go-trafilatura` + `adbar/trafilatura`** define **HOW extraction should behave** — defer to these when rs-trafilatura is thin or ambiguous.
- **`trafilatura-rs`** is the cross-check / tiebreaker.
- **`readability`** is a TypeScript/DOM idiom reference only (not extraction behavior).

## TypeScript LSP

The `typescript-lsp@claude-plugins-official` plugin wires `typescript-language-server` into the built-in `LSP` tool — go-to-definition, find-all-references, hover types, and real-time diagnostics across `.ts`/`.tsx`/`.js`/`.jsx`. Python (`pyright-lsp`) and Rust (`rust-analyzer-lsp`) are also enabled — pyright for the `training/` Python, rust-analyzer to READ the Rust references under `~/r/htmlwasher-sources/`.

- Use `Grep`/`Glob` for **discovery** (finding files, searching patterns)
- Use `LSP` for **understanding** (definitions, references, type errors) — prefer it over reading whole files
- `ENABLE_LSP_TOOL=1` is set in `.claude/settings.json`; the LSP tool auto-approves (no `permissions.allow` entry needed)

## Rules

Rules under `.claude/rules/` auto-load by reference; the SessionStart snapshot prints counts. All kept rules:

- [Formatting guidelines](@/.claude/rules/formatting-guidelines.md) — markdown headers, "Step NAME" steps (no numbers), `-` bullets, no emoji-bold headers
- [JSON config only](@/.claude/rules/json-config-only.md) — document config files as JSON, never YAML
- [Memory promotion](@/.claude/rules/memory-promotion.md) — promote durable repo-level facts from memory into CLAUDE.md/rules in the same session; personal preferences stay in memory
- [Minimal diff](@/.claude/rules/minimal-diff.md) — change only what the task requires; Edit over Write on existing files
- [No confirmation prompts](@/.claude/rules/no-confirmation-prompts.md) — execute requested tasks immediately; never ask "shall I proceed?"
- [Path notation](@/.claude/rules/path-notation.md) — use `@/` repo-relative paths in prompts/configs, never absolute filesystem paths
- [Preserve TODOs](@/.claude/rules/preserve-todos.md) — never delete a TODO unless the fix directly resolves it
- [Prompt engineering knowledge](@/.claude/rules/prompt-engineering-knowledge.md) — shared conventions for authoring agents/commands/rules/skills
- [Rule coverage](@/.claude/rules/rule-coverage.md) — every rule must be referenced in CLAUDE.md, an agent, or a command (this list satisfies it)
- [Security](@/.claude/rules/security.md) — untrusted HTML, no secrets in logs, validate input at every boundary
- [Self-improving prompts](@/.claude/rules/self-improving-prompts.md) — after a command/skill/agent runs, fold durable learnings back into the prompt (in-body Step LEARN, not a PostToolUse hook)
- [Spec maintenance](@/.claude/rules/spec-maintenance.md) — keep SPEC.md files in sync with code in the same response
- [Task completion](@/.claude/rules/task-completion.md) — always finish all pending tasks; never stop between steps or after context compression
- [Test maintenance](@/.claude/rules/test-maintenance.md) — keep tests in sync with code in the same response

### SPEC.md mapping

Spec maintenance routes changes to the nearest SPEC.md:

- `htmlwasher/src/**` → `htmlwasher/SPEC.md`
- `tools/wash-corpus-tester/src/**` → `tools/wash-corpus-tester/SPEC.md`
- `tools/live-crawl-tester/src/**` → `tools/live-crawl-tester/SPEC.md` (scaffold stub only)
- `training/**.py` → `training/SPEC.md`
- architecture / data-flow changes → root `SPEC.md`

## Security

Treat all fetched HTML as untrusted — never `eval`, never feed it into a template engine without escaping, sanitize before downstream use. No secrets in logs (redact tokens, full request bodies). Validate input at every boundary (zod or typed parsing in TypeScript). If the out-of-brief `tools/live-crawl-tester/` scaffold is ever implemented, it must be a polite fetcher that honors robots.txt + per-host rate limits and target sites' Terms of Service per Crawlee/Apify industry standards (it is NOT Crawlee/Playwright itself). No `.env*` files in the repo.

See [`@/.claude/rules/security.md`](@/.claude/rules/security.md) for the full security checklist.

## Claude Code setup maintenance (self-improving)

The Claude config is a maintained artifact. The `SessionStart` hook (`.claude/hooks/claude-setup-snapshot.mjs`) _surfaces_ an inventory — it prints setup counts + an audit-staleness line every session but never blocks. The `Stop` gates _enforce_: `spec-gate.sh` and `test-gate.sh` check the spec/test-maintenance rules and can block a turn until SPEC.md and tests are brought in sync with the code. The **`claude-setup-auditor`** skill is the reasoning half: it reviews the whole `.claude/` setup against the latest official Claude Code docs (8-dimension rubric; Adopt / Improve / Remove / Security / Parked) with per-item confirmation. Run `/autonomous:meta:setup` periodically, before significant work, or when the snapshot flags the audit as stale.

## Resources

- [adbar/trafilatura](https://github.com/adbar/trafilatura) — the canonical original (Python)
- [trafilatura.readthedocs.io](https://trafilatura.readthedocs.io/) — algorithm reference
- [markusmobius/go-trafilatura](https://github.com/markusmobius/go-trafilatura) — faithful Go port (HOW extraction behaves)
- [Murrough-Foley/rs-trafilatura](https://github.com/Murrough-Foley/rs-trafilatura) — divergent Rust fork with ML page-typing (primary port target)
- [Murrough-Foley/web-page-classifier](https://github.com/Murrough-Foley/web-page-classifier) — the XGBoost page-type classifier
- [WCXB dataset (Hugging Face)](https://huggingface.co/datasets/murrough-foley/web-content-extraction-benchmark) — training data; mirror on [Zenodo (DOI 10.5281/zenodo.19316874)](https://doi.org/10.5281/zenodo.19316874) (CC-BY-4.0, attribution required)
- [onnxruntime-node](https://www.npmjs.com/package/onnxruntime-node) / [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) — ONNX inference backends
- [mozilla/readability](https://github.com/mozilla/readability) — TypeScript/DOM idiom reference
