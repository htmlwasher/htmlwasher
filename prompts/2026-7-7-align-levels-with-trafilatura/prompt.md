> **TLDR**: Trim trafilaturacore's cleaning/boilerplate knobs to match upstream Trafilatura — drop the five-level `CLEANING_LEVELS` preset system (trafilaturacore's own invention, not a Trafilatura concept) in favour of Trafilatura's canonical output-tag set, and rename the `none` boilerplate mode to a clearer clean-only name. Then update the docs and re-benchmark.

we need to remove these settings (defined in `@/packages/trafilaturacore/src/types.ts`; the five level presets live in `@/packages/trafilaturacore/src/cleaning/presets/`):
```
export const CLEANING_LEVELS = ['minimal', 'standard', 'permissive', 'styled', 'correct'] as const;
export type CleaningLevel = (typeof CLEANING_LEVELS)[number];

```
we will keep only those elements that Trafilatura or rs-trafilatura uses (research on the web and in `~/r/trafilatura-sources`). Neither has "cleaning levels" — Trafilatura's kept-element set is its output whitelist `TEI_VALID_TAGS` (rendered to HTML via `HTML_CONVERSIONS`) plus the `MANUALLY_CLEANED` / `MANUALLY_STRIPPED` / `CUT_EMPTY_ELEMS` lists in `~/r/trafilatura-sources/trafilatura/trafilatura/{settings,xml,htmlprocessing}.py`; rs-trafilatura exposes only `favor_precision` / `favor_recall` in `~/r/trafilatura-sources/rs-trafilatura/src/options.rs`.

also, rename the `none` boilerplate mode below (in `@/packages/trafilaturacore/src/types.ts`, handled in `@/packages/trafilaturacore/src/pipeline.ts`) to something better, to reflect that it will do only the html cleanup by filtering to basic elements, but keeping only basic elements. (`precision | balanced | recall` faithfully mirror Trafilatura's internal `focus` field, so keep those three; only `none` is trafilaturacore's own addition — candidates: `passthrough`, `clean-only`, `bare`.)
```
export const BOILERPLATE_MODES = ['precision', 'balanced', 'recall', 'none'] as const;
export type BoilerplateMode = (typeof BOILERPLATE_MODES)[number];
```

update @/SPEC.md
update @/prompts/2026-6-24-init/prompt.md
update @/README.md

when done, commit and push
then run this slash command `/bench:improve`
then again commit and push

## Outcome

- Implemented 2026-07-07. `CLEANING_LEVELS`/`CleaningLevel`, `DEFAULT_CLEANING_LEVEL`, `isCleaningLevel`, the `level` option, the CLI `-l/--level` flag, and `src/cleaning/presets/` are gone; the sanitize stage now always runs (the `correct` normalize-only path is retired), with the security floor unchanged and unconditional on every path.
- Rename decision: `none` → `clean-only` (identical semantics: skip boilerplate removal + classification entirely, never load the FFI binding, clean the whole document; `pageType`/`confidence` omitted).
- The presets are replaced by the exported `DEFAULT_CLEAN_CONFIG` in the new `@/packages/trafilaturacore/src/cleaning/config.ts` (alongside the `CleanConfig` interface) — derived from Trafilatura 2.1.0: `TEI_VALID_TAGS` rendered via `HTML_CONVERSIONS` union rs-trafilatura's serializer whitelist as `allowedTags`, `MANUALLY_CLEANED` → `nonTextTags`, `MANUALLY_STRIPPED` → simply not allowed (unwrapped, content kept); a custom `config` replaces it wholesale.
- All tests green: adbar eval precision 0.831 / recall 0.840 / F1 0.835; clean-corpus-tester 28 fixtures × 5 combos, page-type accuracy 100%, 0 hard/security failures — verdict PASS.
