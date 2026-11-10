"""The tile world: words on a grid, in walkable towns and wilds, with halls, roads and terrain.

Steps (all deterministic):

1. **Lots.** Words live in small hamlets ("lots") of 1–7 words, scattered by
   Poisson-disk sampling with open land between them. Lots are filled outward from
   the central plaza in order of a wavy "effective radius" (an island, not a
   circle). Each ring of the island holds exactly its quota of words, so density is
   flat in the towns (HSK 1–6) and lower in the wilderness (HSK 7–9): it never
   increases outward. Inside a lot, words keep room for their name plates: words in
   nearby rows (|dy| < ``GAP_Y``) stay at least ``GAP_X`` columns apart.
2. **Placement.** A force-directed layout on continuous coordinates: each level
   keeps to its band (distance from the center ~ HSK level), themes start in
   angular sectors sized by their word count at that level, and words are pulled
   toward the lower-level word they build on and toward semantic neighbors.
3. **Regions.** The lots of each level are grouped into compact regions of at most
   ``REGION_CAP[level]`` words (towns; wilderness regions are bigger). Words join
   regions by capacity-constrained optimal transport from their layout position.
4. **Neighbors.** Inside a region, words are first matched to slots by layout
   position, then swapped (a quadratic-assignment local search) so that related
   words share a lot: similar meaning, shared characters and "builds on" links pull
   together.
5. **Cells.** Land follows the same wobbly radius (plus coast noise and a margin
   around every word). Empty land joins the region with the most Gaussian-weighted
   word membership nearby, which keeps borders smooth.
6. **Halls and roads.** Each region gets a hall (its training ground) near its
   middle, clear of words. Roads link the plaza to the HSK 1 halls, each hall to the
   halls of neighboring regions, and every lot to its region's network (A* on the
   grid; water costs more and becomes a bridge).
7. **Terrain.** Ground comes from the themes of nearby words (towns) or from
   elevation and moisture noise (wilderness), with ponds, lakes and peaks in open land.
"""

from __future__ import annotations

import colorsys
import heapq
import itertools
import math
import re
from collections import Counter
from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import binary_dilation, distance_transform_edt, gaussian_filter
from scipy.ndimage import label as cc_label
from scipy.optimize import linear_sum_assignment
from scipy.sparse.csgraph import minimum_spanning_tree
from scipy.spatial import cKDTree
from scipy.stats import qmc

from .words import Word, pos_category

LAYOUT_VERSION = 3
SEED = 2026
WILD_LEVEL = 7
DENSITY = {"town": 0.07, "wild": 0.05}  # words per land cell
REGION_CAP = {1: 30, 2: 34, 3: 40, 4: 50, 5: 60, 6: 70, 7: 120}
REGION_FILL = 0.88  # regions aim for this share of their cap (lots are not divisible)
PLAZA_RADIUS = 4.0  # empty central plaza (the spawn point)
LOT_SPACING = 6.0  # minimum distance between lot centers (cells)
LOT_RADIUS = 3.4  # words of a lot sit within this distance of its center
LOT_MAX = 7
RING_WIDTH = 5.0  # word quotas are exact per ring of this width (effective radius)
GAP_X, GAP_Y = 3, 2  # words in nearby rows (|dy| < GAP_Y) stay >= GAP_X columns apart
SOFT_REGION_SIGMA = 3.2  # smoothing of region borders between words
COAST_JITTER = 3.0  # cells the coast wanders in and out (small-scale)
SHAPE_WOBBLE = 0.12  # medium-scale wobble of level bands and coast, relative to radius
SHAPE_SCALE = 40.0  # cells
REPULSE = 3.2  # spacing the force layout aims for, in cells
BAND_SLACK = 2.5  # how far (cells) a word may stray outside its level band during layout
FORCE_ITERS = 160
HALL_CLEAR = 3.0  # halls keep at least this distance from words
LAYOUT_PULL = 0.12  # weight of the layout position against neighbor affinity (step 4)
AFFINITY_K = 6  # strongest relations kept per word in step 4
MIN_WATER = 6  # smallest lake/pond kept (cells)

