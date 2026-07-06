# htmlwasher-native — SPEC

The Rust boilerplate-removal + page-type extraction core for htmlwasher v2. A simplified
fork of rs-trafilatura's LIVE extraction path, ported through the tested v1 TypeScript core
(`packages/htmlwasher/src/core/*`) with the doc-09 divergences applied. **Rust owns boilerplate
removal + the extraction profiles; the TypeScript layer owns sanitization, metadata, and the
public `wash()` API.** Phase CRATE deliverable (plain lib; napi bindings arrive at Phase BIND).

## Public API

```rust
pub fn extract(html: &str, options: &Options) -> Result<ExtractResult, Error>;
pub fn extract_default(html: &str) -> Result<ExtractResult, Error>;
```

- **`Options`** (`camelCase` serde): `focus: Focus` (`Precision|Balanced|Recall`), `page_type:
Option<PageType>` (drives profile selection; `None` = the `Article` profile / classifier-less),
  `url: Option<String>` (reserved for the classifier phase), `emit_mode: EmitMode`
  (`PreserveMarkup` default / `WhitelistParity`), `include_links`, `include_images`, `exclude_tables`.
- **`ExtractResult`** (`camelCase` serde): `content_html: String`, `page_type: PageType`,
  `confidence: Option<f64>` (`None` this phase), `text_length: usize`, `fallback_used: bool`,
  `warnings: Vec<String>`.
- **`PageType`**: 7 variants; the internal `Category` variant serializes/`as_str()`es to the wire
  string `"collection"` (`FromStr`/serde accept both `category` and `collection`; `docs` →
  `documentation`).
- **`Error`** (thiserror, `#[non_exhaustive]`): `InvalidOption`, `TooDeep`.

## Contract (doc-09)

- **Preserve-markup default emit:** kept nodes keep their ORIGINAL tag + ALL attributes (escaped
  via `html-escape`). The ONLY serializer hard-skip is `script`/`style`/`noscript`/`iframe` (the
  no-script FFI invariant; those are also removed doc-wide by cleaning). Rust sanitizes nothing
  else — `content_html` is script-free but otherwise UNTRUSTED and MUST always flow through the TS
  washing stage.
- **`WhitelistParity`** reproduces the upstream rs-trafilatura fixed tag/attribute whitelist emit
  (non-whitelisted elements unwrapped). Reference-parity testing ONLY.
- **Never panics** on malformed/deeply-nested input — returns a `Result`/total value. All dom_query
  traversal is iterative; the only recursion (the serializer, dom_query's `strip_elements`) is
  bounded by an up-front iterative depth guard (`MAX_TREE_DEPTH = 512`). Table caps
  `MAX_TABLE_CELLS = 20_000`, `MAX_TABLE_TEXT_LEN = 200_000`.
- **`text_length`** is measured from the DOM `text()` of the kept subtree (the "text twin"), never a
  regex tag-strip; the `''`-on-whitespace contract is preserved (empty content → empty HTML).
- **No hidden thread-local state**: rs-trafilatura's `COMMENTS_ARE_CONTENT` is an explicit
  `comments_are_content` field on `CoreOptions` (forums treat `comment*` nodes as content).

## Pipeline (`extract.rs::extract_content`)

parse (`dom_query`/html5ever) → `enforce_max_depth` → `clean_document` (bucket B) → `find_content_node`
(profile selectors → content rules → `article`/`main`/`[role=main]` → readability scoring → body) →
per-render clone (`to_fragment`) with the relocated DOM passes [`prune_unwanted_nodes` link density →
header/footer-outside-`article`/`main` → unconditional `is_always_excluded_name` + BreadcrumbList →
gated `is_boilerplate` (skipped on the backoff path) → empty-node prune] → DUAL-mode serializer →
short-extraction backoff + whole-body fallback.

The **doc-09 backoff guard**: when the gated name filter would empty the content it backs off to the
unfiltered render, while the unconditional always-excluded + BreadcrumbList drops still fire.

## Modules

- `options.rs`/`result.rs`/`error.rs` — the public surface.
- `dom.rs` — dom_query helpers (parse, tag/class/id, scoped `select_all`/`select_first`, `text_len`,
  ancestor walk).
- `tags.rs` — the tag catalogs (`TAGS_TO_CLEAN`/`TAGS_TO_STRIP`/`EMPTY_TAGS_TO_REMOVE`/void/hard-skip).
- `patterns.rs` — token/word split + whitespace-collapse helpers.
- `html_processing.rs` — bucket-B `clean_document`, real `remove_comments`, `prune_empty_elements`,
  `enforce_max_depth`.
- `link_density.rs` — `link_density_test(_tables)`, `delete_by_link_density`.
- `selector/{content,discard,utils}.rs` — the content-node cascade, name-based discard predicates,
  content-rule matching.
- `extractor/fallback.rs` — `prune_unwanted_nodes` (reconciled single copy).
- `page_type/mod.rs` — `PageType` + the 7 `ExtractionProfile` constants (verbatim).
- `extract.rs` — orchestration, the DUAL-mode serializer + text twin, relocated DOM passes, table caps.

## Deviations from the reference

- **`html-cleaning` NOT a dependency** — 0.3.0 pins `dom_query 0.24`, incompatible with the mandated
  `dom_query 0.28`; bucket-B cleaning is ported directly from the tested v1 `clean.ts`.
- **dom_query `unwrap_node` is never used** — it removes a node's PARENT, not the node; tag stripping
  uses `strip_elements`.
- **Deferred this phase:** `aggregate_sections`/`collect_repeated_items` post-passes (carried as
  profile config; measured at VALIDATE) and the structured JSON-LD/Discourse/baseline rescue paths.
  The v1-equivalent core cascade + backoff + body fallback is ported.

## Gate

`cargo build --workspace`, `cargo test --workspace` (63 tests), `cargo clippy --workspace
--all-targets -- -D warnings`, `cargo fmt --check` — all green. Production code uses `Result` + `?`
(no `unwrap`/`expect`/`unsafe`); tests permit unwrap/expect via `clippy.toml` + a per-file allow.
The adbar sanity test skips gracefully when `~/r/htmlwasher-sources/trafilatura/tests/cache` is absent.
