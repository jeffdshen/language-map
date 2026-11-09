"""The tile world: words on a grid, grouped into size-capped regions, plus terrain.

Steps (all deterministic):

1. **Slots.** Words live on a brick lattice (every other cell of every other row,
   alternate rows offset), so no two words touch and every word has room for its
   label. Slots are taken outward from the center in order of a wavy "effective
   radius" (an island, not a circle). Towns (HSK 1–6) keep ~92% of lattice slots
   (the gaps become plazas and parks); the wilderness (HSK 7–9) keeps ~78% (the
   gaps grow into lakes, peaks and clearings). Word density is therefore constant
   in towns and *lower* in the wilderness: it never increases outward.
2. **Placement.** A force-directed layout on continuous coordinates: each level
   keeps to its band (distance from the center ~ HSK level), themes start in
   angular sectors sized by their word count at that level, words are pulled
   toward the lower-level word they build on and toward semantic neighbors, and a
   short-range repulsion keeps the density even.
3. **Regions.** Each level is split into balanced clusters of at most
   ``REGION_CAP[level]`` words (towns; wilderness regions are bigger).
4. **Assignment.** Regions get exactly as many slots as they have words by
   capacity-constrained optimal transport (a power diagram), then words are
   matched to their region's slots (Hungarian algorithm), preserving the layout.
5. **Cells.** Land follows the same wobbly radius (plus small coast jitter and a
   margin around every slot). Empty land cells join the region with the most
   Gaussian-weighted word membership nearby, which keeps borders smooth; terrain
   comes from smooth noise, the level, and the themes of nearby words.
"""

from __future__ import annotations

import colorsys
import itertools
import math
import re
from collections import Counter
from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree

from .words import Word, pos_category

LAYOUT_VERSION = 2
SEED = 2026
WILD_LEVEL = 7
SLOT_KEEP = {"town": 0.92, "wild": 0.78}
REGION_CAP = {1: 30, 2: 34, 3: 40, 4: 50, 5: 60, 6: 70, 7: 160}
PLAZA_RADIUS = 2.6  # empty central plaza (the spawn point)
SOFT_REGION_SIGMA = 1.7  # smoothing of region borders between words
COAST_JITTER = 2.0  # cells the coast wanders in and out (small-scale)
SHAPE_WOBBLE = 0.12  # medium-scale wobble of level bands and coast, relative to radius
SHAPE_SCALE = 26.0  # cells
RING_WIDTH = 2.0  # slot quotas are exact per ring of this width (effective radius)
REPULSE = 2.0  # spacing the force layout aims for, in cells (lattice spacing is 2)
BAND_SLACK = 1.5  # how far (cells) a word may stray outside its level band during layout
FORCE_ITERS = 160

# Ground codes. Words only stand on land; '=' and 'k' are used only in empty cells.
GROUND = {
    "~": ("ocean", "#3f6f9e"),
    "=": ("lake", "#5d93c2"),
    ".": ("sand", "#e8d9a8"),
    "p": ("plaza", "#d9d2c3"),
    "g": ("grass", "#a8cf87"),
    "m": ("meadow", "#bfd98f"),
    "w": ("fields", "#e3d58e"),
    "o": ("orchard", "#9dca7c"),
    "d": ("earth", "#cdb48f"),
    "r": ("red rock", "#d39a76"),
    "c": ("crystal", "#bcd9e6"),
    "f": ("forest", "#6fa765"),
    "h": ("hills", "#b5bf80"),
    "k": ("peaks", "#9a958c"),
    "s": ("snow", "#eef2f4"),
    "x": ("marsh", "#8fb79a"),
    "y": ("dunes", "#e6cc8f"),
}

# Wilderness naming by dominant ground.
WILD_PLACE = {
    "f": ("林", "Forest"),
    "k": ("山", "Peaks"),
    "s": ("雪岭", "Snowfields"),
    "x": ("泽", "Marsh"),
    "y": ("沙丘", "Dunes"),
    "r": ("峡谷", "Canyon"),
    "c": ("晶原", "Crystal Fields"),
    "h": ("丘", "Hills"),
    "g": ("原", "Plains"),
    "m": ("原", "Meadows"),
    "=": ("湖", "Lakes"),
}


# ---------------------------------------------------------------------------
# noise


def _hash01(ix: np.ndarray, iy: np.ndarray, seed: int) -> np.ndarray:
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + seed * 2654435761) & (
        0xFFFFFFFF
    )
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h ^= h >> 16
    return (h & 0xFFFFFF).astype(np.float64) / float(0x1000000)


