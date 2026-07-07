# Claude Code Brief — Rebuild htmlwasher with a Rust extraction core

**Created:** 2026-06-24 (v1 — the all-TypeScript build, implemented and green)
**Rewritten:** 2026-07-06 (v2 — Rust boilerplate-removal + classifier core; supersedes v1)
**Author of brief:** prepared for Miroslav Sekera (Glueo s.r.o.)
**For:** Claude Code, run from the repository root.

---

> **TLDR**: Phased brief to rebuild **htmlwasher** as a **hybrid Rust + TypeScript library**. A new in-repo Rust crate — **a simplified rs-trafilatura** — takes over **boilerplate removal, page-type classification (7 types), per-type extraction profiles, and confidence scoring** (HTML in → extracted main-content HTML fragment + `pageType`/`confidence` out). Everything else **stays TypeScript**: the public async `wash()` API, the HTML washing/sanitization levels (`Minimal | Standard | Permissive | Styled | Correct`), the metadata sidecar, and the offline CLI. The classifier drops ONNX entirely: training stays Python (XGBoost from WCXB) but exports the model as the **XGBoost native JSON dump**, evaluated by a **tiny pure-Rust tree-ensemble evaluator** inside the crate — no onnxruntime anywhere. The crate reaches Node via **napi-rs v3** (prebuilt native addons + a `wasm32-wasip1-threads` fallback from the same code). The repo restructures to the **`~/r/contextractor` layout** — flat `packages/*`, the crate nested at `packages/htmlwasher/native/`, prebuilds committed. The crate's output preserves the kept content's **original markup** — Rust sanitizes nothing; the TS washing stage owns ALL tag/attribute/scheme/CSS policy (context doc 09). The public `wash()` surface is **unchanged** from v1. Work the build order in the Build order section; v1's tests, fixtures, and eval scores are the regression oracle.

---

## Mission

Rebuild **htmlwasher** (npm package `htmlwasher`, this repo) so that its compute core is Rust while its product surface stays TypeScript. The library still takes **HTML in and returns cleaned HTML out** — never converting to Markdown, XML, XML/TEI, or plain text, and never fetching/scraping the web. Two composable pillars, now split across two languages:

- **Boilerplate removal + page typing (Rust)** — a Trafilatura-derived main-content extraction core with the rs-trafilatura architecture: a **3-stage page-type cascade** (URL heuristics → HTML signal analysis → gradient-boosted-tree ML over 189 features) into one of 7 page types (`article, forum, product, collection, listing, documentation, service`), **per-type extraction profiles**, **confidence scoring**, and a **boilerplate-skipping serializer** that emits the kept content with its **original markup** — tags and attributes preserved, modulo extraction hygiene; never a verbatim `outerHTML` of unselected content, and never sanitized in Rust (see context doc 09). Gated by the boilerplate mode `precision | balanced | recall | none` (`none` bypasses the Rust core entirely).
- **HTML washing (TypeScript)** — the existing, implemented sanitization + normalization stage (`sanitize-html` ≥ 2.17.2 pipeline, five washing levels plus a fully-custom JSON `SanitizeConfig`, the non-negotiable security floor). In v2 it becomes the **sole sanitization authority** for every output path — extraction on or off — and the floor becomes unconditional (Phase FLOOR closes the wildcard-config bypass proven in context doc 09).

Also unchanged in role: the **metadata sidecar** (TypeScript), the **offline CLI**, the offline **Python `training/` pipeline** (its export format changes), and the offline **wash-corpus-tester** E2E harness (`packages/wash-corpus-tester/` after the restructure).

This brief runs in either of two modes — **update-in-place** (the default, when a working v1 exists) or **from scratch** (greenfield); see **Operating modes** below. In update mode it is a migration, not a rewrite: v1 (all-TypeScript, Phases 0–8 of the original brief) is implemented, tested (≈369 library tests, adbar eval F1 ≈ 0.80, classifier held-out accuracy 0.777), and its public API is frozen. v2 adopts the contextractor repo layout (flat `packages/*`, the Rust crate nested at `packages/htmlwasher/native/`), replaces the flagship's `src/{core,classifier,profiles}/` with that crate, makes the TS washing stage the sole sanitization authority (context doc 09), and deletes the runtime ONNX dependency, while every v1 behavior contract and test floor continues to hold — with the expected output diffs re-baselined rather than regressed: the deliberate `styled`/`correct` × extraction markup preservation (doc 09), doc 09's marginal preset-level attribute diffs (attributes the presets allow that v1's core stripped, e.g. `a[title]`), and movement from the newly-live aggregation passes (Phase VALIDATE).

## What v2 changes, and why

- **Boilerplate removal moves to Rust.** The v1 TS core (`htmlwasher/src/core/`, ≈1,600 lines) is a re-port of rs-trafilatura's extraction. Owning it in Rust — as a simplified fork of rs-trafilatura's *live* code path — removes a whole translation layer, picks up live rs-trafilatura behavior the TS port never implemented (the `aggregateSections` multi-candidate merge and `collectRepeatedItems` post-passes are live in rs-trafilatura but dead flags in v1), and is several times faster on large documents.
- **The classifier moves into the same crate.** Not for compute (tree inference is microseconds; feature extraction is one DOM parse plus text statistics) but for architecture: the classifier's 189 features need a full DOM parse, and the page type exists only to select the extraction profile. Classifier-in-Rust means **one parse feeds both** classification and extraction, the whole classify → profile → extract flow is a single native call, and the port target's shape (rs-trafilatura = extraction + ML page typing in one crate) is preserved rather than split.
- **ONNX is dropped from the runtime.** `training/` still trains XGBoost in Python, but exports the **XGBoost native JSON dump** instead of `model.onnx`. The crate evaluates the trees itself — gradient-boosted trees are threshold comparisons; a small deterministic evaluator with no C dependencies replaces both `onnxruntime-node` and `onnxruntime-web` (and their TreeEnsemble bug-pinning saga). This is also what makes the WASM fallback build clean. The `web-page-classifier` reference crate proves the pattern (it ships its own pure-Rust tree evaluator); we do the same with a documented model format and our own retrained model.
- **Parity work transfers, it is not redone from scratch.** The v1 TS↔Python feature-parity fixtures (exported feature vectors + expected predictions) become the Rust↔Python parity oracle. The Python side (`training/extract_features.py`) does not change and remains the ground truth for feature semantics.
- **The Rust core sanitizes nothing — TypeScript owns all markup policy.** Context doc 09's code investigation splits the v1 core's removals into three buckets: **boilerplate selection** (stays — the product feature), **extraction hygiene** (stays — `<script>`/`<style>`/nav noise must die *before* text/link-density scoring, which incidentally guarantees scripts never cross the FFI), and **output sanitization/normalization** (the ~60-tag emit whitelist + attribute stripping — **deleted from Rust**; the washing presets duplicated it downstream all along). The serializer keeps its boilerplate-skip layer but emits kept nodes with original tags and attributes. Payoff: one sanitization authority instead of two whitelists drifting across languages, the `styled`/`correct` levels finally work with extraction (v1 stripped `class`/`style` before washing could keep them), and the v1 dead-filter ordering hazard disappears structurally. Preconditions are baked into the plan: the unconditional security floor (Phase FLOOR), serializer guard relocation, and DOM-based text length (the sanitization-ownership locked decision).
- **The repo adopts the `~/r/contextractor` layout.** Flat `packages/*` (the flagship moves to `packages/htmlwasher/`, the two testers move up from `tools/htmlwasher/` to `packages/*`, the `tools/` grouping dissolves), the Rust crate nested inside the flagship at `packages/htmlwasher/native/` as the root Cargo workspace's sole member, and prebuilt `.node` binaries committed under `npm/<target>/` so contributors without a Rust toolchain can still build and test the TS packages (the native build script self-skips — contextractor's proven pattern). This completes the restructure the executed `2026-06-27` package-naming prompt explicitly deferred.
- **What deliberately stays TypeScript:** the public `wash()` API and types, the washing pillar (all five levels, custom `SanitizeConfig`, security floor), the metadata sidecar, decode (`chardet`/`iconv-lite`), and the CLI. Do NOT port these to Rust.

---

## Operating modes — build from scratch or update in place

This brief runs either way. Detect the mode at Phase ORIENT: does a working v1 tree exist (`packages/htmlwasher/`, or the pre-restructure `htmlwasher/`, with a green test suite)?

