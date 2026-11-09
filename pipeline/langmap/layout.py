"""Deterministic radial layout.

World model:
- HSK level -> radial band (HSK 1 core in the middle, 7–9 at the frontier).
  Band radii are chosen from word counts so density stays roughly even.
- Theme -> angular sector. Sector widths are computed per band from that band's
  theme counts and interpolated by radius, so borders curve organically.
- Within a sector, a 1-D spectral ordering of the theme's semantic graph gives
  each word a preferred angle (similar sub-topics line up radially), blended
  with its anchor's angle so threads run outward.
- A fixed-iteration relaxation (anchor/neighbor springs + collision removal +
  projection back into band/sector) produces final positions.

No randomness besides a hash of the word id; same inputs -> same map.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

import numpy as np
from scipy.linalg import eigh
from scipy.spatial import cKDTree

from .words import Word

LAYOUT_VERSION = 1

AREA_PER_WORD = {1: 3.4, 2: 3.0, 3: 2.6, 4: 2.4, 5: 2.2, 6: 2.1, 7: 1.9}
CORE_RADIUS = 5.0
MIN_DIST = 1.0
SECTOR_BLEND = 0.5  # blend per-band theme share with the global share
START_ANGLE = -math.pi / 2  # first theme centered at the top (screen y grows down)


@dataclass
class Geometry:
    radii: np.ndarray  # (8,) band edges: radii[0]=core, radii[L]=outer edge of level L
    mids: np.ndarray  # (7,) band mid radii
    bounds: np.ndarray  # (7, K+1) cumulative sector boundary angles per band
    theta0: float

    def band(self, level: int) -> tuple[float, float]:
        return float(self.radii[level - 1]), float(self.radii[level])

    def sector_bounds(self, r: np.ndarray, theme: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Interpolated [lo, hi] angle (unwrapped, >= theta0) for each (r, theme)."""
        lo = np.empty(len(r))
        hi = np.empty(len(r))
        for t in np.unique(theme):
            m = theme == t
            lo[m] = np.interp(r[m], self.mids, self.bounds[:, t])
            hi[m] = np.interp(r[m], self.mids, self.bounds[:, t + 1])
        return lo, hi


def _hash01(s: str, salt: str = "") -> float:
    h = hashlib.sha256((salt + s).encode("utf-8")).digest()
    return int.from_bytes(h[:8], "big") / 2**64


def build_geometry(levels: np.ndarray, theme: np.ndarray, k: int) -> Geometry:
    radii = [CORE_RADIUS]
    for lvl in range(1, 8):
        area = float(np.sum(levels == lvl)) * AREA_PER_WORD[lvl]
        radii.append(math.sqrt(radii[-1] ** 2 + area / math.pi))
    radii_arr = np.array(radii)
    mids = (radii_arr[:-1] + radii_arr[1:]) / 2

    global_share = np.array([np.sum(theme == t) for t in range(k)], dtype=np.float64)
    global_share /= global_share.sum()
    bounds = np.zeros((7, k + 1))
    for li, lvl in enumerate(range(1, 8)):
        m = levels == lvl
        share = np.array([np.sum(theme[m] == t) for t in range(k)], dtype=np.float64)
        share /= max(share.sum(), 1.0)
        share = (share + SECTOR_BLEND * global_share) / (1 + SECTOR_BLEND)
        bounds[li, 1:] = np.cumsum(share) * 2 * math.pi
    # Center the first theme at START_ANGLE in the innermost band.
    theta0 = START_ANGLE - bounds[0, 1] / 2
    return Geometry(radii=radii_arr, mids=mids, bounds=bounds + theta0, theta0=theta0)


def spectral_order(emb: np.ndarray, knn: int = 10) -> np.ndarray:
    """Rank-normalized Fiedler-vector position in [0, 1] for each row."""
    n = emb.shape[0]
    if n <= 2:
        return np.linspace(0.25, 0.75, n) if n else np.zeros(0)
    e = emb.astype(np.float64)
    sims = e @ e.T
    np.fill_diagonal(sims, -np.inf)
    kk = min(knn, n - 1)
    nbrs = np.argsort(-sims, axis=1, kind="stable")[:, :kk]
    A = np.zeros((n, n))
    rows = np.repeat(np.arange(n), kk)
    vals = np.maximum(sims[rows, nbrs.ravel()], 0.0) + 1e-3
    A[rows, nbrs.ravel()] = vals
    A = np.maximum(A, A.T)
    deg = A.sum(axis=1)
    L = np.diag(deg) - A
    # Normalized Laplacian for balance; small ridge keeps disconnected parts stable.
    d = 1.0 / np.sqrt(np.maximum(deg, 1e-9))
    Ln = d[:, None] * L * d[None, :] + 1e-9 * np.eye(n)
    _, vecs = eigh(Ln, subset_by_index=[1, 1])
    f = vecs[:, 0] * d
    if f[np.argmax(np.abs(f))] < 0:  # deterministic sign
        f = -f
    order = np.lexsort((np.arange(n), f))
    ranks = np.empty(n)
    ranks[order] = (np.arange(n) + 0.5) / n
    return ranks


def _unwrap(theta: np.ndarray, theta0: float) -> np.ndarray:
    return theta0 + np.mod(theta - theta0, 2 * math.pi)