# Ground codes. Words, halls and the plaza never stand on water ('~', '=').
GROUND = {
    "~": ("ocean", "#3f6f9e"),
    "=": ("lake", "#5d93c2"),
    ".": ("sand", "#e8d9a8"),
    "p": ("plaza", "#d9d2c3"),
    "+": ("road", "#d9c59c"),
    ",": ("trail", "#c9b189"),
    "b": ("bridge", "#a87c52"),
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
WATER = ("~", "=")

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
# lots and slots


@dataclass
class Slots:
    xy: np.ndarray  # (N, 2) int cells in fill order (outward); each level is a contiguous run
    lot: np.ndarray  # (N,) lot of each slot
    lots: np.ndarray  # (M, 2) lot centers
    wild: np.ndarray  # (N,) bool
    bands: np.ndarray  # (8,) effective radius of each level boundary (bands[0] = plaza)


def gap_free(occ: np.ndarray, x: int, y: int) -> bool:
    """True if a word may stand at array cell (x, y) next to the occupied cells: words in
    nearby rows keep GAP_X columns apart so their name plates never collide."""
    return not occ[y - GAP_Y + 1 : y + GAP_Y, x - GAP_X + 1 : x + GAP_X].any()


def _lot_offsets() -> np.ndarray:
    r = math.ceil(LOT_RADIUS) + 1
    ys, xs = np.mgrid[-r : r + 1, -r : r + 1]
    return np.stack([xs.ravel(), ys.ravel()], axis=1)


def _fill_lot(
    center: np.ndarray, c: int, occ: np.ndarray, offs: np.ndarray, R: int
) -> list[tuple[int, int]]:
    """Up to c free cells around a lot center, nearest first (with a little jitter so lots
    take varied shapes)."""
    cells = np.round(center).astype(np.int64) + offs
    d = np.hypot(cells[:, 0] - center[0], cells[:, 1] - center[1])
    ok = d <= LOT_RADIUS
    cells = cells[ok]
    key = d[ok] + 0.9 * _hash01(cells[:, 0], cells[:, 1], SEED + 4)
    cells = cells[np.lexsort((cells[:, 0], cells[:, 1], key))]
    rr = r_shape(cells[:, 0], cells[:, 1])
    out: list[tuple[int, int]] = []
    for (x, y), r in zip(cells.tolist(), rr.tolist()):
        if r < PLAZA_RADIUS:
            continue
        if gap_free(occ, x + R, y + R):
            occ[y + R, x + R] = True
            out.append((x, y))
            if len(out) == c:
                break
    return out


def make_slots(level_counts: list[int]) -> Slots:
    n = sum(level_counts)
    n_town = sum(level_counts[: WILD_LEVEL - 1])
    area = n_town / DENSITY["town"] + (n - n_town) / DENSITY["wild"]
    R = int(math.sqrt(area / math.pi) * 1.45) + 12
    side = 2.0 * R
    rng = np.random.default_rng(SEED)
    lots = qmc.PoissonDisk(d=2, radius=LOT_SPACING / side, seed=rng).fill_space() * side - R
    lr = r_shape(lots[:, 0], lots[:, 1])
    keep = lr >= PLAZA_RADIUS + 1.0
    lots, lr = lots[keep], lr[keep]
    order = np.lexsort((lots[:, 0], lots[:, 1], lr))
    lots, lr = lots[order], lr[order]
    # Lots hold more or fewer words (weights 0.5–1.5), so some hamlets are busier.
    weight = 0.5 + _hash01(np.arange(len(lots)), np.zeros(len(lots), np.int64), SEED + 3)
    ys, xs = np.mgrid[-R : R + 1, -R : R + 1]
    rc = r_shape(xs, ys)
    nring = int(lr.max() / RING_WIDTH) + 1
    inner = rc >= PLAZA_RADIUS
    ring_area = np.bincount(
        np.minimum(np.floor(rc[inner] / RING_WIDTH).astype(np.int64), nring), minlength=nring + 1
    )
    lot_ring = np.floor(lr / RING_WIDTH).astype(np.int64)
    offs = _lot_offsets()
    occ = np.zeros((2 * R + 1, 2 * R + 1), dtype=bool)
    level_end = np.cumsum(level_counts)
    xy: list[tuple[int, int]] = []
    lot_of: list[int] = []
    used: list[int] = []
    carry = 0.0
    # Each ring gets exactly its quota (error-diffused across lots and rings).
    for g in range(nring):
        if len(xy) >= n:
            break
        members = np.where(lot_ring == g)[0]
        zone = "wild" if len(xy) >= n_town else "town"
        if not len(members):
            carry += DENSITY[zone] * ring_area[g]
            continue
        share = ring_area[g] * weight[members] / weight[members].sum()
        for li, a in zip(members.tolist(), share.tolist()):
            placed = len(xy)
            if placed >= n:
                break
            zone = "wild" if placed >= n_town else "town"
            want = DENSITY[zone] * a + carry
            end = int(level_end[np.searchsorted(level_end, placed, side="right")])
            c = min(int(np.clip(round(want), 0, LOT_MAX)), end - placed)
            got = _fill_lot(lots[li], c, occ, offs, R) if c > 0 else []
            if got:
                xy += got
                lot_of += [len(used)] * len(got)
                used.append(li)
            carry = want - len(got)
    if len(xy) < n:
        raise RuntimeError("island too small for all words; enlarge R")
    xy_a = np.array(xy, dtype=np.int64)
    if int(np.abs(xy_a).max()) >= R - 6:
        raise RuntimeError("lots clipped by the candidate square; enlarge R")
    lot_a = np.array(lot_of, dtype=np.int64)
    used_lots = lots[used]
    used_r = lr[used]
    bands = np.array([PLAZA_RADIUS] + [float(used_r[lot_a[e - 1]]) for e in level_end])
    return Slots(xy=xy_a, lot=lot_a, lots=used_lots, wild=np.arange(n) >= n_town, bands=bands)


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


def _majority(owner: np.ndarray, lab: np.ndarray, m: int, k: int) -> np.ndarray:
    counts = np.zeros((m, k))
    np.add.at(counts, (owner, lab), 1.0)
    return np.argmax(counts, axis=1)


def cluster_lots(P: np.ndarray, wts: np.ndarray, k: int, iters: int = 8) -> np.ndarray:
    """Group lots into k compact clusters holding about the same number of words: balanced
    clustering of the words (each lot repeated by its size), then each lot goes whole to the
    cluster holding most of its words."""
    m = len(P)
    if k <= 1:
        return np.zeros(m, dtype=np.int64)
    pts = np.repeat(P, wts, axis=0)
    owner = np.repeat(np.arange(m), wts)
    n = len(pts)
    base, extra = divmod(n, k)
    caps = np.array([base + (1 if c < extra else 0) for c in range(k)])
    theta = np.mod(np.arctan2(pts[:, 1], pts[:, 0]) + math.pi / 2, 2 * math.pi)
    lab = np.zeros(n, dtype=np.int64)
    lab[np.lexsort((owner, theta))] = np.repeat(np.arange(k), caps)
    for _ in range(iters):
        seeds = np.stack([pts[lab == c].mean(axis=0) for c in range(k)])
        new = ot_assign(pts, seeds, caps)
        if np.array_equal(new, lab):
            break
        lab = new
    return _majority(owner, lab, m, k)


def _region_lots(slots: Slots, counts: list[int]) -> tuple[np.ndarray, list[int]]:
    """Region id per lot (regions ordered by level, then clockwise from the top)."""
    lot_region = np.full(len(slots.lots), -1, dtype=np.int64)
    sizes = np.bincount(slots.lot, minlength=len(slots.lots))
    lot_level = np.zeros(len(slots.lots), dtype=np.int64)
    cum = np.concatenate([[0], np.cumsum(counts)])
    for L in range(1, 8):
        lot_level[slots.lot[cum[L - 1] : cum[L]]] = L
    reg_level: list[int] = []
    for L in range(1, 8):
        li = np.where(lot_level == L)[0]
        if not len(li):
            continue
        cap = REGION_CAP[L]
        k = math.ceil(counts[L - 1] / (cap * REGION_FILL))
        while True:
            lab = cluster_lots(slots.lots[li], sizes[li], k)
            tot = np.bincount(lab, weights=sizes[li], minlength=k)
            if tot.max() <= cap and tot.min() > 0:
                break
            k += 1
        cents = np.stack(
            [
                np.average(slots.lots[li][lab == c], axis=0, weights=sizes[li][lab == c])
                for c in range(k)
            ]
        )
        ang = np.mod(np.arctan2(cents[:, 1], cents[:, 0]) + math.pi / 2, 2 * math.pi)
        rank = np.argsort(np.argsort(ang, kind="stable"), kind="stable")
        lot_region[li] = len(reg_level) + rank[lab]
        reg_level += [L] * k
    return lot_region, reg_level


# ---------------------------------------------------------------------------
# neighbors inside a region


def _affinity(
    idx: np.ndarray, words: list[Word], emb: np.ndarray, anchor, theme, idf
) -> np.ndarray:
    """Symmetric relation strength between the words of one region (sparse: each word keeps
    its AFFINITY_K strongest relations)."""
    m = len(idx)
    E = emb[idx].astype(np.float64)
    E /= np.maximum(np.linalg.norm(E, axis=1, keepdims=True), 1e-9)
    A = np.clip((E @ E.T - 0.3) / 0.7, 0.0, None) ** 1.5
    chars = [set(words[i].chars) for i in idx.tolist()]
    weight = [sum(idf.get(c, 1.0) for c in s) or 1.0 for s in chars]
    for a in range(m):
        if not chars[a]:
            continue
        for b in range(a + 1, m):
            shared = chars[a] & chars[b]
            if shared:
                s = sum(idf.get(c, 1.0) for c in shared) / min(weight[a], weight[b])
                A[a, b] += 1.2 * s
                A[b, a] += 1.2 * s
    where = {int(i): k for k, i in enumerate(idx.tolist())}
    for k, i in enumerate(idx.tolist()):
        j = where.get(int(anchor[i]))
        if j is not None:
            A[k, j] += 1.0
            A[j, k] += 1.0
    A += 0.1 * (theme[idx][:, None] == theme[idx][None, :])
    np.fill_diagonal(A, 0.0)
    if m > AFFINITY_K + 1:
        cut = -np.sort(-A, axis=1)[:, AFFINITY_K - 1 : AFFINITY_K]
        A = np.where(A >= cut, A, 0.0)
        A = np.maximum(A, A.T)
    return A


def qap_swap(
    A: np.ndarray, G: np.ndarray, L: np.ndarray, perm: np.ndarray, max_iter: int
) -> np.ndarray:
    """Local search for a quadratic assignment: word i sits at slot perm[i]; minimize
    sum_{i<j} A_ij G_{perm i, perm j} + sum_i L_{i, perm i} by repeatedly applying the best
    improving swap of two words."""
    perm = perm.copy()
    m = len(perm)
    if m < 3:
        return perm
    for _ in range(max_iter):
        Gp = G[np.ix_(perm, perm)]
        Lp = L[:, perm]
        M = A @ Gp
        dM, dL = np.diag(M), np.diag(Lp)
        D = M + M.T - dM[:, None] - dM[None, :] + 2.0 * A * Gp
        D += Lp + Lp.T - dL[:, None] - dL[None, :]
        np.fill_diagonal(D, np.inf)
        k = int(np.argmin(D))
        a, b = divmod(k, m)
        if D[a, b] >= -1e-9:
            break
        perm[[a, b]] = perm[[b, a]]
    return perm


def qap_cost(A: np.ndarray, G: np.ndarray, perm: np.ndarray) -> float:
    return float(0.5 * (A * G[np.ix_(perm, perm)]).sum())


def _place_region(wi, si, X, slots: Slots, words, emb, anchor, theme, idf) -> np.ndarray:
    """Slot (index into slots) for each word in wi."""
    S = slots.xy[si].astype(np.float64)
    W = X[wi] - X[wi].mean(axis=0) + S.mean(axis=0)
    sq = ((W[:, None, :] - S[None, :, :]) ** 2).sum(-1)
    rows, cols = linear_sum_assignment(sq)
    perm = cols[np.argsort(rows)]
    A = _affinity(wi, words, emb, anchor, theme, idf)
    G = np.sqrt(((S[:, None, :] - S[None, :, :]) ** 2).sum(-1))
    pull = LAYOUT_PULL * max(float(A.sum(axis=1).mean()), 1e-6)
    perm = qap_swap(A, G, pull * np.sqrt(sq), perm, max_iter=4 * len(wi))
    return si[perm]


# ---------------------------------------------------------------------------
# world


@dataclass
class World:
    pos: np.ndarray  # (n, 2) int cell per word
    region: np.ndarray  # (n,) region id per word
    regions: list[dict]
    x0: int
    y0: int
    ground: np.ndarray  # (h, w) '<U1'
    region_grid: np.ndarray  # (h, w) int, -1 = sea
    halls: np.ndarray  # (R, 2) int hall cell per region
    lot: np.ndarray  # (n,) lot per word (-1 if moved out of its lot)
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

    # Lots -> regions, then words -> regions (OT from layout positions), then words -> slots.
    lot_region, reg_level = _region_lots(slots, counts)
    R = len(reg_level)
    slot_reg = lot_region[slots.lot]
    caps = np.bincount(slot_reg, minlength=R)
    seeds = np.stack([slots.xy[slot_reg == r].mean(axis=0) for r in range(R)])
    region = np.full(n, -1, dtype=np.int64)
    reg_lv = np.array(reg_level)
    for L in range(1, 8):
        idx = np.where(levels == L)[0]
        rs = np.where(reg_lv == L)[0]
        region[idx] = rs[ot_assign(X[idx], seeds[rs], caps[rs])]
    char_count: Counter[str] = Counter(c for w in words for c in w.chars)
    idf = {c: math.log(n / v) + 1.0 for c, v in char_count.items()}
    pos = np.zeros((n, 2), dtype=np.int64)
    word_lot = np.zeros(n, dtype=np.int64)
    for r in range(R):
        wi = np.where(region == r)[0]
        si = np.where(slot_reg == r)[0]
        chosen = _place_region(wi, si, X, slots, words, emb, anchor, theme, idf)
        pos[wi] = slots.xy[chosen]
        word_lot[wi] = slots.lot[chosen]

    # Cells.
    slot_r = r_shape(slots.xy[:, 0], slots.xy[:, 1])
    land_r = float(slot_r.max()) + 2.5
    ext = int(np.abs(slots.xy).max()) + 12
    x0 = y0 = -ext
    gy, gx = np.mgrid[-ext : ext + 1, -ext : ext + 1]
    fgx, fgy = gx.astype(np.float64), gy.astype(np.float64)
    # Coast: the wobbly outer ring plus small-scale noise (bays and capes), always keeping
    # a margin of land around every word.
    jitter = (fbm(fgx, fgy, 14.0, SEED + 9) - 0.5) * 2 * COAST_JITTER
    land = r_shape(fgx, fgy) <= land_r + jitter
    near_slot = np.zeros(gx.shape, dtype=bool)
    near_slot[slots.xy[:, 1] + ext, slots.xy[:, 0] + ext] = True
    land |= binary_dilation(near_slot, structure=np.ones((3, 3), dtype=bool), iterations=3)
    land = _largest_land(land)
    assert land[slots.xy[:, 1] + ext, slots.xy[:, 0] + ext].all(), "a word is off the island"
    for _ in range(6):
        region_grid, word_dist = _rasterize(pos, region, land, gx, gy, x0, y0)
        if not _fix_exclaves(pos, region, word_lot, region_grid, land, x0, y0):
            break
    else:
        region_grid, word_dist = _rasterize(pos, region, land, gx, gy, x0, y0)
    assert len({(int(x), int(y)) for x, y in pos.tolist()}) == n, "two words on one cell"

    sea_dist = distance_transform_edt(land)
    rr = r_eff(fgx, fgy)
    level_grid = np.zeros(gx.shape, dtype=np.int64)
    level_grid[land] = reg_lv[region_grid[land]]
    wild = level_grid == WILD_LEVEL
    fields = _fields(fgx, fgy)
    halls = _place_halls(region_grid, word_dist, sea_dist, rr, pos, region, R, x0, y0)
    hall_dist = _dist_to(halls, gx.shape)
    water = _water(land, wild, word_dist, sea_dist, hall_dist, rr, fields)
    word_cells = np.zeros(gx.shape, dtype=bool)
    word_cells[pos[:, 1] - y0, pos[:, 0] - x0] = True
    road = _roads(
        land,
        water,
        word_cells,
        region_grid,
        halls,
        pos - [x0, y0],
        region,
        word_lot,
        reg_level,
        (-x0, -y0),
    )
    ground = _terrain(
        land,
        wild,
        region_grid,
        word_dist,
        sea_dist,
        hall_dist,
        rr,
        water,
        road,
        word_cells,
        pos - [x0, y0],
        theme,
        themes_cfg,
        k,
        fields,
    )
    halls_world = halls + [x0, y0]
    regions = _describe_regions(
        words, region, reg_level, theme, themes_cfg, ground, region_grid, halls_world
    )
    stats = {
        "regions": R,
        "lots": len(np.unique(word_lot[word_lot >= 0])),
        "grid": [int(gx.shape[1]), int(gx.shape[0])],
        "land_cells": int(land.sum()),
        "road_cells": int(road.sum()),
        "band_radii": [round(float(b), 2) for b in slots.bands],
        "region_sizes": {
            str(L): [int(caps[r]) for r in range(R) if reg_level[r] == L] for L in range(1, 8)
        },
    }
    return World(pos, region, regions, x0, y0, ground, region_grid, halls_world, word_lot, stats)


def _rasterize(pos, region, land, gx, gy, x0, y0) -> tuple[np.ndarray, np.ndarray]:
    """Each land cell joins the region with the most (Gaussian-weighted) words around it,
    which gives smooth borders through the open land between lots. Word cells keep their
    own region; cells far from every word fall back to the nearest word.
    Returns (region grid, distance to the nearest word)."""
    cells = np.stack([gx[land], gy[land]], axis=1).astype(np.float64)
    dist, near = cKDTree(pos.astype(np.float64)).query(cells, k=1)
    region_grid = np.full(gx.shape, -1, dtype=np.int64)
    region_grid[land] = region[near]
    px, py = pos[:, 0] - x0, pos[:, 1] - y0
    best = np.zeros(gx.shape)
    arg = np.full(gx.shape, -1, dtype=np.int64)
    for r in range(int(region.max()) + 1):
        sel = region == r
        ys, xs = py[sel], px[sel]
        pad = int(SOFT_REGION_SIGMA * 3) + 2
        ya, yb = max(ys.min() - pad, 0), min(ys.max() + pad + 1, gx.shape[0])
        xa, xb = max(xs.min() - pad, 0), min(xs.max() + pad + 1, gx.shape[1])
        ind = np.zeros((yb - ya, xb - xa))
        ind[ys - ya, xs - xa] = 1.0
        f = gaussian_filter(ind, sigma=SOFT_REGION_SIGMA, mode="constant", truncate=3.0)
        sub_best = best[ya:yb, xa:xb]
        upd = f > sub_best + 1e-9
        sub_best[upd] = f[upd]
        arg[ya:yb, xa:xb][upd] = r
    soft = land & (arg >= 0) & (best > 1e-4)
    region_grid[soft] = arg[soft]
    region_grid[py, px] = region
    word_dist = np.full(gx.shape, np.inf)
    word_dist[land] = dist
    _fix_enclaves(region_grid, pos - np.array([x0, y0]))
    return region_grid, word_dist


def _fix_exclaves(pos, region, word_lot, region_grid, land, x0, y0) -> bool:
    """Words stranded in a detached piece of their region swap places with a word of the
    surrounding region that sits next to the main piece (or, failing that, move to a free
    cell next to it). Returns True if anything moved."""
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
                word_lot[[i, j]] = word_lot[[j, i]]
                px[[i, j]] = px[[j, i]]
                py[[i, j]] = py[[j, i]]
                taken.add(j)
                moved = True
                continue
            occ = np.zeros(region_grid.shape, dtype=bool)
            occ[py, px] = True
            occ[py[i], px[i]] = False
            fys, fxs = np.nonzero(near_main & land & (region_grid == r))
            order = np.argsort((fxs - px[i]) ** 2 + (fys - py[i]) ** 2, kind="stable")
            for q in order.tolist():
                fx_, fy_ = int(fxs[q]), int(fys[q])
                if (
                    2 <= fx_ < occ.shape[1] - 3
                    and 1 <= fy_ < occ.shape[0] - 2
                    and gap_free(occ, fx_, fy_)
                ):
                    pos[i] = (fx_ + x0, fy_ + y0)
                    px[i], py[i] = fx_, fy_
                    word_lot[i] = -1
                    moved = True
                    break
    return moved


def _largest_land(land: np.ndarray) -> np.ndarray:
    """One island: fill pockets of sea inside it and drop detached islets."""
    sea, _ = cc_label(~land)
    outer = set(np.unique(np.concatenate([sea[0], sea[-1], sea[:, 0], sea[:, -1]])).tolist())
    outer.discard(0)
    land = ~np.isin(sea, list(outer))
    lab, m = cc_label(land)
    if m > 1:
        sizes = np.bincount(lab.ravel())
        sizes[0] = 0
        land = lab == int(np.argmax(sizes))
    return land


def _fix_enclaves(region_grid: np.ndarray, word_cells: np.ndarray) -> None:
    """Give word-less pockets of a region (cut off from its words) to the bordering region."""
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
# halls


def _place_halls(region_grid, word_dist, sea_dist, rr, pos, region, R, x0, y0) -> np.ndarray:
    """Hall cell (array coordinates) per region: inside the region, clear of words and the
    coast, as close as possible to the middle of the region's words."""
    halls = np.zeros((R, 2), dtype=np.int64)
    for r in range(R):
        ys, xs = np.nonzero(region_grid == r)
        ya, yb, xa, xb = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        cells = region_grid[ya:yb, xa:xb] == r
        inside = distance_transform_edt(np.pad(cells, 1))[1:-1, 1:-1]
        target = pos[region == r].mean(axis=0) - [x0, y0]
        base = cells & (sea_dist[ya:yb, xa:xb] >= 3.5) & (rr[ya:yb, xa:xb] >= PLAZA_RADIUS + 2.5)
        for clear, margin in ((HALL_CLEAR, 2.5), (2.5, 1.5), (2.0, 1.0), (0.0, 0.0)):
            ok = base & (word_dist[ya:yb, xa:xb] >= clear) & (inside >= margin)
            if ok.any():
                cy, cx = np.nonzero(ok)
                d = (cx + xa - target[0]) ** 2 + (cy + ya - target[1]) ** 2
                j = int(np.argmin(d))
                halls[r] = (cx[j] + xa, cy[j] + ya)
                break
    return halls


def _dist_to(points: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    m = np.ones(shape, dtype=bool)
    m[points[:, 1], points[:, 0]] = False
    return distance_transform_edt(m)


# ---------------------------------------------------------------------------
# roads

_NB8 = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0)] + [
    (dy, dx, math.sqrt(2)) for dy in (-1, 1) for dx in (-1, 1)
]
ROAD_REUSE = 0.3  # cost of walking along an existing road (so roads merge into networks)


