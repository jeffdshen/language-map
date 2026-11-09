"""Zero-shot theme (region) assignment using embedding similarity + POS rules."""

from __future__ import annotations

import json

import numpy as np

from .embed import theme_vectors
from .paths import CONFIG_DIR
from .words import Word

# Content POS that should not land in the grammar region.
_NO_GRAMMAR = {"N", "Adj"}


def load_theme_config(pack: str = "zh-en") -> dict:
    return json.loads((CONFIG_DIR / pack / "themes.json").read_text(encoding="utf-8"))


def assign_themes(
    words: list[Word], emb: np.ndarray, cfg: dict, vecs: dict, refine_iters: int = 2
) -> tuple[np.ndarray, np.ndarray]:
    """Return (theme index per word, N x K similarity matrix of the final centroids)."""
    themes = cfg["themes"]
    keys = [t["key"] for t in themes]
    k_index = {k: i for i, k in enumerate(keys)}
    base = theme_vectors(themes, vecs).astype(np.float64)
    e = emb.astype(np.float64)

    n, k = len(words), len(themes)
    allowed = np.ones((n, k), dtype=bool)
    bias = np.zeros((n, k), dtype=np.float64)
    for i, w in enumerate(words):
        primary = w.pos[0] if w.pos else ""
        rule = cfg["pos_rules"].get(primary)
        if rule:
            allowed[i] = False
            for key in rule:
                allowed[i, k_index[key]] = True
        elif primary in _NO_GRAMMAR:
            allowed[i, k_index["grammar"]] = False
        for key, b in cfg.get("bias", {}).get(primary, {}).items():
            bias[i, k_index[key]] += b

    centroids = base.copy()
    assign = np.zeros(n, dtype=np.int64)
    sims = np.zeros((n, k))
    for it in range(refine_iters + 1):
        sims = e @ centroids.T + bias
        masked = np.where(allowed, sims, -np.inf)
        assign = np.argmax(masked, axis=1)
        if it == refine_iters:
            break
        new = []
        for j in range(k):
            members = e[assign == j]
            c = base[j]
            if len(members):
                m = members.mean(axis=0)
                m /= np.linalg.norm(m) or 1.0
                c = 0.5 * base[j] + 0.5 * m
            new.append(c / (np.linalg.norm(c) or 1.0))
        centroids = np.stack(new)
    return assign, sims
