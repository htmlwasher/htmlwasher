"""Async example: clean several pages concurrently with ``aclean``.

``aclean`` is the async counterpart of ``clean`` — each call spawns one child
process running the bundled Node CLI. Nothing touches the network.

Run:  python async_example.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import trafilaturacore

SAMPLE = Path(__file__).resolve().parents[1] / "sample.html"


async def main() -> None:
    html = SAMPLE.read_text(encoding="utf-8")

    # Run the four boilerplate modes concurrently.
    results = await asyncio.gather(
        *(trafilaturacore.aclean(html, boilerplate=mode) for mode in trafilaturacore.BOILERPLATE_MODES)
    )
    for mode, result in zip(trafilaturacore.BOILERPLATE_MODES, results, strict=True):
        print(f"{mode}: {len(result.html)} bytes, page_type={result.page_type or '(none)'}")

    # A per-call timeout bounds the child process.
    fast = await trafilaturacore.aclean(html, boilerplate="balanced", timeout=30.0)
    print("balanced page type:", fast.page_type, "confidence:", fast.confidence)


if __name__ == "__main__":
    asyncio.run(main())
