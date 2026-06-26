# SPDX-License-Identifier: Apache-2.0
"""Fetch the WCXB dataset and build a labeled page index.

WCXB = Web Content Extraction Benchmark (Hugging Face
``murrough-foley/web-content-extraction-benchmark``; Zenodo DOI
10.5281/zenodo.19316874). Licensed CC-BY-4.0 — attribution required.

The dataset is large; it is ``.gitignore``d under ``data/`` and downloaded on
demand. This script is idempotent: ``snapshot_download`` re-uses the local cache
and only fetches missing/changed files.

The labeled index comes from ``metadata.json``'s ``files`` dict::

    {"0001": {"split": "dev"|"test", "page_type": <one of 7>,
              "domain": ..., "spa": bool}, ...}

HTML lives at ``<split>/html/NNNN.html``. The dataset ships only a ``domain``
(not a full URL), so downstream feature extraction uses ``https://{domain}/`` as
the source URL — a documented parity caveat (URL-derived features f[0..14] and
f[72] see only the bare domain).
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path

from huggingface_hub import hf_hub_download
from huggingface_hub.errors import EntryNotFoundError, HfHubHTTPError

REPO_ID = "murrough-foley/web-content-extraction-benchmark"
DATA_DIR = Path(__file__).parent / "data" / "wcxb"

# The dataset is thousands of small files; HF rate-limits anonymous IPs that fan
# out aggressively, so we fetch sequentially (one ``hf_hub_download`` per file)
# with gentle pacing and per-file retry. Already-present files are skipped, so a
# rate-limited run resumes cheaply. A HF_TOKEN in the environment (never logged)
# raises the limit considerably and makes this far faster.
_MAX_RETRIES = int(os.environ.get("WCXB_MAX_RETRIES", "10"))
_PACING_SECONDS = float(os.environ.get("WCXB_PACING_SECONDS", "0.05"))

# Canonical 7-type label order from metadata.json "page_types" — the model class
# order. Do NOT reorder; the TS runtime maps argmax -> this list.
CLASS_LABELS = [
    "article",
    "forum",
    "product",
    "collection",
    "listing",
    "documentation",
    "service",
]


@dataclass(frozen=True)
class LabeledPage:
    """One labeled WCXB page."""

    page_id: str
    split: str
    page_type: str
    domain: str
    spa: bool
    html_path: Path

    @property
    def url(self) -> str:
        """Source URL used for URL-derived features (domain-only, see module doc)."""
        return f"https://{self.domain}/"


def _fetch_one(filename: str, local_dir: Path) -> Path:
    """Download a single repo file into ``local_dir`` with retry/backoff on 429.

    Idempotent: ``hf_hub_download`` returns the cached path without a network
    round-trip when the file already exists locally and is unchanged.
    """
    delay = 5.0
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            return Path(
                hf_hub_download(
                    repo_id=REPO_ID,
                    repo_type="dataset",
                    filename=filename,
                    local_dir=str(local_dir),
                )
            )
        except HfHubHTTPError as exc:
            if "429" not in str(exc) or attempt == _MAX_RETRIES:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 120.0)
    raise RuntimeError(f"unreachable retry exhaustion for {filename}")


def load_metadata(local_dir: Path = DATA_DIR) -> dict:
    """Parse ``metadata.json`` (downloads first if missing)."""
    local_dir.mkdir(parents=True, exist_ok=True)
    meta_path = local_dir / "metadata.json"
    if not meta_path.exists():
        _fetch_one("metadata.json", local_dir)
    with meta_path.open(encoding="utf-8") as fh:
        return json.load(fh)


def download(local_dir: Path = DATA_DIR) -> Path:
    """Fetch ``metadata.json`` and every labeled HTML file, sequentially.

    Resumes cheaply: already-present files are skipped after a quick existence
    check, so re-running after a rate-limit interruption only fetches the
    remainder. Logs progress every 100 files (no secrets in logs).
    """
    local_dir.mkdir(parents=True, exist_ok=True)
    metadata = load_metadata(local_dir)
    entries = sorted(metadata["files"].items())
    total = len(entries)
    fetched = 0
    for idx, (page_id, entry) in enumerate(entries, start=1):
        rel = f"{entry['split']}/html/{page_id}.html"
        dest = local_dir / rel
        if dest.exists():
            continue
        try:
            _fetch_one(rel, local_dir)
        except EntryNotFoundError:
            # Labeled in metadata but no HTML file on the Hub — skip; build_index
            # only keeps pages whose HTML is actually present.
            continue
        fetched += 1
        if _PACING_SECONDS > 0:
            time.sleep(_PACING_SECONDS)
        if idx % 100 == 0 or idx == total:
            print(f"  {idx}/{total} processed ({fetched} newly fetched)")
    print(f"Download complete: {fetched} files fetched, {total - fetched} already cached")
    return local_dir


def build_index(local_dir: Path = DATA_DIR) -> list[LabeledPage]:
    """Build the labeled index, keeping only entries with an existing HTML file."""
    metadata = load_metadata(local_dir)
    page_types = metadata.get("page_types")
    if page_types != CLASS_LABELS:
        raise ValueError(
            f"metadata.json page_types {page_types} != expected {CLASS_LABELS}; "
            "the class order contract changed — investigate before training."
        )

    pages: list[LabeledPage] = []
    for page_id, entry in metadata["files"].items():
        split = entry["split"]
        html_path = local_dir / split / "html" / f"{page_id}.html"
        if not html_path.exists():
            continue
        pages.append(
            LabeledPage(
                page_id=page_id,
                split=split,
                page_type=entry["page_type"],
                domain=entry["domain"],
                spa=bool(entry.get("spa", False)),
                html_path=html_path,
            )
        )
    return pages


def main() -> None:
    from collections import Counter

    local_dir = download()
    pages = build_index(local_dir)
    by_split = Counter(p.split for p in pages)
    print(f"WCXB downloaded to {local_dir}")
    print(f"Labeled pages with HTML present: {len(pages)}")
    for split in ("dev", "test"):
        split_pages = [p for p in pages if p.split == split]
        by_type = Counter(p.page_type for p in split_pages)
        ordered = {t: by_type.get(t, 0) for t in CLASS_LABELS}
        print(f"  {split}: {by_split.get(split, 0)} pages  {ordered}")


if __name__ == "__main__":
    main()
