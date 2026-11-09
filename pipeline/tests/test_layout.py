import math

import numpy as np
import pytest

from langmap.layout import MIN_DIST, build_geometry, layout, layout_stats
from langmap.words import Word


@pytest.fixture(scope="module")
def synthetic():
    rng = np.random.default_rng(0)
    k = 4
    words, theme = [], []
    for i in range(600):
        level = 1 + int(rng.integers(0, 10)) % 7
        t = i % k
        words.append(
            Word(
                f"L{level}-{i:04d}",
                f"字{i}",
                "zi",
                level,
                ["N"],
                "",
                ["x"],
                freq=float(rng.random() * 6),
                index=i,
            )
        )
        theme.append(t)
    theme = np.array(theme)
    centers = rng.normal(size=(k, 16))
    emb = centers[theme] + 0.4 * rng.normal(size=(len(words), 16))
    emb /= np.linalg.norm(emb, axis=1, keepdims=True)
    anchor = np.full(len(words), -1)
    for i, w in enumerate(words):
        if w.level > 1:
            cands = [j for j, v in enumerate(words) if v.level < w.level and theme[j] == theme[i]]
            if cands:
                anchor[i] = cands[i % len(cands)]
    neighbors = np.argsort(-(emb @ emb.T), axis=1)[:, 1:9]
    return words, emb.astype(np.float32), theme, anchor, neighbors, k


def test_geometry_bands_increase(synthetic):
    words, _, theme, _, _, k = synthetic
    geo = build_geometry(np.array([w.level for w in words]), theme, k)
    assert np.all(np.diff(geo.radii) > 0)
    assert geo.bounds.shape == (7, k + 1)
    assert np.allclose(geo.bounds[:, -1] - geo.bounds[:, 0], 2 * math.pi)
    assert np.all(np.diff(geo.bounds, axis=1) > 0)


def test_layout_invariants(synthetic):
    words, emb, theme, anchor, neighbors, k = synthetic
    P, geo = layout(words, emb, theme, anchor, neighbors, k)
    P2, _ = layout(words, emb, theme, anchor, neighbors, k)
    assert np.array_equal(P, P2), "layout must be deterministic"
    r = np.hypot(P[:, 0], P[:, 1])
    levels = np.array([w.level for w in words])
    lo, hi = geo.radii[levels - 1], geo.radii[levels]
    assert np.all(r >= lo - 0.05) and np.all(r <= hi + 0.05), "words stay in their level ring"
    stats = layout_stats(P)
    assert stats["min_nn"] > 0.75 * MIN_DIST
