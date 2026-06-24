---
name: rust-packaging
description: Modern Rust packaging with Cargo.toml, lints config, semver, and crates.io publishing best practices. Use when configuring a new crate, preparing a release, or wiring up CI publishing.
---

# Rust Packaging

How to package a Rust crate for distribution or in-workspace use.

## Cargo.toml (library crate)

A standard library crate exposes a `[lib]` and is published to crates.io (or consumed in-workspace via a `path` dependency).

```toml
[package]
name = "example-lib"
version = "0.1.0"
edition = "2024"
rust-version = "1.85"
license = "Apache-2.0"
description = "Example library crate."

[lib]
path = "src/lib.rs"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

## Lints

```toml
[lints.rust]
missing_docs = "warn"
unsafe_code = "forbid"
unused_must_use = "deny"

[lints.clippy]
must_use_candidate = "warn"
needless_pass_by_value = "warn"
unwrap_used = "deny"
expect_used = "deny"
missing_errors_doc = "warn"
```

These can be inherited workspace-wide via `[lints]` `workspace = true` in member crates. **Do not relax `unwrap_used` / `expect_used` to silence build errors** — fix the code instead, or convert the panic site to a typed error.

## Semver

- `0.x.y` — bump `x` for breaking changes, `y` for everything else
- `1.0.0+` — bump major for breaking, minor for additive, patch for bug fixes
- Mark public enums `#[non_exhaustive]` if you might add variants
- Mark public structs `#[non_exhaustive]` if you might add fields

## Pre-Publish Check

For an **internal-only** crate (consumed in-workspace via a `path` dependency, not published):

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

For a crates.io-bound crate:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-features
cargo publish --dry-run -p <crate-name>
```

## Publishing

For a crates.io-bound crate:

```bash
cargo login    # interactive — accepts CARGO_REGISTRY_TOKEN env var as well
cargo publish -p <crate-name>
```

For workspaces, publish dependent crates first.
