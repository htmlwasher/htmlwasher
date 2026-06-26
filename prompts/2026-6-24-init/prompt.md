# Claude Code Brief — Build htmlwasher (HTML Washer), a TypeScript HTML-cleanup library

**Created:** 2026-06-24
**Author of brief:** prepared for Miroslav Sekera (Glueo s.r.o.)
**For:** Claude Code, run from the repository root.

---

> **TLDR**: Phased brief for Claude Code to build **htmlwasher** — a TypeScript library that takes HTML in and returns cleaned HTML out (no conversion to Markdown/XML/TEI/text, no scraping). It combines a **Trafilatura-derived boilerplate-removal core** (page-type-aware, with a from-scratch ONNX page-type classifier and per-type profiles) that emits HTML, gated by a `Precision | Balanced | Recall | None` mode, with an **HTML washing/sanitization stage** (`Minimal | Standard | Permissive | Styled | Correct` levels, modeled on the `sanitize-html`-based htmlprocessing-server pipeline). Work the build order in §5, leaning on the Trafilatura reference repos under `~/r/htmlwasher-sources/` and the htmlwasher/contextractor reference projects under `~/r/tools` and `~/r/contextractor`. Use when implementing htmlwasher.

---

## 0. Mission

Build a faithful, well-tested **TypeScript HTML-cleanup library, `htmlwasher`**, that takes **HTML in and returns cleaned HTML out** — never converting to Markdown, XML, XML/TEI, or plain text, and never fetching/scraping the web. It has two composable pillars:

1. **Boilerplate removal** — a Trafilatura-derived main-content extraction core (article/main-content detection, comment + table handling, the readability/dom-distiller-style fallback cascade), **page-type-aware** (7 types: `article, forum, product, collection, listing, documentation, service`) via an **ONNX page-type classifier** and **per-page-type extraction profiles + a confidence score**, as in rs-trafilatura. It keeps the main content **as HTML** (the extracted DOM subtree — never serialized to text/markdown), gated by a boilerplate-mode enumeration `Precision | Balanced | Recall | None`.
2. **HTML washing (cleanup/sanitization)** — a sanitization + normalization stage modeled on the existing **htmlprocessing-server** project (`~/r/tools/packages/htmlprocessing-server`, built on `sanitize-html`), exposing a washing-level enumeration `Minimal | Standard | Permissive | Styled | Correct`.

