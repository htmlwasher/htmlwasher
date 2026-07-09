"""Sync example: clean a page's main content from Python.

This is exactly what a PyPI user writes after `pip install trafilaturacore`.
The library drives a bundled Node CLI via subprocess — Python never loads the
native `.node` module, and nothing ever touches the network: HTML in, cleaned
HTML out.

Run:  python main.py
"""

from __future__ import annotations

from pathlib import Path

import trafilaturacore

SAMPLE = Path(__file__).resolve().parents[1] / "sample.html"


def main() -> None:
    html = SAMPLE.read_text(encoding="utf-8")

    print("version:", trafilaturacore.__version__)
    print("modes:", list(trafilaturacore.BOILERPLATE_MODES))
    print("default mode:", trafilaturacore.DEFAULT_BOILERPLATE_MODE)

    # The simplest call: defaults to `balanced` and keeps comments/tables/
    # images/links. Boilerplate (nav, sidebar, footer) is dropped.
    result = trafilaturacore.clean(html)
    print("cleaned html length:", len(result.html))
    print("page type:", result.page_type, "confidence:", result.confidence)
    if result.metadata is not None:
        print("title:", result.metadata.title, "| author:", result.metadata.author)
    for message in result.messages:
        print(f"[{message.type}] {message.text}")

    # The four boilerplate modes. `clean-keep-boilerplate` skips main-content
    # extraction entirely (HTML cleanup only) and reports no page type.
    for mode in trafilaturacore.BOILERPLATE_MODES:
        r = trafilaturacore.clean(html, boilerplate=mode)
        print(f"{mode}: {len(r.html)} bytes, page_type={r.page_type or '(none)'}")

    # Tri-state content toggles are snake_case keyword arguments; each defaults
    # to keep, and an explicit False subtracts that content family.
    # `include_comments` is accepted but is a soft no-op.
    lean = trafilaturacore.clean(
        html, include_images=False, include_links=False, include_tables=False
    )
    print("lean has <img>?", "<img" in lean.html)
    print("lean has <a href>?", "<a href" in lean.html)

    # Minify instead of pretty-printing.
    print("minified length:", len(trafilaturacore.clean(html, minify=True).html))

    # `url` is context only (classifier heuristics + metadata) — NEVER fetched.
    with_url = trafilaturacore.clean(html, url="https://example.com/blog/post")
    if with_url.metadata is not None:
        print("metadata url:", with_url.metadata.url)

    # A custom cleaning config (plain JSON data) REPLACES the default config.
    # The unconditional security floor still applies: <script>, on* handlers,
    # and dangerous URL schemes are always stripped.
    custom = trafilaturacore.clean(
        html,
        config={
            "allowedTags": ["h1", "h2", "p", "a", "strong", "em"],
            "allowedAttributes": {"a": ["href"]},
        },
    )
    print("custom-config length:", len(custom.html))

    # Boundary guards raise rather than silently degrading.
    try:
        trafilaturacore.clean(html, max_input_bytes=10)
    except trafilaturacore.TrafilaturacoreError as error:
        print("oversized input rejected:", type(error).__name__)


if __name__ == "__main__":
    main()
