# trafilaturacore — licence & acknowledgements report

**Purpose:** identify every project, dataset, and dependency `trafilaturacore` is built on or
derived from, so accurate licence terms and acknowledgements can be assembled.
**Method:** licences verified against ground truth — the local
`LICENSE` / `Cargo.toml` / `pyproject.toml` / `package.json` files under
`~/r/trafilatura-sources/<repo>/`, the installed dependency `license` fields, the npm/crates
registries, and Zenodo / Hugging Face for the dataset.

## Bottom line

- **`trafilaturacore`'s own licence is Apache-2.0** (full text in the repo-root
  [`@/LICENSE`](../../LICENSE); attribution in [`@/NOTICE`](../../NOTICE)). Correct and
  compatible for the whole stack.
- **`trafilaturacore` is a hybrid Rust + TypeScript port of Trafilatura.** It is a _derivative
  work_ of the Apache-2.0 Trafilatura lineage, plus a from-scratch ML page-type classifier
  informed by the rs-trafilatura / web-page-classifier feature set, plus a model trained on the
  **CC-BY-4.0 WCXB dataset**.
- **Everything is Apache-2.0-compatible.** No GPL/LGPL anywhere in the shipped tree. The only
  copyleft touchpoint is **MPL-2.0 via the _optional_ `dompurify`**, electable to Apache-2.0
  and imposing no obligation in practice.
- **The one hard, non-optional obligation that is easy to get wrong: attribution for the WCXB
  dataset (CC-BY-4.0)**, because the shipped `model.xgb.json` + `tfidf-vocab.json` are trained
  from it.
- Classifier inference is a **pure-Rust GBDT evaluator over the XGBoost native JSON dump** —
  there is **no ONNX / onnxruntime** anywhere in the shipped library or the training toolchain.

## What the code is based on — the Trafilatura lineage

These upstream projects live read-only outside the repo at `~/r/trafilatura-sources/` and are
**not** redistributed. `trafilaturacore` is a _derivative work_ of the first three, so
attribution is owed; the rest were consulted only.

| Project                                      | Author / copyright holder                 | Licence (verified)                      | Role                                                                                   | Derivation                                                                                           |
| -------------------------------------------- | ----------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Trafilatura** (Python, canonical original) | Adrien Barbaresi                          | **Apache-2.0** _(GPLv3+ before v1.8.0)_ | Defines extraction semantics, metadata rules, option behaviour, test corpus.           | **DERIVED** — `src/metadata/*` is a direct TS port; the Rust core follows its semantics.             |
| **go-trafilatura**                           | Markus Mobius (`markusmobius`)            | **Apache-2.0**                          | Faithful Go port; the readable reference for the core algorithm.                       | **DERIVED** — tag catalogs, doc-cleaning, link-density, selectors ported into the Rust crate.        |
| **rs-trafilatura**                           | Murrough Foley                            | **MIT OR Apache-2.0** (dual)            | The divergent fork with page-type-aware architecture, 7 page types, per-type profiles. | **DERIVED (code level)** — `packages/trafilaturacore/native/` is a simplified fork of its live path. |
| **web-page-classifier**                      | Murrough Foley                            | **MIT OR Apache-2.0** (dual)            | Reference for the page-type feature set + XGBoost classifier design.                   | **CONSULTED** — classifier reimplemented; no code/model ships.                                       |
| **trafilatura-rs**                           | Nathaniel Chapman (`nchapman`)            | **Apache-2.0** _(single — NOT dual)_    | Faithful Rust port.                                                                    | **CONSULTED** — cross-check / tiebreaker only; no code derived.                                      |
| **mozilla/readability**                      | Arc90 Inc (© 2010), maintained by Mozilla | **Apache-2.0**                          | DOM-idiom reference.                                                                   | **CONSULTED** — no code, dependency, or import survives.                                             |

### Key notes