- **Update mode (default — v1 exists).** The phases exactly as written: v1 is the regression oracle, RESTRUCTURE `git mv`s the existing dirs, FLOOR fixes the real v1 wildcard bug, INTEGRATE deletes `src/{core,classifier,profiles}/`, and VALIDATE/RETEST compare against the recorded v1 baseline. Keep `pnpm test` green throughout.
- **From-scratch mode (greenfield — no v1).** Every pillar is built fresh in the target layout; the same phases apply, adapted:
  - **ORIENT** — no v1 perf/score baseline to capture; record the reference engines (upstream Trafilatura, rs-trafilatura) as the comparison targets instead.
  - **FLOOR** — there is no v1 bug to fix, but the unconditional security floor and the wildcard-`SanitizeConfig` guard are still built into the washing pillar from the start (requirements, not a retrofit).
  - **RESTRUCTURE** — create the `packages/*` layout directly; nothing to move or rename.
  - **CRATE / CLASSIFY / BIND** — identical: port from the rs-trafilatura references. Where a phase says "port the v1 test cases," author equivalent cases from the reference behavior + this brief's locked contracts (the v1 TS core is a convenience, not a prerequisite).
  - **INTEGRATE** — write `pipeline.ts`, the washing pillar, the metadata sidecar, and the CLI fresh against the frozen public API defined here; nothing to delete.
  - **VALIDATE / RETEST** — no v1 numbers to regress against; the bar is this brief's target scores (adbar F1 in the ballpark of upstream Trafilatura; classifier ≈ 0.78) and parity with the reference engines.

  Wherever the brief says "the v1 suite/baseline is the oracle," read it as: **the recorded v1 baseline in update mode; the reference engines + this brief's target contracts in from-scratch mode.**

---

## Read these first (required context)

The research documents in `@/prompts/2026-6-24-init/context/` still ground the design (links below are folder-relative). Read them with the v2 supersessions below in mind.

**Core docs (mandatory):**

- [`./context/01-trafilatura-forks-and-ports-landscape.md`](./context/01-trafilatura-forks-and-ports-landscape.md) — the Python → Go → Rust lineage and which repo is authoritative for what.
- [`./context/02-rs-trafilatura-skeptical-assessment.md`](./context/02-rs-trafilatura-skeptical-assessment.md) — why rs-trafilatura's benchmark claims are unverified and we validate on our own data. Now doubly relevant: v2 derives Rust code from it, so verify behavior, not claims.
- [`./context/03-classifier-reimplementation-feasibility.md`](./context/03-classifier-reimplementation-feasibility.md) — how the classifier works, the 189 features, training requirements, licensing. **Superseded in one respect:** its ONNX-runtime recommendation no longer applies — v2 evaluates the XGBoost JSON dump in Rust; ONNX and onnxruntime are gone from the runtime.
- [`./context/09-boilerplate-only-rust-core-vs-ts-sanitization.md`](./context/09-boilerplate-only-rust-core-vs-ts-sanitization.md) — **the v2 sanitization-ownership decision (2026-07-06, adversarially verified against the code)**: the Rust core does boilerplate selection + extraction hygiene only and emits original markup; the TS washing stage owns ALL tag/attribute/scheme/CSS policy. Defines the three-bucket model, the preserve-markup serializer mode, the unsanitized-FFI contract, and the three preconditions (unconditional floor, serializer guard relocation, DOM text length). Partially supersedes doc 08 §1.

**Supporting docs (read selectively):**

- [`./context/08-html-output-cleanup-pipeline-and-security.md`](./context/08-html-output-cleanup-pipeline-and-security.md) — the washing pipeline, presets, and untrusted-HTML security model: **still binding** for the TS washing pillar, with one supersession — doc 09 replaces its §1 "whitelist re-render / two independent safety passes" framing (the anti-`outerHTML` rationale survives via serializer-side boilerplate skipping; the second safety pass is deliberately retired). Its §5.1 onnxruntime version-pinning analysis is moot in v2.
- [`./context/07-classifier-bilingual-port-deep-dive.md`](./context/07-classifier-bilingual-port-deep-dive.md) — companion to doc 03. The training-compute and rebuild-fresh verdicts stand; the TS-side feature-extraction library analysis is moot (feature extraction is Rust now); the parity discipline it teaches transfers to the Python↔Rust boundary.
- [`./context/06-ml-extraction-landscape.md`](./context/06-ml-extraction-landscape.md), [`./context/04-niche-opportunities-map.md`](./context/04-niche-opportunities-map.md), [`./context/05-crawlee-playwright-hybrid-stack.md`](./context/05-crawlee-playwright-hybrid-stack.md) — unchanged roles: neural-extractor licensing traps, positioning/fixture strategy, and why the E2E tester is offline, respectively.

Also read before coding: [`@/PORTING-NOTES.md`](@/PORTING-NOTES.md) (v1 port map, gotchas, scores — the regression baseline) and [`@/htmlwasher/SPEC.md`](@/htmlwasher/SPEC.md) (the frozen public API).

### Primary sources (for tracing and verification)

**Trafilatura implementations (cloned into `~/r/htmlwasher-sources/` by `@/clone-other-repos.sh`):**

- Upstream Trafilatura (adbar): <https://github.com/adbar/trafilatura> · docs <https://trafilatura.readthedocs.io/>
- go-trafilatura (markusmobius): <https://github.com/markusmobius/go-trafilatura>
- rs-trafilatura (Murrough-Foley, the divergent fork — **now the code-level port source**): <https://github.com/Murrough-Foley/rs-trafilatura>
- web-page-classifier (the XGBoost classifier crate): <https://github.com/Murrough-Foley/web-page-classifier>
- trafilatura-rs (nchapman, faithful Rust port): <https://github.com/nchapman/trafilatura-rs>
- mozilla/readability (JS/DOM idiom reference): <https://github.com/mozilla/readability>

**Rust → Node bindings (consult online, not cloned):**

- napi-rs v3: <https://napi.rs/> · announce <https://napi.rs/blog/announce-v3> · release/packaging guide <https://napi.rs/docs/deep-dive/release> · WASM concept <https://napi.rs/docs/concepts/webassembly> · package templates <https://github.com/napi-rs/package-template> and <https://github.com/napi-rs/package-template-pnpm>
- Prior art — napi binding of rs-trafilatura (npm name `trafilatura`): <https://github.com/gorango/napi-rs-trafilatura>. Proof the approach works; binding-shape reference only, never an authority. We build our own because we need the simplified crate, our retrained model, the WASM fallback, and our API.
- dom_query (the DOM crate rs-trafilatura uses): <https://crates.io/crates/dom_query> · XGBoost model JSON format: <https://xgboost.readthedocs.io/en/stable/tutorials/saving_model.html>

**The dataset & benchmarks (training, unchanged):**

- WCXB dataset (CC-BY-4.0, attribution REQUIRED): <https://huggingface.co/datasets/murrough-foley/web-content-extraction-benchmark> · Zenodo mirror (DOI 10.5281/zenodo.19316874): <https://doi.org/10.5281/zenodo.19316874>
- WCXB paper (arXiv preprint, not peer-reviewed): <https://arxiv.org/abs/2605.21097> · ScrapingHub Article Extraction Benchmark (neutral): <https://github.com/scrapinghub/article-extraction-benchmark>
- Bevendorff et al., SIGIR '23 (why heuristics + per-type routing): <https://downloads.webis.de/publications/papers/bevendorff_2023c.pdf> · Barbaresi, ACL 2021 (Trafilatura): <https://aclanthology.org/2021.acl-demo.15/>

---

## Source repositories & authority hierarchy

The Trafilatura source repos live at **`~/r/htmlwasher-sources/`** (an external sibling directory, cloned by `@/clone-other-repos.sh`; **never edit them**). When sources disagree, follow this hierarchy:

| Repo (local path) | Role | Authority |
| --- | --- | --- |
| `~/r/htmlwasher-sources/rs-trafilatura` | **Primary port source — now at code level.** The Rust crate is a simplified fork of its **live** extraction path. Page-type architecture, profiles, confidence, `favor_precision`/`favor_recall`. | Defines **WHAT** to build AND (new in v2) supplies the Rust code to derive from. |
| `~/r/htmlwasher-sources/web-page-classifier` | **The classifier reference.** The numeric-feature definitions, URL heuristics, the pure-Rust-tree-evaluator pattern. | Reference for **feature semantics** — but `@/training/extract_features.py` + `@/training/FEATURES.md` are the v2 ground truth (see Locked decisions). |
| `~/r/htmlwasher-sources/go-trafilatura` | Faithful Go port; cleanest readable source for the extraction algorithm. | **Disambiguator** when rs-trafilatura's live path is unclear. |
| `~/r/htmlwasher-sources/trafilatura` (adbar) | Canonical original + the eval corpus. | **Final authority** on extraction *semantics*; the validation oracle. |
| `~/r/htmlwasher-sources/trafilatura-rs` (nchapman) | Faithful Rust port. | Cross-check / tiebreaker. |
| `~/r/htmlwasher-sources/readability` (mozilla) | Canonical JS readable-content extractor. | TS/DOM idiom reference only (metadata/washing side). |

