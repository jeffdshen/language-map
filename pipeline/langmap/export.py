"""Write the language pack (committed artifacts) and the human-readable report."""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path

import numpy as np

from .sources import load_lock
from .words import LEVEL_LABELS, Word, pos_category
from .world import GROUND, LAYOUT_VERSION, World, region_runs, world_stats

SCHEMA_VERSION = 3

WORD_FIELDS = [
    "id",
    "hanzi",
    "pinyin",
    "level",
    "pos",
    "theme",
    "region",
    "x",
    "y",
    "anchor",
    "freq",
    "glosses",
    "neighbors",
    "trad",
    "alts",
]
REGION_FIELDS = ["id", "level", "kind", "theme", "zh", "en", "count", "cells", "x", "y", "color"]
N_STARTERS = 8


def _dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _write_lists(path: Path, header: dict, lists: dict[str, list]) -> str:
    """JSON object: compact header keys, then each list with one item per line (readable
    diffs). Returns sha256 of the text."""
    items = [f"{_dumps(k)}:{_dumps(v)}" for k, v in header.items()]
    items += [f"{_dumps(k)}:[\n" + ",\n".join(_dumps(x) for x in v) + "]" for k, v in lists.items()]
    text = "{\n" + ",\n".join(items) + "}\n"
    path.write_text(text, encoding="utf-8")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def pick_starters(words: list[Word], world: World, limit: int = N_STARTERS) -> list[int]:
    """The HSK 1 words nearest the spawn point (the most frequent words sit there)."""
    d = np.hypot(world.pos[:, 0], world.pos[:, 1])
    l1 = [w.index for w in words if w.level == 1]
    return sorted(sorted(l1, key=lambda i: (float(d[i]), -words[i].freq, i))[:limit])


def legacy_bands(legacy: dict[str, str]) -> dict[str, list[int]]:
    """Old ids ``L<band>-<seq>`` -> per-band arrays of new word numbers (``w00157`` -> 157;
    0 = no match), indexed by seq - 1."""
    out: dict[str, list[int]] = {}
    for old, new in sorted(legacy.items()):
        m = re.fullmatch(r"(L\d)-(\d+)", old)
        if not m:
            continue
        arr = out.setdefault(m.group(1), [])
        seq = int(m.group(2))
        arr.extend([0] * (seq - len(arr)))
        arr[seq - 1] = int(new.lstrip("w"))
    return dict(sorted(out.items()))


def export_pack(
    out_dir: Path,
    words: list[Word],
    theme: np.ndarray,
    anchor: np.ndarray,
    neighbors: np.ndarray,
    world: World,
    themes_cfg: list[dict],
    sentences: list[dict],
    by_word: list[list[int]],
    legacy: dict[str, str],
    stats: dict,
) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in ("regions.json",):
        (out_dir / stale).unlink(missing_ok=True)

    rows = []
    for w in words:
        i = w.index
        rows.append(
            [
                w.id,
                w.hanzi,
                w.pinyin,
                w.level,
                pos_category(w),
                int(theme[i]),
                int(world.region[i]),
                int(world.pos[i, 0]),
                int(world.pos[i, 1]),
                int(anchor[i]),
                w.freq,
                w.glosses,
                [int(j) for j in neighbors[i]],
                w.trad,
                w.alts,
            ]
        )
    words_hash = _write_lists(out_dir / "words.json", {"fields": WORD_FIELDS}, {"rows": rows})

    w_, h_ = world.size
    world_hash = _write_lists(
        out_dir / "world.json",
        {
            "grid": {"x0": world.x0, "y0": world.y0, "w": w_, "h": h_},
            "spawn": [0, 0],
            "ground": {k: {"name": n, "color": c} for k, (n, c) in GROUND.items()},
            "themes": [
                {
                    "key": t["key"],
                    "zh": t["zh"],
                    "en": t["en"],
                    "biome": t["biome"],
                    "color": t["color"],
                    "place": t["place"],
                    "count": int(np.sum(theme == j)),
                }
                for j, t in enumerate(themes_cfg)
            ],
            "regionFields": REGION_FIELDS,
        },
        {
            "regions": [[r[f] for f in REGION_FIELDS] for r in world.regions],
            "terrain": ["".join(row) for row in world.ground.tolist()],
            "regionRuns": region_runs(world.region_grid),
        },
    )

    srows = [[s["id"], s["en_id"], s["en"], s["seg"]] for s in sentences]
    sentences_hash = _write_lists(
        out_dir / "sentences.json",
        {"fields": ["id", "en_id", "en", "seg"]},
        {"rows": srows, "byWord": by_word},
    )

    legacy_hash = _write_lists(
        out_dir / "legacy-ids.json",
        {
            "from": "pack schema 1 (2021 HSK 3.0 list, ids L<band>-<seq>)",
            "to": "w<number> ids; 0 = no match",
        },
        {"bands": [[k, v] for k, v in legacy_bands(legacy).items()]},
    )

    lock = load_lock()
    content_hash = hashlib.sha256(
        (words_hash + world_hash + sentences_hash + legacy_hash).encode()
    ).hexdigest()[:16]
    levels = np.array([w.level for w in words])
    reg_levels = Counter(r["level"] for r in world.regions)
    manifest = {
        "schema": SCHEMA_VERSION,
        "pack": "zh-en",
        "title": "Mandarin Chinese → English (HSK 3.0, 2025 syllabus)",
        "target": {"lang": "zh-Hans", "name": "中文", "tts": "zh-CN"},
        "source": {"lang": "en", "name": "English"},
        "layoutVersion": LAYOUT_VERSION,
        "contentHash": content_hash,
        "files": {
            "words": "words.json",
            "world": "world.json",
            "sentences": "sentences.json",
            "legacy": "legacy-ids.json",
        },
        "levels": [
            {
                "level": lvl,
                "label": LEVEL_LABELS[lvl],
                "count": int(np.sum(levels == lvl)),
                "regions": reg_levels[lvl],
            }
            for lvl in range(1, 8)
        ],
        "starters": pick_starters(words, world),
        "counts": {
            "words": len(words),
            "sentences": len(sentences),
            "regions": len(world.regions),
        },
        "sources": [
            {
                "key": key,
                "name": v["name"],
                "url": v["url"],
                "homepage": v["homepage"],
                "license": v["license"],
                "sha256": v["sha256"],
            }
            for key, v in lock.items()
        ],
        "stats": {**stats, "world": {**world.stats, **world_stats(world, words)}},
    }
    del manifest["stats"]["world"]["region_sizes"]
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    return manifest