def _astar(
    cost: np.ndarray,
    blocked: np.ndarray,
    corner: np.ndarray,
    s: tuple[int, int],
    t: tuple[int, int],
    pad: int,
):
    """Cheapest 8-connected path from s to t (array (y, x) cells) within a padded bounding
    box. Diagonal steps never cut a ``corner`` cell (blocked or water), so a walker can
    always follow the road. Returns a list of cells or None."""
    h, w = cost.shape
    ya, yb = max(min(s[0], t[0]) - pad, 0), min(max(s[0], t[0]) + pad, h - 1)
    xa, xb = max(min(s[1], t[1]) - pad, 0), min(max(s[1], t[1]) + pad, w - 1)
    C = cost[ya : yb + 1, xa : xb + 1].tolist()
    B = blocked[ya : yb + 1, xa : xb + 1].tolist()
    K = corner[ya : yb + 1, xa : xb + 1].tolist()
    H, W = yb - ya + 1, xb - xa + 1
    sy, sx, ty, tx = s[0] - ya, s[1] - xa, t[0] - ya, t[1] - xa
    B[sy][sx] = False
    B[ty][tx] = False

    def heur(y: int, x: int) -> float:
        dy, dx = abs(y - ty), abs(x - tx)
        return ROAD_REUSE * (max(dy, dx) + 0.41421356 * min(dy, dx))

    best = {(sy, sx): 0.0}
    came: dict[tuple[int, int], tuple[int, int]] = {}
    heap = [(heur(sy, sx), 0.0, sy, sx)]
    while heap:
        _, g, y, x = heapq.heappop(heap)
        if (y, x) == (ty, tx):
            path = [(y, x)]
            while path[-1] in came:
                path.append(came[path[-1]])
            return [(py + ya, px + xa) for py, px in reversed(path)]
        if g > best.get((y, x), math.inf):
            continue
        for dy, dx, step in _NB8:
            vy, vx = y + dy, x + dx
            if not (0 <= vy < H and 0 <= vx < W) or B[vy][vx]:
                continue
            if dy and dx and (K[y + dy][x] or K[y][x + dx]):
                continue
            ng = g + step * C[vy][vx]
            if ng < best.get((vy, vx), math.inf) - 1e-12:
                best[(vy, vx)] = ng
                came[(vy, vx)] = (y, x)
                heapq.heappush(heap, (ng + heur(vy, vx), ng, vy, vx))
    return None


