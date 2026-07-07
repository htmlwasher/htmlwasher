# SPDX-License-Identifier: Apache-2.0
"""Generate the Rust↔Python classifier parity fixture for the native crate.

Reads every committed HTML fixture under
``packages/htmlwasher/fixtures/classifier/*.html`` and emits ONE self-consistent
JSON at ``packages/htmlwasher/native/tests/fixtures/classifier-parity.json`` that
the Cargo parity test consumes. For each fixture we record, computed with the
exact feature/tfidf/scaler code the model was trained with:

- ``numeric`` — the 89 RAW (unscaled) numeric features from ``extract_features``.
- ``tfidf`` — the 100 RAW, L2-normalized TF-IDF features (sklearn transform math).
- ``argmax`` / ``page_type`` / ``probs`` — from the trained ``model.xgb.json``
  Booster run on the assembled 189-vector ``[scaled_numeric ++ tfidf]``.

The Rust side re-extracts raw numeric + tfidf (compares to ``numeric``/``tfidf``
within 1e-6), applies the StandardScaler baked into ``tfidf-vocab.json``, feeds
the 189-vector to its pure-Rust GBDT evaluator, and asserts argmax == ``argmax``
(100%) with ``probs`` within tolerance.

The per-fixture ``url`` and ground-truth ``page_type`` are read from the v1
``parity.json`` manifest (the dataset ships only a domain), so this script runs
fully offline without the WCXB download. The v1 ``parity.json`` and the shipped
ONNX artifacts are left untouched — this only writes the new crate fixture.

PARITY CAVEATS the Rust side must honor:

- ``url`` is domain-only for WCXB pages, so URL-derived features f[0..14] and
  f[72] see only the bare domain — use the same per-fixture ``url``.
- TF-IDF token_pattern / ngram_range / lowercase are recorded in
  ``tfidf-vocab.json``; the Rust tokenizer must match them exactly.
- Every ``.len()`` is a UTF-8 byte length (not a code-point count).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import xgboost as xgb

from download_wcxb import CLASS_LABELS
from extract_features import N_NUMERIC, extract_numeric_features, title_meta_text

HERE = Path(__file__).parent
REPO_ROOT = HERE.parent
ARTIFACTS_DIR = REPO_ROOT / "packages" / "htmlwasher" / "native" / "artifacts"
MODEL_PATH = ARTIFACTS_DIR / "model.xgb.json"
VOCAB_PATH = ARTIFACTS_DIR / "tfidf-vocab.json"

FIXTURE_SRC_DIR = REPO_ROOT / "packages" / "htmlwasher" / "fixtures" / "classifier"
V1_MANIFEST = FIXTURE_SRC_DIR / "parity.json"

FIXTURE_OUT_DIR = REPO_ROOT / "packages" / "htmlwasher" / "native" / "tests" / "fixtures"
PARITY_OUT = FIXTURE_OUT_DIR / "classifier-parity.json"

N_TFIDF = 100
N_CLASSES = len(CLASS_LABELS)


def _load_json_object(path: Path) -> dict[str, Any]:
    """Load a JSON file expected to contain a top-level object."""
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise TypeError(f"{path} must contain a JSON object, got {type(data).__name__}")
    return data


def _load_json_array(path: Path) -> list[dict[str, Any]]:
    """Load a JSON file expected to contain a top-level array of objects."""
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise TypeError(f"{path} must contain a JSON array, got {type(data).__name__}")
    return data


def _tfidf_vector(text: str, vocab: dict[str, Any]) -> list[float]:
    """Reproduce sklearn's ``TfidfVectorizer.transform`` for one document.

    Steps: lowercase -> tokenize with the locked token_pattern -> raw term
    counts -> multiply by shipped idf -> L2-normalize the full N_TFIDF vector.
    This is the exact contract the Rust runtime implements.
    """
    vocabulary = vocab["vocabulary"]
    idf = vocab["idf"]
    pattern = re.compile(vocab["tokenPattern"])

    work = text.lower() if vocab["lowercase"] else text
    counts = np.zeros(vocab["nTfidf"], dtype=np.float64)
    for token in pattern.findall(work):
        idx = vocabulary.get(token)
        if idx is not None:
            counts[idx] += 1.0

    weighted = counts * np.asarray(idf, dtype=np.float64)
    norm = np.linalg.norm(weighted)
    if norm > 0:
        weighted = weighted / norm
    return [float(v) for v in weighted]


def _scaled_numeric(numeric: list[float], vocab: dict[str, Any]) -> list[float]:
    """Apply the baked StandardScaler stats (``scale<=0 -> 0.0``)."""
    mean = vocab["numericMean"]
    scale = vocab["numericScale"]
    return [(raw - mean[i]) / scale[i] if scale[i] > 0 else 0.0 for i, raw in enumerate(numeric)]


def _fixture_url_types() -> dict[str, tuple[str, str]]:
    """Map ``file -> (url, page_type)`` from the committed v1 parity manifest."""
    manifest = _load_json_array(V1_MANIFEST)
    return {r["file"]: (r["url"], r["pageType"]) for r in manifest}


def main() -> None:
    vocab = _load_json_object(VOCAB_PATH)
    url_types = _fixture_url_types()

    booster = xgb.Booster()
    booster.load_model(str(MODEL_PATH))

    fixtures = []
    for html_path in sorted(FIXTURE_SRC_DIR.glob("*.html")):
        file = html_path.name
        if file not in url_types:
            raise KeyError(f"{file} has no url/page_type entry in {V1_MANIFEST}")
        # Only the url is needed for feature extraction; page_type here would be
        # the ground-truth label — we instead record the model's PREDICTED label.
        url = url_types[file][0]

        html = html_path.read_text(encoding="utf-8", errors="replace")
        numeric = extract_numeric_features(html, url)
        tfidf = _tfidf_vector(title_meta_text(html), vocab)
        assembled = _scaled_numeric(numeric, vocab) + tfidf

        probs = booster.predict(xgb.DMatrix(np.asarray([assembled], dtype=np.float32)))[0]
        argmax = int(np.argmax(probs))
        fixtures.append(
            {
                "file": file,
                "url": url,
                "numeric": numeric,
                "tfidf": tfidf,
                "argmax": argmax,
                "page_type": CLASS_LABELS[argmax],
                "probs": [float(p) for p in probs],
            }
        )

    payload = {
        "model": MODEL_PATH.name,
        "n_numeric": N_NUMERIC,
        "n_tfidf": N_TFIDF,
        "n_classes": N_CLASSES,
        "class_labels": CLASS_LABELS,
        "fixtures": fixtures,
    }
    FIXTURE_OUT_DIR.mkdir(parents=True, exist_ok=True)
    PARITY_OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(fixtures)} parity fixtures to {PARITY_OUT}")
    by_pred: dict[str, int] = {}
    for fx in fixtures:
        by_pred[fx["page_type"]] = by_pred.get(fx["page_type"], 0) + 1
    print(f"  predicted-type histogram: {by_pred}")


if __name__ == "__main__":
    main()
