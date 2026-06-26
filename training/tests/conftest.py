# SPDX-License-Identifier: Apache-2.0
"""Shared pytest fixtures and path setup for the training tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make the training modules importable without packaging the project.
TRAINING_DIR = Path(__file__).resolve().parent.parent
if str(TRAINING_DIR) not in sys.path:
    sys.path.insert(0, str(TRAINING_DIR))


@pytest.fixture
def tiny_html() -> str:
    """A small, hand-checked HTML snippet with known feature values.

    Hand-derived expectations (UTF-8 byte lengths throughout):

    - Two ``<p>`` elements; both trimmed byte-lengths > 20  -> f[14] = 2.
    - Three headings (h1, h2, h2)                            -> f[16] = 3.
    - One ``<article>``                                      -> f[18] = 1.
    - JSON-LD contains ``"NewsArticle"``                     -> f[23] = 1.
    - Two ``$`` plus one ``€`` in body text                 -> f[65] = 3.
    """
    return (
        "<!DOCTYPE html><html><head>"
        "<title>Hand Checked Page</title>"
        '<meta name="description" content="A tiny fixture.">'
        '<script type="application/ld+json">{"@type":"NewsArticle"}</script>'
        "</head><body>"
        "<article>"
        "<h1>Heading One</h1><h2>Sub A</h2><h2>Sub B</h2>"
        "<p>This paragraph is comfortably longer than twenty bytes.</p>"
        "<p>Second paragraph also exceeds the twenty byte threshold.</p>"
        "<span>Prices: $10 and $20 and €5</span>"
        "</article>"
        "</body></html>"
    )
