# SPDX-License-Identifier: Apache-2.0
"""Export-pipeline tests: the committed ``model.xgb.json`` round-trips and the
``classifier-parity.json`` crate fixture is well-formed.

These assert exported-artifact metadata (class count, feature counts, per-entry
vector widths) and a Booster reload rather than re-training. They skip gracefully
when the artifacts have not been generated yet (a fresh checkout before the first
``train.py`` run), so the default offline ``pytest`` run stays green either way.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from download_wcxb import CLASS_LABELS

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ARTIFACTS_DIR = REPO_ROOT / "packages" / "htmlwasher" / "native" / "artifacts"
MODEL_PATH = ARTIFACTS_DIR / "model.xgb.json"
VOCAB_PATH = ARTIFACTS_DIR / "tfidf-vocab.json"
PARITY_PATH = (
    REPO_ROOT
    / "packages"
    / "htmlwasher"
    / "native"
    / "tests"
    / "fixtures"
    / "classifier-parity.json"
)

N_NUMERIC = 89
N_TFIDF = 100
N_CLASSES = 7


def _load(path: Path) -> dict | list:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def test_classifier_parity_fixture_shape() -> None:
    # Arrange
    if not PARITY_PATH.exists():
        pytest.skip("classifier-parity.json not generated (run make_parity_fixtures.py)")
    payload = _load(PARITY_PATH)

    # Assert — top-level contract the Cargo parity test relies on.
    assert payload["model"] == "model.xgb.json"
    assert payload["n_numeric"] == N_NUMERIC
    assert payload["n_tfidf"] == N_TFIDF
    assert payload["n_classes"] == N_CLASSES
    assert payload["class_labels"] == CLASS_LABELS
    assert len(payload["fixtures"]) > 0

    # Assert — every entry has 89 numeric + 100 tfidf + a valid argmax/label.
    for fx in payload["fixtures"]:
        assert len(fx["numeric"]) == N_NUMERIC, fx["file"]
        assert len(fx["tfidf"]) == N_TFIDF, fx["file"]
        assert len(fx["probs"]) == N_CLASSES, fx["file"]
        assert 0 <= fx["argmax"] < N_CLASSES, fx["file"]
        assert fx["page_type"] == CLASS_LABELS[fx["argmax"]], fx["file"]
        assert abs(sum(fx["probs"]) - 1.0) < 1e-5, fx["file"]


def test_model_xgb_json_roundtrip() -> None:
    # Arrange — reload the committed native JSON dump into a fresh Booster.
    if not (MODEL_PATH.exists() and PARITY_PATH.exists()):
        pytest.skip("model.xgb.json / classifier-parity.json not generated")
    xgb = pytest.importorskip("xgboost")

    vocab = _load(VOCAB_PATH)
    mean = vocab["numericMean"]
    scale = vocab["numericScale"]
    fixtures = _load(PARITY_PATH)["fixtures"]

    booster = xgb.Booster()
    booster.load_model(str(MODEL_PATH))

    # Act — assemble [scaled_numeric ++ raw tfidf] exactly as the Rust side will,
    # then predict on the small fixture sample.
    for fx in fixtures:
        scaled = [
            (raw - mean[i]) / scale[i] if scale[i] > 0 else 0.0
            for i, raw in enumerate(fx["numeric"])
        ]
        assembled = np.asarray([scaled + fx["tfidf"]], dtype=np.float32)
        probs = booster.predict(xgb.DMatrix(assembled))[0]

        # Assert — the reloaded Booster reproduces each fixture's recorded argmax.
        assert int(np.argmax(probs)) == fx["argmax"], fx["file"]
