# htmlwasher — model training (offline)

> Status: IMPLEMENTED. The offline pipeline trains the page-type classifier
> (Phase 4 of `@/prompts/2026-6-24-init/prompt.md`) and exports `model.onnx` +
> `tfidf-vocab.json`. See `@/training/SPEC.md` for the full design and
> `@/training/FEATURES.md` for the authoritative feature contract.

This is the **offline** training project for htmlwasher's page-type
classifier. It trains a standard XGBoost model from the public WCXB dataset and
exports two artifacts into `@/packages/htmlwasher/src/classifier/model/`:

- `model.onnx` — the trained classifier, run in Node via onnxruntime (no Python
  at runtime).
- `tfidf-vocab.json` — the locked TF-IDF vocabulary plus IDF weights, so the
  TypeScript feature extractor reproduces training-time features exactly.

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
  extractor in `@/packages/htmlwasher/src/classifier/features/`.
- `train.py` — train an `XGBClassifier`, evaluate on the held-out TEST split,
  export `model.onnx`, emit `tfidf-vocab.json`, and copy both into
  `@/packages/htmlwasher/src/classifier/model/`.
- `make_parity_fixtures.py` — emit small TS↔Python parity fixtures into
  `@/packages/htmlwasher/fixtures/classifier/`.

## Usage

Run from `@/training/`:

```bash
uv venv && uv pip install -r requirements.txt
uv run python download_wcxb.py        # fetch WCXB into data/wcxb/ (idempotent)
uv run python train.py                # train + export model.onnx + tfidf-vocab.json
uv run python make_parity_fixtures.py # regenerate the TS parity fixtures
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
`@/packages/htmlwasher/README.md`).

## What is committed vs. not

- **Committed:** the trained artifacts `model.onnx` and `tfidf-vocab.json` (they
  live in `@/packages/htmlwasher/src/classifier/model/`), plus this skeleton.
- **Never committed:** the WCXB dataset, downloaded data, the `.venv`, and any
  intermediate `*.parquet` / `*.csv` (see `.gitignore`).
