# Porting the rs-trafilatura Page-Type Classifier: Bilingual Feasibility Deep-Dive

> Research context document for the trafilaturacore TypeScript port.
> Saved 2026-06-24. Source: deep technical research session.
>
> **What's in this doc:** The deeper bilingual (TS + Python) port evaluation, with concrete library options, performance estimates, dependency footprints, and a staged plan. **This is the companion to `03-classifier-reimplementation-feasibility.md`** — that one is the synthesized, primary brief; this one expands on inference-library choices (ONNX vs native bindings vs m2cgen vs Treelite), training cost (no GPU needed), model-sharing format (ONNX), feature-extraction libraries (selectolax for Python, htmlparser2/cheerio for TS), and a reuse-vs-rebuild verdict (**rebuild fresh**, because the rs-trafilatura model is a custom binary with unpublished feature extraction). Read this alongside doc 03 for full coverage of the classifier port.

---

# Porting the rs-trafilatura Page-Type Classifier to TypeScript and Python: A Technical Evaluation

## TL;DR
- **The model itself is the easy part; the 181-feature extraction (81 numeric + 100 TF-IDF) is the hard part — and it is NOT published.** The rs-trafilatura classifier ships as a *custom compact binary* (~1.1 MB, 200 trees, max depth 8, pure-Rust hand-written inference with zero dependencies), not a standard XGBoost `.ubj`/`.json`, and neither the training code nor the TF-IDF vocabulary nor the numeric-feature definitions are open. You cannot just "load the model" in Python or TS — you would have to reverse-engineer the feature pipeline.
- **Fastest practical path: re-train your own XGBoost model and standardize on one format.** Build a small labeled set (the underlying WCXB dataset of 2,008 pages is CC-BY-4.0 and downloadable), train a 7-class XGBoost in scikit-learn/Python (minutes on CPU, no GPU needed), then share ONE model across Python (native `xgboost`) and TypeScript (ONNX Runtime, via onnxmltools conversion). Re-implement feature extraction once and lock it with shared cross-language test fixtures.
- **Both ports are feasible with near-zero accuracy loss on inference.** Python xgboost is C++-core and effectively at parity with Rust; TS via ONNX Runtime Node is within a small multiple. Realistic total budget to a working bilingual classifier: ~1–3 engineer-weeks, dominated by feature-extraction porting and labeling, not by ML compute (a few dollars).

## Key Findings

**The classifier architecture (confirmed from the repo, the dev.to article, and the standalone `web-page-classifier` crate):**
- It is a **three-stage cascade**, not just XGBoost. Stage 1 is URL heuristics (resolves ~63% of pages); Stage 2 is HTML signal analysis — JSON-LD `@type`, Open Graph, DOM patterns (another ~15%); Stage 3 is the XGBoost ML model for the remaining ambiguous pages. Replicating only the XGBoost model gives you a minority of the decisions; the heuristic stages do most of the work and are pure rules you can port directly.
- XGBoost config: **200 estimators (trees), max depth 8, 7-class multi-class** (single multi-class softmax model, not 7 one-vs-rest binaries). Features = **81 numeric (URL patterns, HTML structure, DOM signals) + 100 TF-IDF = 181**. Trained on **1,497 pages with SMOTE oversampling**. Reported accuracy **87.3%, macro F1 0.824**; the dev.to post says 86.6% accuracy. Inference <1 ms/page in Rust.
- Note an inconsistency in the author's own materials: the repo "About" says "89 numeric + 100 TF-IDF," the README "Model Details" says "81 numeric + 100 TF-IDF," and a v0.1.1 release note describes an earlier "Random Forest, 200 trees, 163 features." The 81+100=181 in the README is the internally consistent figure.

**Model format and reusability (the decisive finding):**
- The embedded model is a **custom compact binary** decoded by hand-written pure-Rust tree-walking code. The crate's `Cargo.toml` has an empty `[dependencies]` ("No dependencies — pure Rust with embedded model"), forbids `unsafe`, and uses no `xgboost`, `xgboost-rs`, or `gbdt` crate. It is therefore **not directly loadable by Python's `xgboost.Booster.load_model()`** without bespoke conversion.
- **Training code, the TF-IDF vocabulary (100 terms + IDF weights), and the 81 numeric feature definitions are not published** anywhere (not in the repo, rs-trafilatura, murroughfoley.com, HuggingFace, or the arXiv benchmark paper). This is the single biggest obstacle to reuse.
- **License is permissive: MIT OR Apache-2.0**, dual-licensed, so the code and embedded model are usable commercially with attribution. The **WCXB training/eval dataset is CC-BY-4.0** (commercial use allowed with attribution), available on GitHub, HuggingFace (`murrough-foley/web-content-extraction-benchmark`), and Zenodo (DOI 10.5281/zenodo.19316874).