def _mst_edges(P: np.ndarray, allowed: np.ndarray | None = None) -> list[tuple[int, int]]:
    m = len(P)
    if m < 2:
        return []
    D = np.sqrt(((P[:, None, :] - P[None, :, :]) ** 2).sum(-1)) + 1e-6
    D += 1e-9 * np.arange(m)[:, None]  # deterministic ties
    if allowed is not None:
        D = np.where(allowed, D, 0.0)
    T = minimum_spanning_tree(D).tocoo()
    return sorted((min(a, b), max(a, b)) for a, b in zip(T.row.tolist(), T.col.tolist()))


def _roads(
    land, water, word_cells, region_grid, halls, word_xy, region, word_lot, reg_level, spawn
) -> np.ndarray:
    """Road cells: plaza -> HSK 1 halls, hall <-> neighboring halls (a spanning tree plus
    some loops), and every lot -> its region's hall (a spanning tree per region)."""
    R = len(halls)
    blocked = ~land | word_cells
    blocked[halls[:, 1], halls[:, 0]] = True
    blocked[spawn[1], spawn[0]] = True  # the fountain
    cost = np.ones(land.shape)
    cost[water] = 6.0
    near_word = binary_dilation(word_cells) & ~word_cells
    cost[near_word] += 0.4
    corner = blocked | water
    road = np.zeros(land.shape, dtype=bool)

    def connect(a: tuple[int, int], b: tuple[int, int]) -> None:
        """a, b as (x, y) array cells."""
        s, t = (a[1], a[0]), (b[1], b[0])
        for pad in (10, 30):
            path = _astar(cost, blocked, corner, s, t, pad)
            if path:
                for y, x in path:
                    if not blocked[y, x]:
                        road[y, x] = True
                        cost[y, x] = ROAD_REUSE
                return

    # Plaza to the HSK 1 halls.
    for r in range(R):
        if reg_level[r] == 1:
            connect(spawn, tuple(halls[r]))
    # Hall to hall across region borders.
    pairs = set()
    for a, b in (
        (region_grid[:, :-1], region_grid[:, 1:]),
        (region_grid[:-1, :], region_grid[1:, :]),
    ):
        m = (a != b) & (a >= 0) & (b >= 0)
        for u, v in zip(a[m].tolist(), b[m].tolist()):
            pairs.add((min(u, v), max(u, v)))
    allowed = np.zeros((R, R), dtype=bool)
    for u, v in pairs:
        allowed[u, v] = allowed[v, u] = True
    tree = set(_mst_edges(halls.astype(np.float64), allowed))
    loops = {
        (u, v)
        for u, v in pairs
        if (u, v) not in tree and _hash01(np.array([u]), np.array([v]), SEED + 8)[0] < 0.3
    }
    hall_edges = sorted(
        tree | loops, key=lambda e: (float(np.hypot(*(halls[e[0]] - halls[e[1]]))), e)
    )
    for u, v in hall_edges:
        connect(tuple(halls[u]), tuple(halls[v]))
    # Every lot to its region's hall.
    for r in range(R):
        members = np.where((region == r) & (word_lot >= 0))[0]
        nodes = [tuple(halls[r])]
        for lt in sorted(set(word_lot[members].tolist())):
            cells = word_xy[members[word_lot[members] == lt]]
            c = np.round(cells.mean(axis=0)).astype(np.int64)
            node = _free_near(c, blocked, region_grid, r)
            if node is not None:
                nodes.append(node)
        P = np.array(nodes, dtype=np.float64)
        for a, b in _mst_edges(P):
            connect(nodes[a], nodes[b])
    return road