- **Trafilatura's relicensing history.** Trafilatura was **GPLv3+ before v1.8.0**, then
  relicensed to **Apache-2.0**. `trafilaturacore` ports the _current Apache-2.0_ codebase, so the
  GPL copyleft does not reach it.
- **The two dual-licensed projects (rs-trafilatura, web-page-classifier)** are
  `MIT OR Apache-2.0`. `trafilaturacore` **elects Apache-2.0**, matching its own licence and
  discharging the obligation cleanly. Electing MIT instead would require reproducing each
  `Copyright (c) 2025-2026 Murrough Foley` MIT notice.
- **No upstream ships its own `NOTICE`.** Each ships only `LICENSE` (the dual Rust repos ship
  `LICENSE-APACHE` + `LICENSE-MIT`). Under **Apache-2.0 §4(d)** there is no upstream NOTICE text
  to propagate; the only duty (§4(c)) is preserving copyright/licence notices for copied
  material, which the root `LICENSE` + `NOTICE` do.
- **web-page-classifier and readability are attributed only as a courtesy** — no code derived
  from either ships, so their entries in `NOTICE` are honest over-attribution, not a legal
  requirement.

## The training dataset — WCXB (the one mandatory attribution)

|                      |                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**             | WCXB — Web Content Extraction Benchmark                                                                                                  |
| **Author / creator** | Murrough Foley                                                                                                                           |
| **Licence**          | **CC-BY-4.0** — <https://creativecommons.org/licenses/by/4.0/>                                                                           |
| **DOI**              | `10.5281/zenodo.19316874` — <https://doi.org/10.5281/zenodo.19316874>                                                                    |
| **Source**           | <https://huggingface.co/datasets/murrough-foley/web-content-extraction-benchmark>                                                        |
| **How used**         | Offline only, **unmodified**, in `training/` to train the page-type classifier. Never fetched at runtime; not committed (`.gitignored`). |

**Why this obligation matters most:** the shipped artifacts
`packages/trafilaturacore/native/artifacts/model.xgb.json` and `tfidf-vocab.json` are **trained
from WCXB** and are **included in the published package**. Whether a trained model is legally an
"Adaptation" of a CC-BY dataset is unsettled — but because the obligation _may_ attach, the
licence requires attribution, and attributing costs nothing, **the correct posture is to
attribute unconditionally.** The root `NOTICE` does this, and correctly states the model is
_trained fresh_ from the public dataset (not vendored from any upstream embedded binary).

**Ready-to-use CC-BY-4.0 attribution string:**

