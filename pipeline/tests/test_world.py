import itertools
from collections import deque

import numpy as np
import pytest
from scipy.ndimage import label
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree

from langmap.themes import load_theme_config
from langmap.words import Word
from langmap.world import (
    GAP_X,
    GAP_Y,
    REGION_CAP,
    build_world,
    ot_assign,
    qap_cost,
    qap_swap,
    region_runs,
    world_stats,
)

COUNTS = [60, 40, 90, 120, 180, 200, 480]


def _synthetic():
    rng = np.random.default_rng(7)
    words, levels = [], []
    for lvl, c in enumerate(COUNTS, start=1):
        levels += [lvl] * c
    n = len(levels)
    for i, lvl in enumerate(levels):
        words.append(
            Word(
                f"w{i + 1:05d}",
                chr(0x4E00 + i),
                "a",
                lvl,
                [["N", "V", "Adj"][i % 3]],
                "",
                [["apple", "run", "quiet"][i % 3]],
                freq=float(rng.uniform(1, 7)),
                index=i,
            )
        )
    themes = load_theme_config()["themes"]
    emb = rng.normal(size=(n, 16)).astype(np.float32)
    theme = rng.integers(0, len(themes), n)
    lv = np.array(levels)
    anchor = np.array(
        [int(rng.choice(np.where(lv < lv[i])[0])) if lv[i] > 1 else -1 for i in range(n)]
    )
    neighbors = rng.integers(0, n, (n, 5))
    return words, emb, theme, anchor, neighbors, themes


@pytest.fixture(scope="module")
def built():
    words, emb, theme, anchor, neighbors, themes = _synthetic()
    return words, build_world(words, emb, theme, anchor, neighbors, themes)


def test_deterministic(built):
    _words, w1 = built
    w2 = build_world(*_synthetic())
    assert np.array_equal(w1.pos, w2.pos)
    assert np.array_equal(w1.region, w2.region)
    assert np.array_equal(w1.ground, w2.ground)
    assert w1.regions == w2.regions


def test_words_never_touch(built):
    _, w = built
    assert len({tuple(p) for p in w.pos.tolist()}) == len(w.pos)
    # Chebyshev distance >= 2: no two words in 8-adjacent cells.
    assert not cKDTree(w.pos).query_pairs(1.5, p=np.inf)


def test_words_keep_room_for_name_plates(built):
    _, w = built
    for a, b in cKDTree(w.pos).query_pairs(max(GAP_X, GAP_Y) + 1, p=np.inf):
        dx, dy = np.abs(w.pos[a] - w.pos[b])
        assert dy >= GAP_Y or dx >= GAP_X, (w.pos[a], w.pos[b])


def test_halls_inside_regions_and_clear(built):
    _, w = built
    assert len(w.halls) == len(w.regions)
    occupied = {tuple(p) for p in w.pos.tolist()}
    for r, (x, y) in zip(w.regions, w.halls.tolist()):
        assert (r["x"], r["y"]) == (x, y)
        assert w.region_grid[y - w.y0, x - w.x0] == r["id"]
        assert w.ground[y - w.y0, x - w.x0] not in ("~", "=")
        assert (x, y) not in occupied
        d = np.abs(w.pos - [x, y]).max(axis=1).min()
        assert d >= 2, f"hall {r['id']} is next to a word"


def _walkable(w):
    """Cells the player can stand on: land (bridges included), not words, halls or the
    fountain at the spawn point."""
    ok = ~np.isin(w.ground, ["~", "="])
    ok[w.pos[:, 1] - w.y0, w.pos[:, 0] - w.x0] = False
    ok[w.halls[:, 1] - w.y0, w.halls[:, 0] - w.x0] = False
    ok[-w.y0, -w.x0] = False
    return ok