**Critical rs-trafilatura reading guidance (from the v2 source audit):** rs-trafilatura v0.2.2 contains **two parallel extraction implementations**. The live path is `src/extract.rs` (≈4,200 lines: orchestration at `extract_content`, the content-node cascade at `find_main_content_node_with_profile`, the whitelist serializer `push_filtered_html_children` at `extract.rs:2700`, comments at `extract_comments`, table handling with `MAX_TABLE_CELLS`/`MAX_TABLE_TEXT_LEN` caps) plus `extractor/fallback.rs`, `selector/{mod,content,utils}.rs`, `html_processing.rs`, `link_density.rs`, `patterns.rs`, and `dom.rs`. The go-style `extractor/{pipeline,handlers,pruning,state,comments}.rs` and `selector/{precision,comments,meta}.rs` are a **dormant parallel implementation — do NOT port them**. `selector/discard.rs` is the one partial exception: the kept `extractor/fallback.rs` uses its `should_discard` (baseline rescue) and `OVERALL_DISCARDED_CONTENT` (`favor_precision` pruning inside `compare_external_extraction`) — port exactly those pieces with the fallback module. Its `Options.page_type` override already decouples classification from extraction cleanly. Its `deduplicate`/`dedup_cache_size` options are dead in the live path (no cache is ever constructed outside tests) — do not port them. Its ported `post_cleaning` attribute stripper (inside the otherwise-kept `html_processing.rs`) is also dead code — defined and unit-tested, never called; do NOT port or wire it: attributes reach the serializer today solely because it never runs, and accidentally wiring it would silently break the preserve-markup contract (doc 09). Note the naming quirk: the internal enum variant `Category` serializes as `"collection"`; htmlwasher's variant is named `Collection` to match the public union.

**The TS-pillar references (read-only sibling projects under `~/r/`)** are unchanged from v1 and matter only if the washing/CLI surface is touched: `~/r/tools/packages/htmlprocessing-server` (the washing engine + presets), `~/r/tools/apps/htmlwasher-*` (product), `~/r/contextractor` (boilerplate-mode mapping + CLI shape).

---

## Locked technical decisions

Do not redesign these — they are settled by the v1 build, the v2 research audit, and the maintainer:

