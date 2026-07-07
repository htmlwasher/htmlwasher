# trafilaturacore — acknowledgements you must give

Decision-ready list. Split into **REQUIRED** (a licence obligates it) vs **NOT required**
(courtesy only). Verified against the actual codebase and the reference clones under
`~/r/trafilatura-sources/`.

The test for "required": a licence obligation is triggered only when `trafilaturacore`
**actually contains/ships** the licensed material — copied/derived code, the trained model, or
a bundled dependency. Projects merely _consulted_ as a reference create **no** obligation.

## MUST attribute — REQUIRED

### Source projects code is ported / derived from (Apache-2.0 §4)

| #   | Project            | Author           | Licence                                       | Why it's required (evidence in the code)                                                                                                                                                               |
| --- | ------------------ | ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Trafilatura**    | Adrien Barbaresi | **Apache-2.0**                                | `trafilaturacore` _is_ a port of it; the metadata subsystem (`packages/trafilaturacore/src/metadata/*`) is a direct TypeScript port, and the Rust core follows its extraction semantics + eval corpus. |
| 2   | **go-trafilatura** | Markus Mobius    | **Apache-2.0**                                | Tag catalogs, doc-cleaning, link-density, and content-selector rules ported into the Rust crate (`native/src/{tags,html_processing,link_density,selector/*}.rs`).                                      |
| 3   | **rs-trafilatura** | Murrough Foley   | **MIT OR Apache-2.0** → used under Apache-2.0 | The shipped Rust crate `packages/trafilaturacore/native/` is a simplified fork of its live extraction path (extract, fallback, selectors, page-type cascade + profiles). Strongest derivation.         |

> For the dual-licensed rs-trafilatura you **elect Apache-2.0** (matches `trafilaturacore`'s own
> licence): keep the Apache licence text + credit Murrough Foley. Electing MIT instead would
> require reproducing the `Copyright (c) 2025-2026 Murrough Foley` MIT notice.

### Training dataset (CC-BY-4.0 — the one unconditional must)

| #   | Item                                        | Author         | Licence       | Why                                                                                                                                                                          |
| --- | ------------------------------------------- | -------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | **WCXB — Web Content Extraction Benchmark** | Murrough Foley | **CC-BY-4.0** | The shipped `model.xgb.json` + `tfidf-vocab.json` (`packages/trafilaturacore/native/artifacts/`) are **trained on it**. Attribution required; DOI `10.5281/zenodo.19316874`. |

### Bundled runtime libraries (their MIT/ISC/BSD notices must travel with redistribution)

Shipped with the published package. MIT / ISC / BSD-2 all require their copyright + licence
notice preserved **in any redistribution**.

| Package                                                        | Licence           |
| -------------------------------------------------------------- | ----------------- |
| sanitize-html                                                  | MIT               |
| parse5                                                         | MIT               |
| linkedom                                                       | **ISC**           |
| prettier                                                       | MIT               |
| html-minifier-terser (bundles `terser`, **BSD-2-Clause**)      | MIT               |
| chardet                                                        | MIT               |
| iconv-lite                                                     | MIT               |
| commander                                                      | MIT               |
| napi, napi-derive, dom_query, html-escape (Rust crate)         | MIT               |
| tendril, regex, serde, serde_json, thiserror, url (Rust crate) | MIT OR Apache-2.0 |

> **Auto-satisfied for a normal `npm publish` / `cargo` install** — each dependency's licence
> text ships inside its own package. You only reproduce these notices yourself if you
> redistribute a _bundled/vendored_ build (single-file bundle, vendored copy, binary, or a
> Docker image with baked `node_modules`).

### Optional backend — REQUIRED _only if you actually ship it_

Pulled in only if a downstream consumer opts into the hardened sanitizer. Attribute **only when
distributing a build that includes it**:

| Package   | Licence                                    | Note                                                                                 |
| --------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| dompurify | **MPL-2.0 OR Apache-2.0** → use Apache-2.0 | Elect Apache-2.0 to avoid MPL file-copyleft; unmodified optional dep = minimal duty. |
| jsdom     | MIT                                        | DOM for the hardened backend.                                                        |

## NOT required — courtesy / optional only

These create **no** licence obligation — keep them as goodwill if you like.

| Item                                                                                         | Licence                  | Why NOT required                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **web-page-classifier** (Murrough Foley)                                                     | MIT OR Apache-2.0        | **Consulted only** — feature set + pure-Rust tree-evaluator pattern. The classifier is independently implemented and the model trained fresh from WCXB; no code and no embedded model binary ships. |
| **trafilatura-rs** (Nathaniel Chapman)                                                       | Apache-2.0               | **No derived code** — used only as a behavioural cross-check / tiebreaker.                                                                                                                          |
| **mozilla/readability** (Arc90 © 2010 / Mozilla)                                             | Apache-2.0               | **No code, dependency, or import** — consulted only as a DOM-idiom reference.                                                                                                                       |
| Offline Python training deps (xgboost, scikit-learn, numpy, pandas, datasets, selectolax, …) | Apache-2.0 / BSD-3 / MIT | Run **offline only** in `training/`; never packaged or shipped. No distribution = no obligation.                                                                                                    |

## The minimal text you must ship

This is the required set (source projects + dataset); the bundled-library notices are satisfied
by a normal install. It matches the repo-root [`@/NOTICE`](../../NOTICE):

```
trafilaturacore is licensed under the Apache License, Version 2.0, and is a
Rust + TypeScript library derived from:

  - Trafilatura — © Adrien Barbaresi — Apache-2.0
    https://github.com/adbar/trafilatura
  - go-trafilatura — © Markus Mobius — Apache-2.0
    https://github.com/markusmobius/go-trafilatura
  - rs-trafilatura — © Murrough Foley — MIT OR Apache-2.0 (used under Apache-2.0)
    https://github.com/Murrough-Foley/rs-trafilatura

The bundled page-type classifier (model.xgb.json + tfidf-vocab.json) is trained on:

  - WCXB: Web Content Extraction Benchmark — © Murrough Foley — CC-BY-4.0
    DOI 10.5281/zenodo.19316874
    https://huggingface.co/datasets/murrough-foley/web-content-extraction-benchmark
    Used unmodified, offline, only to train the classifier.
```

## Bottom line

- **You MUST credit 3 source projects + 1 dataset:** Trafilatura, go-trafilatura,
  rs-trafilatura, and the WCXB dataset (CC-BY-4.0).
- **Plus** preserve the MIT/ISC/BSD notices of the bundled runtime libraries (auto-handled by a
  normal install; manual only if you ship a bundled build).
- **You do NOT have to credit** web-page-classifier, trafilatura-rs, or mozilla/readability
  (consulted only), or the offline Python training stack (never shipped).
- The single non-optional, easy-to-drop obligation is the **WCXB CC-BY-4.0 attribution** for the
  shipped `model.xgb.json` + `tfidf-vocab.json`.
