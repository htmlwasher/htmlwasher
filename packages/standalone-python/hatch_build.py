"""Hatchling build hook forcing a platform-tagged wheel + LICENSE/NOTICE inclusion.

The wheel bundles a flattened Node CLI tree plus the build platform's native
``.node`` addon, so it must be tagged ``py3-none-{platform}`` rather than
``py3-none-any``. The assets themselves are staged into
``src/trafilaturacore/_vendor/`` before the build by ``scripts/stage_vendor.py``
(driven by ``CIBW_BEFORE_ALL`` in CI); this hook sets the wheel tag and
force-includes the Apache-2.0 ``LICENSE`` + third-party attribution ``NOTICE``.

``TRAFILATURACORE_WHEEL_PLATFORM`` pins the platform tag explicitly (e.g.
``manylinux_2_28_x86_64``). CI sets it per matrix row because auditwheel/delocate
repair is disabled — there is no ELF Python extension to relabel a bare
``linux_x86_64`` wheel into a PyPI-acceptable ``manylinux`` tag. When unset (e.g. a
local ``python -m build`` on the native platform), the tag is inferred.

LICENSE + NOTICE are force-included through the hook (not a static ``force-include``
table) so the path resolves in BOTH build layouts: an in-tree build resolves them
at the workspace root (``../../``, symmetric across the engine workspace and the
public mirror); a build FROM the sdist resolves them at the sdist root (where the
sdist ``force-include`` placed them). A static path would only work in one.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

_HERE = Path(__file__).resolve().parent
# Candidate directories holding LICENSE/NOTICE, in priority order:
#   - the workspace root (two levels up) for an in-tree build (engine workspace
#     AND the public mirror are symmetric here);
#   - the package/sdist root (this dir) for a wheel built from the unpacked sdist,
#     where the sdist force-include placed LICENSE/NOTICE at the root.
_DOC_CANDIDATE_DIRS = (_HERE.parent.parent, _HERE)
_DOC_NAMES = ("LICENSE", "NOTICE")


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        # Platform-specific (bundles a .node) but ABI-agnostic: the package is pure
        # Python with no CPython extension, so it runs on any Python 3.x ->
        # py3-none-{platform}, not cp3xx-cp3xx-{platform}.
        build_data["pure_python"] = False
        build_data["tag"] = f"py3-none-{self._platform()}"
        self._force_include_docs(build_data)

    def _force_include_docs(self, build_data: dict[str, Any]) -> None:
        for name in _DOC_NAMES:
            build_data["force_include"][str(self._locate_doc(name))] = f"trafilaturacore/{name}"

    def _locate_doc(self, name: str) -> Path:
        for base in _DOC_CANDIDATE_DIRS:
            candidate = base / name
            if candidate.is_file():
                return candidate
        raise FileNotFoundError(
            f"{name} not found in any candidate layout; tried "
            + ", ".join(str(base / name) for base in _DOC_CANDIDATE_DIRS)
        )

    def _platform(self) -> str:
        # CI pins the platform tag per matrix row; locally infer it (auditwheel
        # repair is disabled, so the tag must be correct at build time).
        pinned = os.environ.get("TRAFILATURACORE_WHEEL_PLATFORM")
        if pinned:
            return pinned
        from packaging.tags import sys_tags

        return next(iter(sys_tags())).platform
