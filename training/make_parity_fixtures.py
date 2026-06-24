# SPDX-License-Identifier: Apache-2.0
"""Generate TS↔Python parity fixtures from small WCXB dev pages.

Picks small (<60 KB) dev HTML pages spread across all 7 page types, copies each
to ``htmlwasher/fixtures/classifier/<id>.html``, and writes
``parity.json``: a list of records the TypeScript parity test re-extracts and
compares against (numeric vector, TF-IDF vector, and argmax class).

The TF-IDF vector is computed by transforming each fixture's ``title_meta_text``
through the trained, locked vectorizer (read back from ``tfidf-vocab.json`` is
not needed here — we re-fit-then-transform to mirror exactly what train.py
produced, but to keep this script standalone we load the shipped vocab/idf and
apply sklearn's transform math directly so the fixtures match the runtime).

PARITY CAVEATS the TS side must honor:

- URL is ``https://{domain}/`` only (WCXB ships no full URL), so URL-derived
  features f[0..14] and f[72] see only the bare domain.
- TF-IDF token_pattern / ngram_range / lowercase are recorded in
  ``tfidf-vocab.json``; the TS tokenizer must match them exactly.
- Every ``.len()`` is a UTF-8 byte length (not JS UTF-16 ``.length``).
"""

from __future__ import annotations

import json
import re
import shutil
from collections import defaultdict
from pathlib import Path

import numpy as np

from download_wcxb import CLASS_LABELS, build_index
from extract_features import extract_numeric_features, title_meta_text

HERE = Path(__file__).parent
VOCAB_PATH = HERE / "tfidf-vocab.json"
FIXTURE_DIR = HERE.parent / "htmlwasher" / "fixtures" / "classifier"
PARITY_JSON = FIXTURE_DIR / "parity.json"

MAX_BYTES = 60_000
PER_TYPE = 2  # aim for ~2 small pages per type (~14 total across 7 types)


def _load_vocab() -> dict:
    with VOCAB_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def _tfidf_vector(text: str, vocab: dict) -> list[float]:
    """Reproduce sklearn's TfidfVectorizer.transform for one document.

    Steps: lowercase -> tokenize with the locked token_pattern -> raw term
    counts -> multiply by shipped idf -> L2-normalize the full N_TFIDF vector.
    This is the exact contract the TS runtime implements.
    """
    n_tfidf = vocab["nTfidf"]
    vocabulary = vocab["vocabulary"]
    idf = vocab["idf"]
    pattern = re.compile(vocab["tokenPattern"])

    work = text.lower() if vocab["lowercase"] else text
    counts = np.zeros(n_tfidf, dtype=np.float64)
    for token in pattern.findall(work):
        idx = vocabulary.get(token)
        if idx is not None:
            counts[idx] += 1.0

    weighted = counts * np.asarray(idf, dtype=np.float64)
    norm = np.linalg.norm(weighted)
    if norm > 0:
        weighted = weighted / norm
    return [float(v) for v in weighted]


def _scaled_numeric(numeric: list[float], vocab: dict) -> list[float]:
    """Apply StandardScaler stats from tfidf-vocab.json (scale<=0 -> 0.0)."""
    mean = vocab["numericMean"]
    scale = vocab["numericScale"]
    out = []
    for i, raw in enumerate(numeric):
        out.append((raw - mean[i]) / scale[i] if scale[i] > 0 else 0.0)
    return out


def _onnx_argmax(features_189: list[float]) -> int:
    """Run the exported ONNX model on the assembled 189-vector -> argmax class."""
    import onnxruntime as ort

    sess = ort.InferenceSession(str(HERE / "model.onnx"), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    out = sess.run(None, {input_name: np.asarray([features_189], dtype=np.float32)})
    # out[0] is the predicted label; the model's class order is CLASS_LABELS.
    return int(np.asarray(out[0]).ravel()[0])


def main() -> None:
    vocab = _load_vocab()
    pages = build_index()
    dev = [p for p in pages if p.split == "dev"]

    # Group small dev pages by type.
    by_type: dict[str, list] = defaultdict(list)
    for page in dev:
        size = page.html_path.stat().st_size
        if size <= MAX_BYTES:
            by_type[page.page_type].append((size, page))

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    records = []
    for page_type in CLASS_LABELS:
        candidates = sorted(by_type.get(page_type, []), key=lambda sp: sp[0])
        for _size, page in candidates[:PER_TYPE]:
            html = page.html_path.read_text(encoding="utf-8", errors="replace")
            numeric = extract_numeric_features(html, page.url)
            text = title_meta_text(html)
            tfidf = _tfidf_vector(text, vocab)

            scaled = _scaled_numeric(numeric, vocab)
            assembled = scaled + tfidf
            argmax = _onnx_argmax(assembled)

            dest_name = f"{page.page_id}.html"
            shutil.copy2(page.html_path, FIXTURE_DIR / dest_name)
            records.append(
                {
                    "file": dest_name,
                    "url": page.url,
                    "pageType": page.page_type,
                    "numeric": numeric,
                    "tfidf": tfidf,
                    "argmax": argmax,
                    "argmaxLabel": CLASS_LABELS[argmax],
                }
            )

    PARITY_JSON.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(records)} parity fixtures to {FIXTURE_DIR}")
    print(f"  parity manifest: {PARITY_JSON}")
    by_t = defaultdict(int)
    for r in records:
        by_t[r["pageType"]] += 1
    print(f"  per type: {dict(by_t)}")


if __name__ == "__main__":
    main()
