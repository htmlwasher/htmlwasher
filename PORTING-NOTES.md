# PORTING-NOTES.md — htmlwasher port

Working reference for the phased port defined in
[`@/prompts/2026-6-24-init/prompt.md`](prompts/2026-6-24-init/prompt.md). Records the
source→target module mapping, resolved questions, parity gotchas, and open
questions. Kept current as phases land (per the Phase 7 gate and the deliverables
checklist). Built from a Phase 0 reconnaissance of the reference repos under
`~/r/htmlwasher-sources/` and the sibling projects `~/r/tools/packages/htmlprocessing-server`
and `~/r/contextractor`.

## Status

- Phase 0 (orientation) — done (this document).
- Phase 1 (scaffold) — done. Type surface in `src/types.ts`; baseline gate green.
- Phase 2 (boilerplate core) — done. `src/core/` extracts main-content HTML; 45
  unit tests + 4 real adbar pages pass. See "Phase 2 notes" below.
- Phase 3 (metadata) — done. `src/metadata/` ports adbar's OG→JSON-LD→meta→DOM
  precedence; 60 unit tests pass; correct title/author/date/sitename on real adbar
  pages. `date.ts` is a reduced htmldate equivalent; DOM XPaths translated to CSS
  (regex-anchored class/id predicates loosened to substring — documented per module).
