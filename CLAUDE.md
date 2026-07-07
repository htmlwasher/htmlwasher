# trafilatura — trafilaturacore

trafilatura hosts **`trafilaturacore`**, a **hybrid Rust + TypeScript** content-extraction library derived from **[Trafilatura](https://github.com/adbar/trafilatura)**. Its boilerplate-removal + page-type-classification core is a **Rust crate** (`packages/trafilaturacore/native/`, a simplified fork of rs-trafilatura's live path) reached from Node via **napi-rs**; the public async `clean()` API, the Trafilatura-aligned HTML-cleaning/sanitization stage, the metadata sidecar, and the CLI stay **TypeScript**. It extracts a page's main content — clean HTML plus structured metadata (title, author, date, sitename, tags) — and classifies the page into one of 7 page types (article, forum, product, collection, listing, documentation, service) via a **pure-Rust GBDT evaluator over the XGBoost native JSON dump (no ONNX/onnxruntime)** to route extraction through a type-specific profile. Alongside the library, this repo holds an offline Python `training/` pipeline (XGBoost → `model.xgb.json`) and the offline `packages/clean-corpus-tester/` end-to-end fixture harness. It is a **content-extraction library for Node.js — not a scraper, not a browser-automation crawler, not an Apify Actor.**

## Project Structure

```
Cargo.toml                 # root Rust workspace (member: packages/trafilaturacore/native); Cargo.lock committed
packages/                  # flat pnpm/Turborepo workspace (contextractor layout; `tools/` dissolved)
├── trafilaturacore/            # the TS library (npm package `trafilaturacore`, alpha): src/{cleaning,metadata},
│   │                      #   pipeline.ts, cli*, types.ts, test/, fixtures/ — the TS shell over the Rust core
│   └── native/            # the Rust crate `trafilaturacore-native` = npm `@trafilaturacore/native` (private):
│                          #   the simplified rs-trafilatura fork — extraction, page_type/ (cascade +
│                          #   189-feature extractor + pure-Rust GBDT), profiles, dual-mode serializer,
│                          #   #[napi] extract/extractSync; artifacts/{model.xgb.json,tfidf-vocab.json};
│                          #   npm/<target>/ committed prebuilds. (The former TS src/{core,classifier,
│                          #   profiles}/ live here now.)
├── clean-corpus-tester/    # THE offline E2E tester (brief §7): runs clean() over saved HTML fixtures across
│                          #   the 7 page types; reports PASS/FAIL; no network; in `pnpm test`.
└── live-crawl-tester/     # OUT-OF-BRIEF, OPTIONAL, UNIMPLEMENTED scaffold stub (index.ts only logs
                           #   "not yet implemented"). Would hit the network, so NOT in offline `pnpm test`.
training/                  # OFFLINE Python project (3.12+, uv-managed): trains XGBoost from the WCXB
                           #   dataset, exports model.xgb.json + tfidf-vocab.json + parity fixtures into
                           #   the crate. Not a pnpm workspace package; not shipped at runtime.
# (the six READ-ONLY reference repos are cloned OUTSIDE this repo into ~/r/trafilatura-sources/, by clone-other-repos.sh)
prompts/2026-6-24-init/    # build brief (prompt.md, self-updating per its own "Keep this brief current"
                           #   rule) + research context docs (read-only)
```

## Current status

The **v2 hybrid rebuild** ([`@/prompts/2026-6-24-init/prompt.md`](@/prompts/2026-6-24-init/prompt.md), phases ORIENT→POLISH) is **implemented**. `trafilaturacore` exposes the public async `clean()` composing the Rust boilerplate-removal + classification core (`@trafilaturacore/native`, a simplified rs-trafilatura fork with a **pure-Rust GBDT page-type classifier over the XGBoost JSON dump — no ONNX**), the TypeScript metadata sidecar, and the Trafilatura-aligned cleaning stage (the **sole sanitization authority** — the Rust core emits preserve-markup, unsanitized HTML; context doc 09). `training/` trains the classifier from WCXB and exports `model.xgb.json` + `tfidf-vocab.json` + the Rust↔Python parity fixtures into the crate; `packages/clean-corpus-tester/` is the offline E2E tester. Rust↔Python feature parity is exact (numeric ≤ 3.4e-13, argmax 100%); extraction scores F1 ≈ 0.83 on the adbar eval corpus (a lift over v1's ≈0.80) and the Rust core is ~3× faster; the classifier ≈ 0.777 held-out WCXB accuracy. See [`@/PORTING-NOTES.md`](@/PORTING-NOTES.md) for the per-phase map, gotchas, and scores, and each package's `SPEC.md` for the current API. Alpha — APIs may still change.

## Commands

```bash
pnpm fix               # Biome check --fix --unsafe + format, then markdownlint --fix + Prettier on Markdown
pnpm build             # `pnpm fix`, then build all TS packages via turbo
pnpm test              # All vitest tests via turbo (offline; incl. the offline clean-corpus-tester E2E)
pnpm lint              # Biome check + markdownlint + Prettier --check on Markdown (read-only)
pnpm lint:md           # Markdown only: markdownlint + Prettier --check
pnpm fix:md            # Markdown only: markdownlint --fix + Prettier --write (Biome owns JS/TS/JSON)
pnpm clone-sources     # `bash clone-other-repos.sh` — fetch the six read-only reference repos into ~/r/trafilatura-sources/
npx cspell "**/*.md"   # Spell check (cspell dictionaries: bash, en-gb, git, rust)
npx knip               # Dead-code: unused exports/files/deps (config in knip.json)
# Rust native crate (packages/trafilaturacore/native/ — needs a Rust toolchain):
cargo test --workspace                          # crate unit + integration tests (incl. Rust↔Python parity)
cargo clippy --workspace --all-targets -- -D warnings   # lint (unwrap/expect/unsafe denied)
cargo fmt --check                               # format check
# napi build --release --features napi          # rebuild the prebuilt .node (needs @napi-rs/cli; committed prebuilds otherwise)
# Offline Python training (run from training/):
uv sync                # Create/refresh the uv-managed venv
uv run pytest          # Run training unit tests
uvx ruff check .       # Lint Python
uvx ruff format .      # Format Python
```

Biome owns JS/TS/JSON lint+format; Prettier + markdownlint-cli2 own Markdown; cspell owns spelling; knip owns dead-code. Lockfiles (`pnpm-lock.yaml`) are gitignored by repo convention — use plain `pnpm install`, never a frozen/CI install.

## Local Prerequisites

- **Node 22+**, **pnpm 10+** — the library and the offline `packages/clean-corpus-tester/`
- **Python 3.12+ with [uv](https://docs.astral.sh/uv/)** — only for the offline `training/` pipeline
- **git** — to clone the six read-only reference repos into `~/r/trafilatura-sources/`
- **Rust toolchain (cargo/rustc, current stable ≥ 1.85 for edition 2024) — required only to REBUILD the native crate** at `packages/trafilaturacore/native/`. Committed prebuilt `.node` binaries (added at Phase BIND) let contributors without Rust still `pnpm build`/`pnpm test` — the native build script self-skips when no toolchain is configured. `rust-analyzer` is first-class: it reads the in-repo crate AND the read-only references under `~/r/trafilatura-sources/`.

## Reference sources are read-only (external)

The reference repos live at **`~/r/trafilatura-sources/`** — an external sibling directory **outside** this repo (NOT inside it, NOT committed), cloned by `@/clone-other-repos.sh`. **Never edit them.** They define the port's behavior by an authority hierarchy:

- **`rs-trafilatura` + `web-page-classifier`** define **WHAT** to build (the divergent fork with ML page-typing — the primary port target).
- **`go-trafilatura` + `adbar/trafilatura`** define **HOW extraction should behave** — defer to these when rs-trafilatura is thin or ambiguous.
- **`trafilatura-rs`** is the cross-check / tiebreaker.
- **`readability`** is a TypeScript/DOM idiom reference only (not extraction behavior).

## TypeScript LSP

The `typescript-lsp@claude-plugins-official` plugin wires `typescript-language-server` into the built-in `LSP` tool — go-to-definition, find-all-references, hover types, and real-time diagnostics across `.ts`/`.tsx`/`.js`/`.jsx`. Python (`pyright-lsp`) and Rust (`rust-analyzer-lsp`) are also enabled — pyright for the `training/` Python, and **rust-analyzer is first-class**: it drives the in-repo native crate at `packages/trafilaturacore/native/` (go-to-def, types, diagnostics) AND reads the read-only Rust references under `~/r/trafilatura-sources/`.

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

- `packages/trafilaturacore/src/**` → `packages/trafilaturacore/SPEC.md`
- `packages/clean-corpus-tester/src/**` → `packages/clean-corpus-tester/SPEC.md`
- `packages/live-crawl-tester/src/**` → `packages/live-crawl-tester/SPEC.md` (scaffold stub only)
- `training/**.py` → `training/SPEC.md`
- architecture / data-flow changes → root `SPEC.md`

## Security

Treat all fetched HTML as untrusted — never `eval`, never feed it into a template engine without escaping, sanitize before downstream use. No secrets in logs (redact tokens, full request bodies). Validate input at every boundary (zod or typed parsing in TypeScript). If the out-of-brief `packages/live-crawl-tester/` scaffold is ever implemented, it must be a polite fetcher that honors robots.txt + per-host rate limits and target sites' Terms of Service per Crawlee/Apify industry standards (it is NOT Crawlee/Playwright itself). No `.env*` files in the repo.

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
- [napi-rs](https://napi.rs/) — the Rust↔Node binding for the native crate · [dom_query](https://crates.io/crates/dom_query) — the crate's html5ever-based DOM · [XGBoost model JSON](https://xgboost.readthedocs.io/en/stable/tutorials/saving_model.html) — the classifier's native-JSON dump format (evaluated by a pure-Rust GBDT, no ONNX)
- [mozilla/readability](https://github.com/mozilla/readability) — TypeScript/DOM idiom reference
