# Boilerplate-Only Rust Core vs TypeScript-Owned Sanitization — Feasibility & Verdict (July 2026)

> Research context document for the **v2 rebuild brief** ([`../prompt.md`](../prompt.md)). Question under analysis: *should the Rust core do ONLY boilerplate removal (drop sidebars, nav, boilerplate-named nodes) and emit the kept content with its **original markup** — no tag whitelisting, no attribute stripping — leaving ALL sanitization (scripts, disallowed attributes, URL schemes, CSS) to `sanitize-html` in the TypeScript washing stage?* Grounded in three parallel code investigations (2026-07-06): the v1 washing pillar (`@/htmlwasher/src/washing/`), the v1 extraction core (`@/htmlwasher/src/core/`), and rs-trafilatura v0.2.2 + the html-cleaning 0.3.0 crate. This doc revisits — and partially supersedes — doc 08's "two independent safety passes" argument in light of the v2 language split. All `file:line` references are to the v1 tree at the analysis date.

---

## Executive summary — verdict

**Yes: possible, and on balance a good idea — with three preconditions.** The proposed split is architecturally sound *if it is framed correctly*: the Rust core cannot and should not emit byte-original HTML. It must keep two of its three removal roles — **boilerplate selection** (the product feature) and **extraction hygiene** (script/style/nav removal that the scoring math itself requires) — and shed only the third: **output sanitization/normalization** (tag whitelisting, attribute stripping, unwrapping). Scripts therefore never cross the Rust→TS boundary anyway — not because of a sanitization pass, but as a pre-scoring hygiene side effect.

What the split buys:

- **One sanitization authority.** Every byte of output — extraction on or off — flows through the same `sanitize-html` + security-floor path in TS. Today there are two whitelists in two languages that must not drift; under the split there is one.
- **The `styled` and `correct` washing levels finally work with extraction.** Today the core strips `class`/`id`/`style` before washing ever sees the content, so `boilerplate: 'balanced'` + `level: 'styled'` can never keep a class or inline style — the level's headline feature is unreachable except via `boilerplate: 'none'` (see the pipeline findings below). Under the split, attributes reach the washing stage and the level presets actually decide.
- **The v1 "dead filter" bug class disappears structurally.** The hazard existed only because the core stripped `class`/`id` (`postCleaning`) before a name-based guard ran. No attribute stripping in the core → no ordering constraint to get wrong.
- **Feasible and cheap in the fork:** rs-trafilatura's serializer separates its SKIP layer from its EMIT layer cleanly; a `preserve_markup` emit mode is ~80–120 LOC behind an option, with the whitelist mode retained for upstream parity testing.

The three preconditions:

- **Fix the custom-config floor bypass first.** A `SanitizeConfig` of `{ "allowedAttributes": { "*": ["*"] } }` passes validation and lets `onclick` survive today (verified empirically) — a pre-existing v1 bug that is tolerable while the core independently strips `on*`, and intolerable once washing is the only line of defense.
- **Move the emit-side skip guards into DOM passes.** Three boilerplate decisions currently live inside the whitelist serializer; deleting the serializer without relocating them regresses `header` handling and breaks the extraction backoff (details below).
- **Replace the regex text-length measurement.** The core's `textLenOf` regex tag-strip is only safe because output text/attrs are currently escaped and whitelisted; with verbatim attributes it must measure DOM `textContent` instead.

---

## The question, made precise: three buckets of removal

"Boilerplate removal vs cleanup" is too coarse. The v1 core (and rs-trafilatura identically) removes things for three distinct reasons, and the proposal splits along a line *inside* what looks like one serializer:

- **Bucket A — boilerplate selection/removal** (the product feature): main-content node selection, nav/aside/footer dropping, profile `boilerplateSelectors`, link-density pruning, `BOILERPLATE_TOKENS`/`COMMENT_TOKENS` name filtering, BreadcrumbList microdata drops, empty-node pruning, the backoff. **Stays in Rust — this is the crate's reason to exist.**
- **Bucket B — extraction hygiene** (removals the algorithm needs to score sanely): `cleanDocument` kills ~50 tag types on the whole body *before any scoring runs* — `script`, `style`, `noscript`, `iframe`, `svg`, `form`, `head`, interactive chrome, embeds — plus HTML comments (`@/htmlwasher/src/core/clean.ts:66-118`, `constants.ts:9-60`; identically html-cleaning 0.3.0 `presets::trafilatura()`, presets.rs:220-238 + `remove_comments`). Text and link-density metrics would be garbage with scripts in the tree. **Stays in Rust — and it is what guarantees `<script>`/`<style>` never reach the serializer regardless of the emit policy.**
- **Bucket C — output sanitization/normalization** (removals that exist to produce clean, safe, minimal markup): the ~60-tag emit whitelist, unwrapping of non-whitelisted tags, `postCleaning`'s attribute policy (`ALWAYS_DROP_ATTRS` kills `id`/`class`/`style`/`align`/…; the 146-entry allow-list kills `data-*`/`aria-*`/`on*`), text/attribute escaping, empty-element unwrap (`@/htmlwasher/src/core/serialize-filtered.ts:34-122, 275-305`). **This is the bucket the proposal deletes from Rust** — it is functionally duplicated downstream by the washing presets at every sanitizing level.

