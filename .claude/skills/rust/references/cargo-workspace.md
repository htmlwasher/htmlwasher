# Cargo Workspace

Layout and dependency management for a Cargo workspace whose crates share inherited package metadata and dependencies.

## Layout

```
@/                                                   # repo root
├── Cargo.toml                                        # workspace root
├── Cargo.lock                                        # committed
└── crates/
    ├── core/                                         # library crate
    │   ├── Cargo.toml
    │   └── src/lib.rs
    └── cli/                                          # binary crate
        ├── Cargo.toml
        └── src/main.rs
```

## Workspace `Cargo.toml`

```toml
[workspace]
resolver = "3"
members = ["crates/core", "crates/cli"]

[workspace.package]
edition = "2024"
rust-version = "1.85"
license = "Apache-2.0"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

## Member crate `Cargo.toml`

```toml
[package]
name = "example-core"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
```

## Conventions

- Inherit common dependencies via `workspace = true` to keep versions aligned.
- Use `path = "..."` references for in-workspace deps (no version).
- Run `cargo build --workspace` and `cargo test --workspace` from the root.
- A virtual workspace with empty `members = []` fails `cargo metadata` — keep at least one member listed.
