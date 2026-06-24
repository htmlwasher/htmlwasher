# Cargo Scripts

Single-file Rust scripts using the `cargo +nightly -Zscript` interpreter. Useful for one-off automation that benefits from typed code without spinning up a crate.

## Shebang form

```rust
#!/usr/bin/env -S cargo +nightly -Zscript
---cargo
[dependencies]
serde_json = "1"
---

fn main() -> anyhow::Result<()> {
    let value: serde_json::Value = serde_json::from_str(r#"{"hello": "world"}"#)?;
    println!("{value}");
    Ok(())
}
```

Mark the file executable (`chmod +x script.rs`) and run as `./script.rs`.

## When to reach for it

- One-off data processing that's awkward in shell
- Throwaway demos that need a real type system
- Glue code in CI where you don't want to maintain a `Cargo.toml`

## When not to reach for it

- Anything that grows past ~200 lines — promote to a real crate
- Code with multiple modules — `cargo +nightly -Zscript` is single-file only
- Production code paths — pin a stable toolchain instead
