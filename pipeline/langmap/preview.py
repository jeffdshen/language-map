"""Debug/review previews of the world as PNGs (not used by the app)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .world import GROUND, World

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


def _base(world: World, cell: int, window: tuple[slice, slice] | None = None) -> Image.Image:
    """Ground colors with region borders (darker where the HSK level changes).

    ``window`` crops the grid (array rows, cols) before upscaling.
    """
    win = window or (slice(None), slice(None))
    codes = sorted(GROUND)
    lut = np.array([_hex(GROUND[c][1]) for c in codes], dtype=np.uint8)
    gi = np.searchsorted(np.array(codes), world.ground[win])
    rgb = lut[gi].repeat(cell, axis=0).repeat(cell, axis=1).astype(np.float32)
    reg = world.region_grid[win]
    level = np.array([r["level"] for r in world.regions] + [0])[reg]
    h, w = reg.shape
    for dy, dx in ((0, 1), (1, 0)):
        a = reg[: h - dy, : w - dx]
        b = reg[dy:, dx:]
        edge = (a != b) & (a >= 0) & (b >= 0)
        lv = level[: h - dy, : w - dx] != level[dy:, dx:]
        for y, x in zip(*np.nonzero(edge)):
            dark = 0.35 if lv[y, x] else 0.7
            if dx:
                sl = np.s_[y * cell : (y + 1) * cell, (x + 1) * cell - 1 : (x + 1) * cell + 1]
            else:
                sl = np.s_[(y + 1) * cell - 1 : (y + 1) * cell + 1, x * cell : (x + 1) * cell]
            rgb[sl] *= dark
    return Image.fromarray(rgb.clip(0, 255).astype(np.uint8))


def render_preview(
    out: Path, world: World, theme: np.ndarray, themes: list[dict], cell: int = 6
) -> None:
    """Whole-world overview: terrain, region borders, words as dots, region names."""
    img = _base(world, cell)
    d = ImageDraw.Draw(img, "RGBA")
    colors = np.array([_hex(t["color"]) for t in themes])
    for i, (x, y) in enumerate(world.pos.tolist()):
        cx, cy = (x - world.x0 + 0.5) * cell, (y - world.y0 + 0.5) * cell
        c = tuple(int(v * 0.55) for v in colors[theme[i]])
        d.rectangle(
            [cx - cell * 0.32, cy - cell * 0.32, cx + cell * 0.32, cy + cell * 0.32],
            fill=c + (255,),
        )
    for x, y in world.halls.tolist():
        cx, cy = (x - world.x0 + 0.5) * cell, (y - world.y0 + 0.5) * cell
        d.rectangle(
            [cx - cell, cy - cell, cx + cell, cy + cell],
            fill=(150, 40, 40, 255),
            outline=(255, 255, 255, 255),
        )
    f = _font(max(10, int(cell * 1.5)))
    for r in world.regions:
        cx, cy = (r["x"] - world.x0 + 0.5) * cell, (r["y"] - world.y0 + 0.5) * cell
        d.text(
            (cx, cy),
            r["zh"],
            font=f,
            fill=(20, 20, 20, 255),
            anchor="mm",
            stroke_width=2,
            stroke_fill=(255, 255, 255, 200),
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").quantize(colors=128, dither=0).save(out, optimize=True)


def render_closeup(
    out: Path, world: World, hanzi: list[str], radius: int = 32, cell: int = 22
) -> None:
    """The middle of the map at roughly game scale, with every word labeled."""
    cx, cy = -world.x0, -world.y0
    window = (slice(cy - radius, cy + radius + 1), slice(cx - radius, cx + radius + 1))
    img = _base(world, cell, window)
    d = ImageDraw.Draw(img, "RGBA")
    for x, y in world.halls.tolist():
        if abs(x) > radius or abs(y) > radius:
            continue
        px, py = (x + radius + 0.5) * cell, (y + radius + 0.5) * cell
        d.rectangle(
            [px - cell * 0.45, py - cell * 0.45, px + cell * 0.45, py + cell * 0.45],
            fill=(150, 40, 40, 255),
        )
    f = _font(int(cell * 0.9))
    for i, (x, y) in enumerate(world.pos.tolist()):
        if abs(x) > radius or abs(y) > radius:
            continue
        px, py = (x + radius + 0.5) * cell, (y + radius + 0.5) * cell
        d.text(
            (px, py),
            hanzi[i],
            font=f,
            fill=(20, 20, 20, 255),
            anchor="mm",
            stroke_width=2,
            stroke_fill=(255, 255, 255, 220),
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").quantize(colors=128, dither=0).save(out, optimize=True)