The proposal, precisely: **keep A + B in the Rust core; emit kept elements with original tag names and all original attributes; delete C; the TS washing stage owns all tag/attribute/scheme/CSS policy.**

---

## Finding: the TS washing stage already treats every input as untrusted

The strongest enabler. `washHtml` re-parses its input from scratch unconditionally (parse5 normalize, `@/htmlwasher/src/washing/wash.ts:84-91`) and has **no assumption anywhere that its input was pre-sanitized by the core** — unit tests feed it raw dirty HTML directly.

Per level (all verified against code and the installed `sanitize-html` ≥ 2.17.2):

- **minimal / standard / permissive / styled:** full `sanitize-html` pass with the preset (`wash.ts:98-107`); `<script>` force-removed from any config (`sanitizer.ts:25, 53-55`); `on*` filtered (`sanitizer.ts:38-44`); `javascript:`/`vbscript:`/`data:` blocked by sanitize-html's default `allowedSchemes`; the CSS-URL sanitizer runs whenever the active config allows `style` (`wash.ts:122-124`, `css-sanitizer.ts` — strips `expression()`, `@import`, `-moz-binding`, non-http(s) `url()`).
- **`correct` is NOT floor-exempt.** Contrary to the folklore in `types.ts:37` ("normalize-only: skip sanitization"), the implementation runs an explicit floor on the `correct` path: `enforceSecurityFloor` (sanitize-html with `allowedTags: false`, script dropped via `exclusiveFilter` + `nonTextTags`, a wildcard `transformTags['*']` stripping every `on*` attribute, extended scheme checks over `srcset`/`formaction`/`poster`) followed by the CSS sanitizer (`wash.ts:125-133`, `sanitizer.ts:116-157`). `correct` is normalize-only **for the tag allow-list only**. Tests confirm scripts/`on*`/`javascript:` are stripped at `correct` (`wash.test.ts:167-190`).
- **Custom `SanitizeConfig`:** always sanitizes (even at `level: 'correct'`), with script/`on*` filtering applied to the config itself — **except the wildcard gap below**.

Two documentation/implementation tensions surfaced (independent of this proposal, but load-bearing for it):

- **The wildcard floor bypass (real gap).** `{ "allowedAttributes": { "*": ["*"] } }` passes `sanitizeConfigError` (shape-only validation, `types.ts:194-214`); `filterEventHandlers` filters literal names starting with `on`, not the `'*'` wildcard; `enforceSecurityFloor` does not run on the custom-config path; and the same wildcard defeats `configAllowsStyle`, so the CSS sanitizer is skipped too. Empirically confirmed through the built `washHtml`: **both** `onclick` **and** a `javascript:` URL inside inline CSS survive. This violates `@/htmlwasher/SPEC.md:46-53` ("regardless of `config` … every `on*` handler … always stripped"). Today the extraction core masks this for `boilerplate ≠ 'none'` because it independently strips `on*`; under the split, nothing masks it. **Must-fix precondition** (reject wildcards in validation, or run `enforceSecurityFloor` unconditionally after any custom-config sanitize).
- **The corpus tester's `correct` exemption is stale slack.** The wash-corpus-tester downgrades script-survival at `correct` to a *soft* warning ("normalize-only … skips sanitization"), but since the implementation runs the floor at `correct`, that exemption never fires. It should be tightened into a hard assertion — especially under the split, where it becomes the direct regression test for the single remaining defense line.

## Finding: what the core actually strips, and what breaks without bucket C

The full inventory (buckets above) yields four load-bearing consequences:

