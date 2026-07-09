"""snake_case kwargs -> trafilaturacore CLI flags (the single translation boundary).

This module is the one place option keywords become CLI flags, applied
immediately before the subprocess spawn. The flag set is defined by
``buildProgram`` in ``packages/trafilaturacore/src/cli-program.ts`` — keep this
table in sync with it.

There is no proxy / crawl / Apify surface: trafilaturacore is HTML in -> cleaned
HTML out and never touches the network, so the option set is small and there are
no secrets to redact. ``config`` (a temp file) and ``max_input_bytes`` (a size
bound validated before spawn) are handled by the orchestrator (:mod:`._run`), not
by this table — mirroring how contextractor keeps ``storage_dir``/``timeout`` out
of its option map.
"""

from __future__ import annotations

from typing import Literal

from ._errors import TrafilaturacoreError

# The four boilerplate-removal modes (mirrors the JS ``BOILERPLATE_MODES``).
BOILERPLATE_MODES: tuple[str, ...] = (
    "precision",
    "balanced",
    "recall",
    "clean-keep-boilerplate",
)
DEFAULT_BOILERPLATE_MODE = "balanced"
BoilerplateMode = Literal["precision", "balanced", "recall", "clean-keep-boilerplate"]

# 10 MB, mirroring the JS ``DEFAULT_MAX_INPUT_BYTES``. Inputs larger than this
# (or a caller-supplied override) are rejected before spawn — a resource bound.
DEFAULT_MAX_INPUT_BYTES = 10 * 1024 * 1024


def is_boilerplate_mode(value: object) -> bool:
    """Runtime guard: is ``value`` one of the four boilerplate modes?"""
    return isinstance(value, str) and value in BOILERPLATE_MODES


def build_clean_args(
    *,
    boilerplate: str | None = None,
    include_comments: bool | None = None,
    include_tables: bool | None = None,
    include_images: bool | None = None,
    include_links: bool | None = None,
    minify: bool | None = None,
    url: str | None = None,
    config_path: str | None = None,
) -> list[str]:
    """Translate resolved option values into the CLI flag list.

    Pure: no I/O and no temp files (the orchestrator writes any ``config`` temp
    file and passes its path as ``config_path``), so this is fully unit-testable
    offline. ``None`` means "unset" and emits nothing; the CLI's own defaults
    then apply.
    """
    args: list[str] = []
    if boilerplate is not None:
        if not is_boilerplate_mode(boilerplate):
            raise TrafilaturacoreError(
                f"unknown boilerplate mode {boilerplate!r}; "
                f"use one of: {', '.join(BOILERPLATE_MODES)}"
            )
        args += ["-b", boilerplate]
    # Content toggles are negation-only: default keep; only an explicit False
    # subtracts that content family (mirrors the CLI's --no-* options).
    if include_comments is False:
        args.append("--no-comments")
    if include_tables is False:
        args.append("--no-tables")
    if include_images is False:
        args.append("--no-images")
    if include_links is False:
        args.append("--no-links")
    if minify:
        args.append("-m")
    if url is not None:
        args += ["-u", str(url)]
    if config_path is not None:
        args += ["-c", str(config_path)]
    return args
