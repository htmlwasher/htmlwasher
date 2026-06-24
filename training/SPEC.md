# SPEC — training (offline classifier pipeline)

> Status: PENDING — NOT IMPLEMENTED. This spec describes the intended pipeline.
> No training, feature-extraction, or export logic exists in this directory yet.
> Authority: `@/prompts/2026-6-24-init/prompt.md` (Phase 4).

## Purpose

Train htmlwasher's page-type classifier offline and export the two
runtime artifacts consumed by the TypeScript library:

- `model.onnx` — XGBoost classifier exported to ONNX.
- `tfidf-vocab.json` — locked TF-IDF vocabulary + IDF weights.

Both are written to `@/htmlwasher/src/classifier/model/` and are the
only outputs committed to the repository. This project is offline-only, not a
pnpm workspace member, and not shipped at runtime.

## Intended pipeline

The pipeline is a four-stage flow, each stage a planned script (none implemented
yet):

### Stage DOWNLOAD — `download_wcxb.py`

- Fetch the WCXB dataset (CC-BY-4.0, attribution required) from Hugging Face
  `murrough-foley/web-content-extraction-benchmark` or Zenodo DOI
  `10.5281/zenodo.19316874`.
- Data is fetched at runtime and `.gitignore`d — never committed.

### Stage FEATURES — `extract_features.py`

- Compute the **189 features** per page: **89 numeric** DOM/URL signals + **100
  TF-IDF** features. (The reference classifier's code uses 89 numeric / 189
  total; its README body still says 81/181 — the code is authoritative.)
- HTML parsing via `selectolax` (Python side).
- **Parity requirement:** these features MUST match the TypeScript extractor in
  `@/htmlwasher/src/classifier/features/` exactly (feature list,
  ordering, normalization, missing-value handling). Parity is validated by the
  TS↔Python feature-parity tests (target ≥99% exact match).
- **TF-IDF detail:** replicate scikit-learn's nonstandard idf exactly — its
  default (`smooth_idf=True`) is `idf = ln((1+n)/(1+df)) + 1` with L2
  normalization (the bare `ln(n/df) + 1` is only the non-default
  `smooth_idf=False` form). The resulting vocabulary + IDF weights are
  serialized to `tfidf-vocab.json`.

### Stage TRAIN — `train.py`

- Train an `XGBClassifier` over the 7 page types (`article`, `forum`,
  `product`, `collection`, `listing`, `documentation`, `service`).
- Intended hyperparameters (per Phase 4): ~200 trees, `max_depth` 8,
  `multi:softprob`, 7 classes, SMOTE oversampling. CPU-only — no GPU required.

### Stage EXPORT — (within `train.py`)

- Export the trained model to `model.onnx` via `skl2onnx` / `onnxmltools`.
- Emit `tfidf-vocab.json` (vocabulary + IDF weights).
- Copy both artifacts into `@/htmlwasher/src/classifier/model/`.
- Pin a known-good `onnxruntime` for verification (avoid the 1.21.x–1.22.x
  category-only-trees bug noted in the research).

## Determinism and validation

- Tree models are threshold comparisons and are cross-platform deterministic
  once features match — exploit this for reproducible golden tests.
- Parity tests compare the **argmax class**, not exact probabilities (borderline
  float differences across runtimes can flip probabilities).
- Treat our own held-out split as the source of truth for accuracy, not the
  upstream author's leaderboard.

## Tooling

- Python 3.12+, uv-managed; deps listed (not installed) in `requirements.txt`.
- `ruff` (line-length 100, target py312) and `pytest` (`testpaths = ["tests"]`)
  configured in `pyproject.toml`.
