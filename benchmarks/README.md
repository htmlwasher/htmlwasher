# Benchmark reports

Timestamped Markdown reports from the external four-engine extraction benchmark
(trafilaturacore vs Trafilatura vs rs-trafilatura vs mozilla/readability), produced by:

- `/bench:run` — run the benchmark and write a detailed, explained report here.
- `/bench:improve` — root-cause the per-type token-F1 gaps, apply defaults-only fixes to
  trafilaturacore, re-run the offline gates, re-benchmark, and write a before/after report here.

The benchmark itself lives OUTSIDE this repo at `~/r/trafilatura-external-tester/` — it is
external by design because it hits the network (fetching a cached corpus of real pages);
trafilaturacore itself never touches the network. Fidelity is reference-relative (token
precision/recall/F1 vs the Trafilatura reference, not human gold); see each report's
Explanations section.

Report files are named `YYYY-MM-DD-HHmm-benchmark.md`.