def value_noise(x: np.ndarray, y: np.ndarray, scale: float, seed: int) -> np.ndarray:
    gx, gy = np.asarray(x, np.float64) / scale, np.asarray(y, np.float64) / scale
    x0, y0 = np.floor(gx), np.floor(gy)
    fx, fy = gx - x0, gy - y0
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    ix, iy = x0.astype(np.int64), y0.astype(np.int64)
    n00, n10 = _hash01(ix, iy, seed), _hash01(ix + 1, iy, seed)
    n01, n11 = _hash01(ix, iy + 1, seed), _hash01(ix + 1, iy + 1, seed)
    top = n00 + (n10 - n00) * sx
    bot = n01 + (n11 - n01) * sx
    return top + (bot - top) * sy


def fbm(x: np.ndarray, y: np.ndarray, scale: float, seed: int, octaves: int = 3) -> np.ndarray:
    total = np.zeros(np.broadcast(np.asarray(x), np.asarray(y)).shape)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        total += amp * value_noise(x, y, scale / 2**o, seed + 101 * o)
        norm += amp
        amp *= 0.5
    return total / norm


def rank01(v: np.ndarray) -> np.ndarray:
    r = np.argsort(np.argsort(v, kind="stable"), kind="stable")
    return (r + 0.5) / len(v)


_COAST = [
    (k, 0.05 / math.sqrt(k - 1), float(p))
    for k, p in zip(range(2, 8), np.random.default_rng(SEED).uniform(0, 2 * math.pi, 6))
]


def coast_factor(theta: np.ndarray) -> np.ndarray:
    """Smooth angular wobble (~±8%) that makes the island and level bands non-circular."""
    f = np.ones_like(np.asarray(theta, np.float64))
    for k, a, p in _COAST:
        f += a * np.cos(k * theta + p)
    return f