def _free_near(c: np.ndarray, blocked: np.ndarray, region_grid: np.ndarray, r: int):
    h, w = blocked.shape
    for rad in range(3):
        best = None
        for dy in range(-rad, rad + 1):
            for dx in range(-rad, rad + 1):
                if max(abs(dy), abs(dx)) != rad:
                    continue
                x, y = int(c[0] + dx), int(c[1] + dy)
                if 0 <= x < w and 0 <= y < h and not blocked[y, x] and region_grid[y, x] == r:
                    d = dx * dx + dy * dy
                    if best is None or d < best[0]:
                        best = (d, (x, y))
        if best:
            return best[1]
    return None


# ---------------------------------------------------------------------------
# terrain


def _fields(fx: np.ndarray, fy: np.ndarray) -> dict[str, np.ndarray]:
    return {
        "detail": value_noise(fx, fy, 9.0, SEED + 5),
        "elev": fbm(fx, fy, 24.0, SEED + 6),
        "moist": fbm(fx, fy, 30.0, SEED + 7),
        "pond": fbm(fx, fy, 10.0, SEED + 10),
    }


def _water(land, wild, word_dist, sea_dist, hall_dist, rr, fields) -> np.ndarray:
    """Lakes in the open wilderness and a few ponds in town parks (never on or next to a
    word, a hall or the plaza)."""
    e = fields["elev"]
    lake = wild & (word_dist >= 2.5) & (e < 0.37)
    pond = ~wild & (word_dist >= 3.0) & (fields["pond"] < 0.3)
    water = land & (lake | pond) & (hall_dist > 2.9) & (sea_dist > 2.5) & (rr >= PLAZA_RADIUS + 3)
    # Drop puddles: water bodies smaller than a few cells read as glitches.
    lab, n = cc_label(water)
    sizes = np.bincount(lab.ravel(), minlength=n + 1)
    keep = sizes >= MIN_WATER
    keep[0] = False
    return keep[lab]


