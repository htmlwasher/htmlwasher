# trafilaturacore — licences & acknowledgements

Detailed, non-authoritative licence notes for `trafilaturacore`. The **authoritative,
mandatory** files stay in the repo root and are unchanged by these notes:

- [`@/LICENSE`](../../LICENSE) — the full Apache License, Version 2.0 text (the project's licence).
- [`@/NOTICE`](../../NOTICE) — the required attribution notice shipped with the package.

These docs are the working analysis behind that `NOTICE`: what `trafilaturacore` is derived
from, what it merely consulted, what it bundles, and the one dataset attribution that must
never be dropped.

## Contents

- [`acknowledgements.md`](acknowledgements.md) — decision-ready list: what a licence **requires**
  you to attribute vs. what is **courtesy only**.
- [`license-report.md`](license-report.md) — the full report: verified licences for every
  upstream project, the training dataset, and every shipped dependency, plus the
  compatibility analysis.

## One-paragraph summary

`trafilaturacore` is Apache-2.0. It is a hybrid Rust + TypeScript content-extraction library
**derived from** Trafilatura (Apache-2.0), go-trafilatura (Apache-2.0), and rs-trafilatura
(MIT OR Apache-2.0, used under Apache-2.0). It **consulted** web-page-classifier
(MIT OR Apache-2.0), trafilatura-rs (Apache-2.0), and mozilla/readability (Apache-2.0) as
references without shipping their code. Its page-type classifier is trained fresh from the
**WCXB dataset (CC-BY-4.0)** — the single unconditional attribution obligation. Everything is
Apache-2.0-compatible; there is no GPL/LGPL in the shipped tree.

The read-only reference repos live outside this repo at `~/r/trafilatura-sources/` (cloned by
[`@/clone-other-repos.sh`](../../clone-other-repos.sh); never committed).
