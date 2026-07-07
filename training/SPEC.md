# SPEC — training (offline classifier pipeline)

> Status: IMPLEMENTED. `download_wcxb.py`, `extract_features.py`, `train.py`, and
> `make_parity_fixtures.py` exist and run end-to-end; `model.xgb.json` +
> `tfidf-vocab.json` are exported into the Rust crate's `artifacts/` dir, and
> `packages/trafilaturacore/native/tests/fixtures/classifier-parity.json` holds the
> Rust↔Python parity fixtures. Authority: `@/prompts/2026-6-24-init/prompt.md`
> (Phase 4 / Phase CLASSIFY) and the feature contract in `@/training/FEATURES.md`.

## Purpose

Train trafilaturacore's page-type classifier offline and export the two runtime
artifacts consumed by the Rust extraction core (v2):

- `model.xgb.json` — the XGBoost native JSON dump (trees + `tree_info`
  round-robin class layout + `default_left` + `base_score`). Evaluated at
  runtime by a pure-Rust GBDT evaluator in the crate — no ONNX, no onnxruntime.
- `tfidf-vocab.json` — locked TF-IDF vocabulary + IDF weights + the baked
  StandardScaler `mean`/`scale`.

Both are written to `@/packages/trafilaturacore/native/artifacts/` (`include_str!`-ed
by the crate) and are committed to the repository, alongside the parity fixture
at `@/packages/trafilaturacore/native/tests/fixtures/classifier-parity.json`. This
project is offline-only, not a pnpm workspace member, and not shipped at runtime.

> **v1 note:** the shipped `@/packages/trafilaturacore/src/classifier/model/model.onnx`
> + `tfidf-vocab.json` remain committed and untouched so the v1 TypeScript suite
> stays green until Phase INTEGRATE. This pipeline no longer writes them.

## Pipeline

The pipeline is a four-stage flow, one script per stage.

### Stage DOWNLOAD — `download_wcxb.py`

- Fetch the WCXB dataset (CC-BY-4.0, attribution required) from Hugging Face
  `murrough-foley/web-content-extraction-benchmark` (mirror: Zenodo DOI
  `10.5281/zenodo.19316874`) into `data/wcxb/` (`.gitignore`d — never committed).
- Fetches **per file** (`hf_hub_download` for `metadata.json` then each labeled
  HTML), sequentially with gentle pacing + per-file 429 retry/backoff, because
  the snapshot fan-out trips HF's anonymous rate limit. Idempotent: cached files
  are skipped, so an interrupted run resumes cheaply. `WCXB_PACING_SECONDS` and
  `WCXB_MAX_RETRIES` env vars tune it; a `HF_TOKEN` (never logged) raises the limit.
- `build_index()` parses `metadata.json` into `LabeledPage` records, keeping only
  entries whose HTML is present, and asserts `page_types == CLASS_LABELS`.
- **URL caveat:** the dataset ships only a `domain`, so `LabeledPage.url` is
  `https://{domain}/`. URL-derived features (f[0..14], f[72]) therefore see only
  the bare domain. The TS parity side must use the same per-fixture URL.

### Stage FEATURES — `extract_features.py`

- `extract_numeric_features(html, url) -> list[float]` computes exactly **89**
  numeric features; `title_meta_text(html) -> str` returns the `"{title}
  {description}"` TF-IDF input. The full model vector is **189** = 89 scaled
  numeric ++ 100 TF-IDF.
- **Authoritative contract:** [`@/training/FEATURES.md`](@/training/FEATURES.md)
  enumerates every `f[0..89]` index (exact DOM query, normalization,
  missing-value default), the 500,000-byte body-text early-return gate, TF-IDF
  tokenization/input text, StandardScaler scope, tree inference (`< → left`,
  missing→0.0), and the URL/HTML heuristic cascade. Both extractors implement it.
- HTML parsing via `selectolax` (Lexbor). **Parity gotchas baked in:** all
  `.len()` use UTF-8 BYTE length (`_blen`); `.text()` is pure descendant-text
  concatenation (`node.text(deep=True, separator="")`); scoped descendant counts
  exclude the root node (`_descendant_count`, matters for f[85]); direct children
  use a manual `child`/`next` element-only walk (`_element_children`) — NOT
  `node.iter()`, which both includes comment nodes (dom_query `children()` does
  not) and **segfaults** when `.attributes` is read off iterated children on some
  deep trees.
- **Parity requirement:** these features MUST match the TypeScript extractor in
  `@/packages/trafilaturacore/src/classifier/features/` exactly. Validated by the TS↔Python
  parity fixtures (target ≥99% exact match; compare the **argmax class**, not raw
  probabilities).
- **`title_meta_text` is a documented simplification:** `<title>` element text +
  first meta description (`description`/`og:description`/`twitter:description`/
  `dc.description`/`excerpt`). It does NOT run rs-trafilatura's full metadata
  pipeline (DOM title fallbacks, entity decoding, site-suffix stripping). Since
  the TF-IDF vocab is locked from this text, the TS runtime must mirror this exact
  simplified logic, not the full metadata extractor.
- **TF-IDF detail:** scikit-learn's nonstandard idf (`smooth_idf=True`:
  `idf = ln((1+n)/(1+df)) + 1`) with L2 normalization, `token_pattern`
  `(?u)\b\w\w+\b` (drops 1-char tokens), `ngram_range=(1, 1)`, `lowercase=True`.
  These are serialized into `tfidf-vocab.json` so the TS side reproduces the
  transform exactly.

