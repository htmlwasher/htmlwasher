"""trafilaturacore — clean a page's main content from HTML, in Python.

A thin, typed wrapper that drives the bundled trafilaturacore Node CLI:
:func:`clean` (sync) and :func:`aclean` (async) take HTML and return a
:class:`CleanResult` — cleaned HTML, a metadata sidecar, and (unless
``boilerplate='clean-keep-boilerplate'``) a page type and confidence. It is
**offline**: HTML in -> cleaned HTML out; it never fetches the network. Python
loads no JavaScript and no native ``.node`` — Node does, when it runs ``cli.js``.
A self-contained Node runtime ships as a dependency (``nodejs-wheel-binaries``),
so no separate Node.js install is required.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

from ._errors import NodeRuntimeError, TrafilaturacoreError
from ._options import (
    BOILERPLATE_MODES,
    DEFAULT_BOILERPLATE_MODE,
    DEFAULT_MAX_INPUT_BYTES,
    BoilerplateMode,
)
from ._result import CleanResult, Message, Metadata
from ._run import aclean, clean

try:
    __version__ = version("trafilaturacore")
except PackageNotFoundError:  # pragma: no cover - source checkout without install
    __version__ = "0+unknown"

__all__ = [
    "BOILERPLATE_MODES",
    "DEFAULT_BOILERPLATE_MODE",
    "DEFAULT_MAX_INPUT_BYTES",
    "BoilerplateMode",
    "CleanResult",
    "Message",
    "Metadata",
    "NodeRuntimeError",
    "TrafilaturacoreError",
    "__version__",
    "aclean",
    "clean",
]
