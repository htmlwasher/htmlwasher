# The Best Fork or Port of Trafilatura (June 2026): Evaluation & Recommendations

> Research context document for the trafilaturacore TypeScript port.
> Saved 2026-06-24. Source: deep research session.

## TL;DR
- **For a non-Python language, the Go port `markusmobius/go-trafilatura` is the best choice** — it is the most faithful, most mature, and best-maintained reimplementation (tracks upstream to v2.0.0, 141 stars, near-identical F1 to Python, and meaningfully faster). For Rust/JS/.NET, the `nchapman/trafilatura-rs` family (a Rust port of go-trafilatura with UniFFI bindings) is the only credible cross-language option but is young and niche.
- **There is no meaningfully-diverged, actively-maintained *fork* of upstream worth switching to.** Almost all GitHub forks of `adbar/trafilatura` are stale mirror copies; the enhancements that mattered (e.g. precision tuning) were upstreamed.
- **Upstream `adbar/trafilatura` remains the best choice for the vast majority of users** — it is at v2.1.0 (June 7, 2026), 6.0k stars, ~4.48M downloads/month, and is the accuracy reference every port measures against.

## Key Findings

### Upstream baseline (`adbar/trafilatura`)
- Current version **2.1.0**, released **June 7, 2026** (previous: 2.0.0 on Dec 3, 2024; 1.12.2 on Sep 10, 2024). The GitHub repository shows ~6.0k stars and 379 forks.
- Apache-2.0 licensed (since v1.8.0; GPLv3+ before). Now requires Python >=3.10. Development Status: Production/Stable.
- Enormous adoption: ~4,478,315 downloads in the last 30 days. Integrated into thousands of projects by companies like HuggingFace, IBM, and Microsoft Research as well as institutions like the Allen Institute, Stanford, and the Tokyo Institute of Technology. It remains the top-rated heuristic extractor in independent evaluation (Bevendorff, Gupta, Kiesel & Stein, SIGIR '23: heuristic extractors "perform the best and are most robust across the board, whereas the performance of large neural models is surprisingly bad").
- Release cadence has slowed (the ~18-month gap between 2.0.0 and 2.1.0 prompted user complaints), but the project is clearly still maintained.

### Direct forks on GitHub
- Forks of `adbar/trafilatura` are overwhelmingly stale mirror copies (e.g. `LukasBBAW/trafilatura-1`), not meaningfully diverged maintained forks.
- Historically significant precision/recall improvements were contributed upstream rather than maintained as a separate fork. Conclusion: there is no compelling actively-maintained enhanced fork of upstream to recommend over upstream itself.

### Ports / reimplementations in other languages

**Go — `markusmobius/go-trafilatura` (the flagship port).**
- 141 stars, 15 forks, 381 commits, 5 releases; latest release v2.0.0 (May 21, 2025). Apache-2.0.
- Tracks upstream up to Trafilatura v2.0.0. Ported nearly line-by-line, so structure mirrors the Python source and improvements port easily.
- Feature parity is high with documented deviations: JSON-LD parsed with a real JSON parser; fallback extractors are `go-readability` + `go-domdistiller` instead of `python-readability` + `justext`; primary output is HTML rather than XML.
- Accuracy near-identical to Python: on a 960-doc set (vs Python v1.12.2), go-trafilatura+fallback F-Score 0.915 (P 0.909, R 0.921) vs Python+fallback F-Score 0.917 (P 0.919, R 0.915). Speed materially better — 8.39s vs 14.53s single-threaded; uses `re2go` (compile-time regex) and is thread-safe (concurrent run drops to 1.976s).
- Used in production at Microsoft Research. **The most mature, faithful, best-maintained port.**

**Rust — two distinct projects, do not confuse them:**
- **`nchapman/trafilatura-rs`** (crate `trafilatura`): a faithful Rust port *of go-trafilatura*. Latest release v0.3.7 (Mar 10, 2026), ~1,450 crate downloads. F1 ~0.913 — near-identical to Python/Go. Speed competitive-to-faster. Its key strategic value is bindings: native UniFFI bindings for Swift, Kotlin/Android, Ruby, Dart, C#/.NET, and JS/TS (WASM). The closest thing to a "write once, run in many languages" Trafilatura.
- **`Murrough-Foley/rs-trafilatura`** (crate `rs-trafilatura`): began as a port but has diverged into an independent, enhanced implementation with ML page-type classification (XGBoost, 7 page types), per-type extraction profiles, and a confidence score. Self-reports "F1=0.966 on ScrapingHub (#1), F1=0.859 across 2,008 annotated pages." v0.2.x, ~1,600 downloads. This is the port Contextractor itself uses (via napi-rs). More of a "next-gen extractor inspired by Trafilatura" than a faithful port.

**JavaScript / TypeScript:**
- No mature, faithful pure-JS reimplementation exists. A community member (vtempest, issue #688) translated all 21 files to JS in 2024, but it was never adopted upstream and is not a maintained package.
- `deepcrawl/node-trafilatura` is not a port — it bundles the actual Python Trafilatura as a PyInstaller binary behind a TypeScript API.
- The credible native-JS routes are via Rust->WASM/napi: `nchapman/trafilatura-rs` (WASM binding) and `Murrough-Foley/rs-trafilatura` (napi-rs, as used by Contextractor).

**C# / .NET:**
- No independent native (managed) C# reimplementation exists on NuGet or GitHub. The only option is the `Trafilatura` NuGet package by nchapman — a UniFFI native binding to the Rust `trafilatura-rs` crate. Latest v0.3.7 (Mar 10, 2026), targets .NET 8.0. The nearest managed C# analog is `SmartReader`, but that is a port of Mozilla Readability, a different algorithm.

**Java / JVM:** No faithful Java/JVM port exists. Kotlin/JVM consumers can use the `trafilatura-rs` Kotlin/Android UniFFI binding.

**Dart:** A Dart port exists on pub.dev (`trafilatura` by Kamran Khan); also a `trafilatura-rs` Dart binding.

### Maintenance comparison (mid-2026)
- **Actively maintained:** upstream `adbar/trafilatura` (v2.1.0, Jun 7 2026); `nchapman/trafilatura-rs` (v0.3.7, Mar 10 2026); `Murrough-Foley/rs-trafilatura` (~Apr 2026).
- **Maintained but less frequent:** `markusmobius/go-trafilatura` (last release May 21 2025, tracking upstream v2.0.0).
- **Effectively stale/abandoned:** direct GitHub forks of upstream; the vtempest JS translation; `deepcrawl/node-trafilatura`.

## The lineage (critical for the port)
Python (adbar) -> Go (markusmobius) -> Rust (nchapman) -> {Swift, Kotlin, Ruby, Dart, C#, JS/WASM}, with Murrough-Foley's rs-trafilatura being a parallel, divergent, ML-enhanced branch off the same lineage. The algorithm has been ported faithfully exactly once at high quality — to Go by markusmobius — and that Go port is the seed from which the Rust port and the multi-language bindings descend.

## Recommendations
- **Best port for a non-Python language:** Go -> `markusmobius/go-trafilatura` (unreserved). Rust -> `nchapman/trafilatura-rs` (faithful) or `Murrough-Foley/rs-trafilatura` (divergent, ML, max accuracy on diverse page types). JS/TS -> a Rust->native binding, not a pure-JS port. C#/.NET -> `Trafilatura` NuGet (nchapman).
- **Best maintained fork with enhancements:** none among Python forks; `Murrough-Foley/rs-trafilatura` if "enhancement over upstream" is the goal regardless of language.
- **Does upstream remain best for most users?** Yes. For Python users, `adbar/trafilatura` 2.1.0 is the clear default.

## Caveats
- Star/download/date figures are point-in-time as of June 2026.
- rs-trafilatura's accuracy claims are self-reported and not independently reproduced (see the dedicated skeptical assessment document).
- go-trafilatura's README states parity against upstream v2.0.0; it had not published a release tracking v2.1.0 at time of research.
- The Rust naming collision is a genuine trap: crate `trafilatura` (nchapman, faithful) vs crate `rs-trafilatura` (Murrough-Foley, divergent ML).