def _terrain(
    land,
    wild,
    region_grid,
    word_dist,
    sea_dist,
    hall_dist,
    rr,
    water,
    road,
    word_cells,
    word_xy,
    theme,
    themes_cfg,
    k,
    fields,
) -> np.ndarray:
    h, w = land.shape
    # Local theme field: which themes the nearby words belong to (smoothly blended).
    field_ = np.zeros((k, h, w))
    np.add.at(field_, (theme, word_xy[:, 1], word_xy[:, 0]), 1.0)
    for t in range(k):
        field_[t] = gaussian_filter(field_[t], sigma=4.5, mode="constant")
    local = np.argmax(field_, axis=0)

    detail, e = fields["detail"], fields["elev"]
    bias_m = np.array([t.get("wild", {}).get("moisture", 0.0) for t in themes_cfg])[local]
    bias_e = np.array([t.get("wild", {}).get("elevation", 0.0) for t in themes_cfg])[local]
    dry = np.array([t.get("wild", {}).get("dry", "y") for t in themes_cfg])[local]
    e = e + bias_e
    m = fields["moist"] + bias_m

    g1 = np.array([t["ground"][0] for t in themes_cfg])[local]
    g2 = np.array([t["ground"][1] for t in themes_cfg])[local]
    ground = np.where(detail > 0.64, g2, g1).astype("<U1")

    wg = np.full((h, w), "h", dtype="<U1")
    wg[m > 0.58] = "f"
    wg[(m < 0.40)] = dry[m < 0.40]
    wg[(e < 0.40) & (m > 0.52)] = "x"
    wg[(m >= 0.40) & (m <= 0.58) & (detail > 0.6)] = "g"
    wg[e > 0.66] = "k"
    wg[e > 0.76] = "s"
    ground = np.where(wild, wg, ground)
    ground[water] = "="
    near_hall = hall_dist <= 1.6
    ground[near_hall & ~wild] = "p"
    ground[near_hall & wild] = "d"
    ground[road & water] = "b"
    ground[road & ~water & ~wild] = "+"
    ground[road & ~water & wild] = ","
    ground[land & (rr < PLAZA_RADIUS + 0.9)] = "p"
    coast = land & (sea_dist <= 1.5) & ~np.isin(ground, ["=", "b", "+", ",", "p"])
    ground[coast] = "."
    bad = word_cells & np.isin(ground, list(WATER))
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
    words, region, reg_level, theme, themes_cfg, ground, region_grid, halls
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
                "x": int(halls[r][0]),
                "y": int(halls[r][1]),
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
