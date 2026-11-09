"""Debug/review preview of the layout as a PNG (not used by the app)."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .layout import Geometry, _unwrap

_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]


def _font(size: int):
    for p in _FONT_CANDIDATES:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def _hex(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return tuple(int(c[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def render_preview(
    out: Path,
    P: np.ndarray,
    hanzi: list[str],
    levels: np.ndarray,
    theme: np.ndarray,
    anchor: np.ndarray,
    geo: Geometry,
    themes: list[dict],
    size: int = 2400,
    label_levels: int = 1,
) -> None:
    R = float(geo.radii[-1]) + 4
    scale = size / (2 * R)

    def to_px(x, y):
        return (x + R) * scale, (y + R) * scale

    # Terrain: theme by (r, theta) via sector bounds.
    g = 600
    ys, xs = np.mgrid[0:g, 0:g]
    wx = (xs + 0.5) / g * 2 * R - R
    wy = (ys + 0.5) / g * 2 * R - R
    rr = np.hypot(wx, wy).ravel()
    th = _unwrap(np.arctan2(wy, wx).ravel(), geo.theta0)
    tid = np.full(rr.shape, -1)
    for t in range(len(themes)):
        lo, hi = geo.sector_bounds(np.maximum(rr, geo.mids[0]), np.full(rr.shape, t))
        tid[(th >= lo) & (th < hi)] = t
    colors = np.array([_hex(t["color"]) for t in themes], dtype=np.float64)
    img_arr = np.zeros((g * g, 3))
    img_arr[:] = (40, 70, 110)
    land = rr <= geo.radii[-1] + 1.5
    img_arr[land] = colors[tid[land]] * 0.75 + 255 * 0.25
    core = rr <= geo.radii[0]
    img_arr[core] = (245, 240, 225)
    terrain = Image.fromarray(img_arr.reshape(g, g, 3).astype(np.uint8)).resize((size, size))
    img = terrain.convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")

    for rad in geo.radii:
        x0, y0 = to_px(-rad, -rad)
        x1, y1 = to_px(rad, rad)
        d.ellipse([x0, y0, x1, y1], outline=(60, 60, 60, 90), width=2)

    for i, a in enumerate(anchor.tolist()):
        if a >= 0:
            d.line([to_px(*P[i]), to_px(*P[a])], fill=(80, 60, 40, 50), width=1)

    dot = max(2, int(scale * 0.35))
    for i in range(len(P)):
        x, y = to_px(*P[i])
        c = tuple(int(v * 0.55) for v in colors[theme[i]])
        d.ellipse([x - dot, y - dot, x + dot, y + dot], fill=c + (255,))

    f = _font(max(10, int(scale * 0.8)))
    for i in np.where(levels <= label_levels)[0]:
        x, y = to_px(*P[i])
        d.text((x, y - dot), hanzi[i], font=f, fill=(20, 20, 20, 255), anchor="md")

    ft = _font(int(size / 55))
    for t, spec in enumerate(themes):
        mid_r = float(geo.mids[4])
        lo, hi = geo.sector_bounds(np.array([mid_r]), np.array([t]))
        a = (lo[0] + hi[0]) / 2
        x, y = to_px(mid_r * math.cos(a), mid_r * math.sin(a))
        d.text((x, y), f"{spec['zh']} {spec['en']}", font=ft, fill=(0, 0, 0, 200), anchor="mm")

    out.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").quantize(colors=128, dither=0).save(out, optimize=True)