- **The name-based boilerplate filter never depended on bucket C.** The real removals are DOM passes ordered *before* `postCleaning` (`extract.ts:77-78`), reading `class`/`id`/`itemtype` that nothing in A or B strips. Deleting C removes the very stage that created the v1 dead-filter hazard; the "MUST run before postCleaning" comments become vacuous.
- **The trap: three bucket-A/B decisions are embedded in the bucket-C serializer** (`serialize-filtered.ts:339-341`): the `SERIALIZE_SKIP_TAGS` hard drops, the `header`/`footer`-outside-`article`/`main` rule, and an *ungated* `isBoilerplateNamed` check. Two specific hazards: `header` is dropped **only** by the serializer rule today (it is not in `TAGS_TO_CLEAN`) — deleting C without a replacement DOM pass regresses header leakage; and the ungated emit-time name check is currently harmless only because `postCleaning` blinds it — give it back `class`/`id` visibility and it re-empties exactly the output the §10 backoff exists to save (`extract.test.ts:133-143` would fail). A C-less core must delete these emit-time guards and rely on (new or existing) DOM passes. Keeping the `script`/`style`/`noscript`/`iframe` skip in the serializer as a cheap invariant is still recommended — it costs nothing and guarantees the no-script FFI contract even on clean-skipping code paths.
- **`textLenOf` breaks on verbatim attributes.** The regex tag-strip (`extract.ts:31-34`) feeds the backoff emptiness test, the 200-char whole-body fallback, and the returned `textLength`. It is safe today only because bucket C escapes text and whitelists attributes; an unescaped `>` inside a verbatim attribute value (`data-*` JSON, `srcset`) truncates tags and inflates "text". Fix: measure the clone's `textContent`.
- **Downstream is almost entirely indifferent.** `pipeline.ts` reads only `result.html === ''` (the empty-on-whitespace contract must be preserved); washing re-whitelists at every sanitizing level; metadata and the classifier consume the raw input, not core output; the adbar eval washes at `minimal` then strips tags to text — unaffected; the corpus tester's security regexes run on `wash()` output and pair `correct` only with `boilerplate: 'none'` — unaffected. The single *observable* output change: **`correct` + extraction newly carries original `class`/`id`/`style`/`data-*`** — with the floor still applied. That is a behavior change (and arguably the point), not a vulnerability.

Also worth recording: v1's bucket-B/C interplay is already quietly lossy — `TAGS_TO_STRIP` unconditionally unwraps `abbr`/`cite`/`mark`/`small`, and `TAGS_TO_CLEAN` kills `time`/`video`/`audio`, before the serializer could emit them, so several `EMIT_TAGS` entries and the washing presets' rich-inline allowances (`standard` allows `cite`/`mark`/`small`/`time`) are unreachable through extraction today (near-absolute for the `TAGS_TO_CLEAN` trio — the recall-mode "don't delete every `<p>`" backoff at `clean.ts:104-111` can revert their removal on degenerate pages; absolute for the unwrapped inline tags). The split does not fix this by itself — it is a bucket-B policy — but it makes the fix natural (see Recommendation).

## Finding: rs-trafilatura can grow a `preserve_markup` mode in ~100 lines

The fork-side feasibility check came back unambiguous:

