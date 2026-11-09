"""Relations between words: shared characters, semantic neighbors, and anchors.

The *anchor* of a word is its parent in the skill tree: the most related word at
a lower level (shared characters, containment, semantic similarity). Anchors
form the outward "threads" from the HSK 1 core.
"""

from __future__ import annotations

import math
from collections import defaultdict

import numpy as np

from .words import Word

ANCHOR_WEIGHTS = {
    "chars": 0.9,  # idf-weighted share of the word's characters found in the candidate
    "contain": 0.35,  # candidate is a substring of the word (学生 -> 大学生)
    "theme": 0.15,  # same region
    "gap": 0.06,  # penalty per extra level of distance (prefer L-1)
}


def char_index(words: list[Word]) -> dict[str, list[int]]:
    idx: dict[str, list[int]] = defaultdict(list)
    for i, w in enumerate(words):
        for ch in w.chars:
            idx[ch].append(i)
    return dict(idx)


def char_idf(words: list[Word], cidx: dict[str, list[int]]) -> dict[str, float]:
    n = len(words)
    return {ch: math.log(n / len(ids)) + 1.0 for ch, ids in cidx.items()}


def semantic_neighbors(emb: np.ndarray, k: int = 8, chunk: int = 1024) -> np.ndarray:
    """Top-k cosine neighbors (excluding self). Ties broken by lower index."""
    n = emb.shape[0]
    out = np.zeros((n, k), dtype=np.int32)
    e = emb.astype(np.float32)
    for s in range(0, n, chunk):
        sims = e[s : s + chunk] @ e.T
        rows = np.arange(sims.shape[0])
        sims[rows, rows + s] = -np.inf
        # stable sort by (-sim, index)
        order = np.argsort(-sims, axis=1, kind="stable")[:, :k]
        out[s : s + chunk] = order
    return out


def anchors(
    words: list[Word], emb: np.ndarray, theme: np.ndarray, chunk: int = 1024
) -> tuple[np.ndarray, np.ndarray]:
    """Return (anchor index or -1, anchor score) for every word."""
    n = len(words)
    levels = np.array([w.level for w in words])
    cidx = char_index(words)
    idf = char_idf(words, cidx)
    W = ANCHOR_WEIGHTS

    anchor = np.full(n, -1, dtype=np.int32)
    score = np.zeros(n, dtype=np.float32)
    e = emb.astype(np.float32)
    for lvl in range(2, 8):
        rows = np.where(levels == lvl)[0]
        cands = np.where(levels < lvl)[0]
        if len(rows) == 0 or len(cands) == 0:
            continue
        cand_pos = {int(c): j for j, c in enumerate(cands)}
        gap = (lvl - levels[cands] - 1).astype(np.float32) * W["gap"]
        for s in range(0, len(rows), chunk):
            block = rows[s : s + chunk]
            total = e[block] @ e[cands].T
            total -= gap[None, :]
            total += (theme[block][:, None] == theme[cands][None, :]) * W["theme"]
            for bi, i in enumerate(block):
                w = words[i]
                denom = sum(idf[ch] for ch in w.chars) or 1.0
                shared: dict[int, float] = defaultdict(float)
                for ch in w.chars:
                    for c in cidx.get(ch, ()):
                        if c in cand_pos:
                            shared[c] += idf[ch] / denom
                for c, sc in shared.items():
                    j = cand_pos[c]
                    total[bi, j] += W["chars"] * sc
                    if words[c].hanzi in w.hanzi:
                        total[bi, j] += W["contain"]
            best = np.argmax(total, axis=1)  # first max -> lowest index on ties
            anchor[block] = cands[best]
            score[block] = total[np.arange(len(block)), best]
    return anchor, score


def children_of(anchor: np.ndarray) -> list[list[int]]:
    kids: list[list[int]] = [[] for _ in range(len(anchor))]
    for i, a in enumerate(anchor.tolist()):
        if a >= 0:
            kids[a].append(i)
    return kids
