# trafilatura-alpha — model training (offline)

> Status: NOT YET IMPLEMENTED — skeleton only.
> This directory will hold the offline pipeline that trains the page-type
> classifier described in `@/prompts/2026-6-24-init/prompt.md` (Phase 4). No
> training, feature-extraction, or export logic exists yet.

This is the **offline** training project for trafilatura-alpha's page-type
classifier. It trains a standard XGBoost model from the public WCXB dataset and
exports two artifacts into `@/trafilatura-alpha/src/classifier/model/`:

- `model.onnx` — the trained classifier, run in Node via onnxruntime (no Python
  at runtime).
- `tfidf-vocab.json` — the locked TF-IDF vocabulary plus IDF weights, so the
  TypeScript feature extractor reproduces training-time features exactly.

## Scope and status

- **Offline-only.** This project runs by hand to (re)train the model. It is
  **not shipped** with the npm package and is **not** a pnpm workspace member.
- **Python 3.12+, uv-managed.** Dependencies are listed (not installed) in
  `requirements.txt` and resolved on demand via uv. See
  `@/CLAUDE.md` for the repo-wide tooling conventions.
- **Not yet implemented.** The scripts below are planned but intentionally
  absent from this skeleton; they are implemented later, per
  `@/prompts/2026-6-24-init/prompt.md` (Phase 4).

## Planned scripts

These are described here for context only — do not expect them to exist yet:

- `download_wcxb.py` — fetch the WCXB dataset from Hugging Face
  (`murrough-foley/web-content-extraction-benchmark`) or Zenodo
  (DOI `10.5281/zenodo.19316874`). Downloaded data is `.gitignore`d.
- `extract_features.py` — compute the **181 features** (81 numeric DOM/URL
  signals + 100 TF-IDF) with byte-for-byte **parity** to the TypeScript
  extractor in `@/trafilatura-alpha/src/classifier/features/`.
- `train.py` — train an `XGBClassifier`, export `model.onnx`, emit
  `tfidf-vocab.json`, and copy both into
  `@/trafilatura-alpha/src/classifier/model/`.

## Dataset and attribution (required)

The **WCXB** (Web Content Extraction Benchmark) dataset is licensed
**CC-BY-4.0**, which **requires attribution**. It is fetched at runtime and is
**never committed** to this repository.

- Dataset: WCXB by **Murrough Foley** — Hugging Face
  `murrough-foley/web-content-extraction-benchmark`, Zenodo DOI
  `10.5281/zenodo.19316874`, license CC-BY-4.0.

When this pipeline is implemented, reproduce the full attribution/NOTICE block
required by the upstream and reference licenses (see the repository root
`NOTICE` and `@/trafilatura-alpha/README.md`).

## What is committed vs. not

- **Committed:** the trained artifacts `model.onnx` and `tfidf-vocab.json` (they
  live in `@/trafilatura-alpha/src/classifier/model/`), plus this skeleton.
- **Never committed:** the WCXB dataset, downloaded data, the `.venv`, and any
  intermediate `*.parquet` / `*.csv` (see `.gitignore`).
