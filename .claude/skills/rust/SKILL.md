---
name: rust
description: Rust development guidelines and best practices for Edition 2024. Use when writing or modifying Rust code in this workspace.
---

# Rust Guidelines

Standards and best practices for Rust development. Follow these guidelines when writing or modifying Rust code in this workspace.

## Design Principles

Apply DRY, KISS, and SOLID consistently. Prefer free functions over methods when there is no state. Use traits for behavior abstraction, not for forced inheritance. Composition over inheritance. Each module has a single responsibility. Use explicit dependency injection (pass `&dyn Trait` or generic `T: Trait`) rather than global singletons.

## Code Style

- **Naming**: `snake_case` for functions, modules, variables, fields. `CamelCase` for types, traits, enum variants. `SCREAMING_SNAKE_CASE` for constants and statics. Descriptive yet concise.
- **Documentation**: `///` doc comments for every public item. Include a one-line summary, an `# Examples` section with a runnable doctest where useful, and `# Errors` / `# Panics` sections where they apply.
- **Imports**: Group `std`, external crates, and crate-local imports with blank lines between groups. Avoid glob imports outside `mod tests`.
- **Visibility**: Default to private. Promote to `pub(crate)` only when another module needs it; promote to `pub` only at the crate boundary.

## Type System

- Prefer `Option<T>` and `Result<T, E>` over sentinel values
- Newtype wrappers for primitive obsession: `struct UrlStr(String);`
- Exhaustive enums; mark public enums `#[non_exhaustive]` when adding variants would break downstream
- Use `Cow<'_, str>` when a value may or may not need owning
- `Arc<T>` for shared immutable data; `Arc<Mutex<T>>` only when shared mutation is genuinely needed

## Architecture

### Module Organization

- Each module focuses on one concern with clear boundaries
- Re-export the public API from `lib.rs` so call sites import from the crate root

### Environment Variables

- Consolidate environment access in `env.rs` with one function per variable (e.g. `api_token() -> Result<String>`, `cache_dir() -> Option<String>`)
- Easier to mock and audit than scattered `std::env::var(...)` calls

### Data Models

- Use `serde::Deserialize` / `serde::Serialize` for input, output, and configuration
- Add `#[serde(deny_unknown_fields)]` for input that should fail loudly on typos
- Use the `validator` crate or hand-written validators for cross-field invariants

## Testing

### Structure

- Unit tests live next to source in `#[cfg(test)] mod tests { ... }`
- Integration tests live at `tests/<topic>.rs` next to the crate's `src/`
- Async tests use `#[tokio::test]`
- Test names start with `test_` and describe behavior, not implementation

### Quality

- AAA (Arrange, Act, Assert) pattern
- Tests should be useful, readable, concise, deterministic
- Avoid test code that creates massive diffs or becomes burdensome

### Tools

- Prefer `cargo nextest run` over `cargo test` (faster, better output)
- `mockall` for trait mocks, `wiremock` for HTTP mocks
- `proptest` for property-based testing
- `insta` for snapshot tests

## Implementation

When writing Rust code:

```bash
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace --all-features
```

All three must pass before committing.

## References

- For cargo script (`#!/usr/bin/env -S cargo +nightly -Zscript`) patterns, see `references/cargo-scripts.md`.
- For workspace layout and inherited dependencies, see `references/cargo-workspace.md`.