- **SKIP and EMIT never interleave** in `push_filtered_html_children` (extract.rs:2700-2894): the skip layer (header/footer context rule, hard skip-set, `is_always_excluded_name`, gated `is_boilerplate`, BreadcrumbList) is all early `continue`s at 2717-2755; the layout-table unwrap is 2757-2795; the emit whitelist is one `matches!` block plus three attribute `if`s at 2797-2862. A verbatim branch (emit original tag + iterate all attributes via the existing `dom` helpers + escape with the existing `escape_html`, handle voids) is **~40-70 lines in one function**, no signature change (`options` is already threaded). Total estimate incl. the `Options` flag and second-order guards: **~80-120 LOC across two files**, whitelist mode preserved behind the flag.
- **Attributes fully survive doc-cleaning.** The html-cleaning `trafilatura` preset never sets `strip_attributes` (default `false`), and rs-trafilatura's ported `post_cleaning` **is dead code — defined, unit-tested, never called**. `id`/`class`/`style`/`data-*` are dropped on the HTML output path solely by omission in the serializer's emit whitelist. Selection *depends* on attributes being present (`class_score`, profile CSS selectors, signature splitting) — so preserve-markup mode requires zero changes to cleaning or selection.
- **`<script>`/`<style>` never reach the serializer on any path**: killed by the doc-cleaning preset, re-killed by the serializer skip-set, and the fallback path sanitizes via its own `TAGS_TO_SANITIZE`. The no-script boundary invariant holds in preserve-markup mode for free.
- **Two second-order guards:** the extraction-quality heuristic counts `"<a "` substrings (attribute-less anchors don't match in whitelist mode; every anchor matches in verbatim mode — the measured link density shifts, affecting the reported quality score only, not selection); and `under_extracted`/`candidate_is_usable` re-parse the emitted HTML to count `p`/`table` — safe **provided layout-table unwrapping stays on the skip side** (it does).
- **The honest ceiling: "original markup" means "original modulo doc-cleaning".** By serializer time, HTML comments are gone, 18 wrapper tags are already unwrapped (`cite`, `mark`, `small`, `abbr`, …), `figure`-wrapping-a-table was renamed to `div`, and ~50 tag types were deleted. Byte-original output would require serializing from the pre-cleaning backup document with node-identity mapping — a much larger change, not recommended. Additionally, **when a fallback wins (JSON-LD `articleBody`, baseline rescue), markup is inherently synthesized** (bare `<p>` elements from text) — markup preservation is best-effort by construction and must be documented as such.

---

## Security analysis: from two passes to one — is that acceptable?

Doc 08's core argument for the whitelist re-render was **two independent safety passes over untrusted markup**. The split deliberately reduces extraction-path sanitization to one pass. Assessment:

- **What is actually lost:** redundancy on `on*` attributes, URL schemes, and exotic attributes for `boilerplate ≠ 'none'` paths. (Scripts/styles are NOT lost — bucket B removes them regardless, so script stripping remains two-layered: hygiene + floor.)
- **What is gained:** path convergence. Today `boilerplate: 'none'` — a fully supported public mode — already relies on the washing stage as its *only* sanitizer for full untrusted documents. The washing floor is therefore already load-bearing and security-critical; the split does not create that responsibility, it removes the asymmetry where some paths get extra passes and others don't. One hardened path with exhaustive tests beats two paths where the second quietly masks gaps in the first — which is precisely what happened with the wildcard-config bypass: the core's stripping hides the washing bug on extraction paths, so the corpus tester can never catch it.
- **Conditions for acceptance:** fix the wildcard gap; tighten the corpus tester's stale `correct` exemption into hard asserts; keep the existing security-floor unit tests (which already feed raw HTML); add extraction-path security tests that pipe hostile fixtures through `wash()` at every level with `boilerplate: 'balanced'` (today those exist only for `none`); keep the serializer's script/iframe skip-set as the FFI invariant. With those in place, the residual risk is a `sanitize-html` CVE affecting allow-listed attribute handling — mitigated by the version floor (≥ 2.17.2), the independent `enforceSecurityFloor` seam, and the optional hardened DOMPurify backend that exists behind the same interface.

Verdict: acceptable. The defense-in-depth argument was strongest when both passes lived in one language and one test suite. In v2 the whitelist would live in Rust while its safety net lives in TS — two languages, two test suites, one implicit contract. That is *worse* for auditability than one explicit, exhaustively-tested TS sanitizer that provably receives everything.

## Why this is the right split for v2 specifically

- **It aligns the code split with the concern split.** "What is content?" is the Trafilatura-lineage competence — Rust. "What markup is allowed out?" is the washing product's competence — TS, where the presets, the custom-config surface, and the security floor already live. The v1 design put a second, hidden markup policy inside the extraction core; users cannot see it, configure it, or reason about it (`styled` silently doing nothing on extracted content is the symptom).
- **It deletes a cross-language parity liability.** v2 would otherwise ship a Rust whitelist that must stay consistent with the TS presets forever. Under the split there is nothing to keep in sync.
- **It simplifies the port.** The serializer port keeps the skip layer and drops the emit whitelist — strictly less behavior to verify against go-trafilatura/adbar (whose whitelists differ in detail anyway), while the retained whitelist mode still allows byte-for-byte comparison against upstream rs-trafilatura during port validation.
- **It makes the level matrix honest.** `minimal`/`standard`/`permissive` outputs are expected to be near-identical (washing narrows to the same place; marginal diffs where presets allow attributes the core used to strip, e.g. `a[title]`); `styled` and `correct` become meaningfully different with extraction, as documented.

## Costs, accepted

- ~80–120 LOC fork divergence in the serializer (flag-gated, upstream-parity mode retained).
- Larger FFI payloads and marginally more `sanitize-html` work (it re-parses regardless) — negligible against extraction cost.
- The core test suite changes shape: `serialize-filtered.test.ts` (bucket C) retires with the code; the whitelist assertions in `extract.test.ts:38-45` and the raw-core-output `class=`/`style=`/`on*` assertions in `adbar-corpus.test.ts:34-37` move to `wash()`-level tests (only the `<script` assert stays valid on raw core output, guaranteed by bucket B).
- `boilerplate ≠ 'none'` + `correct` output gets larger and noisier (original attributes preserved). That is the requested semantics; consumers wanting stripped output have four levels for it.

## Recommendation

**Adopt the split for v2**, framed as: *the Rust core owns content selection and extraction hygiene; the TS washing stage owns every byte-level markup policy.* Concretely:

- Rust: port the serializer with the SKIP layer intact; emit verbatim tags + attributes (escaped); keep the script/style/noscript/iframe skip-set as the FFI invariant; keep the whitelist emit mode behind an option for upstream parity testing only; relocate the header/footer-context and name-guard decisions to DOM passes; measure text length from the DOM, not by regex.
- TS: fix the wildcard `SanitizeConfig` gap **before** the split lands (it is a v1 bug regardless); tighten the corpus tester's `correct` soft-exemption into hard asserts; add hostile-fixture security tests on extraction paths; otherwise the washing pillar is already ready — it re-parses, assumes nothing, and enforces the floor at every level including `correct`.
- Follow-up (separate decision, not a blocker): revisit bucket B's *lossy normalization* — the wrapper-tag unwrapping (`cite`/`mark`/`small`/`abbr`) and content-tag kills (`time`, `video`/`audio`) that predate the washing pillar and currently make parts of the `standard`/`permissive` presets unreachable through extraction. Scoring does not need those removals (inline wrappers keep their text); moving them out of hygiene would complete the "washing level is the single inclusion knob" promise. Kept out of scope here because it changes extraction behavior relative to the reference implementations and deserves its own eval run.

### Changes to the v2 brief if adopted

- The locked decision "emit via a whitelist re-serializer" becomes "emit via the boilerplate-skipping serializer in preserve-markup mode; the whitelist mode is retained for reference-parity testing only". Doc 08's §1 framing is superseded accordingly (its anti-`outerHTML` rationale survives: boilerplate skipping during serialization remains — only the markup policy moves).
- The Rust boundary contract gains: "contentHtml preserves original tags/attributes of kept nodes (modulo extraction hygiene); it is UNSANITIZED and must always flow through `washHtml`" — and `pipeline.ts` must never expose it directly.
- Phase CRATE: the serializer port task swaps the whitelist emit for the dual-mode emit; the DOM-pass relocation and DOM-based text length become explicit port requirements; the backoff test is the regression guard.
- Phase INTEGRATE: the retired/moved test list above; SPEC updates for the `styled`/`correct` × extraction semantics; document the fallback-path markup-loss limitation.
- Security section: the wildcard-config fix and the tester tightening become named gate items.

## Evidence index

- Washing floor at `correct`: `@/htmlwasher/src/washing/wash.ts:125-133`, `sanitizer.ts:116-157`, `wash.test.ts:167-190`. Preset path: `wash.ts:98-124`, `sanitizer.ts:25-97`. CSS: `css-sanitizer.ts:50-153`.
- Wildcard bypass: `@/htmlwasher/src/types.ts:194-214` (shape-only validation), `sanitizer.ts:38-44` (`filterEventHandlers` literal-prefix check), `wash.ts:56-59` (`configAllowsStyle`), empirical `onclick` survival against installed sanitize-html.
- Core inventory: `@/htmlwasher/src/core/clean.ts:66-118` (hygiene), `constants.ts:9-132, 415-511` (tag/attr/token catalogs), `serialize-filtered.ts:34-122, 275-305, 336-362` (bucket C + embedded skip guards), `extract.ts:31-34, 67-93, 101-126` (`textLenOf`, backoff, pipeline order).
- rs-trafilatura: `src/extract.rs:2700-2894` (serializer layers), `src/html_processing.rs:120-265` (doc-cleaning; `post_cleaning` dead at 351-396), html-cleaning 0.3.0 `presets.rs:218-259` (`strip_attributes` never set), `src/extractor/fallback.rs:372-377` (fallback sanitize), extract.rs:941-953 (quality-heuristic anchor counting).
- Corpus tester exemption: `@/tools/htmlwasher/wash-corpus-tester/src/corpus-runner.ts:199-272` (soft `correct` security routing), `corpus.test.ts:40-49`.
