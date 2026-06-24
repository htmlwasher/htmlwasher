---
name: python-packaging
description: Modern Python packaging with pyproject.toml, src layout, binary/platform wheels, and PyPI distribution best practices. Use when configuring a Python package, building wheels, or publishing to PyPI.
---

# Python Packaging

## Modern Project Structure

### src Layout (Recommended)
```
my-package/
├── src/
│   └── my_package/
│       ├── __init__.py
│       ├── core.py
│       └── utils.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   └── test_core.py
├── docs/
├── .github/
│   └── workflows/
├── pyproject.toml
├── README.md
├── LICENSE
└── CHANGELOG.md
```

## pyproject.toml Configuration

### Complete Example
```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "my-package"
version = "0.1.0"
description = "A short description of the package"
readme = "README.md"
license = {file = "LICENSE"}
requires-python = ">=3.11"
authors = [
    {name = "Your Name", email = "you@example.com"}
]
keywords = ["keyword1", "keyword2"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: Apache Software License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Typing :: Typed",
]
dependencies = [
    "httpx>=0.25.0",
    "pydantic>=2.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-cov>=4.0.0",
    "pytest-asyncio>=0.21.0",
    "ruff>=0.1.0",
    "mypy>=1.0.0",
]

[project.urls]
Homepage = "https://github.com/user/my-package"
Repository = "https://github.com/user/my-package"
Changelog = "https://github.com/user/my-package/blob/main/CHANGELOG.md"

[tool.hatch.build.targets.sdist]
include = [
    "/src",
    "/tests",
]

[tool.hatch.build.targets.wheel]
packages = ["src/my_package"]
```

## Version Management

### Single Source of Truth
```python
# src/my_package/__init__.py
__version__ = "0.1.0"
```

```toml
# pyproject.toml
[project]
dynamic = ["version"]

[tool.hatch.version]
path = "src/my_package/__init__.py"
```

### Semantic Versioning
- **MAJOR**: Breaking changes
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, backward compatible

## Binary / Platform Wheels

A package that bundles native artifacts (a compiled extension, a `.node` addon, or a vendored binary) must ship **platform-tagged** wheels, not `py3-none-any`. With hatchling, drive the tag from a custom build hook:

```python
# hatch_build.py
from hatchling.builders.hooks.plugin.interface import BuildHookInterface

class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        build_data["infer_tag"] = True      # → py3-none-{platform}
        build_data["pure_python"] = False    # not a pure-Python wheel
```

```toml
# pyproject.toml
[tool.hatch.build.targets.wheel.hooks.custom]
path = "hatch_build.py"
```

Each platform wheel carries only that platform's binary. Build the matrix with **cibuildwheel** (one job per platform), staging the per-platform binary into the package before each build via `CIBW_BEFORE_ALL`. Disable auditwheel repair when there is no ELF Python extension to patch. Publish an sdist too, and make unsupported platforms fail with a clear import-time error rather than silently shipping a broken wheel.

Avoid build backends that do not fit a "vendor a prebuilt binary" model: **maturin** (expects a Rust source crate), **scikit-build-core** (expects CMake), **uv_build** (pure-Python only).

## Building and Publishing

### Build Commands
```bash
# Install build tools
pip install build twine

# Build distributions
python -m build

# Check built package
twine check dist/*
```

### Publishing to PyPI — Trusted Publishing (OIDC)

Prefer PyPI Trusted Publishing over a long-lived API token: the workflow authenticates with a short-lived OIDC identity, so there is no secret to leak or rotate.

```yaml
# .github/workflows/publish.yml
name: Publish to PyPI

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: pypi
    permissions:
      id-token: write          # required for Trusted Publishing
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Build
        run: |
          pip install build
          python -m build
      - name: Publish
        uses: pypa/gh-action-pypi-publish@release/v1
        # no password / token — OIDC identity is used
```

## Type Hints and py.typed

### Mark Package as Typed
```
src/my_package/
├── __init__.py
├── py.typed        # Empty file marking package as typed
└── core.py
```

### pyproject.toml for Typed Packages
```toml
[tool.mypy]
packages = ["my_package"]
strict = true
warn_return_any = true
warn_unused_configs = true
```

## Best Practices

- **Use src layout** — prevents import issues during development
- **Single version source** — keep version in one place
- **Comprehensive metadata** — good classifiers and keywords
- **Type hints** — include the py.typed marker
- **Platform-tag binary wheels** — never ship `py3-none-any` when bundling a native artifact
- **Trusted Publishing** — prefer OIDC over PyPI API tokens
- **Include tests in sdist** — for reproducibility
- **Lock development dependencies** — use a lockfile or requirements-dev.txt
