# Claude Code Brief — Port Trafilatura to TypeScript ("trafilatura-alpha")

**Created:** 2026-06-24
**Author of brief:** prepared for Miroslav Sekera (Glueo s.r.o.)
**For:** Claude Code, run from the repository root.

---

## 0. Mission

Build a faithful, well-tested **TypeScript port of Trafilatura** with **page-type-aware extraction**, including:

1. The **core content-extraction algorithm** (article/main-content extraction, metadata, comments, tables, fallback cascade).
2. A **page-type classifier** equivalent to rs-trafilatura's (7 types: `article, forum, product, collection, listing, documentation, service`) — **including training the ML model yourself** and exporting it to ONNX so it runs in Node with no Python at runtime.
3. **Per-page-type extraction profiles + a confidence score**, as in rs-trafilatura.
4. **Comprehensive unit tests** for every module, plus **golden parity tests** against the reference implementations.
5. A separate **live-crawl test project** in `tools/` that fetches real web pages across all 7 page types and verifies extraction works end-to-end.

This is a *port with a divergent classifier feature*, not a from-scratch design. Lean heavily on the existing implementations listed below.

---

## 1. Read these first (required context)

Before writing any code, read the research documents in this folder's `context/` directory. They are syntheses of deep-research sessions and contain the full technical analysis behind this brief — reading them will save you from dead ends.

**Core docs (read in order — these are mandatory):**

- [`./context/01-trafilatura-forks-and-ports-landscape.md`](./context/01-trafilatura-forks-and-ports-landscape.md) — the Python -> Go -> Rust lineage and which repo is authoritative for what.
- [`./context/02-rs-trafilatura-skeptical-assessment.md`](./context/02-rs-trafilatura-skeptical-assessment.md) — why rs-trafilatura's benchmark claims are unverified, and why we validate on our own data.
- [`./context/03-classifier-reimplementation-feasibility.md`](./context/03-classifier-reimplementation-feasibility.md) — **the most important one for Phase 4**: exactly how the classifier works, the 181 features, the ONNX path, training requirements, and licensing. Follow its recommendations.

**Supporting docs (read selectively — they expand on specific decisions):**