### Stage TRAIN — `train.py`

- Load dev split → extract 89 numeric + `title_meta` text per page → fit
  `TfidfVectorizer(max_features=100, smooth_idf=True, norm="l2", lowercase=True,
  ngram_range=(1,1), token_pattern=r"(?u)\b\w\w+\b")` on dev texts → fit
  `StandardScaler` on the 89 dev numeric → assemble `[scaled_numeric(89) ++
  tfidf(100)]` = 189 → SMOTE oversample (fallback: balanced `sample_weight`,
  logged) → train `XGBClassifier(n_estimators=200, max_depth=8,
  objective="multi:softprob", num_class=7, tree_method="hist",
  random_state=42)`.
- Class order is the canonical `CLASS_LABELS = [article, forum, product,
  collection, listing, documentation, service]` (from `metadata.json`
  `page_types`), persisted in `tfidf-vocab.json` as `classLabels`. The TS side
  maps `argmax → classLabels[idx]`; do NOT hardcode an assumed order.
- Evaluates on the held-out TEST split: prints accuracy, per-class P/R/F1,
  macro-F1, and the confusion matrix.

### Stage EXPORT — (within `train.py`)

- Export the XGBoost native JSON dump via
  `clf.get_booster().save_model(model.xgb.json)`. The file carries the 1400 trees
  (200 rounds × 7 classes), `tree_info` (the round-robin class layout,
  `tree_info[i] == i % 7`), per-node `default_left`, and a string-typed
  `base_score` (`"5E-1"` = 0.5). Scaling and TF-IDF live in the feature code — the
  model is pure XGBoost on the 189-vector.
- After export, `_verify_json` reloads `model.xgb.json` into a fresh
  `xgboost.Booster` and asserts its argmax over TEST matches the trained
  classifier's (must round-trip at 100%).
- Emit `tfidf-vocab.json`: `vocabulary` (term→index), `idf` (100), `numericMean`
  + `numericScale` (89 each, the StandardScaler stats), `classLabels` (7),
  `nNumeric` (89), `nTfidf` (100), `tokenPattern`, `ngramRange`, `lowercase`.
- Both `model.xgb.json` + `tfidf-vocab.json` are written directly into
  `@/packages/trafilaturacore/native/artifacts/` (the only committed copies; no
  `training/`-local copies).

### Stage PARITY — `make_parity_fixtures.py`

- Reads every committed HTML fixture under
  `@/packages/trafilaturacore/fixtures/classifier/*.html` (with each fixture's `url` +
  ground-truth type from the v1 `parity.json` manifest, so it runs offline
  without the dataset), loads `model.xgb.json` + `tfidf-vocab.json`, and writes
  `@/packages/trafilaturacore/native/tests/fixtures/classifier-parity.json`:
  `{model, n_numeric:89, n_tfidf:100, n_classes:7, class_labels, fixtures:[{file,
  url, numeric[89] (RAW), tfidf[100] (RAW L2-normed), argmax, page_type,
  probs[7]}]}`. `argmax`/`probs` come from running the Booster on the assembled
  189-vector `[scaled_numeric ++ tfidf]`. The Cargo parity test re-extracts from
  the same HTML, applies the baked scaler, feeds its pure-Rust GBDT evaluator,
  and asserts numeric/tfidf ≤1e-6 and argmax 100%.
- The v1 `@/packages/trafilaturacore/fixtures/classifier/parity.json` (consumed by the
  v1 TS parity suite) is left untouched.

## Determinism and validation

- Tree models are threshold comparisons and are cross-platform deterministic
  once features match — exploit this for reproducible golden tests.
- Parity tests compare the **argmax class**, not exact probabilities (borderline
  float differences across runtimes can flip probabilities).
- Treat our own held-out split as the source of truth for accuracy, not the
  upstream author's leaderboard.

## Tests

- `tests/test_extract_features.py` — representative numeric features against a
  hand-checked snippet (`tiny_html` fixture in `conftest.py`), the 500,000-byte
  gate (strict `>`), UTF-8 byte-length semantics, `extract_domain_path` /
  `contains_any`, `title_meta_text`, and determinism.
- `tests/test_tfidf.py` — TF-IDF fit determinism, the `smooth_idf` formula, L2
  normalization, and the 1-char-token drop.
- `tests/test_model_export.py` — asserts exported-artifact metadata (the
  `classifier-parity.json` shape: 89 numeric + 100 tfidf + 7 probs + valid
  argmax/label per entry) and a `model.xgb.json` round-trip (reload the Booster,
  assert its argmax reproduces each fixture's recorded argmax). Skips gracefully
  when the artifacts have not been generated yet, so the default run stays green.
- All tests are fully offline (no dataset, no network). The dataset download and
  the end-to-end `train.py` run are exercised manually, not in the default
  `pytest` run.

## Tooling

- Python 3.12+, uv-managed; deps in `requirements.txt` (`xgboost`,
  `scikit-learn`, `imbalanced-learn`, `selectolax`, `huggingface_hub`, `pytest`,
  `ruff`). ONNX (`skl2onnx`/`onnxmltools`/`onnx`/`onnxruntime`) was dropped — the
  model exports as the XGBoost native JSON dump and is evaluated by a pure-Rust
  GBDT evaluator in the crate, so no ONNX toolchain is needed.
- `ruff` (line-length 100, target py312) and `pytest` (`testpaths = ["tests"]`)
  configured in `pyproject.toml`.
