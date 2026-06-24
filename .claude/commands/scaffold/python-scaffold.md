---
description: Scaffold production-ready Python projects with modern tooling — hatchling/pyproject.toml, ruff, pytest. Use for libraries, binary/platform wheels, CLI tools, and data applications.
argument-hint: <project-type> [project-name]
---

# Python Project Scaffold

Create a production-ready Python project with modern tooling and best practices.

In htmlwasher the primary target is the `training/` project — an offline, uv-managed Python 3.12+ project that trains an XGBoost page-type classifier from the public WCXB dataset and exports `model.onnx` + `tfidf-vocab.json` for the TypeScript classifier to load. It is NOT a pnpm workspace member and is NOT shipped at runtime. Use the `data-pipeline` or `library` type for it; uv manages the environment (`uv sync`, `uv run`), and a `pyproject.toml` is optional (the project may stay a plain uv-managed script dir until packaging is needed).

## Usage

```
/scaffold:python-scaffold <project-type> [project-name]
```

## Project Types

### `library`

Reusable, pure-Python library with:
- `src/` layout, `pyproject.toml` with full metadata (license, classifiers, keywords)
- hatchling build backend; single version source via `[tool.hatch.version]`
- pytest + pytest-asyncio with coverage; `py.typed` marker
- ruff (lint + format), mypy strict
- GitHub Actions CI publishing on release via PyPI Trusted Publishing (OIDC)

### `binary-wheel-library`

Library that bundles a prebuilt native/vendored artifact (a `.node` addon, a compiled extension, or a runtime binary) and ships **platform-tagged** wheels:
- hatchling + a `hatch_build.py` hook (`infer_tag=True`, `pure_python=False`) → `py3-none-{platform}` wheels
- assets loaded at runtime via `importlib.resources.files()` + `as_file()`; `os.chmod(+x)` after extraction; an `__init__.py` in every resource subdir
- cibuildwheel matrix (one job per platform) staging the per-platform artifact via `CIBW_BEFORE_ALL`; auditwheel disabled when there is no ELF Python extension
- sdist published; unsupported platforms fail with a clear import-time error
- avoid maturin / scikit-build-core / uv_build (they assume Rust src / CMake / pure-Python)

### `cli-tool`

Modern CLI application with:
- Typer or Click for the command surface, Rich for terminal output
- configuration file support (JSON)
- `[project.scripts]` console entry point
- packaging for distribution

### `data-pipeline`

Async data-processing app with:
- `asyncio` structured concurrency (`TaskGroup`), `asyncio.Semaphore` rate limit
- Pydantic v2 for validation, structured logging
- retries with exponential backoff, graceful shutdown
- performance monitoring hooks

## Project Structure

```
{project-name}/
├── src/
│   └── {package_name}/
│       ├── __init__.py
│       ├── py.typed
│       └── main.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   └── test_main.py
├── .github/
│   └── workflows/
│       └── ci.yml
├── .gitignore
├── .python-version
├── hatch_build.py        # only for binary-wheel-library
├── pyproject.toml
└── README.md
```

## Tooling

### Build backend (hatchling)

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### Code Quality (ruff)

```toml
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM", "S"]
ignore = ["S101"]

[tool.ruff.format]
quote-style = "double"
```

### Testing (pytest)

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
addopts = "-v --cov=src --cov-report=term-missing"
```

### Type Checking (mypy)

```toml
[tool.mypy]
python_version = "3.12"
strict = true
warn_return_any = true
warn_unused_configs = true
```

## Execution

When invoked, this command will:

- **Analyze Context** — check for an existing package and either extend it or scaffold standalone
- **Create Structure** — generate the project layout above (with `hatch_build.py` only for `binary-wheel-library`)
- **Configure Tooling** — write `pyproject.toml` with hatchling, ruff, pytest, and mypy config
- **Initialize Git** — `.gitignore`, `.python-version`, initial commit
- **Add Tests** — sample pytest unit test plus `conftest.py`
- **Document** — `README.md` with install, test, and build instructions

## Activated Skills

This command activates these skills when executed:

- `python` — language guidelines
- `python-packaging` — for library and binary-wheel projects
- `python-testing-patterns` — for test setup
- `async-python-patterns` — for projects using `asyncio`
- `python-performance-optimization` — for projects with hot paths