## Details

### Question 1 — TypeScript port feasibility

**Inference options, ranked:**
1. **ONNX Runtime (onnxruntime-node for server, onnxruntime-web for browser/edge) — recommended.** XGBoost → ONNX via `onnxmltools.convert_xgboost`, producing an `ai.onnx.ml.TreeEnsembleClassifier` op. This is the only option with a strong cross-language and cross-runtime story (Node, browser via WASM, and a single artifact shared with Python). ONNX Runtime Web compiles the native engine to WASM and supports the full operator set including tree ensembles.
2. **xgboost-node / xgboost_node (N-API native bindings).** `nuanio/xgboost-node` is old (v1.1.0, ~3 years stale, Linux/macOS only) and `Jonathanfarrow/xgboost_node` is newer but Linux/Mac only, requires a C++ compiler, libomp, and Python at install time. These require native compilation, won't run in the browser or on edge runtimes, and are maintenance risks.
3. **m2cgen → pure JavaScript.** Transpiles the tree ensemble to dependency-free JS (`export_to_javascript`). Runs anywhere including edge. Caveat: m2cgen works in float64 and there can be small floating-point divergences vs the source; for a 200-tree model the generated file is large but workable (you may need to raise the recursion limit during generation).
4. **Treelite.** Compiles to a native shared library — great for a Python/Node server, but it's a `.so`/`.dll`, so no browser/edge and you're back to native builds.

**Performance penalty vs Rust:** For a 200-tree, depth-8, 181-feature model, *model inference* is sub-millisecond in any of these. ONNX Runtime tree-ensemble inference on CPU is in the low-single-digit millisecond range per call (ORT perf tests on a small int8 model show ~1.86 ms average single-inference latency on an ARM64 CPU, and tree ensembles are comparable). The slowdown vs Rust's <1 ms is on the order of a few times, not 10–50×, and is dwarfed by HTML parsing. Pure-JS (m2cgen) is typically the slowest but still well under the page-parse time. **The real cost is feature extraction, not inference.**

**Runtime/edge:** ONNX Runtime Web (WASM, with optional SIMD + multithreading) and m2cgen-generated JS both run in the browser and on Cloudflare Workers/Vercel Edge; native bindings (xgboost-node, Treelite) do not. The ONNX model file for this size is small (low hundreds of KB).