def write_report(
    path: Path,
    words: list[Word],
    theme: np.ndarray,
    world: World,
    themes_cfg: list[dict],
    manifest: dict,
) -> None:
    levels = np.array([w.level for w in words])
    lines = [
        "# zh-en pack report",
        "",
        "Generated by `uv run langmap build`. Review this diff when the pipeline changes.",
        "",
        f"- Content hash: `{manifest['contentHash']}`",
        (
            f"- Words: {len(words)}; sentences: {manifest['counts']['sentences']}; "
            f"regions: {manifest['counts']['regions']}"
        ),
        (
            f"- Grid: {world.size[0]}×{world.size[1]} cells; "
            f"land: {manifest['stats']['world']['land_cells']} cells"
        ),
        (
            f"- Lots (hamlets): {manifest['stats']['world']['lots']}; "
            f"road cells: {manifest['stats']['world']['road_cells']}"
        ),
        "- Words per land cell by distance from the center (must never increase outward): "
        + ", ".join(str(d) for d in manifest["stats"]["world"]["density_by_distance"]),
        "",
        "## Themes",
        "",
        "| Theme | Town | " + " | ".join(LEVEL_LABELS[lvl] for lvl in range(1, 8)) + " | Total |",
        "|---|---|" + "---|" * 8,
    ]
    for j, t in enumerate(themes_cfg):
        counts = [int(np.sum((theme == j) & (levels == lvl))) for lvl in range(1, 8)]
        lines.append(
            f"| {t['zh']} {t['en']} | {t['place']['zh']} {t['place']['en']} | "
            + " | ".join(map(str, counts))
            + f" | {sum(counts)} |"
        )
    lines += ["", "## Regions", ""]
    for lvl in range(1, 8):
        regs = [r for r in world.regions if r["level"] == lvl]
        sizes = sorted({r["count"] for r in regs})
        lines.append(
            f"**{LEVEL_LABELS[lvl]}** ({len(regs)} regions of {'–'.join(map(str, sizes))} "
            "words): " + ", ".join(f"{r['zh']} {r['en']}" for r in regs)
        )
        lines.append("")
    lines += ["## Sentence coverage", "", "| Level | Words with sentences |", "|---|---|"]
    for lvl, (have, total) in manifest["stats"]["sentences"]["coverage_by_level"].items():
        lines.append(f"| {LEVEL_LABELS[int(lvl)]} | {have}/{total} ({100 * have / total:.0f}%) |")
    lines += ["", "## Starters", "", ", ".join(words[i].hanzi for i in manifest["starters"]), ""]
    lines += ["## Stats", "", "```json", json.dumps(manifest["stats"], indent=1), "```", ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
