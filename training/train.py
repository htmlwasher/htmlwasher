# SPDX-License-Identifier: Apache-2.0
"""Train the htmlwasher page-type classifier and export runtime artifacts.

Pipeline (offline, CPU-only, seconds-to-minutes at this scale):

1. Load the WCXB dev split; for each page extract 89 numeric features
   (``extract_features.extract_numeric_features``) and the TF-IDF input text
   (``extract_features.title_meta_text``).
2. Fit ``TfidfVectorizer(max_features=100, ...)`` on the dev texts.
3. Fit ``StandardScaler`` on the 89 numeric (dev only).
4. Assemble the 189-dim matrix ``[scaled_numeric(89) ++ tfidf(100)]``.
5. SMOTE-oversample the minority classes (fallback to ``sample_weight`` if SMOTE
   cannot run on the data — documented at runtime).
6. Train ``XGBClassifier(multi:softprob, 7 classes, hist)``.
7. Export ``model.xgb.json`` (the XGBoost native JSON dump — trees + ``tree_info``
   round-robin class layout + ``default_left`` + ``base_score``; scaling/TF-IDF
   live in the feature code, NOT in the model) and ``tfidf-vocab.json``.
8. Evaluate on the held-out TEST split; print accuracy + per-class P/R/F1 +
   confusion matrix.

Artifacts are written into ``packages/htmlwasher/native/artifacts/`` where a
pure-Rust GBDT evaluator (no onnxruntime) consumes them at inference time.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import numpy as np
import xgboost as xgb
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

from download_wcxb import CLASS_LABELS, LabeledPage, build_index, download
from extract_features import N_NUMERIC, extract_numeric_features, title_meta_text

HERE = Path(__file__).parent
ARTIFACTS_DIR = HERE.parent / "packages" / "htmlwasher" / "native" / "artifacts"
MODEL_OUT = ARTIFACTS_DIR / "model.xgb.json"
VOCAB_OUT = ARTIFACTS_DIR / "tfidf-vocab.json"

N_TFIDF = 100
N_CLASSES = 7
N_FEATURES = N_NUMERIC + N_TFIDF  # 189
RANDOM_STATE = 42

# TF-IDF config (locked into tfidf-vocab.json so the TS runtime reproduces it):
# sklearn default token_pattern drops 1-char tokens; smooth_idf gives the
# nonstandard idf = ln((1+n)/(1+df)) + 1 with L2 normalization.
TOKEN_PATTERN = r"(?u)\b\w\w+\b"
NGRAM_RANGE = (1, 1)
LOWERCASE = True


def _extract_split(pages: list[LabeledPage]) -> tuple[np.ndarray, list[str], list[str]]:
    """Return (numeric matrix [n,89], TF-IDF texts, page-type labels) for ``pages``."""
    numeric: list[list[float]] = []
    texts: list[str] = []
    labels: list[str] = []
    for page in pages:
        html = page.html_path.read_text(encoding="utf-8", errors="replace")
        numeric.append(extract_numeric_features(html, page.url))
        texts.append(title_meta_text(html))
        labels.append(page.page_type)
    return np.asarray(numeric, dtype=np.float64), texts, labels


def _label_indices(labels: list[str]) -> np.ndarray:
    """Map page-type strings to the canonical CLASS_LABELS index order."""
    index = {label: i for i, label in enumerate(CLASS_LABELS)}
    return np.asarray([index[label] for label in labels], dtype=np.int64)


def main() -> None:
    download()
    pages = build_index()
    dev = [p for p in pages if p.split == "dev"]
    test = [p for p in pages if p.split == "test"]
    print(f"Loaded WCXB: {len(dev)} dev pages, {len(test)} test pages")
    print(f"  dev per type:  {dict(Counter(p.page_type for p in dev))}")
    print(f"  test per type: {dict(Counter(p.page_type for p in test))}")

    # --- Feature extraction ---
    dev_numeric, dev_texts, dev_labels = _extract_split(dev)
    test_numeric, test_texts, test_labels = _extract_split(test)

    # --- TF-IDF (fit on dev) ---
    vectorizer = TfidfVectorizer(
        max_features=N_TFIDF,
        smooth_idf=True,
        norm="l2",
        lowercase=LOWERCASE,
        ngram_range=NGRAM_RANGE,
        token_pattern=TOKEN_PATTERN,
    )
    dev_tfidf = vectorizer.fit_transform(dev_texts).toarray()
    test_tfidf = vectorizer.transform(test_texts).toarray()
    vocab_size = len(vectorizer.vocabulary_)
    print(f"TF-IDF vocabulary size: {vocab_size} (cap {N_TFIDF})")

    # The Rust loader (native/src/page_type/model.rs::build_model) HARD-REJECTS any
    # tfidf-vocab.json whose vocabulary length != N_TFIDF, disabling the classifier
    # at load time. A retrain on a small/low-diversity corpus could yield fewer than
    # N_TFIDF unigram terms and would silently ship an unloadable artifact. Fail
    # loudly instead, before spending time training. (Past this guard the TF-IDF
    # matrices always have exactly N_TFIDF columns — no padding step is needed.)
    if vocab_size != N_TFIDF:
        raise ValueError(
            f"TF-IDF vocabulary has {vocab_size} terms, expected exactly {N_TFIDF}. "
            "packages/htmlwasher/native/src/page_type/model.rs rejects a tfidf-vocab.json "
            f"whose vocabulary length != {N_TFIDF}, which would disable the classifier at "
            "load time. Retrain on a larger/more diverse WCXB split so "
            f"TfidfVectorizer(max_features={N_TFIDF}) actually yields {N_TFIDF} terms."
        )

    # --- StandardScaler (fit on dev numeric only) ---
    scaler = StandardScaler()
    dev_numeric_scaled = scaler.fit_transform(dev_numeric)
    test_numeric_scaled = scaler.transform(test_numeric)

    # --- Assemble 189-dim feature matrix: scaled numeric ++ raw TF-IDF ---
    x_dev = np.hstack([dev_numeric_scaled, dev_tfidf]).astype(np.float32)
    x_test = np.hstack([test_numeric_scaled, test_tfidf]).astype(np.float32)
    y_dev = _label_indices(dev_labels)
    y_test = _label_indices(test_labels)
    assert x_dev.shape[1] == N_FEATURES, x_dev.shape

    # --- SMOTE oversampling (fallback to sample_weight) ---
    x_train, y_train, sample_weight, balancing = _balance(x_dev, y_dev)
    print(f"Balancing strategy: {balancing}")
    print(f"  training rows after balancing: {x_train.shape[0]}")

    # --- Train XGBoost ---
    clf = XGBClassifier(
        n_estimators=200,
        max_depth=8,
        objective="multi:softprob",
        num_class=N_CLASSES,
        tree_method="hist",
        random_state=RANDOM_STATE,
        n_jobs=-1,
        eval_metric="mlogloss",
    )
    clf.fit(x_train, y_train, sample_weight=sample_weight)

    # --- Evaluate on the held-out TEST split ---
    _evaluate(clf, x_test, y_test)

    # --- Export the XGBoost native JSON dump + tfidf-vocab.json ---
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    clf.get_booster().save_model(str(MODEL_OUT))
    print(f"Wrote {MODEL_OUT} ({MODEL_OUT.stat().st_size} bytes)")
    _write_vocab(vectorizer, scaler)

    # --- Round-trip the JSON dump: reloaded Booster argmax must match native ---
    _verify_json(clf, x_test)


def _balance(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray | None, str]:
    """SMOTE-oversample; fall back to balanced sample weights if SMOTE fails.

    SMOTE needs ``k_neighbors`` minority samples; we clamp ``k_neighbors`` to the
    smallest class size minus one. If even that is impossible (a class with <2
    members) or SMOTE raises, fall back to per-sample balanced weights and DON'T
    resample.
    """
    counts = Counter(int(c) for c in y)
    smallest = min(counts.values())
    if smallest >= 2:
        try:
            from imblearn.over_sampling import SMOTE

            k = min(5, smallest - 1)
            smote = SMOTE(random_state=RANDOM_STATE, k_neighbors=k)
            x_res, y_res = smote.fit_resample(x, y)
            return x_res, y_res, None, f"SMOTE (k_neighbors={k})"
        except Exception as exc:  # noqa: BLE001 — any SMOTE failure -> documented fallback
            reason = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
            print(f"  SMOTE failed ({reason}); falling back to balanced sample_weight")

    n = len(y)
    weights = np.asarray([n / (N_CLASSES * counts[int(c)]) for c in y], dtype=np.float32)
    return x, y, weights, "balanced sample_weight (SMOTE fallback)"


def _evaluate(clf: XGBClassifier, x_test: np.ndarray, y_test: np.ndarray) -> None:
    """Print accuracy, per-class P/R/F1, macro-F1, and the confusion matrix."""
    y_pred = clf.predict(x_test)
    acc = accuracy_score(y_test, y_pred)
    macro_f1 = f1_score(y_test, y_pred, average="macro")
    print("\n=== TEST split evaluation ===")
    print(f"accuracy: {acc:.4f}    macro-F1: {macro_f1:.4f}")
    print(
        classification_report(
            y_test,
            y_pred,
            labels=list(range(N_CLASSES)),
            target_names=CLASS_LABELS,
            zero_division=0,
            digits=4,
        )
    )
    cm = confusion_matrix(y_test, y_pred, labels=list(range(N_CLASSES)))
    print("confusion matrix (rows = true, cols = pred; CLASS_LABELS order):")
    header = "        " + " ".join(f"{lbl[:5]:>6}" for lbl in CLASS_LABELS)
    print(header)
    for i, row in enumerate(cm):
        print(f"{CLASS_LABELS[i][:7]:>7} " + " ".join(f"{v:>6}" for v in row))


def _write_vocab(vectorizer: TfidfVectorizer, scaler: StandardScaler) -> None:
    """Serialize the locked TF-IDF vocab + IDF and the StandardScaler stats."""
    # vocabulary_ maps term -> column index (0..vocab_size-1); idf_ is aligned to
    # those columns. Pad idf to N_TFIDF (padded columns are unused/zero).
    idf = np.zeros(N_TFIDF, dtype=np.float64)
    idf[: len(vectorizer.idf_)] = vectorizer.idf_
    vocab = {term: int(idx) for term, idx in vectorizer.vocabulary_.items()}

    payload = {
        "vocabulary": vocab,
        "idf": [float(v) for v in idf],
        "numericMean": [float(v) for v in scaler.mean_],
        "numericScale": [float(v) for v in scaler.scale_],
        "classLabels": CLASS_LABELS,
        "nNumeric": N_NUMERIC,
        "nTfidf": N_TFIDF,
        "tokenPattern": TOKEN_PATTERN,
        "ngramRange": list(NGRAM_RANGE),
        "lowercase": LOWERCASE,
    }
    VOCAB_OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {VOCAB_OUT} (vocab terms: {len(vocab)})")


def _verify_json(clf: XGBClassifier, x_test: np.ndarray) -> None:
    """Confirm ``model.xgb.json`` round-trips: a fresh Booster reloaded from the
    dump must reproduce the trained classifier's argmax on TEST (100%)."""
    booster = xgb.Booster()
    booster.load_model(str(MODEL_OUT))
    probs = booster.predict(xgb.DMatrix(x_test))  # (n, 7) for multi:softprob
    reloaded_label = np.asarray(probs).argmax(axis=1)
    native_label = clf.predict(x_test)
    agree = float(np.mean(reloaded_label == native_label))
    print(f"model.xgb.json round-trip argmax agreement on TEST: {agree * 100:.2f}%")
    if agree != 1.0:
        raise AssertionError(f"model.xgb.json round-trip mismatch: {agree * 100:.2f}% (< 100%)")


if __name__ == "__main__":
    main()
