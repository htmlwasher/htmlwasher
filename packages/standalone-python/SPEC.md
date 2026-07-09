# trafilaturacore (Python) — Specification

A library-only PyPI package that drives the bundled `trafilaturacore` Node CLI
from Python. It **reimplements nothing**: `clean`/`aclean` spawn `dist/cli.js`
with `--json`, feed the input HTML on stdin, translate snake_case options to CLI
flags, and parse the JSON result. Python loads no JavaScript and no napi `.node` —
Node does, when it runs `cli.js`. It is **offline**: HTML in → cleaned HTML out;
it never fetches the network. Standalone hatchling package; **not** a pnpm/turbo
workspace member.

## Status

**Alpha / experimental** — not fully tested or officially supported, though still
maintained. Marked `Development Status :: 3 - Alpha` in `pyproject.toml`, with a
prominent caveat at the top of `README.md`.

## Public API

`src/trafilaturacore/__init__.py` exports:

- `clean(html, *, boilerplate=None, include_comments=None, include_tables=None, include_images=None, include_links=None, minify=None, url=None, config=None, max_input_bytes=None, timeout=None) -> CleanResult` — sync, primary. Mirrors the npm library's `clean()`.
- `aclean(...) -> CleanResult` — async counterpart (one child process via `asyncio.create_subprocess_exec`).
- `CleanResult` — frozen dataclass: `html`, `messages: list[Message]`, `metadata: dict | None`, `page_type: str | None`, `confidence: float | None`. `page_type`/`confidence` are `None` under `boilerplate='clean-keep-boilerplate'`.
- `Message` — frozen dataclass: `type` (`info`/`warning`/`error`), `text`.
- `Metadata` — the metadata sidecar type alias (`dict[str, Any]`), passed through verbatim.
- `BoilerplateMode`, `BOILERPLATE_MODES`, `DEFAULT_BOILERPLATE_MODE`, `DEFAULT_MAX_INPUT_BYTES`.
- Errors: `TrafilaturacoreError` (base), `NodeRuntimeError`.
- `__version__` — read via `importlib.metadata.version("trafilaturacore")`.

## Orchestration (one invocation)

Each `clean()`/`aclean()` runs **one** child process:

```
node dist/cli.js --json <mapped flags>   # HTML on stdin, JSON on stdout
```

Then `parse_result(stdout)` builds the `CleanResult`. There is no crawl, no
manifest, and no two-phase export (unlike contextractor) — the CLI is single-shot.

### Exit-code + I/O semantics (`_run.py`)

- CLI exit `0` → parse the JSON. Non-zero (the CLI returns `1` on a handled error) → raise `TrafilaturacoreError` with the redaction-free stderr detail.
- Both runners capture raw **bytes** and decode stdout/stderr as UTF-8 with `errors="replace"` — never the locale codec (Windows cp1252/cp932 mojibake) and never universal-newline translation.
- A `timeout` (sync or async) raises `TrafilaturacoreError("trafilaturacore timed out")` — never the raw `subprocess.TimeoutExpired`. The async path is Python-3.9-safe (`asyncio.wait_for`, not `asyncio.timeout`) and kills+reaps the child on timeout/cancel so Node is never orphaned.
- There are no secrets: no proxy, cookies, headers, or tokens flow through the wrapper (trafilaturacore has none), so no redaction layer is needed.

## Option mapping (`_options.py`)

`build_clean_args(...)` is the single, explicit snake_case → CLI-flag translation
boundary, applied immediately before spawn. It is pure (no I/O) and fully
unit-tested. Categories:

- **scalar**: `boilerplate` → `-b <mode>` (validated against `BOILERPLATE_MODES` before spawn), `url` → `-u <url>`, `config_path` → `-c <file>`.
- **negation-only** (default keep; only `False` emits): `include_comments` → `--no-comments`, `include_tables` → `--no-tables`, `include_images` → `--no-images`, `include_links` → `--no-links`.
- **bare switch** (`True` emits): `minify` → `-m`.

`config` (a dict), `max_input_bytes`, and `timeout` are handled by the
orchestrator (`_run.py`), not this table: `config` is serialized to a temp JSON
file whose path becomes `-c`; `max_input_bytes` bounds the UTF-8 input size before
spawn (default 10 MB, a `RangeError` analogue); `timeout` bounds the subprocess.
The CLI always runs with `--json`, so messages/pageType/confidence come back in
the payload and the CLI writes no stderr diagnostics. There is **no proxy/crawl/
Apify surface** — trafilaturacore has none.

## Result parsing (`_result.py`)

