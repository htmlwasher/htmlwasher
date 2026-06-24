# SPEC — training (offline classifier pipeline)

> Status: IMPLEMENTED. `download_wcxb.py`, `extract_features.py`, `train.py`, and
> `make_parity_fixtures.py` exist and run end-to-end; `model.onnx` +
> `tfidf-vocab.json` are exported and copied into the TS package, and
> `htmlwasher/fixtures/classifier/` holds the TS↔Python parity fixtures.
> Authority: `@/prompts/2026-6-24-init/prompt.md` (Phase 4) and the feature
> contract in `@/training/FEATURES.md`.

## Purpose

Train htmlwasher's page-type classifier offline and export the two
runtime artifacts consumed by the TypeScript library:

- `model.onnx` — XGBoost classifier exported to ONNX.
- `tfidf-vocab.json` — locked TF-IDF vocabulary + IDF weights.

Both are written to `@/htmlwasher/src/classifier/model/` and are the
only outputs committed to the repository. This project is offline-only, not a
pnpm workspace member, and not shipped at runtime.

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
  `@/htmlwasher/src/classifier/features/` exactly. Validated by the TS↔Python
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

- Export to `model.onnx` via `onnxmltools.convert_xgboost`, input a single
  `[None, 189]` float tensor (`target_opset=13`; the converter emits the
  `ai.onnx.ml` `TreeEnsembleClassifier`). Scaling and TF-IDF live in the feature
  code — the ONNX graph is pure XGBoost on the 189-vector. Outputs are `label`
  (int64) and `probabilities` `[None, 7]`.
- After export, the run cross-checks ONNX vs native-XGBoost argmax on TEST
  (expected 100% agreement) against the pinned `onnxruntime` (>=1.23,<1.24 —
  outside the 1.21.x–1.22.x category-only-trees bug window).
- Emit `tfidf-vocab.json`: `vocabulary` (term→index), `idf` (100), `numericMean`
  + `numericScale` (89 each, the StandardScaler stats), `classLabels` (7),
  `nNumeric` (89), `nTfidf` (100), `tokenPattern`, `ngramRange`, `lowercase`.
- Copy `model.onnx` + `tfidf-vocab.json` into `@/htmlwasher/src/classifier/model/`
  (the only committed copies; the `training/`-local copies are `.gitignore`d).

### Stage PARITY — `make_parity_fixtures.py`

- Picks small (<60 KB) dev HTML pages (2 per type, 14 total), copies them to
  `@/htmlwasher/fixtures/classifier/<id>.html`, and writes `parity.json`: per
  fixture `{file, url, pageType, numeric[89], tfidf[100], argmax, argmaxLabel}`,
  with `argmax` from running the exported ONNX on the assembled 189-vector. The TS
  parity test re-extracts from the same HTML and compares.

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
- All tests are fully offline (no dataset, no network). The dataset download and
  the end-to-end `train.py` run are exercised manually, not in the default
  `pytest` run.

## Tooling

- Python 3.12+, uv-managed; deps in `requirements.txt` (`xgboost`,
  `scikit-learn`, `imbalanced-learn`, `skl2onnx`/`onnxmltools`/`onnx`,
  `onnxruntime`, `selectolax`, `huggingface_hub`, `pytest`, `ruff`).
- `ruff` (line-length 100, target py312) and `pytest` (`testpaths = ["tests"]`)
  configured in `pyproject.toml`.