def r_eff(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    return np.hypot(x, y) / coast_factor(np.arctan2(y, x))


def r_shape(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """``r_eff`` plus medium-scale noise (relative to the radius): the level bands and the
    coast get bays and capes instead of smooth arcs, while rings of equal ``r_shape`` still
    hold words at an even density."""
    x, y = np.asarray(x, np.float64), np.asarray(y, np.float64)
    n = fbm(x, y, SHAPE_SCALE, SEED + 12) - 0.5
    return r_eff(x, y) * (1.0 + 2.0 * SHAPE_WOBBLE * n)


# ---------------------------------------------------------------------------
# slots


@dataclass
class Slots:
    xy: np.ndarray  # (N, 2) int cell coordinates, sorted outward
    wild: np.ndarray  # (N,) bool
    bands: np.ndarray  # (8,) effective radius of each level boundary (bands[0] = plaza)


def is_lattice(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    return (np.mod(y, 2) == 0) & (np.mod(x + np.floor_divide(y, 2), 2) == 0)


def make_slots(level_counts: list[int]) -> Slots:
    n_town = sum(level_counts[: WILD_LEVEL - 1])
    n = sum(level_counts)
    n_wild = n - n_town
    area = n_town * 4 / SLOT_KEEP["town"] + n_wild * 4 / SLOT_KEEP["wild"]
    R = int(math.sqrt(area / math.pi) * 1.7) + 10
    ys, xs = np.mgrid[-R : R + 1, -R : R + 1]
    xs, ys = xs.ravel(), ys.ravel()
    lat = is_lattice(xs, ys)
    xs, ys = xs[lat], ys[lat]
    re_ = r_shape(xs, ys)
    order = np.lexsort((xs, ys, re_))
    u_town = rank01(value_noise(xs, ys, 3.0, SEED + 1))
    u_wild = rank01(fbm(xs, ys, 8.0, SEED + 2))
    # Rings of equal width: each keeps exactly its quota (error-diffused), choosing which
    # slots to drop by noise, so density is flat in towns and lower (never higher) outside.
    ring = np.floor(re_ / RING_WIDTH).astype(np.int64)
    kept: list[int] = []
    wild: list[bool] = []
    carry = 0.0
    for rg in range(int(ring.max()) + 1):
        if len(kept) >= n:
            break
        members = order[(ring[order] == rg) & (re_[order] >= PLAZA_RADIUS)]
        if not len(members):
            continue
        is_wild = len(kept) >= n_town
        u = (u_wild if is_wild else u_town)[members]
        want = SLOT_KEEP["wild" if is_wild else "town"] * len(members) + carry
        take = round(want)
        carry = want - take
        chosen = members[np.lexsort((members, -u))[:take]]
        chosen = chosen[np.lexsort((xs[chosen], ys[chosen], re_[chosen]))]
        room = n - len(kept)
        kept += chosen[:room].tolist()
        wild += [is_wild] * min(room, len(chosen))
    if len(kept) < n:
        raise RuntimeError("slot lattice too small")
    xy = np.stack([xs[kept], ys[kept]], axis=1).astype(np.int64)
    # The candidate square must contain every used ring whole, or the coast gets cut flat.
    if int(np.abs(xy).max()) >= R - 2:
        raise RuntimeError("slot lattice clipped; enlarge R")
    rk = re_[kept]
    cum = np.cumsum(level_counts)
    bands = np.array([PLAZA_RADIUS] + [float(rk[c - 1]) for c in cum])
    return Slots(xy=xy, wild=np.array(wild), bands=bands)


# ---------------------------------------------------------------------------
# optimal-transport partition


def ot_assign(points: np.ndarray, seeds: np.ndarray, caps: np.ndarray) -> np.ndarray:
    """Assign each point to a seed, with exactly caps[k] points per seed, minimizing the
    total squared distance (a capacity-constrained power diagram). Returns seed index per point.

    Coordinate ascent on the power-diagram weights gets close; any assignment of the form
    argmin(cost - weight) is optimal for its own counts, so successive shortest paths on the
    small seed graph then fix the remaining imbalance exactly. Meant for few seeds (K <~ 100).
    """
    n, K = len(points), len(seeds)
    assert int(caps.sum()) == n, (int(caps.sum()), n)
    if K == 1:
        return np.zeros(n, dtype=np.int64)
    D = ((points[:, None, :] - seeds[None, :, :]) ** 2).sum(-1)
    w = np.zeros(K)
    for _ in range(30):
        moved = 0.0
        for k in range(K):
            S = D - w
            S[:, k] = np.inf
            t = D[:, k] - S.min(axis=1)
            c = int(caps[k])
            if c == 0:
                nw = float(t.min()) - 1.0
            elif c == n:
                nw = float(t.max()) + 1.0
            else:
                part = np.partition(t, [c - 1, c])
                nw = 0.5 * float(part[c - 1] + part[c])
            moved = max(moved, abs(nw - w[k]))
            w[k] = nw
        if moved < 1e-9:
            break
    label = np.argmin(D - w, axis=1)
    return _ssp_balance(D, label, caps)


def _ssp_balance(D: np.ndarray, label: np.ndarray, caps: np.ndarray) -> np.ndarray:
    """Move points along shortest paths in the seed graph (edge a->b = cheapest single move of
    a point from a to b) from over-full to under-full seeds until all counts match caps."""
    n, K = D.shape
    label = label.copy()
    cnt = np.bincount(label, minlength=K)
    cols = np.arange(K)
    while np.any(cnt != caps):
        delta = D - D[np.arange(n), label][:, None]
        best = np.full((K, K), np.inf)
        arg = np.full((K, K), -1, dtype=np.int64)
        for a in range(K):
            mem = np.where(label == a)[0]
            if len(mem):
                j = np.argmin(delta[mem], axis=0)
                best[a] = delta[mem[j], cols]
                arg[a] = mem[j]
        np.fill_diagonal(best, np.inf)
        dist = np.where(cnt > caps, 0.0, np.inf)
        prev = np.full(K, -1, dtype=np.int64)
        for _ in range(K):
            cand = dist[:, None] + best
            a = np.argmin(cand, axis=0)
            nd = cand[a, cols]
            upd = nd < dist - 1e-9
            if not upd.any():
                break
            dist[upd] = nd[upd]
            prev[upd] = a[upd]
        under = np.where(cnt < caps)[0]
        b = int(under[np.argmin(dist[under])])
        path = [b]
        while prev[path[-1]] >= 0:
            path.append(int(prev[path[-1]]))
        path.reverse()
        for u, v in itertools.pairwise(path):
            label[arg[u, v]] = v
        cnt[path[0]] -= 1
        cnt[path[-1]] += 1
    return label


# ---------------------------------------------------------------------------
# continuous placement


def _polar(r_e: np.ndarray, theta: np.ndarray) -> np.ndarray:
    r = r_e * coast_factor(theta)
    return np.stack([r * np.cos(theta), r * np.sin(theta)], axis=1)


def _first_pc(e: np.ndarray) -> np.ndarray:
    if len(e) < 3:
        return np.arange(len(e), dtype=np.float64)
    c = e - e.mean(axis=0)
    _, _, vt = np.linalg.svd(c, full_matrices=False)
    v = vt[0] * (1 if vt[0][np.argmax(np.abs(vt[0]))] >= 0 else -1)
    return c @ v


def initial_positions(
    levels: np.ndarray,
    freq: np.ndarray,
    theme: np.ndarray,
    emb: np.ndarray,
    anchor: np.ndarray,
    k: int,
    bands: np.ndarray,
) -> np.ndarray:
    """Themes as angular sectors per level (sized by their word count there)."""
    n = len(levels)
    X = np.zeros((n, 2))
    ang = np.zeros(n)
    theta0 = -math.pi / 2
    for L in range(1, 8):
        idx = np.where(levels == L)[0]
        a, b = float(bands[L - 1]), float(bands[L])
        start = theta0
        for t in range(k):
            members = idx[theme[idx] == t]
            m = len(members)
            if not m:
                continue
            span = 2 * math.pi * m / len(idx)
            mid = start + span / 2
            if L == 1:
                key = _first_pc(emb[members])
            else:
                pa = ang[np.maximum(anchor[members], 0)]
                key = np.where(anchor[members] >= 0, np.angle(np.exp(1j * (pa - mid))), 0.0)
                key = key + 1e-3 * _first_pc(emb[members])
            order = members[np.lexsort((members, key))]
            rank = np.arange(m)
            theta = start + span * (rank + 0.5) / m
            # Frequent words start nearer the center (the spawn), with some jitter.
            fr = rank01(-freq[order] - 1e-6 * order)
            frac = 0.7 * fr + 0.3 * ((rank * 0.6180339887 + 0.5 * (t % 2)) % 1.0)
            re_ = np.sqrt(a * a + (b * b - a * a) * frac)
            X[order] = _polar(re_, theta)
            ang[order] = theta
            start += span
    return X


def force_layout(
    words: list[Word],
    emb: np.ndarray,
    theme: np.ndarray,
    anchor: np.ndarray,
    neighbors: np.ndarray,
    k: int,
    bands: np.ndarray,
) -> np.ndarray:
    levels = np.array([w.level for w in words])
    n = len(words)
    freq = np.array([w.freq for w in words], dtype=np.float64)
    X = initial_positions(levels, freq, theme, emb, anchor, k, bands)
    home = X.copy()

    e0, e1, ew = [], [], []
    for i in range(n):
        if anchor[i] >= 0:
            e0.append(i)
            e1.append(int(anchor[i]))
            ew.append(1.0)
        for j in neighbors[i][:3].tolist():
            if abs(levels[j] - levels[i]) <= 1:
                e0.append(i)
                e1.append(j)
                ew.append(0.35)
    e0a, e1a, ewa = np.array(e0), np.array(e1), np.array(ew)
    lo = bands[levels - 1] - BAND_SLACK
    hi = bands[levels] + BAND_SLACK
    lo[levels == 1] = PLAZA_RADIUS

    for it in range(FORCE_ITERS):
        cool = 1.0 - it / FORCE_ITERS
        F = np.zeros_like(X)
        d = (X[e1a] - X[e0a]) * (0.02 * ewa)[:, None]
        for c in range(2):
            F[:, c] += np.bincount(e0a, weights=d[:, c], minlength=n)
            F[:, c] -= np.bincount(e1a, weights=d[:, c], minlength=n)
        F += 0.01 * (home - X)
        pairs = cKDTree(X).query_pairs(REPULSE, output_type="ndarray")
        if len(pairs):
            p0, p1 = pairs[:, 0], pairs[:, 1]
            dv = X[p0] - X[p1]
            dist = np.hypot(dv[:, 0], dv[:, 1])
            zero = dist < 1e-6
            dv[zero] = np.stack([np.cos(p0[zero]), np.sin(p0[zero])], axis=1)
            dist[zero] = 1.0
            push = dv * ((REPULSE - dist) / dist * 0.25)[:, None]
            for c in range(2):
                F[:, c] += np.bincount(p0, weights=push[:, c], minlength=n)
                F[:, c] -= np.bincount(p1, weights=push[:, c], minlength=n)
        mag = np.hypot(F[:, 0], F[:, 1])
        cap = 0.1 + 0.6 * cool
        F *= np.minimum(1.0, cap / np.maximum(mag, 1e-9))[:, None]
        X += F
        th = np.arctan2(X[:, 1], X[:, 0])
        re_ = np.clip(r_eff(X[:, 0], X[:, 1]), lo, hi)
        X = _polar(re_, th)
    return X


# ---------------------------------------------------------------------------
# regions


def cluster_level(P: np.ndarray, k: int, iters: int = 6) -> np.ndarray:
    """Balanced spatial clusters (sizes differ by at most one)."""
    n = len(P)
    if k == 1:
        return np.zeros(n, dtype=np.int64)
    base, extra = divmod(n, k)
    caps = np.array([base + (1 if c < extra else 0) for c in range(k)])
    theta = np.mod(np.arctan2(P[:, 1], P[:, 0]) + math.pi / 2, 2 * math.pi)
    order = np.lexsort((np.arange(n), theta))
    label = np.zeros(n, dtype=np.int64)
    label[order] = np.repeat(np.arange(k), caps)
    for _ in range(iters):
        seeds = np.stack([P[label == c].mean(axis=0) for c in range(k)])
        new = ot_assign(P, seeds, caps)
        if np.array_equal(new, label):
            break
        label = new
    return label


@dataclass
class World:
    pos: np.ndarray  # (n, 2) int cell per word
    region: np.ndarray  # (n,) region id per word
    regions: list[dict]
    x0: int
    y0: int
    ground: np.ndarray  # (h, w) '<U1'
    region_grid: np.ndarray  # (h, w) int, -1 = sea
    stats: dict = field(default_factory=dict)

    @property
    def size(self) -> tuple[int, int]:
        h, w = self.ground.shape
        return w, h


def build_world(
    words: list[Word],
    emb: np.ndarray,
    theme: np.ndarray,
    anchor: np.ndarray,
    neighbors: np.ndarray,
    themes_cfg: list[dict],
) -> World:
    k = len(themes_cfg)
    levels = np.array([w.level for w in words])
    n = len(words)
    counts = [int(np.sum(levels == L)) for L in range(1, 8)]
    slots = make_slots(counts)
    X = force_layout(words, emb, theme, anchor, neighbors, k, slots.bands)

    # Regions per level, ordered by level then clockwise from the top.
    region = np.full(n, -1, dtype=np.int64)
    reg_level: list[int] = []
    for L in range(1, 8):
        idx = np.where(levels == L)[0]
        kL = math.ceil(len(idx) / REGION_CAP[L])
        lab = cluster_level(X[idx], kL)
        cents = np.stack([X[idx][lab == c].mean(axis=0) for c in range(kL)])
        ang = np.mod(np.arctan2(cents[:, 1], cents[:, 0]) + math.pi / 2, 2 * math.pi)
        rank = np.argsort(np.argsort(ang, kind="stable"), kind="stable")
        region[idx] = len(reg_level) + rank[lab]
        reg_level += [L] * kL
    R = len(reg_level)
    caps = np.bincount(region, minlength=R)
    seeds = np.stack([X[region == r].mean(axis=0) for r in range(R)])

    # Regions -> slots (each level fills exactly its own band of slots), then words ->
    # slots within each region.
    slot_reg = np.full(len(slots.xy), -1, dtype=np.int64)
    cum = np.concatenate([[0], np.cumsum(counts)])
    reg_lv = np.array(reg_level)
    for L in range(1, 8):
        rs = np.where(reg_lv == L)[0]
        sl = slice(int(cum[L - 1]), int(cum[L]))
        lab = ot_assign(slots.xy[sl].astype(np.float64), seeds[rs], caps[rs])
        slot_reg[sl] = rs[lab]
    pos = np.zeros((n, 2), dtype=np.int64)
    for r in range(R):
        wi = np.where(region == r)[0]
        si = np.where(slot_reg == r)[0]
        S = slots.xy[si].astype(np.float64)
        W = X[wi] - X[wi].mean(axis=0) + S.mean(axis=0)
        cost = ((W[:, None, :] - S[None, :, :]) ** 2).sum(-1)
        rows, cols = linear_sum_assignment(cost)
        pos[wi[rows]] = slots.xy[si[cols]]

    # Cells.
    slot_r = r_shape(slots.xy[:, 0], slots.xy[:, 1])
    land_r = float(slot_r.max()) + 1.6
    ext = int(np.abs(slots.xy).max()) + 8
    x0 = y0 = -ext
    gy, gx = np.mgrid[-ext : ext + 1, -ext : ext + 1]
    fgx, fgy = gx.astype(np.float64), gy.astype(np.float64)
    # Coast: the wobbly outer ring plus small-scale noise (bays and capes), always keeping
    # a margin of land around every word.
    jitter = (fbm(fgx, fgy, 11.0, SEED + 9) - 0.5) * 2 * COAST_JITTER
    land = r_shape(fgx, fgy) <= land_r + jitter
    near_slot = np.zeros(gx.shape, dtype=bool)
    near_slot[slots.xy[:, 1] + ext, slots.xy[:, 0] + ext] = True
    from scipy.ndimage import binary_dilation

    land |= binary_dilation(near_slot, structure=np.ones((3, 3), dtype=bool), iterations=2)
    land = _largest_land(land)
    word_at = {(int(x), int(y)): i for i, (x, y) in enumerate(pos.tolist())}
    for _ in range(6):
        region_grid, word_dist = _rasterize(pos, region, land, gx, gy, x0, y0)
        if not _fix_exclaves(pos, region, region_grid, land, x0, y0):
            break
    else:
        region_grid, word_dist = _rasterize(pos, region, land, gx, gy, x0, y0)

    ground = _terrain(
        gx,
        gy,
        land,
        region_grid,
        word_dist,
        land_mask_dist(land),
        pos,
        x0,
        y0,
        theme,
        reg_level,
        themes_cfg,
        k,
    )
    regions = _describe_regions(
        words, region, reg_level, pos, theme, themes_cfg, ground, region_grid, x0, y0
    )
    stats = {
        "regions": R,
        "grid": [int(gx.shape[1]), int(gx.shape[0])],
        "land_cells": int(land.sum()),
        "band_radii": [round(float(b), 2) for b in slots.bands],
        "region_sizes": {
            str(L): [int(caps[r]) for r in range(R) if reg_level[r] == L] for L in range(1, 8)
        },
    }
    assert len(word_at) == n, "two words on one cell"
    return World(pos, region, regions, x0, y0, ground, region_grid, stats)


def _rasterize(pos, region, land, gx, gy, x0, y0) -> tuple[np.ndarray, np.ndarray]:
    """Each land cell joins the region with the most (Gaussian-weighted) words around it,
    which gives smoother borders than plain nearest-word cells on the brick lattice. Word
    cells keep their own region; cells far from every word fall back to the nearest word.
    Returns (region grid, distance to the nearest word)."""
    cells = np.stack([gx[land], gy[land]], axis=1).astype(np.float64)
    dist, near = cKDTree(pos.astype(np.float64)).query(cells, k=1)
    region_grid = np.full(gx.shape, -1, dtype=np.int64)
    region_grid[land] = region[near]
    px, py = pos[:, 0] - x0, pos[:, 1] - y0
    best = np.zeros(gx.shape)
    arg = np.full(gx.shape, -1, dtype=np.int64)
    for r in range(int(region.max()) + 1):
        ind = np.zeros(gx.shape)
        sel = region == r
        ind[py[sel], px[sel]] = 1.0
        f = gaussian_filter(ind, sigma=SOFT_REGION_SIGMA, mode="constant", truncate=3.0)
        upd = f > best + 1e-9
        best[upd] = f[upd]
        arg[upd] = r
    soft = land & (arg >= 0) & (best > 1e-4)
    region_grid[soft] = arg[soft]
    region_grid[py, px] = region
    word_dist = np.full(gx.shape, np.inf)
    word_dist[land] = dist
    _fix_enclaves(region_grid, pos - np.array([x0, y0]))
    return region_grid, word_dist


def _fix_exclaves(pos, region, region_grid, land, x0, y0) -> bool:
    """Words stranded in a detached piece of their region swap places with a word of the
    surrounding region that sits next to the main piece (or, failing that, move to a free
    lattice slot next to it). Returns True if anything moved."""
    from scipy.ndimage import binary_dilation
    from scipy.ndimage import label as cc_label

    px, py = pos[:, 0] - x0, pos[:, 1] - y0
    moved = False
    for r in range(int(region_grid.max()) + 1):
        comp, m = cc_label(region_grid == r)
        if m <= 1:
            continue
        main = 1 + int(np.argmax(np.bincount(comp.ravel())[1:]))
        near_main = binary_dilation(comp == main, iterations=2)
        taken: set[int] = set()
        for i in np.where(region == r)[0].tolist():
            c = comp[py[i], px[i]]
            if c == main:
                continue
            piece = binary_dilation(comp == c) & ~(comp == c) & (region_grid >= 0)
            around = Counter(region_grid[piece].tolist())
            host = min(around, key=lambda v: (-around[v], v))
            cand = np.where((region == host) & near_main[py, px])[0]
            cand = [j for j in cand.tolist() if j not in taken]
            if cand:
                j = min(cand, key=lambda j: (float(np.sum((pos[j] - pos[i]) ** 2)), j))
                pos[[i, j]] = pos[[j, i]]
                taken.add(j)
                moved = True
                continue
            h, w = region_grid.shape
            fy, fx = np.mgrid[0:h, 0:w]
            free = near_main & land & is_lattice(fx + x0, fy + y0) & (region_grid == r)
            free[py, px] = False
            fys, fxs = np.nonzero(free)
            if len(fys):
                k = int(np.argmin((fxs - px[i]) ** 2 + (fys - py[i]) ** 2))
                pos[i] = (fxs[k] + x0, fys[k] + y0)
                px[i], py[i] = fxs[k], fys[k]
                moved = True
    return moved


def _largest_land(land: np.ndarray) -> np.ndarray:
    """Fill lakes of sea inside the island so only the outer ocean is sea."""
    from scipy.ndimage import label as cc_label

    sea, _ = cc_label(~land)
    outer = set(np.unique(np.concatenate([sea[0], sea[-1], sea[:, 0], sea[:, -1]])).tolist())
    outer.discard(0)
    return ~np.isin(sea, list(outer))


def land_mask_dist(land: np.ndarray) -> np.ndarray:
    """Distance (cells) from each land cell to the sea (capped)."""
    from scipy.ndimage import distance_transform_edt

    return distance_transform_edt(land)


def _fix_enclaves(region_grid: np.ndarray, word_cells: np.ndarray) -> None:
    """Give word-less pockets of a region (cut off from its words) to the bordering region."""
    from scipy.ndimage import label as cc_label

    R = int(region_grid.max()) + 1
    has_word = np.zeros(region_grid.shape, dtype=bool)
    has_word[word_cells[:, 1], word_cells[:, 0]] = True
    for _ in range(3):
        changed = False
        for r in range(R):
            comp, m = cc_label(region_grid == r)
            if m <= 1:
                continue
            keep = set(np.unique(comp[has_word & (comp > 0)]).tolist())
            for c in range(1, m + 1):
                if c in keep:
                    continue
                ys, xs = np.where(comp == c)
                nb: Counter[int] = Counter()
                for y, x in zip(ys.tolist(), xs.tolist()):
                    for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
                        yy, xx = y + dy, x + dx
                        if 0 <= yy < region_grid.shape[0] and 0 <= xx < region_grid.shape[1]:
                            v = int(region_grid[yy, xx])
                            if v >= 0 and v != r:
                                nb[v] += 1
                if nb:
                    region_grid[ys, xs] = min(nb, key=lambda v: (-nb[v], v))
                    changed = True
        if not changed:
            break


# ---------------------------------------------------------------------------
# terrain


def _terrain(
    gx, gy, land, region_grid, slot_dist, sea_dist, pos, x0, y0, theme, reg_level, themes_cfg, k
) -> np.ndarray:
    h, w = gx.shape
    fx, fy = gx.astype(np.float64), gy.astype(np.float64)
    # Local theme field: which themes the nearby words belong to (smoothly blended).
    field_ = np.zeros((k, h, w))
    px, py = pos[:, 0] - x0, pos[:, 1] - y0
    np.add.at(field_, (theme, py, px), 1.0)
    for t in range(k):
        field_[t] = gaussian_filter(field_[t], sigma=3.0, mode="constant")
    local = np.argmax(field_, axis=0)

    level_grid = np.zeros((h, w), dtype=np.int64)
    level_grid[land] = np.array(reg_level)[region_grid[land]]
    wild = level_grid == WILD_LEVEL

    detail = value_noise(fx, fy, 7.0, SEED + 5)
    elev = fbm(fx, fy, 16.0, SEED + 6)
    moist = fbm(fx, fy, 20.0, SEED + 7)
    bias_m = np.array([t.get("wild", {}).get("moisture", 0.0) for t in themes_cfg])[local]
    bias_e = np.array([t.get("wild", {}).get("elevation", 0.0) for t in themes_cfg])[local]
    dry = np.array([t.get("wild", {}).get("dry", "y") for t in themes_cfg])[local]
    e = elev + bias_e
    m = moist + bias_m

    g1 = np.array([t["ground"][0] for t in themes_cfg])[local]
    g2 = np.array([t["ground"][1] for t in themes_cfg])[local]
    ground = np.where(detail > 0.64, g2, g1).astype("<U1")

    wg = np.full((h, w), "h", dtype="<U1")
    wg[m > 0.58] = "f"
    wg[(m < 0.40)] = dry[m < 0.40]
    wg[(e < 0.36) & (m > 0.52)] = "x"
    wg[(m >= 0.40) & (m <= 0.58) & (detail > 0.6)] = "g"
    wg[e > 0.68] = "k"
    wg[e > 0.78] = "s"
    ground = np.where(wild, wg, ground)

    # Gaps between words: plazas in towns; lakes / peaks / clearings in the wilderness.
    open_ = land & (slot_dist >= 2.0)
    ground[open_ & ~wild] = "p"
    lake = open_ & wild & (e < 0.5)
    peak = open_ & wild & (e > 0.6)
    ground[lake] = "="
    ground[peak & (e <= 0.74)] = "k"
    ground[peak & (e > 0.74)] = "s"

    rr = r_eff(fx, fy)
    ground[land & (rr < PLAZA_RADIUS + 0.9)] = "p"
    ground[land & (sea_dist <= 1.5) & (ground != "=")] = "."
    word_cells = np.zeros((h, w), dtype=bool)
    word_cells[py, px] = True
    bad = word_cells & np.isin(ground, ["=", "~"])
    ground[bad] = "g"
    ground[~land] = "~"
    return ground


# ---------------------------------------------------------------------------
# region descriptions


_NAME_GLOSS = re.compile(r"^[A-Za-z][a-z]{2,9}$")
# Locality / measure-like / grim words that make poor place names ("Inside Orchard").
_NAME_STOP_HANZI = set("上下里外前后左右中内东西南北边旁面头方号个位次些点") | {
    "屁股",
    "毒品",
    "暴力",
    "病毒",
    "垃圾",
    "恶意",
    "苦难",
    "谎言",
    "患者",
    "尸体",
    "死亡",
    "肿瘤",
    "葬礼",
    "厕所",
    "笨蛋",
    "残酷",
    "悲剧",
    "害",
    "目前",
}
_NAME_STOP_GLOSS = {
    "inside",
    "outside",
    "side",
    "front",
    "back",
    "top",
    "bottom",
    "middle",
    "one",
    "thing",
    "kind",
    "way",
    "aspect",
    "part",
    "item",
    "number",
    "matter",
    "among",
    "and",
    "since",
    "after",
    "before",
    "during",
    "while",
    "when",
    "then",
    "later",
    "other",
    "whole",
    "all",
}


def _hub_name(members: list[Word], theme: np.ndarray, dom: int, theme_en: str) -> tuple[str, str]:
    """(zh, en) name stem: the most frequent concrete-looking noun with a one-word gloss,
    preferring the region's dominant theme (so 'Apple' names the orchard); then any noun,
    then an adjective ('Quiet Gardens'); else the theme itself."""
    by_freq = sorted(members, key=lambda w: (-w.freq, w.index))

    def gloss(w: Word) -> str:
        g = w.glosses[0].split(";")[0].split(",")[0].strip() if w.glosses else ""
        return re.sub(r"^(a|an|the|to be|be) ", "", g)

    def ok(w: Word, cat: str) -> bool:
        g = gloss(w)
        return (
            pos_category(w) == cat
            and w.pos[0] == ("N" if cat == "noun" else "Adj")
            and len(w.hanzi) <= 2
            and w.hanzi not in _NAME_STOP_HANZI
            and bool(_NAME_GLOSS.match(g))
            and g.lower() not in _NAME_STOP_GLOSS
            and not g.endswith("ly")
        )

    for pool in (
        [w for w in by_freq if int(theme[w.index]) == dom and ok(w, "noun")],
        [w for w in by_freq if ok(w, "noun")],
        [w for w in by_freq if ok(w, "adj")],
    ):
        if pool:
            return pool[0].hanzi, gloss(pool[0]).capitalize()
    return "", theme_en.split(" ")[0]


def _color(base: str, level: int, r: int) -> str:
    rgb = [int(base.lstrip("#")[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    hh, ll, ss = colorsys.rgb_to_hls(*rgb)
    hh = (hh + (0.025 if r % 2 else -0.025)) % 1.0
    ll = max(0.25, min(0.85, ll - 0.035 * (level - 1) + (0.03 if r % 3 == 0 else 0)))
    out = colorsys.hls_to_rgb(hh, ll, ss)
    return "#" + "".join(f"{round(c * 255):02x}" for c in out)


def _describe_regions(
    words, region, reg_level, pos, theme, themes_cfg, ground, region_grid, x0, y0
) -> list[dict]:
    out = []
    used: Counter[str] = Counter()
    for r, L in enumerate(reg_level):
        members = [words[i] for i in np.where(region == r)[0]]
        tcount = Counter(int(theme[w.index]) for w in members)
        dom = min(tcount, key=lambda t: (-tcount[t], t))
        cfg = themes_cfg[dom]
        cells = region_grid == r
        if L == WILD_LEVEL:
            gc = Counter(ground[cells].tolist())
            gkey = min((g for g in gc if g in WILD_PLACE), key=lambda g: (-gc[g], g), default="g")
            place_zh, place_en = WILD_PLACE[gkey]
            kind = "wild"
        else:
            place_zh, place_en = cfg["place"]["zh"], cfg["place"]["en"]
            kind = "town"
        hub_zh, hub_en = _hub_name(members, theme, dom, cfg["en"])
        name_zh = (hub_zh or cfg["zh"]) + place_zh
        name_en = f"{hub_en} {place_en}"
        used[name_en] += 1
        if used[name_en] > 1:
            nth = min(used[name_en], 6)
            name_en += " " + ["", "", "II", "III", "IV", "V", "VI"][nth]
            name_zh += "·" + "　　二三四五六"[nth]
        ys, xs = np.where(cells)
        cx, cy = xs.mean() + x0, ys.mean() + y0
        # Label at the region cell closest to its centroid (always inside the region).
        j = int(np.argmin((xs + x0 - cx) ** 2 + (ys + y0 - cy) ** 2))
        out.append(
            {
                "id": r,
                "level": L,
                "kind": kind,
                "theme": dom,
                "zh": name_zh,
                "en": name_en,
                "count": len(members),
                "cells": int(cells.sum()),
                "x": int(xs[j] + x0),
                "y": int(ys[j] + y0),
                "color": _color(cfg["color"], L, r),
            }
        )
    return out


def region_runs(region_grid: np.ndarray) -> list[list[int]]:
    """Row-wise run-length encoding: [region, length, region, length, ...]."""
    rows = []
    for row in region_grid.tolist():
        runs: list[int] = []
        for v in row:
            if runs and runs[-2] == v:
                runs[-1] += 1
            else:
                runs += [v, 1]
        rows.append(runs)
    return rows


def world_stats(world: World, words: list[Word]) -> dict:
    """Density per distance band (words per land cell, outside the central plaza), to check
    that density never grows outward."""
    levels = np.array([w.level for w in words])
    h, w = world.ground.shape
    gy, gx = np.mgrid[0:h, 0:w]
    rr = r_shape(gx + world.x0, gy + world.y0)
    land = (world.region_grid >= 0) & (rr >= PLAZA_RADIUS)
    wr = r_shape(world.pos[:, 0], world.pos[:, 1])
    edges = np.linspace(PLAZA_RADIUS, float(rr[land].max()) + 1e-6, 9)
    dens = []
    for a, b in itertools.pairwise(edges):
        cells = int(np.sum(land & (rr >= a) & (rr < b)))
        nw = int(np.sum((wr >= a) & (wr < b)))
        dens.append(round(nw / max(cells, 1), 3))
    mean_r = [round(float(wr[levels == L].mean()), 1) for L in range(1, 8)]
    return {"density_by_distance": dens, "mean_distance_by_level": mean_r}
