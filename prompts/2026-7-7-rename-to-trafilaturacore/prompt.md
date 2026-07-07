
> **TLDR**: Sweep the already-folder-renamed `~/r/trafilatura` and `~/r/trafilatura-external-tester` repos — rename every `htmlwasher` → `trafilaturacore` and `HTML Washer` → `Trafilatura Core` identity token (plus the `wash*` → `sanitize*` API family) across package/crate/folder names, configs, prompts, and docs, then rebuild both repos from scratch and autofix anything broken. Greenfield, so replace outright (no aliases or shims).

we renamed those repos from
```
~/r/htmlwasher/
~/r/htmlwasher-external-tester
```
to
```
~/r/trafilatura/
~/r/trafilatura-external-tester
```

Now, in those renamed repositories
```
~/r/trafilatura/
~/r/trafilatura-external-tester
```

we also need to rename the packages and package-name folders,
so rename all package names, folders, names, references in package.json, turborepo config, crate config etc.

repo name, already renamed `htmlwasher` to `trafilatura`, `htmlwasher-external-tester` renamed to `trafilatura-external-tester`
package name, subfolders (except repo folder) `htmlwasher` to `trafilaturacore` (without dash),
display name `HTML Washer` to `Trafilatura Core`,
the npm package will be named `trafilaturacore`

this is a greenfield project — no backward compatibility, so replace names outright (no aliases, deprecation shims, or re-exports).

concrete `htmlwasher` → `trafilaturacore` targets (the non-obvious ones — sweep every hit, not just these):
- root workspace name `htmlwasher-workspace` → `trafilaturacore-workspace` (@/package.json)
- npm package name + `bin` key `htmlwasher` → `trafilaturacore` (@/packages/htmlwasher/package.json)
- native scoped package `@htmlwasher/native` → `@trafilaturacore/native` and napi `binaryName` `htmlwasher-native` → `trafilaturacore-native` (@/packages/htmlwasher/native/package.json)
- Rust crate `htmlwasher-native` → `trafilaturacore-native` (@/packages/htmlwasher/native/Cargo.toml) and the workspace member path `packages/htmlwasher/native` → `packages/trafilaturacore/native` (@/Cargo.toml)
- package folder `packages/htmlwasher/` → `packages/trafilaturacore/` (pnpm-workspace globs `packages/*`, so no workspace-config edit needed)
- Cargo `repository` URL `github.com/glueo/htmlwasher` → `github.com/glueo/trafilatura` (repo-name rule → `trafilatura`, NOT `trafilaturacore`)

also rename the `wash*` family (greenfield, so rename outright): public `wash()` → `sanitize()`, `WashOptions` → `SanitizeOptions`, the five HTML-washing levels → "sanitization levels", and the `wash-corpus-tester` package/folder → `sanitize-corpus-tester`. use `sanitize`, not `clean`, to avoid colliding with the existing internal bucket-B "cleaning" stage (`clean.ts` / `html_processing.rs`).


the replacement must be done in all the prompts, init prompts, history prompts etc, everywhere (except old commits — no rename in old commits, other branches etc — also except this rename prompt `@/prompts/2026-7-7-rename-to-trafilaturacore/prompt.md`)
this includes references to the read-only reference-repo sources: the sources folder was renamed `~/r/htmlwasher-sources` → `~/r/trafilatura-sources` (repo-name rule → `trafilatura`, NOT `trafilaturacore`), so sweep `htmlwasher-sources` → `trafilatura-sources` in `clone-other-repos.sh`, CLAUDE.md, and anywhere else it appears.

also rename everything in @/prompts/2026-6-24-init/prompt.md and @/prompts/2026-6-24-init/context
When done, compile both repos from scratch, make sure both repos work, nothing is broken. autofix problems.