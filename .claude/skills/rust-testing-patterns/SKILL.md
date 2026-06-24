---
name: rust-testing-patterns
description: Comprehensive testing patterns for Rust — unit, integration, async, mocking, property-based, snapshot, and CLI tests. Use when writing or improving tests in this workspace.
---

# Rust Testing Patterns

Testing tools and layouts for Rust crates.

## Layout

```
crate/
├── src/
│   ├── lib.rs              # `#[cfg(test)] mod tests { ... }` for unit tests
│   └── parser.rs           # `#[cfg(test)] mod tests { ... }` for unit tests
└── tests/
    ├── integration.rs      # tests against the crate's public API only
    └── fixtures/
        └── sample.html
```

Unit tests live next to the code they test. Integration tests live in `tests/<topic>.rs` and exercise only the public API.

## Running

```bash
cargo test --workspace --all-features
cargo nextest run --workspace --all-features    # faster, better output
cargo nextest run -E 'test(parser)'             # filter
```

Prefer `cargo nextest run` for daily use.

## Unit Test Skeleton

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_returns_text() {
        // Arrange
        let html = "<html><body>Hello</body></html>";

        // Act
        let result = extract(html);

        // Assert
        assert_eq!(result.unwrap().text, "Hello");
    }
}
```

## Async Tests

```rust
#[tokio::test]
async fn test_fetch_returns_body() {
    let body = fetch("https://example.com").await.unwrap();
    assert!(body.contains("Example"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_concurrent_fetches() { ... }
```

## Mocking

### Trait mocks with `mockall`

```toml
[dev-dependencies]
mockall = "0.13"
```

```rust
use mockall::automock;

#[automock]
trait HttpClient {
    async fn get(&self, url: &str) -> anyhow::Result<String>;
}

#[tokio::test]
async fn test_uses_client() {
    let mut mock = MockHttpClient::new();
    mock.expect_get()
        .with(mockall::predicate::eq("https://example.com"))
        .returning(|_| Ok("body".to_string()));
    // ... pass mock to the unit under test
}
```

### HTTP mocks with `wiremock`

```toml
[dev-dependencies]
wiremock = "0.6"
```

```rust
use wiremock::{MockServer, Mock, ResponseTemplate};
use wiremock::matchers::{method, path};

#[tokio::test]
async fn test_against_mock_server() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/search"))
        .respond_with(ResponseTemplate::new(200).set_body_string("ok"))
        .mount(&server)
        .await;

    let response = reqwest::get(format!("{}/search", server.uri())).await.unwrap();
    assert_eq!(response.status(), 200);
}
```

## Property-Based Testing

```toml
[dev-dependencies]
proptest = "1"
```

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn test_parse_then_serialize_roundtrips(s in "[a-zA-Z0-9 ]{0,100}") {
        let parsed = parse(&s).unwrap();
        let serialized = serialize(&parsed);
        prop_assert_eq!(s, serialized);
    }
}
```

## Snapshot Testing

```toml
[dev-dependencies]
insta = { version = "1", features = ["yaml"] }
```

```rust
#[test]
fn test_extract_snapshot() {
    let html = include_str!("fixtures/sample.html");
    let result = extract(html).unwrap();
    insta::assert_yaml_snapshot!(result);
}
```

Run `cargo insta review` to accept snapshot changes.

## CLI Integration Tests

```toml
[dev-dependencies]
assert_cmd = "2"
predicates = "3"
```

```rust
use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn test_cli_extracts_from_url() {
    Command::cargo_bin("<bin-name>").unwrap()
        .args(["--url", "https://example.com"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Example"));
}
```

Note: this workspace currently has no cargo binaries, so this pattern applies only to future bin crates.

## Coverage

```bash
cargo install cargo-llvm-cov
cargo llvm-cov --workspace --all-features --html
open target/llvm-cov/html/index.html
```