Both enumerations are **plain string-union / `as const`-array types, NOT TypeScript `enum`s** (mirror htmlprocessing-server's `PROCESSING_MODES = [...] as const` pattern).

Also build: **comprehensive unit tests** for every module, **golden parity tests** against the reference implementations, and a separate **offline** end-to-end "wash corpus" tester in `tools/` (saved HTML fixtures in → cleaned HTML out; **no network**).

This is a *rename + recombination*, not a from-scratch design: it keeps the full existing htmlwasher functionality (now renamed **htmlwasher**) — including the page-type classifier you train yourself and export to ONNX — and **adds** the htmlwasher HTML-cleanup levels, while constraining all output to HTML and dropping every conversion and all scraping. Lean heavily on the existing implementations listed below.

---

## 1. Read these first (required context)

Before writing any code, read the research documents in this folder's `context/` directory. They are syntheses of deep-research sessions and contain the full technical analysis behind the boilerplate-removal pillar — reading them will save you from dead ends.

**Core docs (read in order — these are mandatory):**

- [`./context/01-trafilatura-forks-and-ports-landscape.md`](./context/01-trafilatura-forks-and-ports-landscape.md) — the Python -> Go -> Rust lineage and which repo is authoritative for what.
- [`./context/02-rs-trafilatura-skeptical-assessment.md`](./context/02-rs-trafilatura-skeptical-assessment.md) — why rs-trafilatura's benchmark claims are unverified, and why we validate on our own data.
- [`./context/03-classifier-reimplementation-feasibility.md`](./context/03-classifier-reimplementation-feasibility.md) — **the most important one for Phase 4**: exactly how the classifier works, the 189 features, the ONNX path, training requirements, and licensing. Follow its recommendations.

**Supporting docs (read selectively — they expand on specific decisions):**

- [`./context/08-html-output-cleanup-pipeline-and-security.md`](./context/08-html-output-cleanup-pipeline-and-security.md) — **the htmlwasher-specific synthesis (read before Phases 2, 5, 6)**: how to emit the kept content as a whitelist-re-rendered HTML subtree (NOT verbatim `outerHTML`), the boilerplate-mode → `favor_precision`/`favor_recall` thresholds, the exact washing-level presets, the 2026 library choices (`sanitize-html` ≥ 2.17.2 default + DOMPurify hardened opt-in; parse5/prettier/html-minifier-terser/linkedom/onnxruntime versions), and the untrusted-HTML security model. Grounded in deep reads of `~/r/htmlwasher-sources/`, `~/r/tools/packages/htmlprocessing-server`, and `~/r/contextractor`.
- [`./context/07-classifier-bilingual-port-deep-dive.md`](./context/07-classifier-bilingual-port-deep-dive.md) — **companion to doc 03**: deeper analysis of ONNX vs native bindings vs m2cgen, training compute (no GPU needed), feature-extraction library picks (selectolax for Python, htmlparser2 for TS), and the *reuse-vs-rebuild* verdict (**rebuild fresh** — the rs-trafilatura model is a custom non-XGBoost-native binary). Read alongside doc 03 when implementing Phase 4.
- [`./context/06-ml-extraction-landscape.md`](./context/06-ml-extraction-landscape.md) — adjacent context on the 2026 ML extraction landscape (MinerU-HTML, ReaderLM, Docling, VLMs). **Not directly required for htmlwasher**, but useful for: (a) the licensing-trap table when evaluating any neural addition, (b) future "neural fallback" routing of low-confidence pages, (c) why we *don't* go neural for the classifier itself.
- [`./context/04-niche-opportunities-map.md`](./context/04-niche-opportunities-map.md) — strategic positioning map (forums, multilingual, WARC, Lambda, EU residency). **Not prescriptive for htmlwasher**, but useful for: (a) framing the README positioning, (b) choosing test fixtures aligned with target niches (forums and multilingual are high-value), (c) understanding why bundle size and deployment surface matter.
- [`./context/05-crawlee-playwright-hybrid-stack.md`](./context/05-crawlee-playwright-hybrid-stack.md) — analysis of Crawlee + Playwright + Trafilatura as a production-scraper stack. **Out of scope for htmlwasher** (it is a library, not a scraper — htmlwasher never fetches), but useful background for understanding why the E2E tester in `tools/` is a thin **offline** fixture harness and *not* a crawler. (See Contextractor, below, for where the scraping/crawling concern lives — htmlwasher deliberately does not.)

### Primary sources cited in the research (for tracing & verification)

The context docs above are syntheses; the underlying primary sources are below. Consult them directly when you need ground truth (the local `context/` files are the reasoning; these links are the evidence).

**Trafilatura implementations — the boilerplate-removal pillar (cloned into `~/r/htmlwasher-sources/`, see Section 2):**
- Upstream Trafilatura (adbar): https://github.com/adbar/trafilatura  · docs https://trafilatura.readthedocs.io/  · PyPI https://pypi.org/project/trafilatura/
- go-trafilatura (markusmobius): https://github.com/markusmobius/go-trafilatura
- trafilatura-rs (nchapman, faithful Rust port): https://github.com/nchapman/trafilatura-rs
- rs-trafilatura (Murrough-Foley, the divergent fork): https://github.com/Murrough-Foley/rs-trafilatura
- web-page-classifier (the XGBoost classifier crate): https://github.com/Murrough-Foley/web-page-classifier
- mozilla/readability (JS/DOM idiom reference): https://github.com/mozilla/readability

**htmlwasher cleanup + boilerplate-mode references (local sibling projects — read-only):**
- HTML Washer product: https://www.htmlwasher.com/  · the cleanup engine `~/r/tools/packages/htmlprocessing-server` (the `sanitize-html` pipeline + the Minimal/Standard/Permissive/Styled/Correct presets) · the API `~/r/tools/apps/htmlwasher-api` · the site `~/r/tools/apps/htmlwasher-site`
- Contextractor (boilerplate-mode Precision/Balanced/Recall mapping to favor_precision/favor_recall): https://www.contextractor.com/  · `~/r/contextractor` · the site `~/r/tools/apps/contextractor-site`
- `sanitize-html` (the cleanup library): https://www.npmjs.com/package/sanitize-html
- `parse5` (WHATWG-compliant normalization): https://www.npmjs.com/package/parse5  · `prettier` (HTML pretty-print) https://prettier.io/  · `html-minifier-terser` (minify) https://www.npmjs.com/package/html-minifier-terser

**The classifier model, dataset & benchmarks (needed for Phase 4 training):**
- WCXB benchmark paper (Murrough Foley, arXiv preprint — *not peer-reviewed*): https://arxiv.org/abs/2605.21097
- WCXB dataset (CC-BY-4.0) on Hugging Face: https://huggingface.co/datasets/murrough-foley/web-content-extraction-benchmark
- WCXB dataset on Zenodo (DOI 10.5281/zenodo.19316874): https://doi.org/10.5281/zenodo.19316874
- WCXB leaderboard (author-run): https://webcontentextraction.org/
- ScrapingHub Article Extraction Benchmark (the one neutral benchmark): https://github.com/scrapinghub/article-extraction-benchmark
- Author's write-ups on rs-trafilatura: https://murroughfoley.com/rs-trafilatura-rust-web-content-extraction/  · https://dev.to/murroughfoley/rs-trafilatura-page-type-aware-web-content-extraction-in-rust-2ppf

**Independent academic context (why heuristics + per-type routing, not neural):**
- Bevendorff, Gupta, Kiesel & Stein, "An Empirical Comparison of Web Content Extraction Algorithms," SIGIR '23 (DOI 10.1145/3539618.3591920): https://downloads.webis.de/publications/papers/bevendorff_2023c.pdf
- Barbaresi, "Trafilatura: A Web Scraping Library...," ACL-IJCNLP 2021 System Demonstrations (DOI 10.18653/v1/2021.acl-demo.15): https://aclanthology.org/2021.acl-demo.15/

**ONNX / inference (Phase 4 export & Node runtime):**
- ONNX tree operators (ai.onnx.ml): an XGBoost model exported via onnxmltools currently emits a `TreeEnsembleClassifier` node (https://onnx.ai/onnx/operators/onnx_aionnxml_TreeEnsembleClassifier.html), deprecated since ai.onnx.ml v5 in favor of the consolidated `TreeEnsemble` (https://onnx.ai/onnx/operators/onnx_aionnxml_TreeEnsemble.html), which onnxmltools does not yet emit
- onnxruntime-node: https://www.npmjs.com/package/onnxruntime-node  · onnxruntime-web: https://www.npmjs.com/package/onnxruntime-web
- skl2onnx / onnxmltools (XGBoost -> ONNX export): https://onnx.ai/sklearn-onnx/  · https://github.com/onnx/onnxmltools

> Note: the arXiv ID and Zenodo DOI above are as recorded during research (mid-2026); if a link 404s, search the title. The `context/` docs flag which figures are author-self-reported vs independently verified — keep that distinction when reading the primary sources.

---

## 2. Source repositories & AUTHORITY HIERARCHY

The Trafilatura source repos are cloned by `@/clone-other-repos.sh` into **`~/r/htmlwasher-sources/`** (confirm the location before starting; if they are elsewhere, ask). Each repo has a defined role. **When sources disagree, follow this hierarchy:**

| Repo (local path) | Role | Authority |
|---|---|---|
| `~/r/htmlwasher-sources/rs-trafilatura` | **Primary port target.** Page-type-aware architecture, per-type extraction profiles, confidence scoring, classifier wiring, `favor_precision`/`favor_recall` toggles. | Defines **WHAT** to build (the feature set & architecture). |
| `~/r/htmlwasher-sources/web-page-classifier` | **The classifier.** The 189 features (89 numeric + 100 TF-IDF), the 3-stage URL->HTML->ML cascade, the 7 page types. | Defines the **classifier behavior & features** to replicate byte-for-byte. |
| `~/r/htmlwasher-sources/go-trafilatura` | **Faithful core reference.** Near line-by-line Go port of the Python original; cleanest readable source for the extraction algorithm. | **Disambiguator** for extraction logic when rs-trafilatura is unclear. |
| `~/r/htmlwasher-sources/trafilatura` (adbar) | **Canonical original.** Ground-truth semantics for every option, metadata rules, edge cases, AND the **test corpus**. | **Final authority** on extraction *semantics* and the validation oracle. |
| `~/r/htmlwasher-sources/trafilatura-rs` (nchapman) | Faithful Rust port. | Cross-check / tiebreaker. |
| `~/r/htmlwasher-sources/readability` (mozilla) | NOT Trafilatura. Canonical JS/DOM readable-content extractor. | **TS/DOM idiom reference only** — how to structure DOM traversal in JS. |

**Cleanup-pillar references (NOT in `~/r/htmlwasher-sources/` — read-only sibling projects under `~/r/`):**

| Project (local path) | Role | Authority |
|---|---|---|
| `~/r/tools/packages/htmlprocessing-server` | **The HTML-washing engine.** The `sanitize-html` pipeline (decode -> parse5 normalize -> sanitize -> DOCTYPE -> prettier/minify) and the `Minimal/Standard/Permissive/Styled` `SanitizeConfig` presets + the `Correct` (normalize-only) mode. | Defines the **washing levels & cleanup pipeline** to replicate (ignore its `*-reader` Readability variants — htmlwasher uses the boilerplate pillar instead). |
| `~/r/tools/apps/htmlwasher-api`, `~/r/tools/apps/htmlwasher-site`, https://www.htmlwasher.com/ | The product wrapping that engine (API contract, level copy). | **Product positioning** for the washing levels. |
| `~/r/contextractor`, `~/r/tools/apps/contextractor-site`, https://www.contextractor.com/ | Content extraction on rs-trafilatura: the `precision`/`balanced`/`recall` modes that map to `favorPrecision`/`favorRecall`. | **Reference for the boilerplate-mode mapping** (htmlwasher adds `None`). |

**Rule of thumb:** rs-trafilatura + web-page-classifier tell you *what features and architecture to build* for boilerplate removal; go-trafilatura + adbar tell you *how the extraction must actually behave*; htmlprocessing-server tells you *how the HTML washing must behave*. rs-trafilatura is a divergent fork, so treat its extraction internals as intent and verify behavior against go-trafilatura/adbar. **Never edit any read-only reference** under `~/r/htmlwasher-sources/`, `~/r/tools`, or `~/r/contextractor`.

---

## 3. Locked technical decisions

Do not redesign these — they are settled in the research:

1. **Language/runtime:** TypeScript on Node.js (target the LTS in use). Strict mode (`"strict": true`).
2. **DOM:** parse HTML with a real DOM library — prefer **linkedom** (fast and lenient — it parses HTML via **htmlparser2** under the hood, not parse5) as the primary DOM; use **parse5** for WHATWG-spec-compliant **normalization** in the washing pipeline; `cheerio` acceptable only where a jQuery-like API is genuinely simpler. Pick ONE primary DOM and be consistent. Document the choice. Note: context doc 07 also flags **htmlparser2** as the speed leader for feature extraction (Cheerio Issue #1259 notes parse5 is ~½ htmlparser2's speed) — and it is the same parser linkedom wraps — so consider htmlparser2 specifically inside the classifier's feature extractor where it's a tight inner loop.
3. **Output is HTML, always.** `htmlwasher` takes HTML in and returns cleaned **HTML** out. **No conversion** — no Markdown, no XML, no XML/TEI, no plain text. The boilerplate-removal pillar keeps the extracted main content as an HTML subtree, emitted by **re-serializing the kept node through a tag/attribute whitelist** (port go-trafilatura's `postCleaning` + rs-trafilatura's `push_filtered_html_children` — NOT a verbatim `outerHTML` of the original subtree, which would leak boilerplate and untrusted markup; see context doc 08 §1); the washing pillar returns sanitized/normalized HTML. (Metadata — title/author/date — may be returned as an optional sidecar object alongside the HTML, but is never the content output and never replaces it; see Phase 3.)
4. **Two orthogonal, composable knobs — both plain string unions, NOT TS `enum`s** (use `as const` arrays + a union type, like htmlprocessing-server's `PROCESSING_MODES`):
   - **Boilerplate-removal mode** — `'precision' | 'balanced' | 'recall' | 'none'`. Maps to the Trafilatura/rs-trafilatura toggles exactly as contextractor does (`~/r/contextractor/packages/crawler/src/createCrawler.ts`): `precision` -> `favor_precision` (less noise, may miss content); `balanced` -> neither flag (neutral default); `recall` -> `favor_recall` (more content, may include noise); **`none` -> skip boilerplate removal entirely** (wash the whole document). `none` is htmlwasher's addition — contextractor has no `none`.
   - **HTML washing level** — `'minimal' | 'standard' | 'permissive' | 'styled' | 'correct'`. Reproduce the htmlprocessing-server presets (see Phase 6). `standard` is the default. There are **exactly these five** — do NOT add `*-reader` variants (no "Minimal Reader", etc.); the Readability-preprocessing concern is handled by the boilerplate pillar instead.
   - **The washing level is htmlwasher's ONLY content-inclusion control.** There are deliberately **no `include_comments` / `include_tables` / `include_images` / `include_links` toggles** — those old Trafilatura/contextractor checkboxes **do not exist** in htmlwasher. What survives is decided by the level's tag allow-list: images appear only at `standard`+ (never `minimal`); classes + inline `style` + `<style>` only at `styled`; tables and links (`<a href>`) survive at every level. Comments are governed automatically by the page-type profile (forums treat comments as content), not by a user toggle.
5. **HTML washing engine:** model the cleanup on `~/r/tools/packages/htmlprocessing-server` — use **`sanitize-html`** (the library it uses; pin **≥ 2.17.2** for the CVE-2026-40186 fix) as the default sanitizer, with an **opt-in DOMPurify + jsdom "hardened" mode behind the same interface** for callers who re-render output into a live DOM/email/webview; **parse5** (≥ 8.x) for normalization, **prettier** (`parser: "html"`) for pretty output and **html-minifier-terser** for the `minify` option (note it is the maintained fork of the abandoned `html-minifier`, itself quiescent — `html-minifier-next` is an alternative), and **chardet + iconv-lite** to decode non-UTF-8 buffers. `sanitize-html` is the proven default and matches the reference. **Security is non-negotiable at EVERY level (including `styled` and `correct`):** always strip `<script>`, all `on*` event-handler attributes, and `javascript:`/untrusted `data:` URLs (replicate htmlprocessing-server's `filterEventHandlers`); the `styled` level must additionally run a **CSS-URL allow-list** because `sanitize-html` does NOT filter inline-`style` URLs by default. See context doc 08 §5–6 for the full library analysis + security checklist.
6. **Classifier model:** **retrain a standard XGBoost model from the public WCXB dataset and export to ONNX.** Do NOT try to reverse-engineer rs-trafilatura's embedded ~1.1 MB custom binary — it is not XGBoost-native or ONNX, and reversing it is wasted effort (see context docs 03 and 07).
7. **Inference in Node:** **onnxruntime-node** by default. Also provide an **onnxruntime-web (WASM)** path behind the same interface for zero-native-binary / serverless deployment. Keep inference behind an `interface PageTypeClassifier` so the backend is swappable. **Pin a known-good onnxruntime version (≥ 1.23.0)** — 1.21.x–1.22.x carry two TreeEnsemble correctness bugs that hit small/shallow XGBoost trees (the `is_leaf`/root-branch-as-leaf bug #24679→#25410, and the category-only-trees `same_node_` bug #24636→#24654), both fixed in 1.23.0; current stable is 1.27.0 (see context doc 08 §5.1).
8. **Feature parity is the hard part, not the trees.** The 189 features (89 numeric DOM/URL + 100 TF-IDF) MUST be computed identically to how the model was trained, or predictions diverge. Train the model and compute features from the SAME TypeScript feature-extraction code path wherever possible (see Phase 4), and lock the TF-IDF vocabulary + IDF weights as a shipped JSON artifact. **Feature-count caveat:** web-page-classifier's code is authoritative — `N_NUMERIC_FEATURES = 89`, its embedded binary header, and the live feature extractor all use **89 numeric** (189 total); the README *body* still says 81/181, so trust the source. **TF-IDF gotcha:** scikit-learn's default (`smooth_idf=True`) uses a nonstandard `idf = ln((1+n)/(1+df)) + 1` with L2 normalization (the bare `ln(n/df) + 1` is only the non-default `smooth_idf=False` form) — replicate whichever the training uses, exactly.
9. **Determinism:** tree models are threshold comparisons and are cross-platform deterministic once features match — exploit this for reproducible golden tests. **Compare argmax class, not exact probabilities**, in cross-language parity tests (small float-handling differences across runtimes can flip borderline probability values).

---

## 4. Project structure to create

The TypeScript library is the **htmlwasher** package (npm name `htmlwasher`). Place it inside this product repo. First inspect the existing layout of `@/` (the repository root) and integrate cleanly (it is a pnpm/turbo workspace, so add it as a workspace package). Proposed layout:

```
@/
  clone-other-repos.sh               # clones the 6 Trafilatura reference repos OUTSIDE the repo,
                                     #   into the sibling dir ~/r/htmlwasher-sources/ (NOT in this repo):
                                     #   rs-trafilatura web-page-classifier go-trafilatura
                                     #   trafilatura trafilatura-rs readability
  prompts/2026-6-24-init/            # this brief (prompt.md) + context/ research docs
  htmlwasher/                        # the TS library (HTML in -> cleaned HTML out)
    src/
      core/                          # boilerplate removal: main-content extraction -> HTML subtree
      metadata/                      # optional metadata sidecar (title/author/date/...)
      classifier/
        features/                    # the 189-feature extractor (from web-page-classifier)
        model/                       # model.onnx + tfidf-vocab.json (shipped artifacts)
        classifier.ts                # PageTypeClassifier interface + onnx backends
      profiles/                      # per-page-type extraction profiles + confidence
      washing/                       # HTML washing: sanitize-html presets + normalize/format
        presets/                     # minimal, standard, permissive, styled (SanitizeConfig)
        wash.ts                      # level union + sanitize/normalize/format pipeline
      pipeline.ts                    # orchestrates decode -> classify -> profile -> boilerplate(mode) -> wash(level) -> format
      index.ts                       # public wash() API
      cli.ts                         # offline CLI entry (bin: htmlwasher) + cli-program.ts — file/stdin -> stdout, NEVER fetches
    test/                            # unit tests (mirrors src/)
    fixtures/                        # saved HTML + expected cleaned-HTML output (golden tests)
    package.json
    tsconfig.json
    README.md                        # incl. licenses/attribution (see Section 8) + CLI usage
    SPEC.md                          # public API + module behavior (keep in sync with code)
  training/                          # model training (Python, run offline, NOT shipped)
    download_wcxb.py                 # fetch dataset from HF/Zenodo
    extract_features.py              # 189 features (parity with TS extractor)
    train.py                         # XGBClassifier -> model.onnx + tfidf-vocab.json
    requirements.txt
    README.md
    SPEC.md
  tools/
    wash-corpus-tester/              # OFFLINE E2E over saved HTML fixtures (Section 7) — no network
  SPEC.md                            # root: system overview, architecture, stack, build
  README.md                          # root: repo overview + quick start (library + CLI)
```

Every package and the repo root carries a `SPEC.md`; keep each `SPEC.md` AND
`README.md` in sync with the code in the same change that touches the public
surface (the repo enforces this via its spec/test-maintenance rules).

The public API is roughly (note: `wash()` is **async** — the washing formatter
and the ONNX classifier load lazily):

```ts
wash(html: string, options?: {
  boilerplate?: 'precision' | 'balanced' | 'recall' | 'none'  // default 'balanced'
  level?: 'minimal' | 'standard' | 'permissive' | 'styled' | 'correct'  // default 'standard'
  minify?: boolean                                            // default false (prettier-format)
  url?: string                                                // context only — NEVER fetched
}): Promise<{
  html: string; messages: Message[]; metadata?: Metadata;
  pageType?: PageType; confidence?: number                    // set when extraction runs (omitted for boilerplate:'none')
}>
```

The two knobs are orthogonal: any boilerplate mode combines with any washing level (e.g. `boilerplate: 'balanced'` + `level: 'standard'`). These two (plus `minify`) are the **entire** user-facing surface — there are deliberately **no `includeComments` / `includeTables` / `includeImages` / `includeLinks` options**. The washing `level` is the single tag-inclusion knob (it subsumes images/tables/links), and comments are decided by the classified page type.

**CLI (offline) — same surface, both bin and lib.** Ship a `htmlwasher` CLI
(`bin: htmlwasher` → `dist/cli.js`, plus an `./cli` export) built on `commander`,
modeled on **contextractor** (<https://www.contextractor.com/>; local
`~/r/contextractor/packages/standalone` — `cli.ts` + `cli-program.ts`,
`#!/usr/bin/env node` + an `isMainEntry` guard wrapping a testable `runWash(opts, io)`
core) — but **offline only**: it NEVER fetches a URL (contextractor crawls; htmlwasher
does not). It reads an HTML **file
argument** or **stdin** (`-`/omitted) and writes cleaned HTML to **stdout** (or
`-o <file>`); diagnostics + the `[pageType confidence]` line go to **stderr**. The
Unix-pipe convention (file arg for the common case, stdin for piping, stdout for
composition) is deliberate. Options map 1:1 to `wash()`: `-b/--boilerplate`,
`-l/--level`, `-m/--minify` (surfaces the same minify switch), `-u/--url` (context
only), plus `--json` (emit the full result object), `-o/--output`, `-q/--quiet`.
Set `process.exitCode` rather than calling `process.exit()` mid-pipe so stdout
flushes.

---

## 5. Build order (phased, with explicit "definition of done" gates)

Work phase by phase. **Do not advance until the phase's gate passes.** Commit after each phase.

### Phase 0 — Orientation
- Read the three core `context/` docs (01, 02, 03) and skim the four supporting docs (04, 05, 06, 07). Skim the six Trafilatura source repos and the `~/r/tools/packages/htmlprocessing-server` cleanup engine. Map go-trafilatura's file structure (cleanest read) and htmlprocessing-server's pipeline to your planned `src/` layout. Write a short `PORTING-NOTES.md` recording the mapping and any open questions.

### Phase 1 — Scaffold
- Initialize the `htmlwasher` TS package: strict tsconfig, a test runner (**vitest** preferred), linting (your call), and a CI-friendly `pnpm test`.
- **Gate:** `pnpm test` runs (even with a trivial passing test); `tsc --noEmit` is clean.

### Phase 2 — Boilerplate-removal core (emits HTML)
- Port the core extraction algorithm from **go-trafilatura** (disambiguating against **adbar** semantics): main-content detection, the readability/dom-distiller-style fallback cascade, comment extraction, table handling, and the precision/recall toggles. **Keep the result as an HTML subtree** — do NOT serialize to text/markdown/XML. Emit it via a **whitelist re-serializer**: port go-trafilatura's `postCleaning` (attribute allow-list + empty-node prune, `html-processing.go:401`) and rs-trafilatura's `push_filtered_html_children` (tag/attribute whitelist, unwrap non-whitelisted tags, skip boilerplate inline, `src/extract.rs:2700`). Keep a **generous** content tag set here (headings, paragraphs, lists, blockquotes, code, **tables, links with `href`, images**, structural wrappers) so the washing level — not a per-content toggle — does the final narrowing; do NOT re-expose the reference's `include_tables`/`include_links`/`include_images` options. See context doc 08 §1.
- Write **unit tests per module** as you go.
- **Gate:** unit tests cover each core function; a handful of adbar test-corpus pages yield a sensible main-content **HTML** fragment.

### Phase 3 — Metadata (optional sidecar)
- Port metadata extraction (title, author, date, URL, sitename, description, tags) from adbar/go-trafilatura, including JSON-LD, OpenGraph, and meta-tag handling. This is returned as an **optional sidecar object** alongside the cleaned HTML — it never replaces or converts the HTML content.
- **Gate:** unit tests for each metadata field against known fixtures.

### Phase 4 — Feature extraction + the ML classifier (the crux)
- In `training/`, implement `extract_features.py` reproducing the **189 features** (89 numeric DOM/URL signals + 100 TF-IDF) exactly as described in web-page-classifier (read its source for the precise feature list, ordering, normalization, and missing-value handling).
- In `src/classifier/features/`, implement the **same** extractor in TypeScript. These two MUST agree.
- `download_wcxb.py`: fetch the WCXB dataset (CC-BY-4.0) from Hugging Face `murrough-foley/web-content-extraction-benchmark` (or Zenodo DOI `10.5281/zenodo.19316874`).
- `train.py`: train an `XGBClassifier` (200 trees, max_depth 8, `multi:softprob`, 7 classes, SMOTE oversampling), export to **`model.onnx`** via `onnxmltools`/`skl2onnx`, and emit **`tfidf-vocab.json`** (vocabulary + IDF weights). Copy both into `src/classifier/model/`. **No GPU needed** — context doc 07 confirms training takes seconds-to-minutes on CPU at this scale (~1,500–10,000 samples, 189 features, 200 trees).
- Wire `src/classifier/classifier.ts`: load `model.onnx` with onnxruntime-node, implement the **3-stage cascade** (URL heuristics -> HTML signal analysis -> ML), and return `(pageType, confidence)`.
- **Golden parity tests (critical):** build a fixture set of WCXB pages; assert the **TS feature extractor produces the same feature vectors** as the Python one (export Python vectors to JSON, compare), and that the ONNX model yields the same `argmax` class. **Target >=99% exact feature match**; investigate any mismatch as a bug.
- **Gate:** classifier reproduces the trained model's predictions in Node; feature parity >=99%; report classifier accuracy on a held-out split.

### Phase 5 — Per-type profiles + confidence + boilerplate modes
- Port the **per-page-type extraction profiles** and **confidence scoring** from rs-trafilatura: route boilerplate removal based on the classified page type, applying type-specific tuning.
- Wire the **boilerplate-mode** string union `'precision' | 'balanced' | 'recall' | 'none'` onto the core: `precision`/`recall` set the Trafilatura `favor_precision`/`favor_recall` toggles, `balanced` sets neither, and **`none` bypasses boilerplate removal entirely** (the washing pillar then processes the full document). Mirror the contextractor mapping (`~/r/contextractor`).
- **Gate:** unit tests showing the right profile is selected per type, that mode choice changes extraction output as expected, and that `none` returns the whole document unextracted.

### Phase 6 — HTML washing levels (the cleanup pillar)
- In `src/washing/`, reproduce the htmlprocessing-server cleanup, modeled on `~/r/tools/packages/htmlprocessing-server`:
  - The pipeline: **decode** (chardet + iconv-lite for non-UTF-8 buffers) -> **normalize** with parse5 (full-document vs fragment auto-detected) -> **sanitize** with `sanitize-html` using the level preset (skipped for `correct`) -> add **DOCTYPE** for full documents -> **prettier-format** or **html-minifier-terser minify**.
  - The four sanitization presets as `SanitizeConfig` objects (`allowedTags`, `allowedAttributes`, `allowedClasses`, `selfClosing`, `transformTags`, `nonTextTags`):
    - **`minimal`** — strictest: document scaffolding + headings, tables, lists, code/pre, and `b/i/s/em/strong/abbr/del` inline; NO images, NO `div/span`, NO HTML5 structural elements, NO classes/IDs, NO inline styles. `transformTags` maps deprecated -> semantic (`strike->del`, `tt->code`, `acronym->abbr`, `dir->ul`, `listing/xmp/plaintext->pre`).
    - **`standard`** (DEFAULT) — adds images + responsive `picture/source`, `video/audio`, `figure/figcaption`, `blockquote`, definition lists, and rich inline semantics (`cite/dfn/kbd/samp/var/mark/small/q/wbr/time/ins/sub/sup`). Still NO `div/span`, NO HTML5 structural elements, NO classes/IDs, NO inline styles.
    - **`permissive`** — full HTML5 content: structural elements (`article/section/main/header/footer/nav/aside`), `details/summary`, `div/span`, `map/area`, `track`, bidi/ruby. Still NO classes/IDs and NO inline styles.
    - **`styled`** — like `permissive` PLUS CSS styling: allow `class` and inline `style` on all tags (a `'*': ['class','style']` entry) and keep the `<style>` tag's CSS (drop `style` from `nonTextTags`). Still strips scripts, `on*` handlers, and `javascript:` URLs.
  - **`correct`** is NOT a sanitization preset: it is normalize-only (skip the sanitize step entirely), so all tags/attributes are preserved — parse5 just makes the HTML well-formed and prettier reformats it. This is the htmlcorrector behavior.
- **Gate:** unit tests assert, per level, the exact tag/attribute allow-list behavior on representative HTML; `correct` preserves all tags; every level strips `<script>`/`on*`/`javascript:`; the orchestrated `pipeline.ts` runs `boilerplate(mode)` then `wash(level)` and returns `{ html, messages }`.

### Phase 7 — Validation against the reference corpus
- Build a validation harness that runs the full pipeline over **adbar's test corpus** and compares the extracted **main-content HTML** against expected outputs (precision/recall/F1-style scoring on the kept text content of the HTML).
- **Gate:** results are in the same ballpark as upstream on articles; document any systematic gaps in `PORTING-NOTES.md`.

### Phase 8 — Offline wash-corpus tester (see Section 7)
- Build it in `tools/wash-corpus-tester/`.
- **Gate:** it runs a configured set of **saved HTML fixtures** across all 7 page types through htmlwasher (every boilerplate mode × washing level relevant to the fixture) and reports per-fixture pass/fail with the cleaned-HTML output. **No network.**

---

## 6. Testing, review & quality gates

- **Every `src/` module has a co-located unit test.** Use vitest. Cover happy paths, empty/malformed HTML, missing metadata, the boilerplate modes (incl. `none`), and every washing level (incl. `correct`).
- **Golden tests** use saved fixtures in `fixtures/` (HTML in, expected cleaned HTML committed) so they're deterministic and offline.
- **Washing tests** assert the per-level allow-list behavior and the security invariants (`<script>`/`on*`/`javascript:` always stripped — at every level, incl. `styled` and `correct`).
- **Feature-parity tests** compare TS vs Python feature vectors (Phase 4) — assert the full 189-vector matches and the ONNX argmax class agrees.
- **CLI tests** drive a testable `runWash(opts, io)` core with in-memory streams + a fixture file: default HTML-to-stdout, `--minify`, `--json`, `-o <file>`, invalid-option exit codes, and missing-input handling.
- `pnpm test` must run the whole suite headless and pass in CI; the training tests run via `uv run pytest` (+ `uvx ruff check`).
- **Full-repo code review + autofix (quality gate before "done").** Run a complete review of the WHOLE repo — inspired by `/meta:code-review-autofix` (per-domain TS/Python/security checklists, ideally multi-agent with adversarial verification of each finding) — and **fix every confirmed finding, not just list them**. Then **rerun the entire suite** (`pnpm build && pnpm lint && pnpm test`, plus the training `pytest`/`ruff`) and autofix any failure; never silence with `any`/`@ts-ignore`. End-to-end validation (not just unit tests) is what catches integration bugs like a filter that's dead in the real pipeline (see §10).
- **Docs stay in sync.** Any change to the public surface updates the relevant `SPEC.md` AND `README.md` (and `PORTING-NOTES.md`) in the same change.

---

## 7. Offline wash-corpus test project — `tools/wash-corpus-tester/`

A **separate** TypeScript project (its own `package.json`) that proves htmlwasher works end-to-end on realistic pages — **entirely offline**. It does **not** fetch, crawl, or scrape; htmlwasher is a library, not a scraper.

Requirements:
- Depends on the local `htmlwasher` package (workspace link or relative path).
- A **configurable fixture set** (`fixtures/` + a `corpus.json` manifest) of **saved HTML files** with **at least 3 fixtures per page type** across all 7 types (article, forum, product, collection, listing, documentation, service). Seed it with saved pages from stable, well-known sites. **Consider including multilingual and Czech/EU sources** to surface English-bias gaps in the classifier (per context doc 04).
- For each fixture: run htmlwasher across the relevant `boilerplate` × `level` combinations and report: detected page type, confidence, optional metadata, a cleaned-HTML length sanity check, and **PASS/FAIL** against simple assertions (e.g. non-empty cleaned HTML, no `<script>`/`on*`/`javascript:` survives, `correct` preserves tag set, plausible page type vs the expected label in the manifest).
- Output a readable summary (table to stdout + a JSON/markdown report file). Non-zero exit code if any assertion fails.
- Provide a `pnpm test:corpus` script. Because it reads only local fixtures, it is deterministic and reproducible; it may run as part of `pnpm test` or as a separate target — your call, but it must never hit the network.

---

## 8. Constraints, licensing, non-goals

- **Licensing:** rs-trafilatura, web-page-classifier, nchapman/trafilatura-rs are **MIT OR Apache-2.0**; go-trafilatura, adbar/trafilatura, mozilla/readability are **Apache-2.0**; `sanitize-html`, `parse5`, `prettier`, `html-minifier-terser`, `htmlparser2`, `linkedom` are permissive **MIT/ISC/BSD**-class; the **WCXB dataset is CC-BY-4.0 (attribution REQUIRED)**. The `~/r/tools/packages/htmlprocessing-server`, htmlwasher-*, and contextractor projects are **Glueo's own** (internal references, no third-party license obligation). In `htmlwasher/README.md` and `training/README.md`, include a NOTICE/attribution section crediting Adrien Barbaresi (Trafilatura), markusmobius (go-trafilatura), Murrough Foley (rs-trafilatura, web-page-classifier, WCXB dataset), nchapman (trafilatura-rs), Mozilla (Readability), and the `sanitize-html` authors, and reproduce the required license notices. Keep SPDX headers where you port substantial code.
- **Do not** vendor or copy the rs-trafilatura embedded model binary; you are training your own model from the public dataset.
- **Do not** commit large datasets to the repo; download them in `training/` on demand and `.gitignore` them. Commit only `model.onnx` + `tfidf-vocab.json` (and small fixtures).
- **Non-goals:**
  - **No conversion.** HTML in, HTML out — never Markdown, XML, XML/TEI, or plain text. (The boilerplate pillar keeps an HTML subtree; the washing pillar returns sanitized/normalized HTML.)
  - **No scraping / crawling / fetching.** htmlwasher never touches the network; the `tools/` tester is offline over saved fixtures. Crawling lives in Contextractor, not here (see context doc 05).
  - **No granular content toggles.** No `include_comments` / `include_tables` / `include_images` / `include_links` checkboxes (the Trafilatura/contextractor content options). The washing **level** is the single tag-inclusion control; comments follow the page-type profile.
  - Matching rs-trafilatura's exact benchmark numbers (they're self-reported — see context doc 02); supporting non-Node runtimes beyond the WASM path; adding a neural HTML extractor like MinerU-HTML or ReaderLM-v2 (out of scope — context doc 06 covers what these are and why we defer).
- **Validate on our own data:** per the research, treat our own held-out results as the source of truth, not the upstream author's WCXB leaderboard.

---

## 9. Deliverables checklist

- [ ] `htmlwasher/` TS library: boilerplate removal (HTML subtree) + classifier + per-type profiles + confidence + the `Precision/Balanced/Recall/None` mode, AND the HTML washing levels `Minimal/Standard/Permissive/Styled/Correct`, exposed via a single `wash(html, options)` API that returns cleaned **HTML** (+ optional metadata sidecar). No conversion, no scraping.
- [ ] An **offline `htmlwasher` CLI** (`bin`) wrapping the same `wash()`: file-arg/stdin → stdout (or `-o`), `-b/-l/-m/-u/--json/-q` options, never fetches.
- [ ] `model.onnx` + `tfidf-vocab.json` trained from WCXB, loaded via onnxruntime-node (and a WASM backend behind the same interface).
- [ ] Full **unit test** suite (vitest): per-module tests, washing-level + security tests, golden fixtures, and TS<->Python **feature-parity tests**, all green via `pnpm test`.
- [ ] Validation harness vs adbar's test corpus (cleaned-HTML scoring) with a short results writeup in `PORTING-NOTES.md`.
- [ ] `training/` Python pipeline (download -> features -> train -> export ONNX), reproducible from `requirements.txt`.
- [ ] `tools/wash-corpus-tester/` **offline** project that runs saved HTML fixtures across all 7 page types through htmlwasher and reports PASS/FAIL via `pnpm test:corpus`. No network.
- [ ] **READMEs and `SPEC.md`s** (root + each package) current, with usage (library + CLI) + full license attribution.
- [ ] **Full-repo code review + autofix** completed (every confirmed finding fixed), with the whole suite green afterward (`pnpm build && pnpm lint && pnpm test` + training `pytest`/`ruff`).
- [ ] Repo is **TypeScript + Python** (TS runtime/library/CLI + offline Python `training/`), NOT collapsed to pure TS — the two meet only at the ONNX artifacts + the feature-parity contract.

Work incrementally, commit per phase, keep `PORTING-NOTES.md` current, and ask if the source-repo location or the host-repo structure is not what this brief assumes.

---

## 10. Implementation outcomes & learnings (post-build)

Phases 0–8 + the CLI are **implemented and green**: 307 library unit tests + the
offline corpus tester + 14 training pytests pass; classifier held-out test accuracy
≈ 0.78 (macro-F1 0.66); TS↔Python feature parity **100%** on the fixtures; adbar
eval **F1 ≈ 0.80** (P 0.79 / R 0.81). The repo is **TypeScript + Python by design**
(do NOT collapse to pure TS): training is Python (XGBoost / scikit-learn / ONNX
export — no JS equivalent of that maturity), the runtime is TS (onnxruntime), and
the two are joined ONLY by the exported `model.onnx`/`tfidf-vocab.json` and the
byte-for-byte feature-parity contract (`training/FEATURES.md`). Feature extraction
is therefore implemented twice (`training/extract_features.py` + TS
`src/classifier/features/`) and MUST be kept in parity — a dedicated parity test
enforces it.

Hard-won gotchas (a re-run should bake these in from the start):

- **Run the name-based boilerplate filter BEFORE `postCleaning`, with a backoff.**
  `postCleaning` strips `class`/`id`, which blinds any serializer-stage name guard,
  so the `BOILERPLATE_TOKENS`/`COMMENT_TOKENS` filter silently does nothing if it
  runs at serialize time. Run it over the content node's DESCENDANTS before
  `postCleaning` (honoring `commentsAsContent`), and back off to the unfiltered
  extraction if filtering would empty the content (collection/listing pages live in
  boilerplate-named containers — go-trafilatura's "do not delete all the content").
- **Classifier DOM parity needs lexbor-equivalent parsing.** linkedom's parser
  diverges from selectolax/lexbor on nested `<body>` and trailing whitespace text
  nodes; parse via parse5-normalize → linkedom (`parseDocumentSpec`) to get
  byte-exact body text. selectolax comma-union selectors do **not** deduplicate
  (match each sub-selector separately). Use **UTF-8 byte lengths** everywhere (not
  JS UTF-16 `.length`) and an explicit **CPython `str.split`/`str.strip` whitespace
  codepoint class** (JS `\s`/`.trim()` differ on U+001C–U+001F / U+0085 / U+FEFF).
- **linkedom does not wrap loose fragments** in `<html><body>` — normalize in the
  parse step. Use `nextElementSibling` (not `nextSibling`) for last-element checks,
  since pretty-printed HTML interleaves whitespace text nodes.
- **The offline corpus tester imports `htmlwasher` from `dist/`** — rebuild before a
  direct `pnpm test:corpus`; the turbo `pnpm test` rebuilds first.
- **Pin onnxruntime exactly** (both `-node` and `-web` in lockstep) and validate the
  shipped vocab artifact at load. Metadata XPaths translate to CSS (regex-anchored
  class/id predicates loosen to substring — document per module).
- **A post-implementation multi-agent code review pays off:** it caught the dead
  boilerplate filter (unit tests passed because they exercised the serializer in
  isolation, bypassing `postCleaning`). End-to-end validation, not just unit tests,
  is what surfaces this class of bug.