- **Language split.** Rust owns boilerplate removal, the 3-stage page-type cascade, the 7 extraction profiles, and confidence. TypeScript owns the public `wash()` API, washing levels + custom `SanitizeConfig` + security floor, the metadata sidecar, buffer decoding, and the CLI. Python owns training. Do not move washing or metadata into Rust; do not reimplement extraction in TS.
- **The Rust core is a simplified fork of rs-trafilatura's live path** (MIT OR Apache-2.0 — code derivation is allowed with attribution). Keep: the `extract.rs` live pipeline, `extractor/fallback.rs` (JSON-LD `articleBody` pre-check, Discourse `data-preloaded`, external-candidate comparison, baseline rescue), content selectors, `html_processing.rs` doc-cleaning with profiles, link-density tests, the boilerplate-skipping HTML serializer **in preserve-markup mode** (original tags + attributes of kept nodes; the upstream whitelist emit stays available behind an option for reference-parity testing only — see the sanitization-ownership decision below) AND its internal text twin (the fallback triggers measure text length — keep text serialization internal even though only HTML is exposed), comment extraction with the forum `commentsAreContent` coupling, layout-table detection with the existing caps. Strip: the `spider` feature and crawler glue, both CLI bins, the Markdown output path (`quick_html2md`, `src/markdown.rs`, `output_markdown`), the `ImageData` collection feature (`<img>` tags still survive in the serialized HTML — washing narrows later), `src/encoding.rs`/`encoding_rs`/`extract_bytes*` (the crate takes `&str`; TS decodes), the metadata sidecar modules, `scoring.rs`, the dead dedup options, and the entire `web-page-classifier` dependency + embedded model binaries.
- **Sanitization ownership (context doc 09): the crate's HTML output is UNSANITIZED by design.** Kept elements emit verbatim — original tag names, ALL original attributes, text/attribute values escaped; no tag whitelist, no attribute policy in Rust. The boilerplate SKIP behavior is fully retained but re-homed: the `script`/`style`/`noscript`/`iframe` hard skip stays in the serializer as a zero-cost FFI invariant (hygiene already killed them — doc-cleaning runs before scoring because script/style text corrupts the metrics), while the header/footer-outside-`article`/`main` rule, the name guards (`is_always_excluded_name`, the gated `is_boilerplate`), and the BreadcrumbList drop relocate to DOM passes — `header` has no other removal path today, so without the relocated pass it leaks; and the name guard must NOT act on the backoff path now that it can see `class`/`id`, or it re-empties exactly the output the backoff saves (the v1 backoff test is the regression guard). Measure `textLength` from DOM `textContent`, never by regex tag-stripping (unescaped `>` inside verbatim attribute values breaks the regex and can suppress the whole-body fallback); preserve the `''`-on-whitespace contract (`pipeline.ts`'s empty-extraction fallback reads it). Boundary contract: `contentHtml` = original markup of kept nodes modulo hygiene, script-free but otherwise untrusted — it MUST always flow through `washHtml` and is never exposed directly. Known, documented limitation: when a fallback wins (JSON-LD `articleBody`, baseline rescue), markup is synthesized — preservation is best-effort by construction.
- **DOM crate: `dom_query`** (html5ever-based, pure Rust — what rs-trafilatura uses). Keep the `html-cleaning` crate dependency (same author; supplies the trafilatura doc-cleaning preset and etree text/tail utilities the live path leans on) after verifying its crates.io license; reimplement only if the license check fails. New crate: current stable Rust edition, `rust-version` pinned, `unsafe_code = "forbid"`, minimal deps (`dom_query`, `tendril`, `html-cleaning`, `regex`, `serde`/`serde_json` for the JSON-LD fallbacks, `thiserror`, `url` for the URL-heuristics stage).
- **Fix the re-entrancy hazard while porting:** rs-trafilatura's `thread_local! COMMENTS_ARE_CONTENT` flag must become an explicit parameter/state argument threaded through extraction — a library entered from Node worker threads cannot carry hidden thread-local mutable state.
- **Classifier: 3-stage cascade in Rust, model from Python, no ONNX.** Stage URL heuristics and stage HTML-signal refinement port from the v1 TS implementation (`url-heuristics.ts`, `html-signals.ts` — themselves verbatim ports of rs-trafilatura `page_type/mod.rs`). Stage ML: the 189-feature extractor (89 numeric + 100 TF-IDF) in Rust with **`@/training/extract_features.py` as the byte-level parity target** — scikit-learn TF-IDF semantics (`smooth_idf=True`: `idf = ln((1+n)/(1+df)) + 1`, L2 normalization — NOT web-page-classifier's un-normalized variant), the baked StandardScaler transform, the enhanced-feature-group gating (zeroed when body text exceeds 500,000 chars), **UTF-8 byte lengths** (never UTF-16 code units), the **CPython `str.split`/`str.strip` whitespace codepoint class**, and the **selectolax comma-union rule** — comma-separated selector unions do NOT deduplicate: a node counts once per matching sub-selector, in document order (read the `matchUnion` parity comment in v1's `dom-query.ts` before deleting it, verify `dom_query`'s comma-union behavior matches, and fix the ambiguous "union" wording in `@/training/FEATURES.md`). Inference: a small pure-Rust evaluator over the **XGBoost native JSON dump** (`multi:softprob`, 7 classes, 200 rounds → 1,400 trees; honor `default_left` missing-value routing and strict `<` split comparison; softmax over per-class margin sums). A vetted pure-Rust GBDT crate may be used if it matches exactly; otherwise the evaluator is ~200 lines. **Feature-count guard:** 189 = 89 numeric + 100 TF-IDF per our training code; rs-trafilatura's `ml.rs` comment ("81") and the classifier README body (81/181) are stale — trust `@/training/`.
- **Model artifacts are compiled into the crate** via `include_str!` (`model.xgb.json`, plus `tfidf-vocab.json` with the StandardScaler statistics embedded exactly as v1 ships them), parsed once behind `LazyLock` with validation at first use. Self-contained, filesystem-free, WASM-safe. `training/` exports these files and the repo commits them; ONNX export, `onnxmltools`/`skl2onnx`, and the committed ONNX artifacts are removed (training side at Phase CLASSIFY; the shipped `src/classifier/model/model.onnx` leaves with `src/classifier/` at Phase INTEGRATE).
- **Confidence rules port exactly** (v1 `classifier.ts` / rs-trafilatura `extract.rs:55-92`): URL-stage type ≠ article and ML agrees → `1.0`; signal-refined type and ML agrees → `0.95`; otherwise the softmax probability of the argmax class. Cross-language parity compares **argmax class, not float probabilities**.
- **Binding: napi-rs v3** (`napi` ≥ 3.10, `@napi-rs/cli` ≥ 3.7 — GA since 2025, production-proven by oxc/rolldown). One `#[napi]` crate — `htmlwasher-native` at `packages/htmlwasher/native/` — produces the native addons AND the `wasm32-wasip1-threads` fallback. Primary export `extract(html, options?)` returning a `Promise` (AsyncTask on the libuv threadpool — extraction must not block the event loop) plus `extractSync` for scripting; TypeScript definitions auto-generated. npm packaging follows **contextractor's committed-prebuilds pattern, NOT the napi publish template**: the crate's npm package is **`@htmlwasher/native`** (private, `publish = false` on the crate), its per-platform packages `@htmlwasher/native-<target>` live in `npm/<target>/` as **private, `file:`-linked `optionalDependencies` with the prebuilt `.node` binaries committed to git**; the flagship `htmlwasher` depends on `@htmlwasher/native` via the workspace protocol and ships the needed prebuilds inside its own tarball while alpha (revisit per-platform npm publishing when leaving alpha). Target matrix mirrors contextractor's five (darwin arm64/x64, linux x64/arm64 gnu, win32 x64) plus the wasm32-wasip1-threads fallback; CI rebuilds and refreshes the committed prebuilds. Known limitation, accepted: the WASM fallback needs SharedArrayBuffer — **Cloudflare-Workers-class edge runtimes are a non-goal**.
- **Workspace/build integration (mirror `~/r/contextractor` exactly).** Root `Cargo.toml` workspace with `members = ["packages/htmlwasher/native"]`, `resolver = "2"`, shared `[workspace.package]` metadata, contextractor's `[workspace.lints]` (clippy `unwrap_used`/`expect_used`/`missing_errors_doc` denied; `panic`/`todo`/`unimplemented` warned) tightened to `unsafe_code = "forbid"`, and its release profile (`lto = true`, `opt-level = 3`, `codegen-units = 1`, `strip = "symbols"`). **`Cargo.lock` IS committed** (the pnpm-lock gitignore convention does NOT extend to Cargo). `@/pnpm-workspace.yaml` uses contextractor's globs — `packages/*`, `packages/*/native`, `packages/*/native/npm/*` — so the native package AND its platform dirs ARE workspace packages (`file:`-linked, prebuilds committed). Gitignore per contextractor: `target/` and the crate-root `*.node` build artifact ignored, the `npm/<target>/` binaries tracked. Turbo stays as simple as contextractor's (`build` → `dist/**`): the native `build` script self-skips when committed prebuilds are present and no Rust toolchain is configured (rebuild via `npm_config_rebuild_native=1` or a present `CARGO_HOME`), and the native `test` script wraps `cargo test --workspace` + the vitest smoke test in the same skip pattern — CI always rebuilds and runs both. Add knip ignores for the generated loader files.
- **Public API is frozen.** `wash(html, options?) → Promise<{ html, messages, metadata?, pageType?, confidence? }>` with `boilerplate: 'precision' | 'balanced' | 'recall' | 'none'` (default `balanced`), `level: 'minimal' | 'standard' | 'permissive' | 'styled' | 'correct'` (default `standard`), `config?: SanitizeConfig` (custom JSON config, precedence over `level`), `minify?`, `maxInputBytes?` (default 10 MB, enforced in TS **before** the FFI call), `url?` (context only — never fetched). Plain string unions, no TS `enum`s; **no `includeComments`/`includeTables`/`includeImages`/`includeLinks` toggles** — the washing level (or custom config) is the only content-inclusion control, and comments follow the classified page type. `boilerplate: 'none'` never calls the Rust core and omits `pageType`/`confidence`. The five washing levels, the custom-config semantics, the security floor (`<script>` tag + content, every `on*` handler, `javascript:`/`vbscript:`/untrusted `data:` URLs, and dangerous inline CSS — `expression()`, `-moz-binding`, `url(javascript:|data:)` — stripped at every level including `styled` and `correct`; CSS-URL allow-list whenever inline `style` is allowed), and the CLI surface (`-b/-l/-c/-m/-u/--json/-o/-q`, file/stdin → stdout, offline) are all implemented in v1 — see `@/htmlwasher/SPEC.md` and context doc 08; do not change them. Boundary validation stays hand-written runtime guards (`isSanitizeConfig`/`isWashingLevel`/`isBoilerplateMode` — **no `zod`**); `wash()` throws `TypeError` on a malformed config and the CLI exits non-zero with a clear stderr message. The floor becomes **unconditional** in v2 (Phase FLOOR): `enforceSecurityFloor` + the CSS-URL sanitizer run as the final washing pass on EVERY path — presets, custom config, and `correct` — closing the `{ "allowedAttributes": { "*": ["*"] } }` bypass doc 09 proved (in v1 that config passes validation and emits `onclick` and `javascript:` CSS URLs).
- **Determinism:** tree models are threshold comparisons — cross-platform deterministic once features match. Exploit for golden tests; compare argmax, not probabilities.

---

## Project structure (target)

The repo adopts the layout of `~/r/contextractor` (the sibling product repo already shipping a Rust core the same way): flat `packages/*`, the Rust crate nested INSIDE the flagship package at `packages/htmlwasher/native/` as the root Cargo workspace's sole member, and committed prebuilt binaries so a Rust toolchain is needed only to REBUILD the native crate.

```text
@/
  Cargo.toml                       # NEW: root Rust workspace — members = ["packages/htmlwasher/native"];
                                   #   lints + release profile mirror ~/r/contextractor; Cargo.lock committed
  packages/
    htmlwasher/                    # the flagship TS library (npm `htmlwasher`, unscoped, published) —
      src/                         #   moved from @/htmlwasher/ at Phase RESTRUCTURE; public surface unchanged
        washing/                   # KEPT: sanitize/normalize/format pipeline + presets + security floor
        metadata/                  # KEPT: metadata sidecar (gains its own small DOM-parse helper)
        pipeline.ts                # REWIRED: metadata → @htmlwasher/native extract() → wash(level)
        types.ts / index.ts        # KEPT: frozen public types (PageType union asserted against
                                   #   the napi-generated types in a type test)
        cli.ts / cli-program.ts    # KEPT: offline CLI
        core/ classifier/ profiles/  # DELETED (replaced by the native crate)
      test/ fixtures/              # golden + validation tests; adbar eval harness unchanged
      native/                      # NEW: crate `htmlwasher-native` = npm `@htmlwasher/native` (private):
        src/                       #   the simplified rs-trafilatura fork — extraction pipeline, selectors,
                                   #   cleaning, link density, page_type/ (cascade + profiles + features +
                                   #   GBDT eval), serializer (preserve-markup HTML + text twin), #[napi] extract/extractSync
        artifacts/                 #   model.xgb.json + tfidf-vocab.json (scaler embedded, as in v1) — include_str!-ed
        tests/fixtures/            #   Python↔Rust parity fixtures (written by training/)
        npm/<target>/              #   per-platform pkgs with COMMITTED prebuilt .node binaries — private,
                                   #   file:-linked optionalDependencies AND pnpm workspace pkgs (contextractor pattern)
        package.json / SPEC.md     #   build + test scripts self-skip when no Rust toolchain is present
    wash-corpus-tester/            # @htmlwasher/wash-corpus-tester — moved up from tools/htmlwasher/ (role unchanged)
    live-crawl-tester/             # @htmlwasher/live-crawl-tester — moved up from tools/htmlwasher/ (out-of-brief stub)
  training/                        # Python (uv): trains XGBoost from WCXB; NOW exports the XGBoost
                                   #   JSON dump + feature artifacts + parity fixtures (ONNX export removed)
  prompts/2026-6-24-init/          # this brief + context/ research docs
```

The Rust boundary (napi-generated, consumed only by `pipeline.ts`):

```ts
extract(html: string, options?: {
  pageType?: PageType          // override — skips the 3-stage cascade (confidence omitted)
  focus?: 'precision' | 'balanced' | 'recall'
  url?: string                 // context for URL heuristics + hostname; never fetched
}): Promise<{
  contentHtml: string          // original markup of kept nodes (modulo hygiene) — UNSANITIZED; always flows through washHtml
  pageType: PageType
  confidence?: number
  textLength: number
  fallbackUsed: boolean
  warnings: string[]
}>
```

Every package and the repo root carries a `SPEC.md`; keep each `SPEC.md` and `README.md` in sync with the code in the same change (the repo enforces this via its spec/test-maintenance rules).

---

## Required tooling

The repo is already equipped for this build — use these capabilities rather than reinventing them. Delegate substantial work to the agents; consult the skills for language conventions; the `LSP` tool (rust-analyzer / pyright / typescript-language-server, all enabled) gives go-to-definition, types, and diagnostics across all three stacks.

- **Rust — author the crate + read the references** → the `rust-pro` agent (v2: reads `~/r/htmlwasher-sources/` AND writes `packages/htmlwasher/native/` — the fork, the napi bindings, the GBDT evaluator). Language conventions: the `rust`, `rust-packaging`, `rust-testing-patterns` skills. Toolchain: `cargo`/`clippy` are installed; the `wasm32-wasip1-threads` rustup target is installed. `@napi-rs/cli` is a **per-package devDependency** added at Phase BIND (not a global CLI); cross-building the Linux-gnu targets needs **Zig** (`cargo-zigbuild`, via `napi build -x`) and the WASM fallback needs a **WASI SDK** (`WASI_SDK_PATH`) — install those at Phase BIND / in CI, not before.
- **TypeScript — washing, pipeline rewire, CLI, types** → the `ts-pro` agent; the `typescript` skill.
- **Python — training, XGBoost-JSON export, feature parity** → the `python-pro` agent; the `python`, `python-packaging`, `python-testing-patterns`, `python-performance-optimization`, `async-python-patterns` skills.
- **Docs lookup — napi-rs v3, `dom_query`, XGBoost JSON model format, sanitize-html** → the `context7` plugin (library docs, already enabled) + `WebFetch`; for open questions / debugging, the `web-research-specialist` agent. (No MCP server is needed — context7 + WebFetch + LSP cover it; do not add one.)
- **Full-repo review (Phase POLISH) + per-change review** → the `code-reviewer` agent (v2: three-stack Rust/TS/Python with the FFI/no-panic/preserve-markup checklist) and the `/meta:code-review-autofix` command; the `security-guidance` plugin and `@/.claude/rules/security.md` govern the untrusted-HTML floor.
- **Checks** → the `test-runner` agent runs format/lint/type-check/tests; `pnpm build && pnpm lint && pnpm test` plus `cargo test --workspace` / `cargo clippy` and the training `pytest`/`ruff` are the gates.
- **Deep live retest (Phase RETEST)** → the standalone `~/r/htmlwasher-external-tester/` benchmark (external — it hits the network) and its `benchmark-runner` agent + `run-benchmark` skill: four-engine token fidelity vs the Trafilatura reference plus the Claude `visual-extraction-judge` workflow (completeness + cleanliness). Copy its methodology; keep it reference-relative and defaults-only.

---

## Build order (phased, with explicit gates)

Work phase by phase. **Do not advance until the phase's gate passes.** Commit after each phase. Keep `pnpm test` green throughout — in update mode the v1 suite is the safety net until INTEGRATE swaps the implementation; from scratch, the growing fresh suite is the net (see **Operating modes**).

### Phase ORIENT

- Read the context docs (with the v2 supersessions), `@/PORTING-NOTES.md`, `@/htmlwasher/SPEC.md`, and the rs-trafilatura live-path guidance above. Confirm `~/r/htmlwasher-sources/` is cloned. Map rs-trafilatura's live modules to the planned crate layout in a new v2 section of `PORTING-NOTES.md`, including the explicit strip list and the dormant-module exclusion.
- Capture the v1 performance baseline while the TS core still exists: wall-time per page over the adbar eval corpus (plus a large-page sample), recorded in the v2 `PORTING-NOTES.md` section — v1 recorded no perf numbers, and after Phase INTEGRATE the TS core is gone, so Phase VALIDATE depends on this measurement.
- **Gate:** the v2 `PORTING-NOTES.md` section exists with the module map, open questions, and the measured v1 perf baseline; no production code yet.

### Phase FLOOR — make the TS security floor unconditional (v1 bug, doc 09 precondition)

With the core's whitelist gone, the washing floor is the single defense line — and v1 has a proven bypass: a custom `SanitizeConfig` of `{ "allowedAttributes": { "*": ["*"] } }` passes validation and emits `onclick` and `javascript:` CSS URLs (doc 09, empirically verified). Fix it in v1 terms BEFORE any Rust work changes what reaches washing.

- Run `enforceSecurityFloor` + the CSS-URL sanitizer as the final pass on every `washHtml` path (presets, custom config, `correct`) — no gating on `configAllowsStyle`'s literal-`'style'` check.
- Add regression tests: wildcard configs, and hostile fixtures piped through the public `wash()` at every level with `boilerplate: 'balanced'` (v1 exercises hostile input only on `none`-mode paths).
- Tighten the wash-corpus-tester: its `correct`-level script-survival soft-exemption is stale (the implementation already enforces the floor at `correct`) — make the security asserts hard at EVERY level.
- Update `@/htmlwasher/SPEC.md` (its "regardless of `config`" promise becomes true) and the tester's SPEC in the same change.
- **Gate:** `pnpm test` green including the new wildcard + extraction-path security tests; the corpus tester hard-asserts security at all levels including `correct`.

### Phase RESTRUCTURE — adopt the contextractor repo layout

Merged from the executed `2026-06-27` package-naming prompt, whose Notes explicitly deferred this full move. Pure renames plus reference fixes — no behavior change, no package renames.

- `git mv`: `htmlwasher` → `packages/htmlwasher`; `tools/htmlwasher/wash-corpus-tester` → `packages/wash-corpus-tester`; `tools/htmlwasher/live-crawl-tester` → `packages/live-crawl-tester`; the emptied `tools/` goes away. Package NAMES stay unchanged (`htmlwasher` unscoped + published; the `@htmlwasher/*` testers private); update the flagship's `package.json` `repository.directory` (the item the naming prompt deferred, now in scope). No `package.json` at a grouping level — `packages/` stays a plain folder (Turborepo errors on group-level package.json).
- `@/pnpm-workspace.yaml` → the three contextractor globs (see the locked workspace decision).
- Fix relative-path depth: the flagship's `tsconfig.json` `extends` gains one `../`; each tester loses one (they were a level deeper under `tools/htmlwasher/`). Sweep every remaining hard-coded path (`grep -rn -E 'tools/htmlwasher|@/htmlwasher/' . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git`) and fix `@/CLAUDE.md` (Project Structure tree + the SPEC.md mapping), root `SPEC.md`, `knip.json`, workflows, and any fixture paths in the same change.
- `pnpm install` (plain — never a frozen/CI install; `pnpm-lock.yaml` is gitignored by repo convention), then autofix to green: a path error is a missed depth/sweep fix; a workspace-resolution error is the globs.
- **Gate:** `pnpm build && pnpm lint && pnpm test` green; `pnpm ls -r --depth -1` shows every package at its new path with its name unchanged; `git status` shows renames + reference fixes only (minimal diff).

### Phase CRATE — the extraction core in Rust

- Verify the `html-cleaning` crate license on crates.io FIRST — the keep-vs-reimplement decision shapes the whole port (Phase POLISH only records the result in `@/NOTICE`). Update `@/CLAUDE.md`'s Local Prerequisites in the same change that introduces the workspace — "No Rust toolchain is required" becomes "required only to rebuild the native crate; committed prebuilds cover TS builds/tests".
- Scaffold the root Cargo workspace and the `htmlwasher-native` crate at `packages/htmlwasher/native/` (a plain lib crate under `cargo test` for now — the `#[napi]` surface arrives at Phase BIND). Port the live extraction path (see the locked strip/keep list): options/result/error types, `dom_query` wrapper, patterns, doc-cleaning with profile injection, link density, the content-node cascade (profile selectors → content rules → `article`/`main` semantic → heuristic scoring incl. the bottom-up paragraph scorer), the fallback cascade, comments, tables with caps, and the serializer + internal text twin in **dual emit modes** — preserve-markup (the default: original tags/attributes, skip guards relocated to DOM passes, DOM-based `textLength`) and the upstream whitelist mode (reference-parity testing only), per the sanitization-ownership decision. Include the `PageType` enum + the 7 `ExtractionProfile` consts; `page_type: Option<PageType>` input drives profile selection (classification lands next phase; default `Article` reproduces classifier-less behavior).
- Replace the `COMMENTS_ARE_CONTENT` thread-local with explicit state. Do not port the dormant modules or dead options.
- Port the v1 core unit-test cases as cargo tests (every `src/core/*.test.ts` — `extract`, `clean`, `main-content`, `dom`, `profile` — plus the `src/profiles/` tests; from `serialize-filtered.test.ts` port the skip-layer/backoff/escaping cases, while its bucket-C emit-whitelist and attribute-policy cases retire with the code or port only against the whitelist parity mode, per doc 09), plus fixture goldens and a malformed-HTML corpus (truncated tags, nested `<body>`, encoding garbage) asserting **no panics** — errors are `Result`s.
- **Gate:** `cargo test --workspace` green; the v1 adbar sanity-harness assertions pass as a cargo test over the same cached pages, adjusted per doc 09 — minimum text length, expected content needles, and no `<script` on the raw preserve-markup output (the hygiene guarantee); the v1 `on*`/`class`/`style` assertions apply only to the whitelist parity mode (for preserve-markup output they re-target washed output at Phase INTEGRATE); kept nodes retain their original `class`/`style`/`data-*` on preserve-markup output for at least one attribute-rich fixture (the positive assertion of the doc 09 payoff); `favor_precision`/`favor_recall`/profile selection observably change output; the `html-cleaning` license is verified compatible.

### Phase CLASSIFY — the page-type cascade + model in Rust

- Port URL heuristics and HTML-signal refinement into `page_type/`. Implement the 189-feature extractor against `@/training/extract_features.py` semantics (the locked TF-IDF/scaler/byte-length/whitespace rules). **Establish byte-exact body-text parity first** — Python parses via selectolax/lexbor, Rust via html5ever; parse-divergence fixtures (nested `<body>`, trailing whitespace text nodes, `<template>`) come before any model evaluation.
- In `training/`: replace the ONNX export with `Booster.save_model` JSON + the feature artifacts; regenerate the parity fixture set (feature vectors + expected argmax + probabilities per fixture page) consumed by BOTH pytest and cargo, committed under `packages/htmlwasher/native/tests/fixtures/`; update training tests; remove `onnxmltools`/`skl2onnx` and `training/model.onnx`. **Training-side removals only:** the shipped `packages/htmlwasher/src/classifier/model/model.onnx`, the `onnxruntime-*` dependencies, and the v1 TS parity fixture `packages/htmlwasher/fixtures/classifier/parity.json` stay untouched until Phase INTEGRATE deletes `src/classifier/` — the v1 suite must remain green through this phase.
- Implement the GBDT evaluator; wire the 3-stage cascade + the exact confidence rules; embed artifacts via `include_str!` with load-time validation. Port the v1 classifier unit-test cases (confidence rules, URL heuristics, HTML signals — `src/classifier/*.test.ts`) as cargo tests in `page_type/`.
- **Gate:** Rust↔Python parity on the fixture set — numeric + TF-IDF vectors match within 1e-6, **argmax 100%**; held-out WCXB accuracy re-reported (expect ≈ 0.777 — same model, same features); training pytest + ruff green.

### Phase BIND — napi-rs surface + packaging

- Add the `#[napi]` surface to the native crate: async `extract` (+ `extractSync`), generated `index.d.ts`/loader, the `npm/<target>/` platform dirs with private `file:`-linked `optionalDependencies`, and the self-skipping build/test scripts — all per the locked contextractor pattern. CI builds and commits the prebuilds for the five native targets + the wasm32-wasip1-threads fallback (npm publishing stays manual while alpha).
- Integrate with the monorepo per the locked workspace/turbo/knip decisions. Add a TS smoke test inside `packages/htmlwasher/native` loading the locally built binding — the package `test` script runs the cargo-test skip pattern followed by the vitest smoke test.
- **Gate:** `pnpm build` produces a loadable binding on the host platform (and self-skips cleanly once a prebuild is committed and no toolchain is configured); the smoke test extracts a fixture page end-to-end from TS; `pnpm lint` (incl. knip) green.

### Phase INTEGRATE — rewire the TS package

- `pipeline.ts`: `runBoilerplate` now maps `boilerplate` mode → `focus`, passes `url`, and calls `@htmlwasher/native`'s `extract()` (a `workspace:*` dependency of the flagship); `'none'` still skips it entirely; the empty-result warn-and-wash-whole-doc behavior is preserved. Delete `src/core/`, `src/classifier/`, `src/profiles/`; move the DOM-parse helper metadata needs into `src/metadata/`; drop `onnxruntime-node`/`onnxruntime-web` and now-unused deps (`linkedom`/`parse5` stay for metadata + washing).
- Keep `types.ts` as the frozen public surface; add a type-level test asserting the public `PageType` union equals the napi-generated one.
- Update TS tests per doc 09's migration map: core/classifier unit tests are gone (their cases live in cargo now, the serializer-whitelist suite retires with the code); the raw-core-output `class=`/`style=`/`on*` assertions re-target `wash()` output; the Phase FLOOR hostile-fixture extraction-path tests now exercise the Rust path; pipeline, washing, metadata, CLI, index/types tests still pass (re-baseline any extraction-path goldens per the Mission's expected-diff list); add a `styled` × `balanced` test asserting `class`/inline-`style` survival through `wash()` — the doc 09 headline payoff. Update `htmlwasher/SPEC.md` (including the new `styled`/`correct` × extraction semantics and the fallback-path markup-loss limitation), the new crate `SPEC.md`s, root `SPEC.md`, `training/SPEC.md`.
- **Gate:** `pnpm build && pnpm lint && pnpm test` fully green — including the offline wash-corpus-tester — with the Rust core underneath and zero public-API change; every deleted `*.test.ts` maps to a named cargo test module or a recorded "retired per doc 09" entry (record the mapping in `PORTING-NOTES.md`).