def layout(
    words: list[Word],
    emb: np.ndarray,
    theme: np.ndarray,
    anchor: np.ndarray,
    neighbors: np.ndarray,
    k: int,
    iters: int = 320,
) -> tuple[np.ndarray, Geometry]:
    n = len(words)
    levels = np.array([w.level for w in words])
    geo = build_geometry(levels, theme, k)
    r_lo = geo.radii[levels - 1]
    r_hi = geo.radii[levels]

    # Preferred position within sector, blended with anchor's (same theme only).
    u = np.zeros(n)
    for t in range(k):
        idx = np.where(theme == t)[0]
        u[idx] = spectral_order(emb[idx])
    for lvl in range(2, 8):  # inner levels first so blends cascade outward
        for i in np.where(levels == lvl)[0]:
            a = anchor[i]
            if a >= 0 and theme[a] == theme[i]:
                u[i] = 0.5 * u[i] + 0.5 * u[a]

    # Radial home within the band: frequent words sit nearer the inner edge
    # (learned earlier), with a little hash jitter; area-uniform so density is even.
    jitter = np.array([_hash01(w.id, "r") for w in words])
    freq = np.array([w.freq for w in words])
    q = np.zeros(n)
    for lvl in range(1, 8):
        for t in range(k):
            idx = np.where((levels == lvl) & (theme == t))[0]
            if len(idx) == 0:
                continue
            order = np.lexsort((idx, -freq[idx]))
            q[idx[order]] = (np.arange(len(idx)) + 0.5) / len(idx)
    q = 0.75 * q + 0.25 * jitter
    pad = 0.4
    lo2, hi2 = (r_lo + pad) ** 2, (r_hi - pad) ** 2
    r_home = np.sqrt(lo2 + q * (hi2 - lo2))

    def target_theta(rr: np.ndarray) -> np.ndarray:
        lo, hi = geo.sector_bounds(rr, theme)
        margin = np.minimum(0.6 / rr, (hi - lo) / 2)
        return lo + margin + u * np.maximum(hi - lo - 2 * margin, 0)

    r = r_home.copy()
    th = target_theta(r)

    has_anchor = anchor >= 0
    a_idx = np.where(has_anchor, anchor, 0)
    a_w = np.where(has_anchor, np.where(theme[a_idx] == theme, 1.0, 0.2), 0.0)

    # Semantic neighbor springs: same theme, |level diff| <= 1.
    nb_i, nb_j = [], []
    for i in range(n):
        for j in neighbors[i][:5]:
            if theme[j] == theme[i] and abs(levels[j] - levels[i]) <= 1:
                nb_i.append(i)
                nb_j.append(int(j))
    nb_i_arr = np.array(nb_i, dtype=np.int64)
    nb_j_arr = np.array(nb_j, dtype=np.int64)
    nb_count = np.bincount(nb_i_arr, minlength=n).astype(np.float64)

    def wrap(a: np.ndarray) -> np.ndarray:
        return np.mod(a + math.pi, 2 * math.pi) - math.pi

    k_anchor, k_target, k_nb, k_rad = 0.05, 0.05, 0.04, 0.08
    settle = iters // 4
    P = np.stack([r * np.cos(th), r * np.sin(th)], axis=1)
    for it in range(iters):
        r = np.hypot(P[:, 0], P[:, 1])
        th = _unwrap(np.arctan2(P[:, 1], P[:, 0]), geo.theta0)
        if it < iters - settle:
            cool = 1.0 - it / (iters - settle)
            dth = k_target * wrap(target_theta(r) - th)
            dth += k_anchor * a_w * wrap(th[a_idx] - th)
            if len(nb_i_arr):
                acc = np.zeros(n)
                np.add.at(acc, nb_i_arr, wrap(th[nb_j_arr] - th[nb_i_arr]))
                dth += k_nb * acc / np.maximum(nb_count, 1.0)
            th = th + dth * (0.5 + 0.5 * cool)
            r = r + k_rad * (r_home - r)
            P = np.stack([r * np.cos(th), r * np.sin(th)], axis=1)

        # Collision resolution (position based).
        for _ in range(3):
            pairs = cKDTree(P).query_pairs(MIN_DIST, output_type="ndarray")
            if len(pairs) == 0:
                break
            pairs = pairs[np.lexsort((pairs[:, 1], pairs[:, 0]))]
            d = P[pairs[:, 1]] - P[pairs[:, 0]]
            dist = np.hypot(d[:, 0], d[:, 1])
            tiny = dist < 1e-9
            if np.any(tiny):  # deterministic separation direction
                ang = np.array([_hash01(f"{a}-{b}", "sep") for a, b in pairs[tiny]]) * 2 * math.pi
                d[tiny] = np.stack([np.cos(ang), np.sin(ang)], axis=1) * 1e-3
                dist[tiny] = 1e-3
            push = ((MIN_DIST - dist) / 2 / dist)[:, None] * d
            D = np.zeros_like(P)
            np.add.at(D, pairs[:, 0], -push)
            np.add.at(D, pairs[:, 1], push)
            P = P + D

        # Project back into band and sector.
        rr = np.clip(np.hypot(P[:, 0], P[:, 1]), r_lo + pad, r_hi - pad)
        th = _unwrap(np.arctan2(P[:, 1], P[:, 0]), geo.theta0)
        lo, hi = geo.sector_bounds(rr, theme)
        margin = np.minimum(0.45 / rr, (hi - lo) / 2)
        th = np.clip(th, lo + margin, hi - margin)
        P = np.stack([rr * np.cos(th), rr * np.sin(th)], axis=1)

    return np.round(P, 2), geo


def layout_stats(P: np.ndarray) -> dict:
    tree = cKDTree(P)
    d, _ = tree.query(P, k=2)
    nn = d[:, 1]
    return {
        "min_nn": float(nn.min()),
        "p05_nn": float(np.percentile(nn, 5)),
        "median_nn": float(np.median(nn)),
        "overlaps<0.8": int(np.sum(nn < 0.8)),
        "radius": float(np.hypot(P[:, 0], P[:, 1]).max()),
    }