> WCXB: Web Content Extraction Benchmark by Murrough Foley. Licensed under CC-BY-4.0
> (<https://creativecommons.org/licenses/by/4.0/>). DOI: 10.5281/zenodo.19316874. Source:
> <https://huggingface.co/datasets/murrough-foley/web-content-extraction-benchmark>. Used
> unmodified, offline, only to train trafilaturacore's page-type classifier.

## Shipped runtime dependencies (in the published package)

All permissive, all Apache-2.0-compatible.

### TypeScript runtime (always installed)

| Package                   | Licence                | What it does                                                                       |
| ------------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `@trafilaturacore/native` | Apache-2.0 (this repo) | napi-rs binding around the Rust extraction core (ships the prebuilt native addon). |
| `sanitize-html`           | MIT                    | default HTML cleaner (the cleaning stage).                                         |
| `parse5`                  | MIT                    | WHATWG-compliant HTML normalization.                                               |
| `linkedom`                | **ISC**                | the DOM for metadata + cleaning.                                                   |
| `prettier`                | MIT                    | HTML pretty-printing.                                                              |
| `html-minifier-terser`    | MIT                    | HTML minification (bundles `terser`, BSD-2-Clause).                                |
| `chardet`, `iconv-lite`   | MIT                    | byte → string decoding.                                                            |
| `commander`               | MIT                    | CLI argument parsing.                                                              |

### Rust crate dependencies (compiled into the native addon)

| Crate                                              | Licence           |
| -------------------------------------------------- | ----------------- |
| `napi`, `napi-derive`                              | MIT               |
| `dom_query`                                        | MIT               |
| `html-escape`                                      | MIT               |
| `tendril`                                          | MIT OR Apache-2.0 |
| `regex`, `serde`, `serde_json`, `thiserror`, `url` | MIT OR Apache-2.0 |

Inference is a **pure-Rust GBDT evaluator over the XGBoost native JSON dump** — no ONNX runtime
is compiled or shipped.

### Optional TypeScript backend (only if the consumer opts into the hardened cleaner)

| Package     | Licence                                    | When pulled in                                 |
| ----------- | ------------------------------------------ | ---------------------------------------------- |
| `dompurify` | **MPL-2.0 OR Apache-2.0** → use Apache-2.0 | opt-in "hardened" DOMPurify sanitizer backend. |
| `jsdom`     | MIT                                        | DOM for the hardened backend.                  |

**`dompurify` — the only copyleft touchpoint, and it's benign:** MPL-2.0 is file-level weak
copyleft; used **unmodified, not vendored, and only as an optional dependency**, the only duty
is preserving its own licence text (which ships in its package). `trafilaturacore` may **elect
the Apache-2.0 branch**, discharging every MPL-2.0 obligation. Net: minimal, optional, and
electable away entirely.

## NOT shipped (no distribution obligation)

The offline Python training stack in `training/` (`xgboost` Apache-2.0, `scikit-learn`/`numpy`/
`pandas` BSD-3, `datasets`/`huggingface_hub` Apache-2.0, `selectolax` MIT, `imbalanced-learn`
MIT, `pytest`/`ruff` MIT) is resolved via `uv` on demand and is **never packaged or shipped**.
`selectolax` vendors the Lexbor (Apache-2.0) and Modest (LGPL-2.1) native engines; the LGPL only
matters on redistribution, and training is offline-only, so it never reaches the published
library. There is no ONNX toolchain (`skl2onnx` / `onnxmltools` / `onnx` / `onnxruntime`) — it
was dropped in favour of the XGBoost-JSON GBDT evaluator.

## Licence-compatibility analysis

- **`trafilaturacore` publishes under Apache-2.0.** ✅
- **Upstream lineage** is Apache-2.0 (Trafilatura, go-trafilatura, trafilatura-rs, Readability)
  and `MIT OR Apache-2.0` (rs-trafilatura, web-page-classifier, elected as Apache-2.0). All
  compatible; all attributed in `NOTICE`. ✅
- **Shipped deps** are MIT / ISC / (MIT OR Apache-2.0) with transitive BSD-2-Clause via `terser`.
  All permissive, all Apache-2.0-compatible. ✅
- **Optional `dompurify`** is `MPL-2.0 OR Apache-2.0` → elect Apache-2.0; zero obligation as an
  unmodified optional dep. ✅
- **No GPL or LGPL** in the runtime, optional, or transitive shipped tree. (LGPL appears only
  via `selectolax`'s bundled Modest engine, offline training-only, never shipped.) ✅
- **WCXB dataset (CC-BY-4.0)** → attribution required, provided in `NOTICE`. ✅ — _the one
  obligation to never drop._

**Conclusion: the project is cleanly licensable under Apache-2.0, with mandatory attribution only
for the WCXB dataset.**

## Compliance checklist

- [x] Ship the Apache-2.0 `LICENSE` text — present at repo root.
- [x] Attribute the Apache-2.0 / dual-licensed upstream projects — present in `NOTICE`.
- [x] Attribute the WCXB dataset (CC-BY-4.0) — present in `NOTICE` with the DOI.
- [x] Preserve dependency licence texts — they ship inside each npm/crates package.
- [x] No GPL/LGPL obligations in the shipped tree; MPL-2.0 (`dompurify`) is optional and
      electable to Apache-2.0.
