# SPDX-License-Identifier: Apache-2.0
"""TF-IDF determinism and sklearn-config tests (offline, no dataset)."""

from __future__ import annotations

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

# Mirror the locked config in train.py.
TOKEN_PATTERN = r"(?u)\b\w\w+\b"


def _make_vectorizer() -> TfidfVectorizer:
    return TfidfVectorizer(
        max_features=100,
        smooth_idf=True,
        norm="l2",
        lowercase=True,
        ngram_range=(1, 1),
        token_pattern=TOKEN_PATTERN,
    )


def test_tfidf_fit_is_deterministic() -> None:
    # Arrange
    docs = [
        "best coffee makers review guide",
        "forum thread reply latest post",
        "product price buy cart checkout",
        "api reference function parameter docs",
    ]

    # Act — fit twice on identical input.
    v1 = _make_vectorizer().fit(docs)
    v2 = _make_vectorizer().fit(docs)

    # Assert — identical vocabulary and identical IDF weights.
    assert v1.vocabulary_ == v2.vocabulary_
    np.testing.assert_array_equal(v1.idf_, v2.idf_)


def test_tfidf_smooth_idf_formula() -> None:
    # Arrange — two docs; "coffee" appears in 1 of 2 (df=1), "the" filtered by
    # token_pattern only if 1-char; use real words. n=2.
    docs = ["coffee guide", "coffee shop guide"]
    vec = _make_vectorizer().fit(docs)

    # Assert — sklearn smooth_idf: idf = ln((1+n)/(1+df)) + 1.
    n = len(docs)
    df_coffee = 2  # appears in both docs
    expected_coffee = np.log((1 + n) / (1 + df_coffee)) + 1
    idx = vec.vocabulary_["coffee"]
    assert abs(vec.idf_[idx] - expected_coffee) < 1e-12


def test_tfidf_output_is_l2_normalized() -> None:
    # Arrange
    docs = ["price buy cart", "article author published"]
    vec = _make_vectorizer().fit(docs)

    # Act
    matrix = vec.transform(docs).toarray()

    # Assert — each non-empty row has unit L2 norm.
    norms = np.linalg.norm(matrix, axis=1)
    for norm in norms:
        assert abs(norm - 1.0) < 1e-9


def test_token_pattern_drops_single_char_tokens() -> None:
    # Arrange — "a" and "x" are single-char and dropped by the default pattern.
    docs = ["a coffee x guide", "a coffee guide"]
    vec = _make_vectorizer().fit(docs)

    # Assert — single-char tokens are absent from the vocabulary.
    assert "a" not in vec.vocabulary_
    assert "x" not in vec.vocabulary_
    assert "coffee" in vec.vocabulary_
