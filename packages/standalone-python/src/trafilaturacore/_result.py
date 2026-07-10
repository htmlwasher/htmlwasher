"""Parse the CLI's ``--json`` payload into a typed :class:`CleanResult`.

The ``trafilaturacore --json`` output is a JSON object with ``html``,
``messages``, and (when boilerplate removal ran) ``metadata``, ``pageType`` and
``confidence``. ``JSON.stringify`` omits undefined-valued keys, so the last three
may be absent (e.g. under ``boilerplate='keep'``).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ._errors import TrafilaturacoreError

# The metadata sidecar is passed through verbatim (JSON keys exactly as the
# engine's metadata stage emits them) so a new field never needs a wrapper change.
Metadata = dict[str, Any]


@dataclass(frozen=True)
class Message:
    """A non-fatal diagnostic accumulated while cleaning."""

    type: str  # "info" | "warning" | "error"
    text: str


@dataclass(frozen=True)
class CleanResult:
    """The result of :func:`trafilaturacore.clean`.

    ``page_type`` and ``confidence`` are ``None`` when boilerplate removal did not
    run (``boilerplate='keep'``). ``metadata`` is ``None`` when
    the engine resolved no metadata.
    """

    html: str
    messages: list[Message]
    metadata: Metadata | None = None
    page_type: str | None = None
    confidence: float | None = None


def parse_result(stdout: str) -> CleanResult:
    """Parse the CLI's ``--json`` stdout into a :class:`CleanResult`."""
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise TrafilaturacoreError("trafilaturacore emitted malformed JSON output") from exc
    if not isinstance(data, dict):
        raise TrafilaturacoreError("trafilaturacore JSON output was not an object")

    raw_messages = data.get("messages") or []
    messages = [
        Message(type=str(item.get("type", "")), text=str(item.get("text", "")))
        for item in raw_messages
        if isinstance(item, dict)
    ]

    metadata = data.get("metadata")
    page_type = data.get("pageType")
    confidence = data.get("confidence")
    return CleanResult(
        html=str(data.get("html", "")),
        messages=messages,
        metadata=metadata if isinstance(metadata, dict) else None,
        page_type=page_type if isinstance(page_type, str) else None,
        confidence=(
            float(confidence)
            if isinstance(confidence, (int, float)) and not isinstance(confidence, bool)
            else None
        ),
    )