### Phase VALIDATE — regression against v1

- Run the adbar eval harness (`packages/htmlwasher/test/validation/`): floors unchanged (pages > 50, precision > 0.6, recall > 0.65, F1 > 0.65); target **no regression vs v1's P ≈ 0.79 / R ≈ 0.81 / F1 ≈ 0.80**. The newly live `aggregateSections`/`collectRepeatedItems` passes may move scores — investigate any drop, document any gain, and re-baseline in `PORTING-NOTES.md`.
- Run the wash-corpus-tester across all 7 page types; hard security asserts and the page-type accuracy floor must hold. Compare performance against the v1 baseline captured at Phase ORIENT — expect the Rust core to be faster; document it.
- **Gate:** scores + perf documented in `PORTING-NOTES.md`; no floor regressions.

### Phase RETEST — deep external retest + autofix loop (live pages)

The offline gates (adbar eval, wash-corpus-tester) never see real-page behavior, cross-engine fidelity, or human-like visual quality. Close that gap with the standalone live benchmark at `~/r/htmlwasher-external-tester/` (external by design — it does the one thing the library never does: hit the network), then autofix to the bar. Copy/adapt its methodology — its `benchmark-runner` agent and `run-benchmark` skill are the reference procedure; keep the run honest exactly as they prescribe.