`parse_result(stdout)` `json.loads` the payload and builds `CleanResult`. Malformed
or non-object JSON raises `TrafilaturacoreError`. `metadata`/`pageType`/`confidence`
are optional (`JSON.stringify` omits undefined-valued keys), so each maps to
`None` when absent; `confidence` is coerced to `float`.

## Runtime resolution (`_runtime.py`)

- `resolve_node()` — `TRAFILATURACORE_NODE_PATH` override, else the `nodejs-wheel-binaries` binary at `nodejs_wheel.executable.ROOT_DIR` (`bin/node` on POSIX, `node.exe` on Windows). Restores the exec bit (POSIX) if a wheel ZIP dropped it.
- `vendor_cli_dir()` — context manager that materializes the staged `_vendor/cli` tree as a real directory via `importlib.resources.as_file()` (a no-op on disk; extracts to a temp dir, removed on exit, when imported from a zip/pex/shiv).
- `cli_js(cli_dir)` — resolves `dist/cli.js` inside that tree; raises `NodeRuntimeError` if assets were not staged.

In-repo/dev usage points `vendor_cli_dir` at the sibling engine package
(`packages/trafilaturacore/`, which already carries a built `dist/cli.js` + a real
`node_modules`); the installed wheel vendors an equivalent tree under
`_vendor/cli`. Both resolve the same `<cli_dir>/dist/cli.js` shape.

## Asset bundling

The engine CLI is built with **tsup** into `dist/` (ESM). The bundle keeps the
public runtime deps (`commander`, `sanitize-html`, `linkedom`, `parse5`,
`prettier`, `chardet`, `html-minifier-terser`, `iconv-lite`) **external**, so they
must resolve from a real `node_modules` at runtime; the napi `.node` prebuilds and
their CJS loader are staged under `dist/native/` by the engine's tsup build. At
wheel-build time `scripts/stage_vendor.py` copies a
`pnpm deploy --prod --config.node-linker=hoisted` tree (npm-style real files —
wheels can't carry pnpm's symlink store) into `src/trafilaturacore/_vendor/cli/`,
restores `"type": "module"` (pnpm deploy strips it), prunes every non-build-platform
`.node` under `dist/native/`, and seeds an `__init__.py` in every subdir (for
`importlib.resources`). `_vendor/cli` is gitignored and force-included via the
wheel `artifacts` glob. The Node runtime itself is **not** bundled (it comes from
`nodejs-wheel-binaries`).

## Packaging & distribution

- Backend: hatchling + `hatch_build.py` (`pure_python=False`; explicit `tag = py3-none-{platform}`, pinned via `TRAFILATURACORE_WHEEL_PLATFORM` in CI, inferred locally) → `py3-none-{platform}` wheels. Forbid maturin / scikit-build-core / uv_build.
- `version` is static `0.0.0a0` in `pyproject.toml` (aligned with the npm `0.0.0-alpha.0`); `__version__` is read from installed metadata.
- `readme = "README.md"` → the PyPI project page; included in the sdist.
- **LICENSE + NOTICE** live at the engine workspace root (`../../`, symmetric across the engine workspace and the public mirror). The hook force-includes both into the wheel, checking two candidate layouts — the workspace root (in-tree build) and the sdist root (build from the unpacked sdist). The sdist itself carries them at its root via `[tool.hatch.build.targets.sdist.force-include]`, so a wheel built from the sdist still finds them.
- Wheel matrix: `macosx_*_arm64`, `macosx_*_x86_64`, `manylinux_2_28_x86_64`, `manylinux_2_28_aarch64`, `win_amd64`, plus an sdist. **musl is unsupported** — the napi loader throws a clear import error rather than ship a broken `.node`.
- CI: the mirror's `.github/workflows/release-pypi.yml` (cibuildwheel; `CIBW_BEFORE_ALL` stages `_vendor`; auditwheel/delocate repair disabled — there is no ELF Python extension; publish via PyPI Trusted Publishing / OIDC; `workflow_dispatch` only). Sequenced after the `build-native.yml` prebuild refresh so wheels bundle current `.node` files.

## Tests

`pytest` + `pytest-asyncio` (subprocess boundary mocked; no network): option-flag
mapping per category, boilerplate validation, argv + stdin delivery, config
dict → temp file (written + cleaned up), exit-nonzero raise, malformed-JSON raise,
empty-input + `max_input_bytes` guards, UTF-8 byte fidelity, the async path + its
timeout-kills-child behavior, node/CLI resolution + exec-bit restore, the
LICENSE/NOTICE force-include hook, and `stage_vendor` prune/esm/init-seed logic.
One non-mocked layer, `tests/test_e2e_real_cli.py`, drives the repo-built
`packages/trafilaturacore/dist/cli.js` with the system `node` through `clean()` on
a local HTML fixture (offline; auto-skips when `node` or the built CLI is absent).