**Feature extraction in TS:** Use **htmlparser2** (the speed leader — cheerio's own issue #1259 is titled "parse5 is about half the performance of htmlparser2," and htmlparser2 is documented as taking shortcuts to be fastest) or **cheerio** (jQuery API, wraps parse5/htmlparser2). A real-world benchmark over 1,635 pages found `cheerio.load` at a 10.60 ms median, dropping to 3.10 ms with `{xmlMode:true}` — "roughly a 3x speedup." JS HTML parsing is materially slower than Rust's lol_html/dom_query (Lexbor-class parsers process ~1,120 docs/s vs lxml/BS4 ~48 docs/s) but still only a few milliseconds per typical page. Budget single-digit-to-low-tens of ms per page in Node for parse + feature extraction.

### Question 2 — Python port feasibility

**Inference:** The **official `xgboost` package** is the standard and the right default — it's the same C++ core as the Rust ecosystem's bindings, so accuracy and speed are at parity with the original. Alternatives: `treelite`/GTIL for compiled inference, `onnxruntime` for the shared-format path, `m2cgen` for a zero-dependency pure-Python export. **LightGBM is a different algorithm** — viable to train fresh, not for loading an XGBoost model.

**Performance:** Python xgboost vs Rust native is near-parity for inference (both call the same C++). The GIL is irrelevant for short, C-level predict calls and you can batch. m2cgen pure-Python would be markedly slower (interpreted tree walks) but still fine at classifier scale.

**Dependencies/wheels:** `xgboost` 3.3.0 ships pre-built wheels (confirmed on PyPI) for **Linux x86_64 (`manylinux_2_28`) + aarch64, Windows x86_64, macOS x86_64 + Apple Silicon arm64 (`macosx_12_0_arm64`)**; **XGBoost 3.x requires Python 3.10+**. An `xgboost-cpu` variant exists with a much smaller footprint (good for Lambda layers; x86_64 Linux/Windows, plus win_arm64). For zero-dependency serverless, m2cgen output needs nothing. ONNX Runtime install is moderate (tens of MB). Note for Apple Silicon: a source build needs `brew install libomp`, but the wheels remove that need.

**Feature extraction in Python:** Use **selectolax** — a **Cython wrapper around the Modest and Lexbor engines (fast HTML5 parsers written in pure C)**; as of 2025 the author recommends Lexbor as the default backend. It is the fastest Python HTML parser: the author measured it "sometimes 30 times faster than lxml" ("a 5–30x speedup almost for free"), and Resiliparse/Selectolax-Lexbor process ~1,120 docs/s vs lxml/BS4 ~48 docs/s. selectolax can roughly match rs-trafilatura's parsing tier. lxml is the next best; avoid BeautifulSoup for throughput.

### Question 3 — Can one model be shared between Python and TS/JS?

**Yes — if you control the model.** Standard XGBoost formats (`.ubj`/`.json`) are stable and readable from every official XGBoost binding (UBJSON is the default since 2.1.0), but **JS has no official XGBoost binding**, so `.ubj`/`.json` alone does not solve the browser/edge case. The robust single-source-of-truth is **ONNX**: one `.onnx` file runs in Python (onnxruntime), Node (onnxruntime-node), browser/edge (onnxruntime-web/WASM). Keep the original `.json` XGBoost model as the canonical training artifact and generate the ONNX from it via onnxmltools.

**Floating-point determinism:** Tree-ensemble outputs are generally deterministic across runtimes for the same input vector, but tiny differences in float handling (m2cgen's float64-only note; ONNX/XGBoost threshold float32 coercion) can flip borderline cases. Mitigate by comparing **argmax class** (robust) rather than exact probabilities, and by pinning a tolerance in cross-language tests. (Also note: recent onnxruntime 1.21.x–1.22.x had a bug for category-only trees — pin a known-good version.)

**The 181-feature extraction is the hard, must-keep-in-sync part.** Because the original feature code and TF-IDF vocabulary are not published, you must re-implement extraction in BOTH languages identically. Strategies, best to worst: (a) **Compile feature extraction once from Rust to WASM** and call it from both Node and Python (single source of truth — strongly recommended if you want bit-identical features and you're already in the rs-trafilatura ecosystem); (b) shared **golden test fixtures** (HTML → expected 181-vector JSON) that both implementations must pass in CI; (c) code generation. TF-IDF in particular must replicate the exact tokenizer, vocabulary, IDF weights, and normalization (note scikit-learn's nonstandard `idf = ln(n/df)+1` with L2 norm) — derive these from whatever *you* train, not from the closed Rust model.

### Question 4 — Training compute requirements

**XGBoost training cost is trivial here.** A 200-tree, depth-8, 7-class model on ~1,500–10,000 samples with 181 features trains in **seconds to a couple of minutes on CPU** (any modern laptop: M4, 8-core x86, EPYC). **GPU does not help** at this scale — for <100k rows the data-transfer/kernel overhead makes GPU equal or slower than CPU (multiple practitioner benchmarks: e.g., a 10k-row/30-feature set took ~5 s on CPU vs ~6 s on an RTX 3060; GPU only wins above ~100k–1M rows). Memory is well under 1 GB. Hyperparameter search (Optuna) multiplies by the number of trials but each trial is still seconds; a few hundred trials is an afternoon on CPU.

**Dataset requirements:** This is the real cost. For a balanced 7-class classifier you want on the order of a few hundred to ~1,000 labeled examples per class (the original used 1,497 total pages with SMOTE oversampling to handle imbalance). Sources: the **WCXB dataset (2,008 pages, 7 types, CC-BY-4.0)** is directly usable as a labeled seed. For more, use Common Crawl + weak supervision (URL/JSON-LD heuristics auto-label, exactly the cascade's Stage 1–2), then **LLM labeling** (zero-shot with a strong model, or distill) which is far cheaper than crowdsourcing. Hand-labeling runs ~20–40 s/page once a rubric exists.

**Alternatives:** A fine-tuned **ModernBERT/DistilBERT** text classifier can hit ~F1 0.89 on small synthetic data and trains/runs comfortably on a single 24 GB GPU (L4-class). But **ModernBERT-base is 149M parameters** (large = 395M; released Dec 19, 2024 by Answer.AI/LightOn, Warner et al. arXiv:2412.13663, 8,192-token context, pre-trained on 2T tokens on 8×H100) — far heavier to deploy in TS/edge than a tree ensemble, and overkill if structural features already give ~87%. ModernBERT's training data is "primarily English and code, so performance may be lower for other languages," which matters for Czech/EU content. **LightGBM** trains faster than XGBoost with comparable accuracy but is a different model artifact. A **Random Forest** baseline is a reasonable sanity check. For your goals (lightweight, cross-language, edge-deployable), **tree ensemble beats a transformer**.

### Question 5 — Reusing the existing rs-trafilatura model

- **License:** MIT OR Apache-2.0 — commercially reusable with attribution. No copyleft obligations. The WCXB data is CC-BY-4.0.
- **Is the model included?** Yes, embedded in the crate — but in a **custom binary**, not a portable XGBoost file, and **without** the feature/TF-IDF pipeline. So "extract the model and load it elsewhere" is not viable without significant reverse engineering of both the binary format and the 181-feature extractor.
- **Compatibility paths:** Direct binary load — **no** (custom format). ONNX/Treelite conversion — **only possible if you can first get the model into a standard XGBoost object, which you can't from the embedded binary**. The practical conversion path requires re-training.
- **Risks of reuse:** Even if you reverse-engineered it: model staleness (trained on a specific 2026 web snapshot), train/test contamination risk if your pages overlap WCXB, and **quality on your distribution** — it was trained on a general (largely English) web sample; performance on Czech/EU sites is unverified and likely weaker, especially for the English-vocabulary TF-IDF component.

## Recommendations

**Staged plan (fastest path to a working bilingual classifier with one shared model):**

1. **Port the cheap wins first (days).** Re-implement Stage 1 (URL heuristics) and Stage 2 (JSON-LD/OG/DOM signal rules) in TypeScript and Python. These are deterministic rules, resolve ~78% of pages in the original cascade, and need no ML. This alone may meet your needs for many pages.
2. **Train your own XGBoost Stage 3 (1–3 days).** Pull the WCXB dataset (CC-BY-4.0), define your 7 classes, engineer a feature set (start simpler than 181 — structural/DOM counts + a modest TF-IDF), train a 200-tree multi-class model in Python/scikit-learn. Save canonical `model.json`; export `model.onnx` via onnxmltools. Budget: minutes of CPU compute, a few dollars at most. Add Optuna tuning if needed.
3. **Standardize on ONNX as the shared artifact.** Python: `onnxruntime` (or native `xgboost`). Node/server: `onnxruntime-node`. Browser/Cloudflare/Vercel edge: `onnxruntime-web` (WASM). One file, all runtimes. Pin a known-good onnxruntime version.
4. **Lock feature extraction with golden fixtures (ongoing).** Maintain a `fixtures/` set of HTML→expected-181-vector JSON; both the TS and Python extractors must reproduce them in CI to tolerance. Use selectolax (Python) and htmlparser2/cheerio with `xmlMode` (TS). If you want bit-identical features and are willing to invest, compile a single Rust feature extractor to WASM and call it from both languages.
5. **Localize for your distribution.** Add Czech/EU pages to training and to the TF-IDF vocabulary; re-evaluate per-class F1 on your own held-out set.

**Decision thresholds that change the plan:**
- If your pages are mostly resolvable by URL/JSON-LD heuristics → you may skip the ML model entirely (Stage 1–2 only).
- If structural features alone underperform (<~80% on your held-out set) → add the TF-IDF block, then consider a ModernBERT distillation only if you have GPU and need the last few points.
- If you need browser/edge inference → ONNX-Web or m2cgen mandatory (rules out native bindings and Treelite).
- If you only ever run server-side Python+Node → native `xgboost` (Python) + `onnxruntime-node` is simplest.

**Reuse vs build fresh:** **Build fresh.** Reusing the rs-trafilatura model directly is blocked by the custom binary format and the unpublished feature/TF-IDF pipeline; reverse engineering both would cost more than re-training, and you'd inherit staleness and English-bias risk. The repo is still highly valuable as a **blueprint** (the cascade design, the 7-type taxonomy, the feature *categories*) and the WCXB data is a ready-made labeled seed — both of which the permissive licenses let you use. As a quick interim option, since rs-trafilatura already ships a Python package (PyO3 native extension) and Contextractor already consumes the Rust core via a napi-rs binding in Node, you could call the existing Rust classifier directly in both stacks today and only build the portable ONNX classifier when you need browser/edge or a localized model.

## Caveats
- The conclusion that the embedded model is a custom (non-XGBoost-standard) binary is a high-confidence inference from the crate's zero-dependency `Cargo.toml`, "compact binary format" wording, and hand-written pure-Rust inference — it was not byte-level verified because the model file and `src/*.rs` could not be opened directly by automated tools. If you clone the repo and find a standard `.ubj`/`.json`, the reuse calculus improves (you could then convert to ONNX directly and skip retraining the model, though you'd still need to reverse-engineer the 181-feature extractor).
- Feature-count figures are inconsistent across the author's materials (81 vs 89 numeric; an older 163-feature Random Forest). Treat "181 = 81 numeric + 100 TF-IDF, 200 trees, depth 8" as the best current reading.
- Performance multipliers (JS vs Rust parsing, ONNX vs native inference) are order-of-magnitude estimates from general benchmarks, not measurements of this specific model; validate on your hardware.
- Reported accuracy (86.6–87.3%, macro F1 0.824) is on the author's WCXB distribution; expect different numbers on Czech/EU content.