def test_every_word_and_hall_reachable_from_spawn(built):
    _, w = built
    ok = _walkable(w)
    h, wd = ok.shape
    seen = np.zeros_like(ok)
    start = (-w.y0 + 2, -w.x0)
    assert ok[start]
    seen[start] = True
    q = deque([start])
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            v = (y + dy, x + dx)
            if 0 <= v[0] < h and 0 <= v[1] < wd and ok[v] and not seen[v]:
                seen[v] = True
                q.append(v)
    for x, y in np.concatenate([w.pos, w.halls]).tolist():
        cy, cx = y - w.y0, x - w.x0
        assert any(seen[cy + dy, cx + dx] for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1))), (
            f"({x}, {y}) cannot be reached"
        )


def test_roads_lead_to_every_hall(built):
    _, w = built
    road = np.isin(w.ground, ["+", ",", "b", "p", "d"])
    lab, _ = label(road, structure=np.ones((3, 3)))
    plaza = lab[-w.y0 + 1, -w.x0]
    assert plaza > 0
    for x, y in w.halls.tolist():
        cy, cx = y - w.y0, x - w.x0
        around = lab[cy - 1 : cy + 2, cx - 1 : cx + 2]
        assert (around == plaza).any(), f"hall at ({x}, {y}) is off the road network"


def test_regions_capped_single_level_contiguous(built):
    words, w = built
    levels = np.array([x.level for x in words])
    for r in w.regions:
        members = np.where(w.region == r["id"])[0]
        assert len(members) == r["count"] <= REGION_CAP[r["level"]]
        assert set(levels[members].tolist()) == {r["level"]}
        _, m = label(w.region_grid == r["id"])
        assert m == 1, f"region {r['id']} is in {m} pieces"
    px, py = w.pos[:, 0] - w.x0, w.pos[:, 1] - w.y0
    assert np.array_equal(w.region_grid[py, px], w.region)
    assert not np.isin(w.ground[py, px], ["~", "="]).any()


def test_density_never_increases_outward(built):
    words, w = built
    s = world_stats(w, words)
    d = s["density_by_distance"]
    assert all(b <= a * 1.06 for a, b in itertools.pairwise(d)), d
    mean_r = s["mean_distance_by_level"]
    assert all(b > a for a, b in itertools.pairwise(mean_r)), mean_r


def test_region_runs_roundtrip(built):
    _, w = built
    for row, runs in zip(w.region_grid.tolist(), region_runs(w.region_grid)):
        decoded = [v for v, n in zip(runs[::2], runs[1::2]) for _ in range(n)]
        assert decoded == row


def test_ot_assign_is_optimal_and_exact():
    rng = np.random.default_rng(3)
    pts = rng.uniform(0, 20, (60, 2))
    seeds = rng.uniform(0, 20, (4, 2))
    caps = np.array([10, 20, 5, 25])
    lab = ot_assign(pts, seeds, caps)
    assert np.array_equal(np.bincount(lab, minlength=4), caps)
    cost = ((pts - seeds[lab]) ** 2).sum()
    cols = np.repeat(np.arange(4), caps)
    D = ((pts[:, None, :] - seeds[cols][None, :, :]) ** 2).sum(-1)
    r, c = linear_sum_assignment(D)
    assert cost == pytest.approx(D[r, c].sum())


def test_qap_swap_never_worsens():
    rng = np.random.default_rng(5)
    m = 24
    A = rng.uniform(0, 1, (m, m)) * (rng.uniform(0, 1, (m, m)) < 0.2)
    A = np.triu(A, 1)
    A = A + A.T
    P = rng.uniform(0, 10, (m, 2))
    G = np.sqrt(((P[:, None] - P[None]) ** 2).sum(-1))
    perm0 = rng.permutation(m)
    perm = qap_swap(A, G, np.zeros((m, m)), perm0, max_iter=200)
    assert sorted(perm.tolist()) == list(range(m))
    assert qap_cost(A, G, perm) < qap_cost(A, G, perm0)