- [`./context/07-classifier-bilingual-port-deep-dive.md`](./context/07-classifier-bilingual-port-deep-dive.md) — **companion to doc 03**: deeper analysis of ONNX vs native bindings vs m2cgen, training compute (no GPU needed), feature-extraction library picks (selectolax for Python, htmlparser2 for TS), and the *reuse-vs-rebuild* verdict (**rebuild fresh** — the rs-trafilatura model is a custom non-XGBoost-native binary). Read alongside doc 03 when implementing Phase 4.
- [`./context/06-ml-extraction-landscape.md`](./context/06-ml-extraction-landscape.md) — adjacent context on the 2026 ML extraction landscape (MinerU-HTML, ReaderLM, Docling, VLMs). **Not directly required for the port**, but useful for: (a) the licensing-trap table when evaluating any neural addition, (b) future "neural fallback" routing of low-confidence pages, (c) why we *don't* go neural for the classifier itself.
- [`./context/04-niche-opportunities-map.md`](./context/04-niche-opportunities-map.md) — strategic positioning map (forums, multilingual, WARC, Lambda, EU residency). **Not prescriptive for the TS port**, but useful for: (a) framing the README positioning, (b) choosing live-crawl test fixtures aligned with target niches (forums and multilingual are high-value), (c) understanding why bundle size and deployment surface matter.
- [`./context/05-crawlee-playwright-hybrid-stack.md`](./context/05-crawlee-playwright-hybrid-stack.md) — analysis of Crawlee + Playwright + Trafilatura as a production-scraper stack. **Out of scope for the trafilatura-alpha port itself** (it's a library, not a scraper), but useful for: (a) understanding why the live-crawl tester in `tools/` uses a polite fetcher and *not* a full Crawlee setup, (b) future Contextractor-server architecture, (c) the Apify Store dual-channel monetization angle.

### Primary sources cited in the research (for tracing & verification)

The context docs above are syntheses; the underlying primary sources are below. Consult them directly when you need ground truth (the local `context/` files are the reasoning; these links are the evidence).

**The implementations (also cloned into `sources/` — see Section 2):**
- Upstream Trafilatura (adbar): https://github.com/adbar/trafilatura  · docs https://trafilatura.readthedocs.io/  · PyPI https://pypi.org/project/trafilatura/
- go-trafilatura (markusmobius): https://github.com/markusmobius/go-trafilatura
- trafilatura-rs (nchapman, faithful Rust port): https://github.com/nchapman/trafilatura-rs
- rs-trafilatura (Murrough-Foley, the divergent fork): https://github.com/Murrough-Foley/rs-trafilatura
- web-page-classifier (the XGBoost classifier crate): https://github.com/Murrough-Foley/web-page-classifier
- mozilla/readability (JS/DOM idiom reference): https://github.com/mozilla/readability

**The classifier model, dataset & benchmarks (needed for Phase 4 training):**
- WCXB benchmark paper (Murrough Foley, arXiv preprint — *not peer-reviewed*): https://arxiv.org/abs/2605.21097
- WCXB dataset (CC-BY-4.0) on Hugging Face: https://huggingface.co/datasets/murrough-foley/web-content-extraction-benchmark
- WCXB dataset on Zenodo (DOI 10.5281/zenodo.19316874): https://doi.org/10.5281/zenodo.19316874
- WCXB leaderboard (author-run): https://webcontentextraction.org/
- ScrapingHub Article Extraction Benchmark (the one neutral benchmark): https://github.com/scrapinghub/article-extraction-benchmark
- Author's write-ups on rs-trafilatura: https://murroughfoley.com/rs-trafilatura-rust-web-content-extraction/  · https://dev.to/murroughfoley/rs-trafilatura-page-type-aware-web-content-extraction-in-rust-2ppf

**Independent academic context (why heuristics + per-type routing, not neural):**
- Bevendorff, Gupta, Kiesel & Stein, "An Empirical Comparison of Web Content Extraction Algorithms," SIGIR '23 (DOI 10.1145/3539618.3591920): https://downloads.webis.de/publications/papers/bevendorff_2023c.pdf
- Barbaresi, "Trafilatura: A Web Scraping Library...," ACL-IJCNLP 2021 System Demos (DOI 10.18653/v1/2021.acl-demo.15): https://aclanthology.org/2021.acl-demo.15/

**ONNX / inference (Phase 4 export & Node runtime):**
- ONNX `TreeEnsemble` operator (ai.onnx.ml): https://onnx.ai/onnx/operators/onnx_aionnxml_TreeEnsemble.html
- onnxruntime-node: https://www.npmjs.com/package/onnxruntime-node  · onnxruntime-web: https://www.npmjs.com/package/onnxruntime-web
- skl2onnx / onnxmltools (XGBoost -> ONNX export): https://onnx.ai/sklearn-onnx/  · https://github.com/onnx/onnxmltools

**Product context:** Contextractor (uses rs-trafilatura today): https://www.contextractor.com/

> Note: the arXiv ID and Zenodo DOI above are as recorded during research (mid-2026); if a link 404s, search the title. The `context/` docs flag which figures are author-self-reported vs independently verified — keep that distinction when reading the primary sources.

---

## 2. Source repositories & AUTHORITY HIERARCHY

The source repos are cloned by `/Users/miroslavsekera/r/htmlwasher/clone-other-repos.sh` into **`/Users/miroslavsekera/r/htmlwasher/sources/`** (confirm the location before starting; if they are elsewhere, ask). Each repo has a defined role. **When sources disagree, follow this hierarchy:**

| Repo (local path) | Role | Authority |
|---|---|---|
| `/Users/miroslavsekera/r/htmlwasher/sources/rs-trafilatura` | **Primary port target.** Page-type-aware architecture, per-type extraction profiles, confidence scoring, classifier wiring. | Defines **WHAT** to build (the feature set & architecture). |
| `/Users/miroslavsekera/r/htmlwasher/sources/web-page-classifier` | **The classifier.** The 181 features (81 numeric + 100 TF-IDF), the 3-stage URL->HTML->ML cascade, the 7 page types. | Defines the **classifier behavior & features** to replicate byte-for-byte. |
| `/Users/miroslavsekera/r/htmlwasher/sources/go-trafilatura` | **Faithful core reference.** Near line-by-line Go port of the Python original; cleanest readable source for the extraction algorithm. | **Disambiguator** for extraction logic when rs-trafilatura is unclear. |
| `/Users/miroslavsekera/r/htmlwasher/sources/trafilatura` (adbar) | **Canonical original.** Ground-truth semantics for every option, metadata rules, edge cases, AND the **test corpus**. | **Final authority** on extraction *semantics* and the validation oracle. |
| `/Users/miroslavsekera/r/htmlwasher/sources/trafilatura-rs` (nchapman) | Faithful Rust port. | Cross-check / tiebreaker. |
| `/Users/miroslavsekera/r/htmlwasher/sources/readability` (mozilla) | NOT Trafilatura. Canonical JS/DOM readable-content extractor. | **TS/DOM idiom reference only** — how to structure DOM traversal in JS. |

**Rule of thumb:** rs-trafilatura + web-page-classifier tell you *what features and architecture to build*; go-trafilatura + adbar tell you *how the extraction must actually behave*. rs-trafilatura is a divergent fork, so treat its extraction internals as intent and verify behavior against go-trafilatura/adbar.

---

## 3. Locked technical decisions

Do not redesign these — they are settled in the research:

1. **Language/runtime:** TypeScript on Node.js (target the LTS in use). Strict mode (`"strict": true`).
2. **DOM:** parse HTML with a real DOM library — prefer **linkedom** (fast, spec-ish) with **parse5** as the underlying parser; `cheerio` acceptable only where a jQuery-like API is genuinely simpler. Pick ONE primary and be consistent. Document the choice. Note: context doc 07 also flags **htmlparser2** as the speed leader for feature extraction (Cheerio Issue #1259 notes parse5 is ~½ htmlparser2's speed); consider htmlparser2 specifically inside the classifier's feature extractor where it's a tight inner loop.
3. **Classifier model:** **retrain a standard XGBoost model from the public WCXB dataset and export to ONNX.** Do NOT try to reverse-engineer rs-trafilatura's embedded ~1.1 MB custom binary — it is not XGBoost-native or ONNX, and reversing it is wasted effort (see context docs 03 and 07).
4. **Inference in Node:** **onnxruntime-node** by default. Also provide an **onnxruntime-web (WASM)** path behind the same interface for zero-native-binary / serverless deployment. Keep inference behind an `interface PageTypeClassifier` so the backend is swappable. **Pin a known-good onnxruntime version** — context doc 07 notes 1.21.x–1.22.x had a category-only-trees bug.
5. **Feature parity is the hard part, not the trees.** The 181 features (81 numeric DOM/URL + 100 TF-IDF) MUST be computed identically to how the model was trained, or predictions diverge. Train the model and compute features from the SAME TypeScript feature-extraction code path wherever possible (see Phase 4), and lock the TF-IDF vocabulary + IDF weights as a shipped JSON artifact. **TF-IDF gotcha:** scikit-learn uses a nonstandard `idf = ln(n/df) + 1` with L2 normalization — replicate exactly.
6. **Output:** primary output is clean text + structured metadata (mirror go-trafilatura's HTML/markdown output options). Support `include_comments`, `include_tables`, `favor_precision`, `favor_recall` equivalents.
7. **Determinism:** tree models are threshold comparisons and are cross-platform deterministic once features match — exploit this for reproducible golden tests. **Compare argmax class, not exact probabilities**, in cross-language parity tests (small float-handling differences across runtimes can flip borderline probability values).

---

## 4. Project structure to create

The TypeScript library is the **trafilatura-alpha** package. Place it inside this product repo. First inspect the existing layout of `/Users/miroslavsekera/r/htmlwasher` and integrate cleanly (if it's a monorepo/workspaces, add a package; otherwise create a top-level library dir). Proposed layout:

```
/Users/miroslavsekera/r/htmlwasher/
  clone-other-repos.sh               # clones the 6 reference repos into sources/
  sources/                           # the 6 cloned reference repos (read-only inputs)
    rs-trafilatura/  web-page-classifier/  go-trafilatura/
    trafilatura/  trafilatura-rs/  readability/
  prompts/2026-6-24-init/            # this brief (prompt.md) + context/ research docs
  trafilatura-alpha/                 # the TS port (library)
    src/
      core/                          # extraction algorithm (from go-trafilatura/adbar)
      metadata/                      # metadata extraction
      classifier/
        features/                    # the 181-feature extractor (from web-page-classifier)
        model/                       # model.onnx + tfidf-vocab.json (shipped artifacts)
        classifier.ts                # PageTypeClassifier interface + onnx backends
      profiles/                      # per-page-type extraction profiles (from rs-trafilatura)
      index.ts
    test/                            # unit tests (mirrors src/)
    fixtures/                        # saved HTML + expected output (golden tests)
    package.json
    tsconfig.json
    README.md                        # incl. licenses/attribution (see Section 8)
  training/                          # model training (Python, run offline, NOT shipped)
    download_wcxb.py                 # fetch dataset from HF/Zenodo
    extract_features.py              # 181 features (parity with TS extractor)
    train.py                         # XGBClassifier -> model.onnx + tfidf-vocab.json
    requirements.txt
    README.md
  tools/
    live-crawl-tester/               # the live-site E2E test project (Section 7)
```

---

## 5. Build order (phased, with explicit "definition of done" gates)

Work phase by phase. **Do not advance until the phase's gate passes.** Commit after each phase.

### Phase 0 — Orientation
- Read the three core `context/` docs (01, 02, 03) and skim the four supporting docs (04, 05, 06, 07). Skim the six source repos. Map go-trafilatura's file structure (it's the cleanest read) to your planned `src/` layout. Write a short `PORTING-NOTES.md` recording the mapping and any open questions.

### Phase 1 — Scaffold
- Initialize the `trafilatura-alpha` TS package: strict tsconfig, a test runner (**vitest** preferred), linting (your call), and a CI-friendly `npm test`.
- **Gate:** `npm test` runs (even with a trivial passing test); `tsc --noEmit` is clean.

### Phase 2 — Core extraction
- Port the core extraction algorithm from **go-trafilatura** (disambiguating against **adbar** semantics): main-content detection, the readability/dom-distiller-style fallback cascade, comment extraction, table handling, and the precision/recall toggles.
- Write **unit tests per module** as you go.
- **Gate:** unit tests cover each core function; a handful of adbar test-corpus pages extract sensibly.

### Phase 3 — Metadata
- Port metadata extraction (title, author, date, URL, sitename, description, tags) from adbar/go-trafilatura, including JSON-LD, OpenGraph, and meta-tag handling.
- **Gate:** unit tests for each metadata field against known fixtures.

### Phase 4 — Feature extraction + the ML model (the crux)
- In `training/`, implement `extract_features.py` reproducing the **181 features** (81 numeric DOM/URL signals + 100 TF-IDF) exactly as described in web-page-classifier (read its source for the precise feature list, ordering, normalization, and missing-value handling).
- In `src/classifier/features/`, implement the **same** extractor in TypeScript. These two MUST agree.
- `download_wcxb.py`: fetch the WCXB dataset (CC-BY-4.0) from Hugging Face `murrough-foley/web-content-extraction-benchmark` (or Zenodo DOI `10.5281/zenodo.19316874`).
- `train.py`: train an `XGBClassifier` (200 trees, max_depth 8, `multi:softprob`, 7 classes, SMOTE oversampling), export to **`model.onnx`** via `onnxmltools`/`skl2onnx`, and emit **`tfidf-vocab.json`** (vocabulary + IDF weights). Copy both into `src/classifier/model/`. **No GPU needed** — context doc 07 confirms training takes seconds-to-minutes on CPU at this scale (~1,500–10,000 samples, 181 features, 200 trees).
- Wire `src/classifier/classifier.ts`: load `model.onnx` with onnxruntime-node, implement the **3-stage cascade** (URL heuristics -> HTML signal analysis -> ML), and return `(pageType, confidence)`.
- **Golden parity tests (critical):** build a fixture set of WCXB pages; assert the **TS feature extractor produces the same feature vectors** as the Python one (export Python vectors to JSON, compare), and that the ONNX model yields the same `argmax` class. **Target >=99% exact feature match**; investigate any mismatch as a bug.
- **Gate:** classifier reproduces the trained model's predictions in Node; feature parity >=99%; report classifier accuracy on a held-out split.

### Phase 5 — Per-type profiles + confidence
- Port the **per-page-type extraction profiles** and **confidence scoring** from rs-trafilatura: route extraction based on the classified page type, applying type-specific tuning.
- **Gate:** unit tests showing the right profile is selected per type and that profile choice changes extraction output as expected.

### Phase 6 — Validation against the reference corpus
- Build a validation harness that runs the full pipeline over **adbar's test corpus** and compares against expected outputs (precision/recall/F1-style scoring on extracted text).
- **Gate:** results are in the same ballpark as upstream on articles; document any systematic gaps in `PORTING-NOTES.md`.

### Phase 7 — Live-crawl test project (see Section 7)
- Build it in `tools/live-crawl-tester/`.
- **Gate:** it crawls a configured list of live URLs across all 7 page types and reports per-URL pass/fail with extracted output.

---

## 6. Testing requirements (unit)

- **Every `src/` module has a co-located unit test.** Use vitest. Cover happy paths, empty/malformed HTML, missing metadata, and the precision/recall toggles.
- **Golden tests** use saved fixtures in `fixtures/` (HTML in, expected output committed) so they're deterministic and offline.
- **Feature-parity tests** compare TS vs Python feature vectors (Phase 4).
- `npm test` must run the whole suite headless and pass in CI.

---

## 7. Live-crawl test project — `tools/live-crawl-tester/`

A **separate** TypeScript project (its own `package.json`) that proves the library works on the real web.

Requirements:
- Depends on the local `trafilatura-alpha` package (workspace link or relative path).
- A **configurable URL list** (`urls.json`) with **at least 3 real URLs per page type** across all 7 types (article, forum, product, collection, listing, documentation, service). Seed it with stable, well-known sites. **Consider including multilingual and Czech/EU sources** to surface English-bias gaps in the classifier (per context doc 04, multilingual + EU is a strategic differentiator).
- For each URL: fetch the HTML, run extraction + classification, and report: detected page type, confidence, extracted title/author/date, a text-length sanity check, and **PASS/FAIL** against simple assertions (e.g. non-empty main text, plausible title, page type matches the expected label in the config).
- **Be a polite crawler:** respect `robots.txt`, set a descriptive User-Agent, rate-limit (e.g. 1 request/sec, concurrency <=2), timeout + retry with backoff, and **cache fetched HTML to disk** so reruns don't re-hit sites (and so failures are reproducible offline). This is a thin polite fetcher, **not** a Crawlee/Playwright setup — context doc 05 explains why a full anti-bot stack is out of scope for a library test harness.
- Output a readable summary (table to stdout + a JSON/markdown report file). Non-zero exit code if any assertion fails.
- Provide an `npm run test:live` script. Make a clear note that this hits the network and is **not** part of the offline `npm test`.

---

## 8. Constraints, licensing, non-goals

- **Licensing:** rs-trafilatura, web-page-classifier, nchapman/trafilatura-rs are **MIT OR Apache-2.0**; go-trafilatura, adbar/trafilatura, mozilla/readability are **Apache-2.0**; the **WCXB dataset is CC-BY-4.0 (attribution REQUIRED)**. In `trafilatura-alpha/README.md` and `training/README.md`, include a NOTICE/attribution section crediting Adrien Barbaresi (Trafilatura), markusmobius (go-trafilatura), Murrough Foley (rs-trafilatura, web-page-classifier, WCXB dataset), nchapman (trafilatura-rs), and Mozilla (Readability), and reproduce the required license notices. Keep SPDX headers where you port substantial code.
- **Do not** vendor or copy the rs-trafilatura embedded model binary; you are training your own model from the public dataset.
- **Do not** commit large datasets to the repo; download them in `training/` on demand and `.gitignore` them. Commit only `model.onnx` + `tfidf-vocab.json` (and small fixtures).
- **Non-goals:** matching rs-trafilatura's exact benchmark numbers (they're self-reported — see context doc 02); supporting non-Node runtimes beyond the WASM path; building a crawler framework (the live tester is a thin polite fetcher, not a Crawlee replacement — see context doc 05); adding a neural HTML extractor like MinerU-HTML or ReaderLM-v2 (out of scope for this port — context doc 06 covers what these are and why we defer).
- **Validate on our own data:** per the research, treat our own held-out results as the source of truth, not the upstream author's WCXB leaderboard.

---

## 9. Deliverables checklist

- [ ] `trafilatura-alpha/` TS library: core extraction + metadata + classifier + per-type profiles + confidence.
- [ ] `model.onnx` + `tfidf-vocab.json` trained from WCXB, loaded via onnxruntime-node (and a WASM backend behind the same interface).
- [ ] Full **unit test** suite (vitest), golden fixtures, and TS<->Python **feature-parity tests**, all green via `npm test`.
- [ ] Validation harness vs adbar's test corpus with a short results writeup in `PORTING-NOTES.md`.
- [ ] `training/` Python pipeline (download -> features -> train -> export ONNX), reproducible from `requirements.txt`.
- [ ] `tools/live-crawl-tester/` project that crawls live sites across all 7 page types, caches HTML, respects robots.txt, and reports PASS/FAIL via `npm run test:live`.
- [ ] READMEs with usage + full license attribution.

Work incrementally, commit per phase, keep `PORTING-NOTES.md` current, and ask if the source-repo location or the host-repo structure is not what this brief assumes.
