# htmlwasher: HTML-Output Boilerplate Removal + Cleanup Pipeline, Library Choices & Security (June 2026)

> Research context document for **htmlwasher** (the renamed `trafilatura-alpha`) — the HTML-in / HTML-out cleanup library. This doc covers the concerns the pivot introduced that docs 01–07 do not: how to emit the extracted main content **as HTML**, how the two pillars (boilerplate removal + HTML washing) compose, the exact washing-level presets, the 2026 library choices (sanitizer/normalizer/formatter/DOM/ONNX), and the untrusted-HTML security model. It is grounded in deep reads of the cloned references under `~/r/htmlwasher-sources/`, the htmlwasher cleanup engine at `~/r/tools/packages/htmlprocessing-server`, and `~/r/contextractor`, plus mid-2026 web research. Adversarially verified where load-bearing.

---

## 0. Executive summary — the two-pillar design

htmlwasher = **HTML in → cleaned HTML out**, never converting to Markdown/XML/TEI/text, never fetching. It composes two orthogonal pillars:

1. **Boilerplate removal** (the Trafilatura core — heuristics + ML page-type classifier + per-type profiles, all kept). Output is the kept main content **re-serialized as a clean, simplified HTML subtree**. Gated by a `precision | balanced | recall | none` mode.
2. **HTML washing** (the htmlprocessing-server cleanup). A `sanitize-html`-based allow-list sanitizer + parse5 normalize + prettier/minify, exposed as `minimal | standard | permissive | styled | correct` levels.

The single most important architectural finding: **emitting "HTML" does NOT mean serializing the original DOM subtree verbatim.** Both go-trafilatura and rs-trafilatura emit HTML by *rebuilding* a fresh, attribute-stripped, whitelist-restricted HTML string from the kept node. This is inherently a sanitizing step, and htmlwasher then layers the washing level on top — **two independent safety passes** over untrusted markup.

