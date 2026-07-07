# trafilaturacore — model training (offline)

> Status: IMPLEMENTED. The offline pipeline trains the page-type classifier
> (Phase 4 / Phase CLASSIFY of `@/prompts/2026-6-24-init/prompt.md`) and exports
> `model.xgb.json` + `tfidf-vocab.json` plus the Rust↔Python parity fixture. See
> `@/training/SPEC.md` for the full design and `@/training/FEATURES.md` for the
> authoritative feature contract.

This is the **offline** training project for trafilaturacore's page-type
classifier. It trains a standard XGBoost model from the public WCXB dataset and
exports two artifacts into `@/packages/trafilaturacore/native/artifacts/`:

- `model.xgb.json` — the XGBoost native JSON dump (trees + `tree_info`
  round-robin class layout + `default_left` + `base_score`). Evaluated at runtime
  by a pure-Rust GBDT evaluator in the crate — no ONNX, no onnxruntime.
- `tfidf-vocab.json` — the locked TF-IDF vocabulary plus IDF weights and the
  baked StandardScaler stats, so the Rust feature extractor reproduces
  training-time features exactly.

## Scope and status

- **Offline-only.** This project runs by hand to (re)train the model. It is
  **not shipped** with the npm package and is **not** a pnpm workspace member.
- **Python 3.12+, uv-managed.** Dependencies are listed in `requirements.txt`
  and resolved on demand via uv. See `@/CLAUDE.md` for the repo-wide tooling
  conventions.

## Scripts

- `download_wcxb.py` — fetch the WCXB dataset from Hugging Face
  (`murrough-foley/web-content-extraction-benchmark`; Zenodo mirror DOI
  `10.5281/zenodo.19316874`) into `data/wcxb/` (`.gitignore`d). Per-file,
  rate-limit-resilient, idempotent.
- `extract_features.py` — compute the **89 numeric** features (+ the
  `title_meta` TF-IDF input) with byte-for-byte **parity** to the TypeScript
  extractor in `@/packages/trafilaturacore/src/classifier/features/`.
- `train.py` — train an `XGBClassifier`, evaluate on the held-out TEST split,
  export `model.xgb.json` (native JSON dump) + `tfidf-vocab.json` into
  `@/packages/trafilaturacore/native/artifacts/`, and round-trip-verify the dump.
- `make_parity_fixtures.py` — emit the Rust↔Python parity fixture
  `@/packages/trafilaturacore/native/tests/fixtures/classifier-parity.json`.

## Usage

Run from `@/training/`:

```bash
uv venv && uv pip install -r requirements.txt
uv run python download_wcxb.py        # fetch WCXB into data/wcxb/ (idempotent)
uv run python train.py                # train + export model.xgb.json + tfidf-vocab.json
uv run python make_parity_fixtures.py # regenerate classifier-parity.json
uv run pytest                         # offline unit tests
uvx ruff check . && uvx ruff format .
```

## Dataset and attribution (required)

The **WCXB** (Web Content Extraction Benchmark) dataset is licensed
**CC-BY-4.0**, which **requires attribution**. It is fetched at runtime and is
**never committed** to this repository.

- Dataset: WCXB by **Murrough Foley** — Hugging Face
  `murrough-foley/web-content-extraction-benchmark`, Zenodo DOI
  `10.5281/zenodo.19316874`, license CC-BY-4.0.

Reproduce the full attribution/NOTICE block required by the upstream and
reference licenses (see the repository root `NOTICE` and
`@/packages/trafilaturacore/README.md`).

## What is committed vs. not

- **Committed:** the trained artifacts `model.xgb.json` + `tfidf-vocab.json` (in
  `@/packages/trafilaturacore/native/artifacts/`), the parity fixture
  `@/packages/trafilaturacore/native/tests/fixtures/classifier-parity.json`, and this
  skeleton. (The v1 `@/packages/trafilaturacore/src/classifier/model/model.onnx` +
  `tfidf-vocab.json` also stay committed until Phase INTEGRATE — this pipeline no
  longer writes them.)
- **Never committed:** the WCXB dataset, downloaded data, the `.venv`, and any
  intermediate `*.parquet` / `*.csv` (see `.gitignore`).
