# Add Contextractor Content-Inclusion Toggles to trafilaturacore

## Goal

Give `trafilaturacore`'s public `clean()` API and CLI the content-inclusion toggles the downstream **Contextractor** consumer drives, mirroring Trafilatura's `include_*` flags. Contextractor's playground "Extraction & output" panel exposes a **Content** group — Include comments / tables / images / links — that must map onto real `trafilaturacore` options. The change is **TypeScript-only**; the Rust core is untouched.

## Consumers (context — do NOT edit these repos here)

- `~/r/tools/projects/contextractor-engine` — TS monorepo that wraps `trafilaturacore` behind a `ContentExtractor`; its calls are synchronous.
- `~/r/tools/projects/contextractor-web` — the playground UI (contextractor.com); shared contract type `TrafilaturaConfig` in `packages/api/types.ts`.

`trafilaturacore` stays **HTML in → cleaned HTML out**. Contextractor owns format conversion (markdown / text / json) and the boundary renames (`targetLanguage → languageCode`, `text → txt`). Do NOT add any of those here.

## Skills and Agents

- `ts-pro` — the TypeScript library work under `@/packages/trafilaturacore/src/`.
- `test-runner` — run format / lint / typecheck / tests after the change.

## Scope — Add

- `CleanOptions` (`@/packages/trafilaturacore/src/types.ts`): four optional tri-state booleans `includeComments` / `includeTables` / `includeImages` / `includeLinks`. Rewrite the existing "there are deliberately no include\* toggles" comment.
- `deriveContentConfig(base, toggles)` exported from `@/packages/trafilaturacore/src/cleaning/config.ts`: subtracts tag families from a base `CleanConfig` per the toggles. Returns the **base reference unchanged** when nothing subtracts.
- Wire through `@/packages/trafilaturacore/src/pipeline.ts`: validate each toggle is a boolean at the boundary; derive the effective config and pass it to `cleanHtml`; when nothing subtracts, forward `options.config` verbatim so the default path stays byte-identical.
- CLI (`@/packages/trafilaturacore/src/cli-program.ts`): `--no-comments` / `--no-tables` / `--no-images` / `--no-links`, threaded through `ResolvedCliOptions` into `clean()`.

## Scope — Do NOT

- Do NOT rename the `boilerplate` extraction-mode option — a rename to `extractionMode` was proposed and rejected. Keep `precision | balanced | recall | clean-only`.
- Do NOT add `languageCode` or language filtering (needs core language support that does not exist yet).
- Do NOT add output-format conversion.
- Do NOT touch the native crate: the napi `ExtractOptions` (`pageType` / `focus` / `url`) is unchanged. The TS cleaning stage is the sole sanitization authority (context doc 09), so subtraction happens there.

## Semantics

- Tri-state: `undefined` or `true` keeps the content (base config used untouched); only an explicit `false` subtracts. Defaults keep everything — non-breaking, opt-in subtractions. (Contextractor defaults `includeImages` off; `trafilaturacore` keeps images by default and subtracts only on explicit `false`.)
- `includeImages: false` → discard image subtrees: remove `img` / `figure` / `figcaption` / `picture` / `source` from `allowedTags`; add `figure` / `picture` / `img` / `source` to `nonTextTags`; drop their `allowedAttributes` and `selfClosing` entries.
- `includeTables: false` → discard table subtrees: remove `table` / `caption` / `tr` / `td` / `th` / `colgroup` / `col` from `allowedTags`; add `table` to `nonTextTags`.
- `includeLinks: false` → unwrap `<a>`: remove `a` from `allowedTags` (anchor text kept, `href` dropped); do NOT add it to `nonTextTags`.
- `includeComments` → soft no-op: comment retention is decided by the page-type profile in the Rust core, not a tag-level toggle. Accept and validate it for consumer-contract parity; it does NOT feed `deriveContentConfig`.

## Reference — the wiring pattern

The recently removed cleaning-levels option (commit `e7a808d`, "replace cleaning levels with a Trafilatura-aligned default config") shows how a mode/option was threaded through `types.ts` → `cli-program.ts` (`-l/--level`: a commander option plus a parser guard) → `pipeline.ts`. Mirror that shape. The live `boilerplate` option in the same three files is the working example to copy.

## Tests (same response as the source change)

- `@/packages/trafilaturacore/src/cleaning/config.test.ts` — `deriveContentConfig` units: no-toggle (and all-`true`) returns the same base reference; each `false` subtracts exactly the right tags into `allowedTags` / `nonTextTags`; derives from a custom base config without mutating it.
- `@/packages/trafilaturacore/src/pipeline.test.ts` — `clean()` behavior: `includeImages:false` drops `<img>`; `includeTables:false` drops the table; `includeLinks:false` keeps the text but drops `<a>`; `includeComments:false` is a no-op; a non-boolean toggle throws `TypeError`.
- `@/packages/trafilaturacore/src/cli-program.test.ts` — the `--no-*` flags map to the right `clean()` options.

## Docs (same response — per the spec/test-maintenance rules)

- `@/packages/trafilaturacore/SPEC.md` and `@/packages/trafilaturacore/README.md` — the four toggles, their semantics and defaults, the CLI flag table, and `deriveContentConfig`.
- `@/SPEC.md` and `@/README.md` — a short lib + CLI example.
- `@/prompts/2026-6-24-init/prompt.md` and `@/PORTING-NOTES.md` — note the added toggles.

## Verify

- Run per-package to bypass the Turborepo cache (root `pnpm test` / `pnpm build` can replay a cached PASS on a dirty tree): `pnpm --filter trafilaturacore test` and `pnpm --filter trafilaturacore build`, then `pnpm lint`.
- Expect all `trafilaturacore` tests green and the adbar eval F1 ≈ 0.835 unchanged (toggles are opt-in; the default path is byte-identical to before).
