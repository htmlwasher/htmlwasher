# Reimplementing the rs-trafilatura XGBoost Page-Type Classifier in TypeScript and Python — Feasibility

> Research context document for the trafilaturacore TypeScript port.
> Saved 2026-06-24. Source: deep technical research session.

## TL;DR
- **Feasible in both languages, and inference performance is a non-issue.** The classifier is a tiny tabular model (200 trees, depth 8, 181 features, 7 classes) whose per-page inference is well under 1 ms; TypeScript vs Python vs Rust changes inference latency by microseconds, negligible against HTML parsing + feature extraction (the author's headline is 44 ms/page on CPU, ~22 pages/s). The real engineering work is re-implementing the 181-feature extraction (81 numeric + 100 TF-IDF) identically per language, not running the trees.
- **The model and benchmark data are openly licensed and reusable** (rs-trafilatura and web-page-classifier are MIT OR Apache-2.0; WCXB dataset is CC-BY-4.0, DOI 10.5281/zenodo.19316874), but the classifier ships as a custom ~1.1 MB compact binary embedded in the Rust crate, NOT an XGBoost-native or ONNX file — so "load the same file in Python and JS" is not turnkey. The clean cross-language path is to obtain/retrain a standard XGBoost model and export it to ONNX, which both onnxruntime-node and onnxruntime (Python) load identically.
- **Training needs no GPU and no significant compute.** ~1,497–2,008 labeled pages × 181 features × 200 trees trains on a laptop CPU in seconds to a couple of minutes. Bottleneck is data labeling, not compute.

## How the classifier is actually implemented in Rust
- The classifier is NOT part of the main `rs-trafilatura` crate's code — `rs-trafilatura`'s `Cargo.toml` depends on a separate crate `web-page-classifier = "0.1"` (alongside `dom_query`, `html-cleaning`, `quick_html2md`). The ML lives there.
- `web-page-classifier` (v0.1.0, repo github.com/Murrough-Foley/web-page-classifier, MIT OR Apache-2.0) has an empty `[dependencies]` table — pure Rust, `unsafe_code = "forbid"`, "no ML frameworks required." Inference is hand-written tree traversal (threshold comparisons) over an embedded model, NOT a call into xgboost bindings / gbdt / ONNX / tract / ort.
- The model is a ~1.1 MB binary embedded into the crate ("The embedded model adds ~1.1MB to binary size"). `Cargo.toml` `include` is only `src/**/*`, so the blob lives under `src/` (almost certainly via `include_bytes!`). Format: a custom "compact binary" — NOT XGBoost-native `.json`/`.ubj`/`.bin` and NOT ONNX.
- Hyperparameters (crate README "Model Details"): XGBoost, 200 estimators, max depth 8; 81 numeric features (URL patterns, HTML structure, DOM signals) + 100 TF-IDF = 181 features; trained on 1,497 pages across 7 types with SMOTE oversampling; 87.3% accuracy, macro F1 0.824. (Repo "About" blurb says "89 numeric features" and "86.6% accuracy"; 81+100=181 is internally consistent, so 89 appears stale.)
- Public API: `classify_url(&str) -> PageType` (Stage 1 URL heuristics), `classify_ml(&[f64], &str) -> (PageType, confidence)` (Stage 2 ML), plus `N_NUMERIC_FEATURES`. `classify_ml` takes the numeric feature vector pre-computed by the caller plus a text string — TF-IDF is computed internally from the text; numeric DOM/URL features are computed upstream in `rs-trafilatura`.
- Three-stage pipeline: URL heuristics (~63% of pages resolve here), HTML signal analysis (JSON-LD @type, OpenGraph, DOM patterns; ~15% more), XGBoost only for the remaining ambiguous pages (~22%).
- NO training code or training data is committed to the web-page-classifier repo (4 commits; only src/, licenses, README, Cargo.toml/lock). Training done offline in Python.
- The author already ships a Python binding: the `rs-trafilatura` PyPI package (PyO3) bundles all four Rust crates and exposes `rs_trafilatura.classify_page(numeric_features)` and `classify_url(...)`.

## Q1 — TypeScript / JavaScript reimplementation
**Feasible: yes, comfortably.** Four approaches:
1. **ONNX + `onnxruntime-node` (recommended).** Convert a standard XGBoost model to ONNX (`onnxmltools.convert_xgboost` -> `ai.onnx.ml` TreeEnsemble) and run with onnxruntime-node. Most robust, maintained, cross-language-consistent. Ships native `.node` binary (prebuilt Win/macOS/Linux x64+arm64).
2. **ONNX + `onnxruntime-web` (WASM).** Same model file, pure WASM, no native addon — ideal where you can't ship native binaries. Slightly slower cold start/per-call, irrelevant at this model size.
3. **Hand-written tree traversal in TS** from a dumped model JSON (`booster.dump_model`/`save_model(json)`). For 200 shallow trees, a few hundred lines. Pure JS, zero runtime deps, trivially bundleable/serverless-friendly. Mirrors exactly what the Rust crate does.
4. **Pure-JS XGBoost packages** (`@fractal-solutions/xgboost-js`, emscripten `ml-xgboost`, old `nuanio/xgboost-node`). Lightly maintained niche; not recommended as primary.

**Speed vs Rust:** single inference is microseconds to tens of microseconds in any approach. Native addon: ~1–3x of native Rust. WASM: ~2–5x slower, still sub-ms. Pure-JS traversal: ~5–20x slower worst case, still <0.1 ms/page. **This does not matter** — total pipeline is 44 ms/page (README per-type table: 14.1 ms/file articles to 43.8 ms/file collections), dominated by HTML parsing + DOM feature extraction; for ~78% of pages the model never runs (URL/HTML heuristics resolve first). Optimize HTML parsing (cheerio/parse5/linkedom) and feature code, not the trees.

**Runtime deps by approach:** onnxruntime-node = native prebuilt `.node` (tens of MB installed), adds cold-start weight. onnxruntime-web = a `.wasm` (few MB), no native addon, cleanest for constrained/serverless. Pure-JS traversal = zero native deps, ships only JS + a model JSON (few hundred KB–~1 MB). Best for Apify bundle size + cold start.

## Q2 — Python reimplementation
**Feasible: trivially.** Options: (a) official `xgboost` package loading the model directly (C-speed); (b) ONNX + onnxruntime; (c) pure-Python traversal (pointless except to avoid the binary dep); (d) treelite (compiles trees to native .so, 2–6x faster batch, overkill); (e) reuse existing Rust model via `pip install rs-trafilatura` (PyO3) — lowest effort.

**Speed vs Rust:** per-call inference in xgboost/onnxruntime is native C/C++ — effectively Rust-equivalent. Python overhead appears only as per-call DMatrix construction (microseconds), pure-Python feature extraction (use lxml/selectolax), and the GIL for in-process parallelism (sidestep with multiprocessing/batching). Sub-ms for one page.

**Runtime deps / sizes:** xgboost wheel bundles libxgboost + links OpenMP (~150–300 MB installed) and needs numpy. onnxruntime bundles native libs (~15–60 MB) + numpy. Pure-Python needs only stdlib. PyO3 rs-trafilatura wheel is a single compact native extension.

## Q3 — Can ONE model be shared between Python and TS/JS?
**Yes — via ONNX, with one large caveat.**
- ONNX is the universal interchange format: onnxruntime has first-class Python AND Node/Web bindings; a single `.onnx` TreeEnsemble produces identical predictions in both.
- XGBoost native `.json`/`.ubj` is also cross-platform, but JS has no first-class official XGBoost loader, so ONNX is preferable for parity.
- **Critical caveat — sharing the model is necessary but NOT sufficient.** The 181 features must be computed byte-for-byte identically in Python and JS, or predictions diverge: same DOM metrics, same text normalization/tokenization, same 100-term TF-IDF vocabulary + IDF weights, same feature ordering, same missing-value handling. This feature-extraction parity is the genuinely hard part — far harder than the trees. The Rust `classify_ml` even splits responsibility (numeric vector in, text string in), so you must replicate both halves.
- **Floating-point determinism favors you.** Tree models are `feature[i] < threshold` comparisons -> discrete paths; unlike neural nets they're essentially immune to cross-platform FP drift (only matters for inputs exactly on a split threshold). Once features match, Python and JS agree on the class. Keep features float32/float64 consistently and replicate XGBoost's default-direction (missing-value) behavior.

## Q4 — Training compute & GPU
**No GPU needed; compute is trivial.** Small tabular problem: ~1,497 training rows (<=2,008 with held-out), 181 features, 200 trees, depth 8, 7 classes. Trains on a laptop CPU in seconds to a couple of minutes. (XGBoost guidance: skip GPU when data fits in memory and trains in <5s on CPU; GPU memory-transfer/kernel-launch overhead makes small datasets slower on GPU.) Deep-learning contrast: rs-trafilatura 44 ms/page on CPU vs MinerU-HTML 1,570 ms/page and ReaderLM-v2 10,410 ms/page on an A100. GPU only helps XGBoost for very large datasets or big hyperparameter sweeps — N/A here. Training loop: labeled HTML -> 181-feature vectors -> xgboost.train/XGBClassifier.fit with SMOTE -> export. True cost is acquiring/labeling pages, not compute.

## Q5 — Reusing the existing model/data
**Licenses (all permissive/reusable, incl. commercial):**
- rs-trafilatura: MIT OR Apache-2.0. web-page-classifier: MIT OR Apache-2.0. go-trafilatura: Apache-2.0. adbar/trafilatura: Apache-2.0.
- WCXB dataset: CC-BY-4.0 (attribution required), DOI 10.5281/zenodo.19316874, mirrored on Hugging Face (`murrough-foley/web-content-extraction-benchmark`). 2,008 pages from 1,613 domains: 793 articles, 165 service, 119 products, 117 collections, 113 forums, 99 listings, 91 documentation; 1,497 dev + 511 held-out test.

**Is the trained model committed?** Yes — but as the ~1.1 MB custom compact binary embedded in web-page-classifier/src/, NOT XGBoost-native or ONNX. Not directly loadable by Python xgboost or onnxruntime as-is; you'd have to reverse its serialization to convert.
**Is training DATA included?** Not in the classifier repo. But WCXB (the underlying labeled corpus) IS public (Zenodo/HF, CC-BY-4.0), giving labels + raw HTML to regenerate features and retrain. Feature-extraction code is open (in the rs-trafilatura/web-page-classifier Rust source).

**Lowest-effort paths, ranked:**
1. **Just need it in Python:** `pip install rs-trafilatura`, call `classify_page()`/`classify_url()` — reuses the exact existing model via PyO3, zero reimplementation (adds a native wheel dep).
2. **Want one portable model shared by TS + Python:** retrain a standard XGBClassifier from public WCXB data using feature extraction ported from the Rust source, export to ONNX, load with onnxruntime-node (TS) + onnxruntime (Python). Guarantees identical predictions, avoids reverse-engineering the blob.
3. **Want zero native deps in the Apify Actor (TS):** same retrain, but dump model to JSON and ship a hand-written ~few-hundred-line tree traverser + model JSON. Smallest bundle, best cold start.

In all cases the unavoidable work is porting the 181-feature extraction (and the 100-term TF-IDF vocabulary) to your target language so it matches the model's expectations.

## Recommendations
1. **Decide whether you actually need to drop Rust.** If napi-rs already works in Contextractor, the cheapest correct answer is to keep calling web-page-classifier via napi-rs and rs-trafilatura via PyO3 in Python.
2. **If reimplementing: standardize on a retrained, ONNX-exported XGBoost model.** Retrain XGBClassifier (200 trees, depth 8, multi:softprob, 7 classes, SMOTE) on public CC-BY-4.0 WCXB data, port feature extraction from the open Rust source, export with onnxmltools to ONNX. Load identically in onnxruntime (Python) + onnxruntime-node/-web (TS). Threshold to change plan: if you require zero native deps in the Actor, switch to JSON-dump + hand-written-traverser.
3. **Invest the budget in feature-extraction parity, not the trees.** Write the 181-feature extractor once per language, lock the 100-term TF-IDF vocabulary as a shipped artifact, validate against a golden set of WCXB pages until predictions match the reference (target >=99% exact-match).
4. **Train on CPU; do not provision a GPU.** Spend effort on labeled-data quality/coverage — that's what moves the ~87% accuracy.
5. **Honor CC-BY-4.0 attribution** for WCXB and keep MIT/Apache notices if you reuse code.

## Caveats
- The web-page-classifier source files could not be read directly during research; "custom compact binary traversed by hand-written pure-Rust" is inferred (high confidence) from the empty dependency list, `unsafe_code = "forbid"`, the "no ML frameworks"/"compact binary" wording, and `include = ["src/**/*"]`. To confirm, download the crate tarball and inspect src/.
- Source inconsistencies in the author's materials: feature count (81 vs 89; 81 consistent with 181 total) and accuracy (87.3% vs 86.6% vs 87%). Treat the crate README "Model Details" as authoritative. Per-page timing: README table ~14–44 ms/file vs headline 44 ms/page; both sub-50 ms.
- Because the shipped artifact is not XGBoost-native/ONNX, "load the identical existing model in Python and JS" is not directly possible without retraining or reverse-engineering the blob. The ONNX-after-retrain path sidesteps this.
- JS/WASM/native perf figures are reasoned estimates anchored to published tree-inference benchmarks + rs-trafilatura's per-page timings. Given the model size, the qualitative conclusion (language-agnostic, sub-ms) is robust.
