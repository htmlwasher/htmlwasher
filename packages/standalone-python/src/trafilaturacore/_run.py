"""Drive the bundled trafilaturacore Node CLI: HTML in (stdin) -> JSON out (stdout).

One child process per call: ``node dist/cli.js --json <flags>`` with the input
HTML on stdin. No network, no crawl, no manifest — trafilaturacore is HTML in ->
cleaned HTML out. Python loads no JavaScript and no native ``.node``; Node does,
when it runs ``cli.js``. See packages/standalone-python/SPEC.md.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import tempfile
from collections.abc import Iterator, Mapping
from contextlib import contextmanager, suppress
from typing import Any

from ._errors import TrafilaturacoreError
from ._options import DEFAULT_MAX_INPUT_BYTES, BoilerplateMode, build_clean_args
from ._result import CleanResult, parse_result
from ._runtime import cli_js, resolve_node, vendor_cli_dir


def _validate_input(html: str, max_input_bytes: int | None) -> bytes:
    """Validate + UTF-8 encode the input HTML, enforcing the size bound."""
    if not isinstance(html, str):
        raise TrafilaturacoreError("html must be a string")
    if not html:
        raise TrafilaturacoreError("no HTML provided")
    encoded = html.encode("utf-8")
    limit = DEFAULT_MAX_INPUT_BYTES if max_input_bytes is None else int(max_input_bytes)
    if len(encoded) > limit:
        raise TrafilaturacoreError(
            f"input HTML is {len(encoded)} bytes, over the {limit}-byte limit "
            "(raise max_input_bytes to process larger documents)"
        )
    return encoded


@contextmanager
def _config_file(config: Mapping[str, Any] | None) -> Iterator[str | None]:
    """Serialize a custom cleaning config to a temp JSON file for ``-c``.

    Yields ``None`` when no config is given, else the temp file path. The file is
    removed after the run. The CLI does the deep structural validation of the
    config (and exits 1 with a clear message on a bad one); this only checks the
    top-level type before spawn.
    """
    if config is None:
        yield None
        return
    if not isinstance(config, Mapping):
        raise TrafilaturacoreError("config must be a mapping/dict")
    fd, path = tempfile.mkstemp(prefix="trafilaturacore-config-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(dict(config), handle)
        yield path
    finally:
        with suppress(OSError):
            os.unlink(path)


def _check(code: int | None, stderr: str) -> None:
    """Raise on a non-zero CLI exit. The CLI returns 0 (success) or 1 (handled)."""
    if code != 0:
        detail = (stderr or "").strip()
        suffix = f": {detail}" if detail else ""
        raise TrafilaturacoreError(f"trafilaturacore CLI failed (exit {code}){suffix}")


def clean(
    html: str,
    *,
    boilerplate: BoilerplateMode | None = None,
    include_comments: bool | None = None,
    include_tables: bool | None = None,
    include_images: bool | None = None,
    include_links: bool | None = None,
    minify: bool | None = None,
    url: str | None = None,
    config: Mapping[str, Any] | None = None,
    max_input_bytes: int | None = None,
    timeout: float | None = None,
) -> CleanResult:
    """Clean a page's main content from ``html`` and return a :class:`CleanResult`.

    Mirrors the npm library's ``clean()``: HTML in -> cleaned HTML out, plus a
    metadata sidecar and (unless ``boilerplate='clean-keep-boilerplate'``) a page
    type and confidence. It is **offline** — the ``url`` is context only for the
    classifier/metadata and is never fetched.

    - ``boilerplate`` — one of ``precision`` / ``balanced`` (default) / ``recall``
      / ``clean-keep-boilerplate``.
    - ``include_comments`` / ``include_tables`` / ``include_images`` /
      ``include_links`` — tri-state, default keep; pass ``False`` to drop that
      content family. (``include_comments`` is a soft no-op — comment retention is
      decided by the page-type profile — accepted for parity.)
    - ``config`` — a fully-custom cleaning config (a dict), written to a temp file
      and passed as ``--config``; replaces the default Trafilatura-aligned config.
    - ``minify`` — minify the output instead of pretty-formatting it.
    - ``max_input_bytes`` — reject inputs larger than this many UTF-8 bytes
      (default 10 MB) before spawn.

    Raises :class:`TrafilaturacoreError` on invalid input/options or a CLI failure.
    """
    stdin = _validate_input(html, max_input_bytes)
    with _config_file(config) as config_path:
        flags = build_clean_args(
            boilerplate=boilerplate,
            include_comments=include_comments,
            include_tables=include_tables,
            include_images=include_images,
            include_links=include_links,
            minify=minify,
            url=url,
            config_path=config_path,
        )
        with vendor_cli_dir() as cli_dir:
            argv = [resolve_node(), str(cli_js(cli_dir)), "--json", *flags]
            code, out, err = _run_sync(argv, stdin, timeout)
            _check(code, err)
            return parse_result(out)


async def aclean(
    html: str,
    *,
    boilerplate: BoilerplateMode | None = None,
    include_comments: bool | None = None,
    include_tables: bool | None = None,
    include_images: bool | None = None,
    include_links: bool | None = None,
    minify: bool | None = None,
    url: str | None = None,
    config: Mapping[str, Any] | None = None,
    max_input_bytes: int | None = None,
    timeout: float | None = None,
) -> CleanResult:
    """Async counterpart of :func:`clean` (one child process)."""
    stdin = _validate_input(html, max_input_bytes)
    with _config_file(config) as config_path:
        flags = build_clean_args(
            boilerplate=boilerplate,
            include_comments=include_comments,
            include_tables=include_tables,
            include_images=include_images,
            include_links=include_links,
            minify=minify,
            url=url,
            config_path=config_path,
        )
        with vendor_cli_dir() as cli_dir:
            argv = [resolve_node(), str(cli_js(cli_dir)), "--json", *flags]
            code, out, err = await _run_async(argv, stdin, timeout)
            _check(code, err)
            return parse_result(out)


def _run_sync(argv: list[str], stdin: bytes, timeout: float | None) -> tuple[int | None, str, str]:
    """Run one child process; capture bytes, decode UTF-8 with ``errors="replace"``.

    Capturing bytes (no ``text=True``) avoids the locale codec (mojibake /
    ``UnicodeDecodeError`` on Windows cp1252/cp932) and universal-newline
    translation.
    """
    try:
        proc = subprocess.run(argv, input=stdin, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise TrafilaturacoreError("trafilaturacore timed out") from None
    return (
        proc.returncode,
        proc.stdout.decode(errors="replace"),
        proc.stderr.decode(errors="replace"),
    )


async def _run_async(
    argv: list[str], stdin: bytes, timeout: float | None
) -> tuple[int | None, str, str]:
    """Async mirror of :func:`_run_sync` (Python 3.9-safe: ``asyncio.wait_for``)."""
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(stdin), timeout)
    except asyncio.TimeoutError:
        raise TrafilaturacoreError("trafilaturacore timed out") from None
    finally:
        # Reap the child whenever communicate() did not finish — timeout or
        # cancellation of the surrounding task — so Node is never orphaned.
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
    return proc.returncode, out.decode(errors="replace"), err.decode(errors="replace")