- Phase 6 (washing levels) — done. `src/washing/` ports the htmlprocessing-server
  pipeline; 5 levels, security at every level + the styled CSS-URL allow-list
  (closes sanitize-html's gap), optional DOMPurify/jsdom hardened backend; 71
  tests pass. `washHtml`/`washBuffer` are async (prettier/minifier lazily imported)
  — so the public `wash()` will be async too. parse5 bumped to `^8`.
- Orchestration — done. `src/pipeline.ts` exposes the public async `wash()`
  composing metadata + boilerplate(mode) + wash(level); 6 integration tests pass.
  Classifier-based profile routing plugs into the boilerplate stage in Phase 5.
- Phase 5 (part 1) — done. The 7 profiles + core profile wiring
  (`contentSelectors`/`preserveTags`/`boilerplateSelectors`). Classifier routing
  pending the trained model (part 2).
- Phase 7 (validation vs adbar corpus) — done. `test/validation/` scores the full
  `wash()` pipeline over the 100 adbar eval pages present locally (skips in CI).
  **Result: precision ≈ 0.79, recall ≈ 0.81, F1 ≈ 0.80** (balanced + minimal) —
  in the same ballpark as upstream Trafilatura on this set. (Pre code-review the
  name-based boilerplate filter was dead, scoring P 0.75 / R 0.84 / F1 0.79;
  activating it lifted precision — see "Post-implementation code review".)
  Expectations fixture (`fixtures/validation/eval-expectations.json`) derived from
  adbar's `tests/evaldata.py` (Apache-2.0; attribution in NOTICE).
- Phase 4 (classifier) — done. Real model trained on full WCXB (test acc 0.777,
  macro-F1 0.663; ONNX↔native argmax 100%). TS runtime at 100% feature parity
  (numeric 1246/1246, tfidf 1400/1400, argmax 14/14). Cross-DOM fixes: selectolax
  comma-unions don't dedup; linkedom vs lexbor parsing → `parseDocumentSpec`
  (parse5 normalize → linkedom) for byte-exact body text.
- Phase 5 (part 2) — done. `pipeline.ts` classifies → selects profile → extracts;
  `wash()` returns `pageType` + `confidence`. `none` skips classification.
- Phase 8 (offline wash-corpus tester) — done. `tools/wash-corpus-tester/`: 27
  WCXB fixtures (≥3 per type × 7), 108 runs (4 boilerplate×level combos each),
  asserting security invariants + page-type plausibility, with a stdout table +
  `report.json`/`report.md`. Offline, deterministic, `pnpm test:corpus`.

### Phase 8 notes

- **Accuracy caveat:** the 27 fixtures are WCXB **dev-split** pages the model
  trained on, so the tester's 100% page-type accuracy is inflated. The unbiased
  number is the held-out **test-split accuracy 0.777** from training (Phase 4).
  The tester is an end-to-end smoke/regression check, not an accuracy benchmark.
- Security holds at all four sanitizing levels (no script/on\*/javascript: survives).
  `correct` is normalize-only (the documented trust boundary) so it passes markup
  through — recorded as soft warnings, not failures.
- **`tools/live-crawl-tester/` decision:** the brief's offline Phase 8 deliverable
  is `wash-corpus-tester` (built). The pre-existing scaffold `live-crawl-tester`
  (an unimplemented network-fetch stub) is left untouched — deleting it would churn
  ~15 incidental references across the `.claude/` config for no functional gain,
  and the stub never actually fetches. The two are complementary: offline fixtures
  here vs a future live-fetch harness there.

### Post-implementation code review

A whole-repo multi-agent review (7 subsystem reviewers → adversarial verify)
surfaced 25 findings; 16 were confirmed real and fixed, 9 rejected as style nits.
Highlights:

- **(critical) The name-based boilerplate filter was dead in the real pipeline.**
  `postCleaning` strips `class`/`id` (ALWAYS_DROP_ATTRS) BEFORE the whitelist
  serializer's `isBoilerplateNamed` guard reads them, so `BOILERPLATE_TOKENS`/
  `COMMENT_TOKENS` never dropped anything during extraction. Fix: a name-based
  boilerplate pass over the content-node DESCENDANTS in `extractFrom()` BEFORE
  `postCleaning` (honoring `commentsAsContent`), with a **backoff**: if removing
  boilerplate-named nodes empties the content (collection/listing pages whose
  whole body is in boilerplate-named containers), keep the unfiltered extraction
  (go-trafilatura's "do not delete all the content" rule). This lifted precision
  0.75 → 0.79 and F1 0.79 → 0.80 on the adbar eval.
- (warning) `linkDensityTest` used `nextSibling` (node) where go-trafilatura uses
  `NextElementSibling` — on pretty-printed HTML a whitespace text node made every
  last block use the lower limit. Fixed via `HElement.nextElementSibling`.
- (warning) `postCleaning` empty-strip used `childNodes.length` instead of
  element-children + leading-text (go's `etree.Text`); now strips whitespace-only
  `<div>   </div>`.
- (warning) `PRODUCT_BOILERPLATE_SELECTORS` was missing `[class*='recommend']` vs
  rs-trafilatura — restored.
- (info) classifier feature whitespace (`splitWhitespace`/`strip`/`paragraphWordCount`)
  now uses the exact CPython `str.split`/`str.strip` codepoint class (was JS `\s`/
  `.trim()`), tightening the byte-for-byte parity contract (parity stayed 100%).
- ONNX runtimes pinned to exactly 1.27.0 (both backends in lockstep); vocab artifact
  validated at load; `css-sanitizer` rejects backslash-escaped `url()` schemes;
  pipeline catch blocks narrow `unknown`; CLI error path no longer double-newlines;
  unused `washing/index.ts` barrel removed; stale "181-feature" comment → 189;
  `training/uv.lock` gitignored.

The earlier "precision is the weak dimension" gap is the same root cause (the dead
filter) and is now addressed. Remaining: `precision`/`balanced` modes still score
near-identically on this coarse substring eval; the focus thresholds have only a
small effect there.

### Phase 2 notes

- **Emit path:** we follow rs-trafilatura's filter-serialize approach (select a
  content node → `postCleaning` → whitelist re-serialize via
  `serialize-filtered.ts`), NOT go-trafilatura's per-element body rebuild
  (`main-extractor.go` `handle*` handlers). The brief §5 sanctions this. The
  per-element handlers were therefore not ported.
- **Cleaning** (`clean.ts`) is a faithful port of `html-processing.go`
  (`docCleaning`, `pruneHTML`, `linkDensityTest(+Tables)`, `deleteByLinkDensity`)
  with the precision/recall thresholds. Tag catalogs in `constants.ts` are
  verbatim from `settings.go`.
- **Selectors:** content rules 1–5 ported from `internal/selector/content.go`
  (rule 2 = any bare `<article>`), then `<article>`/`<main>`/`[role=main]`, then a
  readability-style scoring fallback, then the body.
- **linkedom gotcha:** `parseHTML` does not wrap loose input in `<html><body>`
  (it promotes the first element to the root). `parseDocument` normalizes: full
  docs as-is, stray `<body>` wrapped in `<html>`, bare fragments in
  `<html><body>`.
- **Deferred:** comment extraction, the per-type profile post-passes
  (aggregate/collect), and the `extraction_quality` heuristic move to Phase 5;
  the 27-feature ML quality model stays out of scope.

## Authority hierarchy (recap)

- `rs-trafilatura` + `web-page-classifier` define **WHAT** (page-type-aware
  architecture, the 7 types, per-type profiles, confidence, the 89+100 feature
  classifier). Treat its extraction internals as _intent_.
- `go-trafilatura` + `adbar/trafilatura` define **HOW** extraction behaves. Defer to
  these for the core algorithm, thresholds, and metadata semantics.
- `trafilatura-rs` (nchapman) is the cross-check / tiebreaker.
- `readability` (mozilla) is a TS/DOM idiom reference only.
- `htmlprocessing-server` defines the **HTML-washing** pillar (sanitize-html presets +
  normalize/format pipeline).
- `contextractor` defines the **boilerplate-mode → favor_precision/favor_recall** mapping.

## Resolved questions

### Feature count: 89 numeric + 100 TF-IDF = 189 (NOT 81/181)

The brief §3.8 is correct and is confirmed by source: `web-page-classifier/src/lib.rs:35`
declares `N_NUMERIC_FEATURES = 89`, and `rs-trafilatura/src/page_type/ml.rs`
`extract_ml_features` fills `f[0..89]`. Context docs 03 and 07 say 81/181 — that traces
to the stale README _body_ and the `ml.rs` doc comment (which says 81 while the array is
89). **Trust the code: 89 numeric, 189 total.** Numeric feature groups:

- `f[0..14]` — URL flags
- `f[14..63]` — HTML structural
- `f[63..73]` — enhanced structural (GATED: `extract_ml_features` early-returns after
  `f[62]`, leaving `f[63..89] = 0`, when body text > 500,000 chars — reproduce this gate)
- `f[73..81]` — DOM-vocabulary density
- `f[81..89]` — collection-specific

### TF-IDF: match scikit-learn training, NOT the Rust crate

The Rust crate's `compute_tfidf` (`web-page-classifier/src/model.rs:179`) uses raw
`tf = count/n_words` × baked IDF with **NO L2 normalization** and ad-hoc bigram substring
matching. We are retraining fresh, so we reproduce **scikit-learn `TfidfVectorizer`** on
both the Python and TS sides: sklearn default `smooth_idf=True` →
`idf = ln((1+n)/(1+df)) + 1`, with `norm='l2'`. Lock vocabulary + IDF weights in
`tfidf-vocab.json`. Compare **argmax class**, not probabilities, in parity tests.

### Page-type taxonomy + the `collection`/`category` alias

7 types: `article, forum, product, collection, listing, documentation, service`. The Rust
enum variant is `Category` but `as_str()` serializes it to the string `"collection"`
(`page_type/mod.rs:28-72`); `FromStr` accepts both `category` and `collection`, and `docs`
→ `documentation`. Output metadata must use `"collection"`.

### onnxruntime pin ≥ 1.23.0

1.21.x–1.22.x carry two `TreeEnsemble` correctness bugs that hit small/shallow XGBoost
trees (exactly this model): the `is_leaf`/root-branch-as-leaf bug (#24679→#25410) and the
category-only-trees `same_node_` bug (#24636→#24654), both fixed in 1.23.0. The package
already pins `^1.23.0`. Ship a golden test asserting ONNX argmax == trained-model argmax.

## Source → target module map

### Boilerplate-removal core → `@/htmlwasher/src/core/`

The core follows go-trafilatura's **keep-HTML** route (its `convertTags` keeps HTML,
`html-processing.go:481-484`), NOT adbar's XML round-trip. Shared pipeline stages (adbar
`core.py` / go `core.go`): load/parse → metadata → prune → clean → convert-tags(keep HTML)
→ comments → main-content → fallback cascade → baseline → postCleaning → **whitelist
re-serialize**.

- **Whitelist re-serializer** — port `rs-trafilatura push_filtered_html_children`
  (`src/extract.rs:2700-2894`) + go-trafilatura `postCleaning` (`html-processing.go:401-448`)
  → `core/serialize-filtered.ts`. Walk children; **unwrap** non-whitelisted elements
  (recurse, emit no tag); **drop** the explicit skip set (`nav|aside|script|style|noscript|iframe|svg|ins`),
  `is_always_excluded_name` (class/id substring list), and `is_boilerplate` nodes; escape
  all text/attr values. Never `outerHTML` the kept node verbatim.
- **Block+inline tag whitelist** (generous, per brief §5 Phase 2): `p, div, section,
article, main, h1-h6, blockquote, pre, code, strong, em, b, i, a, ul, ol, li, dl, dt, dd,
table, thead, tbody, tfoot, tr, td, th, caption, colgroup, col, br`, plus images. The
  washing **level** does the final tag narrowing — do NOT re-expose
  `include_tables/links/images`.
- **Attribute allow-list** — go `settings.go:79-116`: always drop
  `id, class, align, background, bgcolor, border, cellpadding, cellspacing, frame, hspace,
rules, style, valign, vspace`; drop `width/height` except on `table/th/td/hr/pre`. Minimal
  conditional keep set from rs: `href` on `<a>`, `class` on `<code>`, `colspan/rowspan` on
  `td/th`.
- **Boilerplate predicates** — `is_always_excluded_name` + `is_boilerplate`
  (`extract.rs:2934`, `3215`; regexes in `patterns.rs`) → `core/boilerplate-class.ts`.
- **`COMMENTS_ARE_CONTENT`** thread-local (`extract.rs:28,149,446,3236`) → an explicit TS
  context param (not a global). Forum profile flips `is_boilerplate` to the
  `NO_COMMENTS` regex so `comment*`-classed nodes are kept.
- **favor_precision/favor_recall thresholds** (`extract.rs:2149-2155`, `pruning.rs:156-203`,
  `pipeline.rs:215`, `link_density.rs:71,174`, `html_processing.rs:324,416-417`):
  min content-node score 5000(P)/1000(bal)/500(R); link short-text length 10(P)/100(else);
  paragraph-sufficiency factor 1(P)/3(else); child-depth 1(P)/3(else); recall adds div/lb/list
  potential tags; precision adds extra prune passes; `keep_tail = !precision`. Precision wins
  when both set. **Cross-check these numbers against go/adbar** (open question).
- **Fallback cascade + recovery + post-passes** (`extract.rs:228-318, 437-441`): short-extraction
  ancestor walk (accept >2×), bottom-up readability scorer (accept >2× and >500), under-extraction
  fallback on a pre-cleaning backup, then profile post-passes (`aggregate_sections`,
  `collect_repeated_items`, Category description prepend, Product JSON-LD description).

### Metadata → `@/htmlwasher/src/metadata/` (optional sidecar)

Orchestrator: adbar `metadata.py:extract_metadata` (457-561). Per-field precedence:
**OpenGraph → JSON-LD (override) → name/itemprop/property meta → XPath/DOM heuristics**
(DOM only fills still-empty fields). Modules to create:

- `opengraph.ts` — `OG_PROPERTIES` map (`metadata.py:136`), `examine_meta` bootstrap.
- `meta-tags.ts` — `METANAME_*` allow-lists, twitter/itemprop handling (`X = X or content`).
- `json-ld.ts` — `extract_json`/`process_parent` (well-formed) + `extract_json_parse_error`
  (regex fallback); `@context` must match `^https?://schema.org`.
- `authors.ts` — `normalize_authors` (`json_metadata.py:290`): split, strip, title-case,
  dedup; drop single-word author; apply `author_blacklist`.
- `title.ts, url.ts, sitename.ts, catstags.ts, license.ts` — DOM/XPath fallbacks
  (`xpaths.py`; this checkout inlines what older trafilatura called `metaxpaths.py`).
- `date.ts` — adbar delegates to the external **htmldate** `find_date`. htmlwasher must port
  a JSON-LD/meta/url/text date heuristic or a minimal htmldate equivalent (open question on scope).

### Classifier → `@/htmlwasher/src/classifier/` + training

- `classifier/features/` (TS, htmlparser2 hot-path) + `training/extract_features.py` (Python,
  selectolax) — the **same** 89-numeric + 100-TF-IDF extractor, byte-for-byte. Reproduce
  rs `ml.rs` selectors, `[class*=]` substring matchers, and the 500KB gate exactly.
- 3-stage cascade (`extract.rs:54-92`, `page_type/mod.rs:600-655,728-793`) →
  `classifier/{url-heuristics,html-signals,classify}.ts`: Stage 2 (`refine_with_html_signals`)
  only overrides `Article`. Agreement rule: URL+ML agree → conf 1.0; HTML+ML agree → 0.95;
  else ML softmax.
- `classifier/model/` — `model.onnx` + `tfidf-vocab.json` loaded via onnxruntime-node
  (default) / onnxruntime-web (WASM) behind `interface PageTypeClassifier`. StandardScaler
  `(x-mean)/scale` (scale ≤ 0 → 0) baked into training; tree split is strict `<` → left;
  missing feature → 0.0.

### Per-type profiles → `@/htmlwasher/src/profiles/`

`ExtractionProfile` (`page_type/mod.rs:98-345`) LIVE fields: `comments_are_content`,
`content_selectors`, `preserve_tags`, `boilerplate_selectors`, `aggregate_sections`,
`collect_repeated_items`. **DEAD fields** (declared, never read — grep-confirmed):
`lenient_boilerplate`, `min_paragraph_density` — do not invent behavior; omit or wire
deliberately. Copy the 7 profile selector/tag arrays verbatim. Confidence:
`classification_confidence` (agreement) + `extraction_quality` heuristic (`extract.rs:880-985`;
the 27-feature ML quality model `predict_quality` is a _second_ model — out of scope unless
confirmed).

### HTML washing → `@/htmlwasher/src/washing/`

Faithful port of `htmlprocessing-server/src/process-html.ts`. Pipeline order:
decode (chardet, iconv-lite; buffers only), then normalize (parse5), then sanitize
(sanitize-html with the level preset; skipped for `correct`), then re-normalize (only if
`transformTags`), then DOCTYPE prepend (full documents), then format (prettier by default;
html-minifier-terser when `minify`). Returns `{ html, messages }`.

- `washing/modes.ts` — washing-level union as `as const` (NEVER a TS enum), mirroring
  `PROCESSING_MODES`. **htmlwasher uses exactly 5 levels** —
  `minimal | standard | permissive | styled | correct` — and **drops the four `*-reader`
  variants** (the Readability concern is handled by the boilerplate pillar; do not bundle
  jsdom/@mozilla/readability).
- `washing/presets/{minimal,standard,permissive,styled}.ts` — `SanitizeConfig` objects
  (`allowedTags, allowedAttributes, allowedClasses, selfClosing, nonTextTags, transformTags`),
  copied from `htmlprocessing-server/src/presets/`. `standard` is the default.
- `washing/sanitize.ts` — wraps sanitize-html; runs `filterEventHandlers` (strip every `on*`
  attr) on `allowedAttributes` first. `correct` skips this stage entirely (normalize + DOCTYPE
  - format only) but is still a security boundary.
- Security at EVERY level: rely on sanitize-html defaults (`allowedSchemes
[http,https,ftp,mailto,tel]` on `href/src/cite`) to strip `javascript:`/`data:`, plus
  `filterEventHandlers`. The **`styled` level must add an explicit CSS-URL allow-list** —
  sanitize-html does NOT scheme-filter `url()` inside `style` attrs or `<style>` blocks, so
  `url(javascript:|data:)`, `expression()`, `@import`, `-moz-binding` survive by default.

### Orchestration → `@/htmlwasher/src/pipeline.ts` + `index.ts`

`wash(html, { boilerplate?, level?, minify? })` → `{ html, messages, metadata? }`. Defaults:
`boilerplate: 'balanced'`, `level: 'standard'`, `minify: false`. `boilerplate: 'none'`
bypasses extraction (washes the whole document). The two knobs are orthogonal; these three
options are the **entire** user surface — no `includeComments/Tables/Images/Links`.

## Parity gotchas (carry into the relevant phase)

- Never `outerHTML` the kept subtree — always whitelist re-render (still contains boilerplate
  wrappers, tracking attrs, untrusted markup otherwise).
- `push_filtered_html_children` **unwraps** non-whitelisted elements vs **drops** the skip
  set / boilerplate-named nodes — getting unwrap-vs-drop wrong changes output substantially.
- Match scikit-learn TF-IDF (`smooth_idf=True`, L2 norm), not the Rust crate's un-normalized path.
- Reproduce the 500KB feature gate and the strict-`<` tree comparison + 0.0 missing-default.
- `correct` mode and the `styled` CSS-URL gap are both security boundaries — test them.
- prettier is the DEFAULT formatter in htmlprocessing-server (`shouldMinify` defaults false).
- parse5 pin: source uses `^8`; htmlwasher pins `^7.3.0` — serializer output can differ
  (whitespace/attr order) and break golden fixtures. **Bump htmlwasher to parse5 `^8`** for
  washing parity (decision: align to the washing engine).
- contextractor's modes do NOT use the ML classifier (its `PageType` import is a dead shim);
  htmlwasher DOES route extraction through the per-type profile — don't copy the no-classifier behavior.
- WCXB dataset is CC-BY-4.0 — attribution REQUIRED (Murrough Foley / DOI 10.5281/zenodo.19316874).
  Do NOT vendor rs-trafilatura's embedded `~1.1 MB` binary model.

## Open questions

- **Phase 4 — exhaustive 89-feature enumeration.** The per-feature computation list for
  `f[0..89]` must be read line-by-line from `rs-trafilatura/src/page_type/ml.rs` when building
  the extractor (deferred from Phase 0 — the recon's full-enumeration reader hit the structured-output
  cap; re-run as a focused read at Phase 4).
- **Phase 2 — go-trafilatura core line-by-line.** Same deferral: read the actual `.go` handlers
  (`handle_titles/formatting/lists/quotes/code_blocks/paragraphs/table/image/other`) at Phase 2.
- **WCXB download feasibility.** Phase 4 needs the dataset from Hugging Face / Zenodo — network
  access from this environment is unverified. If unavailable, train.py + extract_features.py +
  the TS extractor + ONNX-load path are still built and unit-tested with a small synthetic/fixture
  set, and the real training run is documented as a follow-up. (Will be confirmed at Phase 4.)
- **htmldate scope.** Port a minimal date heuristic vs a fuller htmldate equivalent — decide at Phase 3.
- **Quality model.** The 27-feature `predict_quality` ONNX is a second model; brief emphasizes the
  page-type classifier only — treat as out of scope unless directed.
- **Cross-check rs thresholds vs go/adbar.** Verify `min_score 1000`, `max_link_density 0.8`, the
  2-pass `delete_by_link_density`, and the precision/recall numbers against go-trafilatura at Phase 2/5.

## tools/ tester: brief vs scaffold drift (Phase 8)

The brief (§4, §7, §8) specifies an **offline** `tools/wash-corpus-tester/` (saved HTML
fixtures in → cleaned HTML out, **no network**, ≥3 fixtures per page type × 7 types). The
current scaffold instead has `tools/live-crawl-tester/` (a polite network fetcher per
CLAUDE.md). The brief and the §8 non-goals are explicit that htmlwasher never touches the
network. **Decision: build `tools/wash-corpus-tester/` per the brief** and reconcile the
scaffold at Phase 8 (repoint the workspace, retire or repurpose the live-crawl-tester, and
update CLAUDE.md / SPEC.md accordingly).
