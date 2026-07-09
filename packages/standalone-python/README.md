# trafilaturacore

[![PyPI version](https://img.shields.io/pypi/v/trafilaturacore.svg)](https://pypi.org/project/trafilaturacore/)
[![PyPI downloads](https://img.shields.io/pypi/dm/trafilaturacore.svg)](https://pypi.org/project/trafilaturacore/)
[![license](https://img.shields.io/pypi/l/trafilaturacore.svg)](https://github.com/trafilatura/trafilatura/blob/main/LICENSE)

Clean a page's main content from HTML, in Python — a thin, typed wrapper over the
bundled [`trafilaturacore`](https://www.npmjs.com/package/trafilaturacore) Node
CLI. HTML in → cleaned HTML out, plus a metadata sidecar and a page type.

> **⚠️ Alpha / experimental.** This Python wrapper is an **alpha** release — not
> fully tested or officially supported, though still maintained. The API may
> still change.

`trafilaturacore` is a hybrid Rust + TypeScript port of
[Trafilatura](https://github.com/adbar/trafilatura): a Rust core removes
boilerplate and classifies the page type; a TypeScript stage sanitizes and
formats the result. It is a **content-extraction library, not a scraper** — it is
**offline** and never fetches the network. The `url` argument is context only (for
the classifier's URL heuristics and the metadata sidecar) and is never fetched.

This package **reimplements nothing**: it drives the bundled Node CLI as a
subprocess and parses its JSON output. A self-contained Node runtime is installed
automatically as a dependency (`nodejs-wheel-binaries`), so no separate Node.js
install is required — but no Python code touches the extraction engine itself.

## Install

```bash
pip install trafilaturacore
```

Platform wheels are published for macOS (arm64, x86_64), Linux (x86_64, aarch64;
glibc ≥ 2.28), and Windows (x64). Requires Python 3.9+.

## Quick start

```pycon
>>> import trafilaturacore
>>> html = "<html><body><article><h1>Hello</h1><p>Real body text here.</p></article></body></html>"
>>> result = trafilaturacore.clean(html)
>>> result.html
'<h1>Hello</h1>\n<p>Real body text here.</p>\n'
>>> result.page_type
'article'
```

`clean()` returns a `CleanResult` dataclass:

- `html` — the cleaned HTML.
- `messages` — a list of `Message(type, text)` diagnostics.
- `metadata` — a dict sidecar (title, author, date, sitename, …), or `None`.
- `page_type` — one of `article`, `forum`, `product`, `collection`, `listing`,
  `documentation`, `service`, or `None` under `clean-keep-boilerplate`.
- `confidence` — the classifier's confidence in `page_type` (0–1), or `None`.

`aclean()` is the async variant with the same signature.

## Options

Every option is a typed keyword argument mapping one-to-one onto a
[CLI flag](https://www.npmjs.com/package/trafilaturacore):

- `boilerplate=` — `"precision"`, `"balanced"` (default), `"recall"`, or
  `"clean-keep-boilerplate"` (HTML cleanup only; keeps the whole document, skips
  classification).
- `include_comments=` / `include_tables=` / `include_images=` / `include_links=` —
  tri-state, default keep; pass `False` to drop that content family.
  (`include_comments` is a soft no-op — comment retention follows the page type.)
- `config=` — a custom cleaning config dict (allowed tags/attributes/…); replaces
  the default Trafilatura-aligned config.
- `minify=True` — minify the output instead of pretty-formatting it.
- `url=` — source URL for classifier/metadata context only. **Never fetched.**
- `max_input_bytes=` — reject inputs larger than this many UTF-8 bytes (default
  10 MB) before spawning.
- `timeout=` — seconds before the subprocess is killed and a `TrafilaturacoreError`
  is raised.

```python
import trafilaturacore

result = trafilaturacore.clean(
    html,
    boilerplate="recall",
    include_tables=False,
    minify=True,
)
```

Invalid input or a CLI failure raises `TrafilaturacoreError`. Set
`TRAFILATURACORE_NODE_PATH` to use a host Node binary instead of the bundled runtime.

## Contributing

Issues and pull requests are welcome at the
[issue tracker](https://github.com/trafilatura/trafilatura/issues). The extraction
engine, the npm CLI, and this Python wrapper all live in the same
[source repository](https://github.com/trafilatura/trafilatura).

## License

[Apache-2.0](https://github.com/trafilatura/trafilatura/blob/main/LICENSE). Bundles
third-party components; see the `NOTICE` shipped in the wheel.