Both enumerations are plain `as const` string unions, **never TypeScript `enum`s** (mirror htmlprocessing-server's `PROCESSING_MODES`).

---

## 1. Boilerplate removal as HTML output — the whitelist re-render pattern

The brief forbids text/markdown/xml output, so the boilerplate pillar must emit the kept content as an **HTML string**. The reference implementations show exactly how — and how NOT — to do this.

### go-trafilatura is the model to mirror (keep native HTML)

go-trafilatura **deliberately keeps the kept content as a real `html.Node`** and never does upstream Trafilatura's HTML→XML conversion. Its `convertTags` carries the explicit comment "since we prefer the results to be HTML, we won't do it here" (`~/r/htmlwasher-sources/go-trafilatura/html-processing.go:481-484`); its README states "the main output of the original Trafilatura is XML, while in our port the main output is HTML" (`README.md:29`); CLI default format is `html`.

Its emission path is the blueprint for htmlwasher:

- After extraction, run **`postCleaning`** on the kept node (`~/r/htmlwasher-sources/go-trafilatura/html-processing.go:401-448`): bottom-up removal of empty non-void nodes, then an **attribute allow-list** that always drops `id, class, align, background, bgcolor, border, cellpadding, cellspacing, frame, hspace, rules, style, valign, vspace`; drops `width`/`height` except on `table/th/td/hr/pre`; and drops any attribute not in the `allowedAttributes` allow-list (`~/r/htmlwasher-sources/go-trafilatura/settings.go:79-116`).
- Serialize with an `outerHTML`-equivalent. For a full document, `CreateReadableDocument` (`~/r/htmlwasher-sources/go-trafilatura/helper.go:13-77`) builds `<html><head>…meta…</head><body><div id="content-body">…</div></body></html>`; for a fragment, serialize the node directly.

### rs-trafilatura confirms it: rebuild from a tag/attribute whitelist

rs-trafilatura's `ExtractResult.content_html: Option<String>` ("Main content as HTML (preserves structure)", `~/r/htmlwasher-sources/rs-trafilatura/src/result.rs:41`) is **not** produced via the DOM crate's verbatim `outer_html`/`inner_html` (those exist at `src/dom.rs:106-120` but are deliberately unused for content). Instead `push_filtered_html_children` (`src/extract.rs:2700-2894`) recurses the kept node and **emits opening/closing tags by hand** into a `String`:

- Hardcoded tag whitelist emitted (`src/extract.rs:2797-2834`): `p, div, section, article, main, h1–h6, blockquote, pre, code, strong, em, b, i, a, ul, ol, li, dl, dt, dd, table, thead, tbody, tfoot, tr, td, th, caption, colgroup, col`, plus `<br>`. **Non-whitelisted tags are *unwrapped*** (children recursed, wrapper dropped).
- Attributes aggressively stripped: only `href` on `<a>` (gated on `include_links`), `class` on `<code>`, `colspan`/`rowspan` on `<td>/<th>` survive; all text + attribute values are HTML-escaped (`src/extract.rs:2837-2891`).
- Boilerplate removed *inline during the walk*: `nav, aside, script, style, noscript, iframe, svg, ins` always skipped; out-of-article `header`/`footer` skipped; class/id boilerplate and `breadcrumblist` itemtypes skipped; layout tables unwrapped, only data tables kept (`src/extract.rs:2717-2795`).

Markdown, where it exists, is a *derivative* of this filtered HTML (`src/extract.rs:425-440`) — HTML is the structural source of truth.

### adbar/trafilatura (contrast): HTML is a round-trip back from its internal XML

Upstream Python trafilatura's internal tree is a **custom XML vocabulary** (`<head>`, `<list>/<item>`, `<hi>`, `<ref>`, `<graphic>`, `<lb>`, `<quote>/<code>`; `~/r/htmlwasher-sources/trafilatura/trafilatura/htmlprocessing.py:378-430`). Its 7 output formats are `csv, json, html, markdown, txt, xml, xmltei` (`settings.py:23-24`); `html` is real (since v1.11) but is produced by `build_html_output` → `convert_to_html` (`htmlprocessing.py:448-479`), the inverse mapping back to HTML via `HTML_CONVERSIONS` (`list→ul, item→li, code→pre, quote→blockquote, lb→br, graphic→img, ref→a, head→hN, hi→emphasis`), with `attrib.clear()` on everything except `<a>` (`href`) and `<img>` (`src/alt/title`). The result is a normalized, attribute-stripped HTML — same *destination* as go-trafilatura, reached by a different route. **htmlwasher follows go-trafilatura's keep-HTML route, not adbar's XML round-trip.**

### Design directive for htmlwasher

- Keep the kept content node as a real DOM node (parse5/linkedom tree). **Do not `outerHTML` it verbatim** — the original subtree still contains boilerplate wrappers, tracking attributes, inline styles, and untrusted markup.
- Port `postCleaning` (go-trafilatura) / `push_filtered_html_children` (rs-trafilatura) as a **whitelist re-serializer**: walk the kept node, emit only whitelisted tags (unwrap the rest), keep only whitelisted attributes, HTML-escape all text/attr values, skip boilerplate elements inline. In TS this is a straightforward recursive string-builder over the node tree — no DOM-serialization library needed, and it inherently sanitizes.
- **Beware the `content_html = None` weak spots:** rs-trafilatura's merge/collect/JSON-LD override paths (`src/extract.rs:243, 262, 282, 316`) null out structural HTML. For an HTML-only port, re-derive filtered HTML over the aggregated/collected subtree (or wrap plain-text fallbacks in escaped `<p>…</p>`) so the HTML field is always populated when content exists.
- **No `include_*` toggles in htmlwasher.** The reference impls gate content via `include_tables`/`include_links`/`include_images`/`include_comments`; htmlwasher does **not** re-expose these. The boilerplate re-render keeps a **generous** content set (tables, `a[href]`, images, headings, lists, structure), and the **washing level** (§3) is the single tag-inclusion control (images only at `standard`+, etc.); comments follow the page-type profile (`comments_are_content` for forums). User-facing settings are exactly: boilerplate `mode` + washing `level` (+ `minify`).

---

## 2. Boilerplate modes → `favor_precision` / `favor_recall` (concrete thresholds)

The `precision | balanced | recall | none` mode maps exactly as contextractor does (`~/r/contextractor/packages/crawler/src/createCrawler.ts:112-113`; schema default `balanced`, `~/r/contextractor/packages/schema/src/source-of-truth/input.ts:222-224`): `precision → favor_precision`, `recall → favor_recall`, `balanced →` neither, **`none →` skip boilerplate removal** (htmlwasher's addition; contextractor has no `none`). Contextractor's modes do **not** use the ML classifier — it is a plain global toggle (the `PageType` import is a dead-code shim); `pageType` is only surfaced as output metadata.

Both flags default `false`; when both set, **precision wins** (rs: `~/r/htmlwasher-sources/rs-trafilatura/src/options.rs:55-56`; adbar collapses to a tri-state `focus`, `settings.py:145`). They tune thresholds, not algorithm structure. Concrete effects (consistent across rs-trafilatura and adbar/go-trafilatura):

| Knob | precision | balanced (default) | recall |
|---|---|---|---|
| Main content-node min score (rs `src/extract.rs:2149-2155`) | 5000 | 1000 | 500 |
| Link-density length threshold (adbar `htmlprocessing.py:191`; go `html-processing.go:455`) | 200 | 100 | 100 |
| Link-density child-depth limit | 1 | 3 | 3 |
| Single-link shortcut threshold (adbar `htmlprocessing.py:134`) | 10 | 100 | 100 |
| Teaser-discard / precision-discard xpaths (adbar `main_extractor.py:606-609`) | both on | teaser on, precision off | both off |
| Reversible cleaning (revert if all `<p>` lost) | — | — | on (`htmlprocessing.py:66-72`) |
| Extra potential tags (`div`, `lb`) added | — | — | on (`main_extractor.py:577-579`) |
| Baseline rescue fallback | **off** (`core.py:117`) | on | on |
| Min-extracted `<p>` factor | 1 | 3 | 3 |

In short: **precision** = higher score bar + far more aggressive link-density/teaser pruning + no baseline rescue (cleaner, may miss content); **recall** = reversible cleaning + wider tag net + lower bars (more content, may include noise); **balanced** = neither flag.

---

## 3. The HTML washing engine (htmlprocessing-server)

`~/r/tools/packages/htmlprocessing-server` (name `htmlprocessing-server`, ESM) is the cleanup reference. It is **NOT a scraper** — HTML/`.docx` in → cleaned HTML out. Built on `parse5` (normalize), `sanitize-html` (sanitize), `prettier`/`html-minifier-terser` (format), `chardet`+`iconv-lite` (decode), and (for its `*-reader` modes, which htmlwasher drops) `@mozilla/readability`+`jsdom`.

### Pipeline (`src/process-html.ts`)

`processHtmlString(html, input)`; `processHtmlFile(buffer, input)` decodes bytes first. Stages in order:

- **NORMALIZE (always)** — `isHtmlDocument()` detects document-vs-fragment via `<!doctype>` / `<html|head|body[\s>]` (`src/normalize-html.ts:53-61`); `normalizeHtml()` uses parse5 `parseFragment`+`serialize` for fragments, `parse`+`serialize` for documents. Empty input → `""`. A parse5 throw is the only hard-fail.
- **READER (reader modes only — htmlwasher DROPS this)** — Mozilla Readability over jsdom; best-effort, never fatal. htmlwasher replaces this concern entirely with the boilerplate pillar.
- **SANITIZE (only when a preset `setup` is provided)** — `sanitizeHtml(html, options)` from the level's `SanitizeConfig` (`allowedTags`, `allowedAttributes`, `allowedClasses`, `selfClosing`, `transformTags`, `nonTextTags`). `allowedAttributes` is first passed through **`filterEventHandlers`** (drops every attribute whose lowercased name starts with `on`, `src/process-html.ts:220-231`). A throw aborts with `{ html: undefined }`.
- **RE-NORMALIZE after transforms** — because `transformTags` can create invalid nesting (e.g. `div→p`), the output is re-run through parse5 (non-fatal). Every preset defines `transformTags`, so this effectively always runs.
- **DOCTYPE** — re-prepend `<!DOCTYPE html>` if the *post-sanitize* output is still a document and lacks one.
- **FORMAT (always, non-fatal)** — `minify: true` → `html-minifier-terser` (collapse whitespace, remove comments, minify CSS/JS); else `prettier.format(parser:"html", printWidth:120, tabWidth:2, htmlWhitespaceSensitivity:"ignore")`.

Returns `{ html, messages }` (`messages` = accumulated `info`/`warning`/`error`).

### The five washing levels (exact, with deltas)

Default level is **`standard`**. Each level is a `SanitizeConfig` preset (`~/r/tools/packages/htmlprocessing-server/src/presets/`):

- **`minimal`** — strictest. Allowed: scaffolding (`html/head/meta/title/body`) + `p, a, strong/em/b/i/s, br, h1–h6, table family (table/thead/tbody/tr/th/td), code, pre, ul/ol/li, del, abbr`. Attributes: `html[lang]`, `meta[charset,name,content]`, `a[href]`, `td/th[colspan,rowspan]`, `abbr[title]`. NO images, NO `div/span`, NO HTML5 structural, NO classes/IDs, NO inline `style`. `nonTextTags: [style, script, textarea, option]` (content discarded). `transformTags`: `strike→del, tt→code, acronym→abbr, dir→ul, listing/xmp/plaintext→pre`.
- **`standard`** (default) — `minimal` **plus** `blockquote, hr, figure/figcaption, u`, images (`img, picture, source`), media (`video, audio`), full table family (`caption, tfoot, col, colgroup`), definition lists (`dl/dt/dd`), rich inline (`cite, dfn, kbd, samp, var, mark, small, q, wbr`), edit-tracking (`ins`), `sub/sup`, `time`; with media/`a`/`img` attributes broadened. Still NO `div/span`, NO HTML5 structural, NO classes/IDs, NO inline `style`.
- **`permissive`** — `standard` **plus** `track`, HTML5 structural (`article, section, main, header, footer, nav, aside, hgroup, address, search`), `div/span`, interactive `details/summary`, image maps (`map/area`), bidi/ruby (`bdi, bdo, ruby, rp, rt`). Still NO classes/IDs and NO inline `style`.
- **`styled`** — `permissive` **plus** CSS: the `<style>` tag is allowed AND `nonTextTags` drops `style` (so `<style>` CSS content survives), and `allowedAttributes['*'] = ['class','style']` so `class` and inline `style` are preserved on every tag. **Still strips scripts and (via `filterEventHandlers`) all `on*` handlers; sanitize-html still blocks `javascript:` URLs.** This is the only level keeping inline styles / classes / `<style>`.
- **`correct`** — NOT a sanitization preset (`isSanitizationMode = mode !== "CORRECT"`, `src/schema/processing-mode.ts:24-31`). The SANITIZE stage is **skipped** (no `setup`), so all tags/attributes are preserved; only parse5 normalization + DOCTYPE + format run. This is the htmlcorrector behavior: make malformed HTML well-formed and reformat it, without removing anything. (htmlwasher must still treat it as a security boundary — see §5.)

---

## 4. The combined htmlwasher pipeline

Two orthogonal knobs compose. Recommended order and defaults:

```
decode(bytes→utf8, chardet+iconv-lite)          # buffers only
  → normalize(parse5)                            # always; document/fragment auto-detected
  → boilerplate removal IF mode != 'none':       # the Trafilatura core, page-type-aware
        classify page type (URL → HTML → ONNX ML)
        select per-type profile
        extract main content (favor_precision/recall per mode)
        re-serialize kept node via tag/attr WHITELIST   # safety pass #1 (§1)
  → wash(level):                                  # the htmlprocessing-server cleanup
        if level != 'correct': sanitize-html(level preset)  # safety pass #2 (§3/§5)
        else: normalize-only
  → DOCTYPE (documents)
  → format: prettier OR html-minifier-terser (minify flag)
  → { html, messages, metadata? }
```

Defaults: `boilerplate: 'balanced'`, `level: 'standard'`, `minify: false`. `boilerplate: 'none'` makes htmlwasher a pure washer over the whole document. Output is **always HTML** (+ optional metadata sidecar object, never embedded, never a content conversion).

---

## 5. Library choices (2026)

Versions as of mid-2026 (npm). All MIT/ISC/BSD-class except where noted.

| Role | Library | Version | Verdict |
|---|---|---|---|
| Sanitizer (default) | **`sanitize-html`** | **2.17.5** (pin **≥ 2.17.2**) | **Keep** — engine parity with htmlprocessing-server; allow-list maps onto the levels; ~8M dl/wk. |
| Sanitizer (opt-in "hardened") | **DOMPurify** + `jsdom` | DOMPurify 3.4.x, jsdom ≥ 20 | Offer behind the same interface for callers re-rendering output into a live DOM/email/webview. |
| Normalizer | **`parse5`** | **8.0.1** | WHATWG-spec tree construction — the correct front-door normalizer (minimizes mXSS parser-differential). |
| Extraction DOM | **`linkedom`** | **0.18.12** | Sweet spot: real DOM + CSS-select at htmlparser2 speed; uses `htmlparser2` internally (not parse5). |
| Feature-extractor hot loop | **`htmlparser2`** | **12.0.0** | Fastest streaming pass; use in the classifier's tight inner loop. |
| Pretty output | **`prettier`** (`parser:"html"`) | **3.8.4** | Cosmetic only; can MOVE whitespace (changes inline rendering). Use `htmlWhitespaceSensitivity:"strict"` if fidelity matters. |
| Minify | **`html-minifier-terser`** | **7.2.0** | Maintained fork of the *abandoned* `html-minifier` — but itself quiescent since 2023. `html-minifier-next` (7.0.0) or `@minify-html/node` are actively-maintained alternatives if churn is acceptable. |
| Charset decode | `chardet` + `iconv-lite` | current | For non-UTF-8 buffer inputs (BOM-first per WHATWG). |
| ONNX inference | **`onnxruntime-node`** (+ `onnxruntime-web` WASM) | **1.27.0** (pin **≥ 1.23.0**) | See §5.1. |

### 5.1 onnxruntime — pin ≥ 1.23.0

ONNX Runtime **1.21.x–1.22.x** carries TWO TreeEnsemble correctness bugs that hit small/shallow XGBoost trees — exactly htmlwasher's classifier:

- **`is_leaf` / root-branch-as-leaf** (issue [#24679](https://github.com/microsoft/onnxruntime/issues/24679), fixed by PR [#25410](https://github.com/microsoft/onnxruntime/pull/25410)): `TreeEnsemble` could classify a tree's root as a leaf when true-child and false-child share an index, returning a node's leaf value instead of descending — **silently wrong predictions**, common in small balanced trees. First fixed in **1.23.0**.
- **`same_node_` / category-only-trees** (issue [#24636](https://github.com/microsoft/onnxruntime/issues/24636), fixed by PR [#24654](https://github.com/microsoft/onnxruntime/pull/24654)): mis-fused `BRANCH_EQ`-only (categorical) trees. Also fixed in **1.23.0**.

The repo already pins `^1.23.0` (current stable `1.27.0` is well clear). Add a golden classifier test asserting ONNX argmax against the trained model to catch future runtime regressions. Note: an `XGBClassifier` exported via onnxmltools today emits a (now-deprecated) `TreeEnsembleClassifier` node, not the consolidated `TreeEnsemble`.

---

## 6. Security model for untrusted HTML

htmlwasher treats **all input as hostile**. Because the boilerplate pillar's whitelist re-render (§1) AND the washing level (§3) are both allow-list passes over a parse5-normalized tree, htmlwasher has **defense in depth** that bare sanitize-html lacks. Even so, every level — including `styled` and `correct` — must enforce these invariants:

- **Parse with parse5 (WHATWG)** before sanitizing; never sanitize off a regex or a lenient tokenizer. Parser/browser divergence is where mutation-XSS (mXSS) lives.
- **Allow-list, never deny-list** tags + attributes; unknown → dropped.
- **Drop all `on*` attributes by prefix** at every level.
- **Drop** `<script>, <noscript>, <iframe>, <object>, <embed>, <applet>, <base>, <meta http-equiv>/<meta refresh>` at every level.
- **Scheme-allow-list every URL attribute** (`href, src, srcset, action, formaction, xlink:href, poster`): permit only `http`/`https`/`mailto` (+ inert `data:` image types where a level needs them); reject `javascript:`/`vbscript:`/untrusted `data:` after entity/whitespace normalization.
- For any level keeping `style`/`<style>` (i.e. `styled`): run a **CSS allow-list** stripping `expression()`, `-moz-binding`, and `url(javascript:|data:…)`. sanitize-html does **not** filter inline-`style` URLs except via a regex you supply — this is a known gap; `styled` must add that regex (or route through the DOMPurify hardened mode).
- **Constrain/remove `<svg>`/`<math>` foreign content** (the prime mXSS launch pads — namespace confusion via `<mtext>/<mglyph>/<style>`). Never keep `<foreignObject>`, SVG `<script>`, or `<svg>/<math>` `on*`/`xlink:href` script.
- **Sanitize last**, at the output boundary; do not post-process the sanitized string (post-modification voids the guarantees).
- Keep parse5 / sanitizer / DOM shim **pinned current** — bypasses land continuously. `sanitize-html ≥ 2.17.2` fixes the entity-in-`<option>`/`<textarea>` parser-differential mXSS (CVE-2026-40186).
- **Bound resource use:** cap input size before parsing (htmlwasher-api enforces **10 MB**), plus a parse timeout/`AbortController` and a deep-nesting guard, so one hostile page cannot stall a worker.

Sanitizer trade-off (verified): sanitize-html's token-stream model is structurally more mXSS-exposed than DOMPurify's real-DOM model, but DOMPurify needs jsdom (≈10× heavier, with a documented long-running-process memory-leak requiring `clearWindow()` recycling) and had its own 2024–25 mXSS CVEs (e.g. CVE-2025-26791, fixed 3.2.4). With parse5-normalize-first + the whitelist re-render, **sanitize-html ≥ 2.17.2 is the right default**, DOMPurify the opt-in hardened tier.

---

## 7. Appendix A — the 189-feature classifier (kept, unchanged)

The page-type classifier stays. Authoritative count from `~/r/htmlwasher-sources/web-page-classifier/src/lib.rs:35` (`N_NUMERIC_FEATURES = 89`) + the embedded `xgboost_v2.bin` header (`n_numeric=89, n_tfidf=100, n_classes=7, n_trees=1400` = 200 rounds × 7): **89 numeric + 100 TF-IDF = 189**. (The README *body* still says 81/181 — stale; trust the code.) The live extractor `~/r/htmlwasher-sources/rs-trafilatura/src/page_type/ml.rs` writes `f[0..=88]` in groups: `f[0..14]` URL signals, `f[14..63]` HTML structural, `f[63..73]` enhanced structural, `f[73..81]` DOM-vocabulary density, `f[81..89]` collection-specific. TF-IDF: `tf = count/n_words`, IDF precomputed (sklearn) and baked into the binary; the Rust path applies **no** L2 norm (a fresh sklearn train with `norm='l2'` will diverge from the Rust crate's `compute_tfidf` — match the *training*, not the crate). 7 page types `article, forum, product, collection, listing, documentation, service` (rs-trafilatura's internal variant `Category` serializes to `"collection"`). 3-stage cascade URL→HTML→ML wired in `~/r/htmlwasher-sources/rs-trafilatura/src/extract.rs:55-92`. TF-IDF reproduction uses scikit-learn's default `smooth_idf=True`: `idf = ln((1+n)/(1+df)) + 1` (the bare `ln(n/df)+1` is the non-default `smooth_idf=False`).

Per-type `ExtractionProfile` fields (`~/r/htmlwasher-sources/rs-trafilatura/src/page_type/mod.rs:99-153`): `comments_are_content` (forums), `content_selectors`, `preserve_tags`, `boilerplate_selectors`, `aggregate_sections`, `collect_repeated_items` (listings), plus the currently-*unwired* `lenient_boilerplate` and `min_paragraph_density`. Two confidence signals: `classification_confidence` (agreement heuristic — URL+ML agree → 1.0, HTML+ML → 0.95, else ML softmax; `src/extract.rs:55-92`) and `extraction_quality` (heuristic F1 estimate from content/HTML ratio, length, `<p>` count, link density, boilerplate keywords; `src/extract.rs:880-985`).

---

## 8. Appendix B — core extraction stage → file mapping (for the TS `src/` layout)

Mirror the shared pipeline (adbar `core.py` / go-trafilatura `core.go`):

| Stage | adbar/trafilatura | go-trafilatura |
|---|---|---|
| Load/parse | `load_html` (`core.py:223`) | `dom.Parse` (`core.go:73`) |
| HTML lang check | `check_html_lang` (`core.py:229`) | `checkHtmlLanguage` (`core.go:92`) |
| Metadata | `extract_metadata` (`core.py:236`) | `extractMetadata` (`core.go:97`) |
| User prune | `prune_unwanted_nodes` (`core.py:259`) | `pruneUnwantedNodes` (`core.go:125`) |
| Tree backups ×2 | `deepcopy` (`core.py:265`) | `dom.Clone` ×2 (`core.go:133`) |
| Tree cleaning | `tree_cleaning` (`core.py:265`) | `docCleaning` (`core.go:138`) |
| Tag conversion | `convert_tags`→XML (`core.py:269`) | `convertTags`→**keeps HTML** (`core.go:139`) |
| Comments | `extract_comments` (`core.py:272`) | `extractComments` (`core.go:147`) |
| Main content | `extract_content` (`core.py:279`) | `extractContent` (`core.go:154`) |
| Fallback compare | `compare_extraction` (`core.py:107`) | `compareExternalExtraction` (`core.go:158`) |
| Baseline rescue | `baseline` (`core.py:118`) | `baseline` (`core.go:164`) |
| Post-cleaning (HTML) | (XML/HTML branch only) | `postCleaning` (`core.go:209`) |
| Serialize | `determine_returnstring` (`core.py:43`) | CLI `writeOutput` (`output.go:45`) |

Per-element handlers to mirror as one module each: `handle_titles, handle_formatting, handle_lists, handle_quotes/code_blocks, handle_paragraphs, handle_table, handle_image, handle_other_elements` (dispatched by `handle_textelem`). For htmlwasher, the "Serialize" stage is **always the whitelist HTML re-render** of §1 — never XML/text/markdown.

---

## 9. Verified conclusions (adversarial)

- **Sanitizer:** Keep `sanitize-html` (≥ 2.17.2) as default; DOMPurify+jsdom as opt-in hardened mode. (Refutation attempt failed — current 2.17.5 has zero known vulns; DOMPurify carried three 2024–25 mXSS CVEs.)
- **HTML output:** Emitting the kept main content as a cleaned/simplified HTML subtree is a first-class, supported pattern across all three port targets — reconstructed via whitelist re-render, **not** verbatim original markup. htmlwasher's HTML-only output is sound.