- **Wire it to the v2 build.** The tester consumes htmlwasher as a `file:` dependency — after RESTRUCTURE the flagship lives at `~/r/htmlwasher/packages/htmlwasher`, so update the tester's `file:` path and `pnpm install`, and rebuild htmlwasher's `dist/` first (it imports built output). The tester's rs-trafilatura path dep points at the read-only reference and is unaffected. In from-scratch mode this is the first time the tester points at the new build — verify all four engines run.
- **Run both report pairs** (per the tester's `run-benchmark` skill):
  - **Token report** (`pnpm bench`): fetch the corpus (≥ 30 public pages across the 7 types, cached, ~1 req/sec), run all four engines (htmlwasher, Trafilatura = reference, rs-trafilatura, mozilla/readability), and score token precision/recall/F1 vs the Trafilatura reference + internal median speed + success rate + output size.
  - **Visual report** (`pnpm visual:prep` → the `visual-extraction-judge` workflow, one vision agent per page → `pnpm visual:report`): Claude scores every engine on **completeness** (kept the main content) and **cleanliness** (dropped the boilerplate) against the rendered screenshot — reference-free, and it scores Trafilatura too.
- **Autofix loop (deep, iterative — the point of this phase).** Treat both reports as findings; root-cause each into the responsible layer, fix, rebuild, re-run, and iterate until the bar holds:
  - Rank by impact: per-page / per-type token-F1 regressions (update mode) or gaps vs Trafilatura (from-scratch); visual completeness/cleanliness misses; per-page extractor failures; speed regressions vs the ORIENT baseline.
  - Root-cause honestly into the **Rust core** (extraction / serializer / profiles), the **classifier** (a wrong page type routes the wrong profile), or the **washing stage** (over- or under-stripping) — delegate via `rust-pro` / `ts-pro` / `python-pro` and confirm with `code-reviewer`. Heuristics: a visual "dropped real content" is usually over-aggressive boilerplate removal or a misrouted profile; "kept boilerplate" is the opposite; a token-F1 cliff isolated to one page type points at that type's profile or its classifier accuracy.
  - **Fix root causes, never the benchmark.** Fidelity is reference-relative (agreement with Trafilatura, not human gold); speed is internal extraction time; htmlwasher does more (HTML out + classification + formatting), so its time/size are not like-for-like. **Defaults only — no per-page or per-corpus precision/recall tuning, and never special-case a URL.** A fix that only moves the benchmark is a regression in disguise.
  - After every fix, re-run the offline gates (`pnpm test`, `cargo test --workspace`, the adbar eval) so a live-page win never regresses the offline oracle.
- **Gate:** on the live corpus, htmlwasher shows no per-type token-F1 regression vs the baseline (update mode) / sits in the ballpark of Trafilatura and no worse than rs-trafilatura (from-scratch); visual completeness + cleanliness are not worse than the baseline / are competitive with the reference engines; zero unhandled extractor failures; every offline gate still green. Commit the refreshed `reports/` in the tester and record the run + the fixes it drove in `PORTING-NOTES.md`.

### Phase POLISH — licensing, docs, review

- Licensing: the Rust core is now a **code-level derivative** of rs-trafilatura (MIT OR Apache-2.0) — extend `@/NOTICE` accordingly (Murrough Foley attribution moves to/remains "derived from", now covering shipped Rust code). Keep and re-point the existing derived-from attributions rather than dropping them as stale: adbar/trafilatura (the metadata port still ships unchanged) and go-trafilatura (its tag catalogs/attribute whitelist now reach the shipped crate through rs-trafilatura's lineage — re-point file references from the deleted `src/core/*` to `packages/htmlwasher/native`). Refresh the NOTICE bundled-dependency section (onnxruntime and `model.onnx` out; the napi loader/platform packages and `model.xgb.json` in). Record the `html-cleaning` license verified at Phase CRATE, set crate `license` fields (Apache-2.0, matching the repo), keep WCXB CC-BY-4.0 attribution, keep SPDX headers where substantial code is ported.
- Docs: sync all `SPEC.md`s and `README.md`s; **finish the `@/CLAUDE.md` rewrite** — the toolchain-prerequisite line already flipped at Phase CRATE; now the structure/commands sections gain the crates + cargo entries and rust-analyzer's role changes from read-only-reference to first-class.
- Full-repo review + autofix quality gate: a complete review of the whole repo (per-domain Rust/TS/Python/security checklists, multi-agent with adversarial verification of each finding), **fix every confirmed finding**, then rerun everything (`pnpm build && pnpm lint && pnpm test`, `cargo test --workspace`, `cargo clippy`, training `pytest`/`ruff`). Never silence with `any`/`@ts-ignore`/`#[allow]`.
- **Gate:** the Deliverables checklist below is fully checked.

---

## Testing, review & quality gates

- **Rust:** every ported module gets cargo unit tests (the v1 TS core tests are the case source); fixture goldens for the serializer; the malformed-HTML no-panic corpus; `cargo clippy -- -D warnings`; the Python↔Rust parity suite (feature vectors + argmax) as a cargo test over committed fixture JSON.
- **TypeScript:** the surviving v1 suites (pipeline, washing incl. per-level allow-list + security invariants, metadata, CLI, types) run unchanged via `pnpm test`; plus the binding smoke test and the `PageType` type-equality test.
- **Python:** training pytest keeps the export honest — model-dump validity, feature-vector regeneration, native-XGBoost-vs-exported-prediction agreement.
- **End-to-end:** the adbar eval harness and the wash-corpus-tester are the integration oracles — v1 proved unit tests alone miss integration bugs (the dead-boilerplate-filter incident). Both must run in `pnpm test`, offline.
- **Security (untrusted HTML at every boundary):** the Rust core must never panic on malformed input (errors are typed `Result`s; napi maps them to JS exceptions); resource caps stay (`MAX_TABLE_CELLS` 20,000, `MAX_TABLE_TEXT_LEN` 200,000) plus a real recursion/depth guard — rs-trafilatura's `max_tree_depth` option exists but the live path never enforces it, so make it enforce; `maxInputBytes` is enforced in TS before crossing the FFI; the washing security floor tests (`<script>`, `on*`, `javascript:`/`vbscript:`/untrusted `data:` URLs, dangerous inline CSS, the CSS-URL allow-list) are non-negotiable at every level — and unconditional in v2 (Phase FLOOR), because washing is the single sanitization authority: the crate's `contentHtml` is unsanitized by design (script-free via hygiene only) and must never bypass `washHtml`; no secrets in logs.
- **Docs stay in sync** with any public-surface change, in the same change (spec/test-maintenance rules).

## Offline wash-corpus tester — `packages/wash-corpus-tester/`

Unchanged in role from v1 (it already exists and passes; Phase RESTRUCTURE moves it up from `tools/htmlwasher/`): a separate offline TypeScript project running the saved-fixture corpus (≥ 3 fixtures per page type across all 7 types, multilingual/Czech included) through `wash()` across the relevant `boilerplate` × `level` combinations, asserting non-empty output, the security floor, `correct ⊇ minimal` tag preservation, and page-type plausibility against the manifest; readable summary + report file; non-zero exit on failure; **never hits the network**. v2's changes: it exercises the Rust core underneath, and its security asserts become hard at EVERY level including `correct` (Phase FLOOR retires the stale normalize-only exemption) — keep it green, and remember it imports `htmlwasher` from `dist/` (rebuild first; turbo's `pnpm test` handles ordering).

---

## Constraints, licensing, non-goals

- **Licensing:** rs-trafilatura and web-page-classifier are MIT OR Apache-2.0 — v2 derives Rust code from rs-trafilatura, so attribution in `@/NOTICE` is REQUIRED (retain copyright notices; state changes per Apache-2.0 §4). go-trafilatura, adbar/trafilatura, mozilla/readability: Apache-2.0. The WCXB dataset is CC-BY-4.0 (attribution REQUIRED). Verify the `html-cleaning` crate's license on crates.io before shipping it as a dependency. Do NOT vendor or copy the rs-trafilatura/web-page-classifier embedded model binaries — we train our own from the public dataset.
- **Do not** commit datasets; download in `training/` on demand, `.gitignore` them. Commit only the exported model/feature artifacts and small fixtures.
- **Non-goals:**
  - No conversion — HTML in, HTML out. Never Markdown/XML/TEI/plain text (the crate's text serializer is internal-only).
  - No scraping/crawling/fetching — the library and both testers never touch the network.
  - No granular content toggles — the washing level/config is the single inclusion control.
  - No porting of washing, metadata, decode, or the CLI to Rust.
  - No sanitization in Rust — the crate's HTML output is unsanitized by design (script-free only via extraction hygiene); every output path flows through the TS washing floor (context doc 09).
  - No dormant-path port — rs-trafilatura's go-style `extractor/pipeline.rs` family stays out.
  - No ONNX/onnxruntime at runtime; no reverse-engineering the upstream embedded models.
  - No Cloudflare-Workers-class edge target for the WASM fallback (wasip1-threads needs SharedArrayBuffer); no non-Node runtimes beyond that fallback.
  - No claim-matching against rs-trafilatura's self-reported benchmarks — our own held-out results are the source of truth.

---

## Deliverables checklist

- [ ] Repo restructured to the contextractor layout: flat `packages/*`, `tools/` dissolved, the three contextractor workspace globs, package names unchanged, all suites green.
- [ ] Phase FLOOR landed: the TS security floor is unconditional, the wildcard-`SanitizeConfig` bypass is closed with regression tests, and the corpus tester hard-asserts security at every level including `correct`.
- [ ] `packages/htmlwasher/native/`: the simplified rs-trafilatura fork — live-path extraction, 3-stage page-type cascade, 189-feature extractor, pure-Rust GBDT evaluator over the XGBoost JSON dump, 7 profiles, confidence; the preserve-markup serializer (dual emit modes, skip guards as DOM passes, DOM-based text length); embedded validated artifacts; no network, no panics on malformed HTML; `cargo test` + `clippy` green.
- [ ] The napi-rs v3 surface on that crate — async `extract` + `extractSync`, generated types, committed prebuilds for the five native targets + the wasm32-wasip1-threads fallback via private `file:`-linked platform packages, CI wired (publish manual while alpha).
- [ ] `packages/htmlwasher/`: public `wash()` surface byte-for-byte compatible with v1; washing/metadata/CLI untouched; `src/{core,classifier,profiles}/` deleted; onnxruntime dependencies gone.
- [ ] `training/`: exports `model.xgb.json` + feature artifacts + regenerated parity fixtures; ONNX export removed; pytest + ruff green.
- [ ] Python↔Rust parity: feature vectors within 1e-6, argmax 100% on fixtures; held-out accuracy re-reported.
- [ ] adbar eval: floors hold, no regression vs P ≈ 0.79 / R ≈ 0.81 / F1 ≈ 0.80; results + perf comparison in `PORTING-NOTES.md`.
- [ ] wash-corpus-tester green across all 7 page types, offline, in `pnpm test`.
- [ ] Phase RETEST run: the external live benchmark (token fidelity vs Trafilatura + visual completeness/cleanliness across the four engines) shows no per-type regression vs the baseline / parity with the reference engines; the autofix loop closed every root-caused finding (defaults only, no benchmark-tuning); refreshed `reports/` committed in the tester and the run recorded in `PORTING-NOTES.md`.
- [ ] `@/NOTICE` + crate license fields updated for the code-level rs-trafilatura derivation; `html-cleaning` license verified.
- [ ] All `SPEC.md`s, `README.md`s, and **`@/CLAUDE.md`** (Rust toolchain now required; new structure/commands) in sync — including a real v2 rewrite of the **root `@/SPEC.md`** (hybrid Rust+TS+Python architecture, the napi boundary, the preserve-markup split, the operating modes).
- [ ] This brief updated in place from the run's learnings (corrections folded in, `PORTING-NOTES.md` + context docs current) so it re-runs cleanly from scratch or as an update.
- [ ] Full-repo review + autofix completed; `pnpm build && pnpm lint && pnpm test`, `cargo test --workspace`, `cargo clippy`, training `pytest`/`ruff` all green.

Work incrementally, commit per phase, keep `PORTING-NOTES.md` current, and ask only when a decision cannot be resolved from this brief, the references, or the v1 code.

---

## Keep this brief current — self-improving + spec sync

Every run must leave two living documents better than it found them, so the next run (in either mode) is smoother. Do this continuously as the build proceeds, not only at the end.

- **Update this brief from what the run taught it.** Whenever a phase reveals the brief was wrong, stale, or thin — a reference `file:line` that moved, a locked decision that didn't survive contact with the code, a gotcha a gate should have caught, a step that needed a retry, an assumption that only holds in one mode — fold the correction back into THIS file in the same session (minimal diff): fix the offending sentence in place, append durable gotchas to the "Learnings carried" section below, and record port-level specifics in `@/PORTING-NOTES.md` (and the relevant `context/` doc when the finding is architectural). Treat the brief as re-runnable code, not a frozen artifact — after every session it must still run cleanly from scratch OR as an update. This mirrors `@/.claude/rules/self-improving-prompts.md`.
- **Keep the specs in sync — and rewrite the root `@/SPEC.md`.** Per the repo's spec-maintenance rule, every `SPEC.md` moves in the same change as the code it documents. In particular the **root `@/SPEC.md`** needs a real v2 rewrite: it currently describes the all-TypeScript v1 system, and after the migration it must document the hybrid architecture — the `packages/htmlwasher/native/` Rust crate and the napi boundary, the preserve-markup / TS-owned-sanitization split (context doc 09), the XGBoost-JSON classifier (no ONNX), the contextractor-style layout, and these two operating modes. The package specs (flagship `packages/htmlwasher/SPEC.md`, the native crate, `training/SPEC.md`) and this root spec are all deliverables, not afterthoughts.

---

## Learnings carried from the v1 all-TypeScript build

v1 (Phases 0–8 of the original brief) shipped: ≈369 library tests + the offline corpus tester + training pytests green; classifier held-out accuracy ≈ 0.78 (macro-F1 0.66); TS↔Python feature parity 100%; adbar eval F1 ≈ 0.80 (P 0.79 / R 0.81). Its hard-won gotchas, re-scoped to v2:

- **Parser parity is the crux — the frontier just moved.** v1 fought linkedom↔selectolax divergence (nested `<body>`, trailing whitespace text nodes, `<template>` handling) to get byte-exact classifier features; v2 fights html5ever↔selectolax on the same fixtures. Establish byte-exact body-text parity fixtures BEFORE evaluating the model, and keep the UTF-8-byte-length, CPython-whitespace, and comma-union-non-dedup disciplines — JS/Rust `\s`-style classes and UTF-16 lengths both diverge from Python, and selectolax counts a node once per matching comma-union sub-selector.
- **The name-based boilerplate filter and attribute visibility (resolved structurally in v2, with a mirror-image trap).** v1's filter was silently dead because `postCleaning` stripped `class`/`id` before the serializer's name guard ran; unit tests passed anyway because they exercised the serializer in isolation. v2's preserve-markup design removes the attribute-stripping stage entirely, so that hazard class disappears — but its mirror image appears: the emit-time name guard must NOT act on the backoff path now that it can see `class`/`id` again, or it re-empties exactly the output the backoff saves (collection/listing pages live in boilerplate-named containers). Port the v1 backoff test to cargo as the regression guard, and prove the ordering with an integration test, not just unit tests.
- **End-to-end validation catches what unit tests cannot.** The adbar eval + corpus tester surfaced the dead-filter bug; run them at every phase gate after INTEGRATE, and finish with a multi-agent full-repo review — it paid for itself in v1.
- **Artifact hygiene:** validate shipped model/vocab artifacts at load (v2: at `include_str!` parse time); the corpus tester imports `htmlwasher` from `dist/` — rebuild before direct runs.
- **Retired with v2:** the onnxruntime exact-pinning rule (1.21.x–1.22.x TreeEnsemble bugs) — no ONNX at runtime; the linkedom fragment-wrapping and `nextElementSibling` DOM quirks — extraction no longer runs on linkedom (metadata still does; its code already handles them).

## Learnings carried from the v2 hybrid Rust+TS build (fold into a re-run)

The v2 build (ORIENT→POLISH) shipped green: crate `cargo test` 100 + clippy/fmt; flagship 218 + corpus PASS; training pytest 17 + ruff; Rust↔Python parity exact (numeric ≤ 3.4e-13, argmax 100%); adbar F1 ≈ 0.83 (lift over v1); Rust core ~3× faster; external bench token-F1 ≈ 0.873 (within −0.008 of rs-trafilatura). Durable corrections for a re-run (details in `@/PORTING-NOTES.md`):

- **`html-cleaning` is version-locked to the WRONG `dom_query`.** The brief says "keep `html-cleaning` ... reimplement only if the license check fails." The license PASSES (MIT OR Apache-2.0) but `html-cleaning 0.3` pins `dom_query 0.24`, whose `Document` type is incompatible with the mandated `dom_query 0.28` — two non-interoperable DOM trees. So bucket-B cleaning was ported directly from the tested v1 `clean.ts` instead (license-clean; no `@/NOTICE` entry needed). Re-run: either pin `dom_query 0.24` to keep `html-cleaning`, or port cleaning directly (recommended).
- **napi packaging gotchas.** `napi-build` maxes at v2 (versioned independently of `napi`/`napi-derive` v3) — use `napi-build = "2"`. `unsafe_code` must be **`deny`, not `forbid`** — `napi-derive`'s generated addon code needs `unsafe` behind a local `#[allow(unsafe_code)]`, which `forbid` rejects. **Do NOT use `#[napi(string_enum)]` const enums** for the boundary types — bundlers (esbuild/vitest) ERASE const enums at runtime, so callers pass raw wire strings that the const-enum type rejects; use `String` fields + `#[napi(ts_type = "'a' | 'b'")]` string-literal unions (matches the frozen public API too). Put napi behind a default-OFF `napi` cargo feature so `cargo test/build/clippy` stay pure-Rust (integration tests link the lib built without `cfg(test)`, so Node-API symbols otherwise leak and fail to link).
- **The GBDT must evaluate splits in float32.** XGBoost stores features/thresholds as f32; comparing in f64 branches differently near a threshold and shifts probs by up to ~0.31 on some pages (argmax unaffected). Cast `(v as f32) < (thr as f32)`. `base_score` (0.5) is inert under softmax; `default_left` never fires on the always-dense 189-vector.
- **htmlwasher is NOT consumable via plain `file:` outside its monorepo.** The flagship deps `@htmlwasher/native: workspace:*`, which errors (`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`) under a `file:` install (e.g. the external tester). The brief's alpha plan ("ships the needed prebuilds inside its own tarball while alpha") is UNIMPLEMENTED — remaining packaging work. Workaround for local consumers: a `pnpm.overrides` mapping `@htmlwasher/native → file:.../native`.
- **The security floor is more than `<script>`/`on*`/schemes.** doc-08's floor spec (drop `<iframe>`/`<object>`/`<embed>`/`<applet>`/`<base>`, `<meta http-equiv>`) was under-implemented — a POLISH multi-agent review caught a real `<iframe srcdoc="<script>…">` stored-XSS (srcdoc is inline HTML, not a URL nor `on*`, so scheme filtering never neutralizes it). `enforceSecurityFloor` must drop the full embedding/navigation vector set + `srcdoc`, since the floor is now the SOLE sanitizer. Keep the multi-agent adversarial review — it earned its keep.
- **Classifier mis-routing → port the baseline rescue.** ~1-in-8 pages are mis-typed (0.777 accuracy); a mis-type routes the wrong profile and can catastrophically under-extract (e.g. a blog post typed `documentation` → 4 words). rs-trafilatura's profile-INDEPENDENT baseline rescue + external-candidate comparison recover content regardless of profile — port them (the CRATE keep-list includes them; they were deferred and added in the RETEST autofix, lifting article F1 0.883 → 0.931). Still deferred: `aggregate_sections`/`collect_repeated_items`, the Discourse/Product structured rescues, and the content-SELECTION gap on very large single-node bodies (Gutenberg-class).
