"""Write the language pack (committed artifacts) and the human-readable report."""

from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from pathlib import Path

import numpy as np

from .layout import LAYOUT_VERSION, Geometry
from .sources import load_lock
from .words import LEVEL_LABELS, Word, pos_category

SCHEMA_VERSION = 1

WORD_FIELDS = [
    "id",
    "hanzi",
    "pinyin",
    "level",
    "pos",
    "theme",
    "x",
    "y",
    "anchor",
    "freq",
    "glosses",
    "neighbors",
    "trad",
    "alts",
]


def _dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _write_rows(path: Path, header: dict, rows: list, extra: dict | None = None) -> str:
    """JSON object with one row per line (readable diffs). Returns sha256."""
    parts = ["{"]
    for k, v in header.items():
        parts.append(f"{_dumps(k)}:{_dumps(v)},")
    parts.append('"rows":[')
    parts.append(",\n".join(_dumps(r) for r in rows))
    parts.append("]")
    for k, v in (extra or {}).items():
        parts.append(f",\n{_dumps(k)}:[")
        parts.append(",\n".join(_dumps(x) for x in v))
        parts.append("]")
    parts.append("}\n")
    text = "\n".join(parts[:2]) + "\n" + "\n".join(parts[2:])
    path.write_text(text, encoding="utf-8")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def pick_starters(words: list[Word], theme: np.ndarray, k: int, limit: int = 10) -> list[int]:
    """Most frequent HSK 1 word in each of the themes with the most HSK 1 words."""
    l1 = [w for w in words if w.level == 1]
    counts = Counter(int(theme[w.index]) for w in l1)
    ranked = sorted(counts, key=lambda t: (-counts[t], t))[:limit]
    out = []
    for t in ranked:
        best = min((w for w in l1 if theme[w.index] == t), key=lambda w: (-w.freq, w.index))
        out.append(best.index)
    return sorted(out)


def region_labels(geo: Geometry, k: int) -> list[list[dict]]:
    """Label anchor points per theme: one in the inner rings, one in the frontier."""
    out = []
    for t in range(k):
        labels = []
        for band, size in ((2, 1.0), (6, 1.6)):
            r = float(geo.mids[band])
            lo = float(np.interp(r, geo.mids, geo.bounds[:, t]))
            hi = float(np.interp(r, geo.mids, geo.bounds[:, t + 1]))
            a = (lo + hi) / 2
            labels.append(
                {
                    "x": round(r * math.cos(a), 2),
                    "y": round(r * math.sin(a), 2),
                    "angle": round(a, 4),
                    "arc": round((hi - lo) * r, 2),
                    "size": size,
                }
            )
        out.append(labels)
    return out


def export_pack(
    out_dir: Path,
    words: list[Word],
    theme: np.ndarray,
    P: np.ndarray,
    anchor: np.ndarray,
    neighbors: np.ndarray,
    geo: Geometry,
    themes_cfg: list[dict],
    sentences: list[dict],
    by_word: list[list[int]],
    stats: dict,
) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    k = len(themes_cfg)

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
                float(P[i, 0]),
                float(P[i, 1]),
                int(anchor[i]),
                w.freq,
                w.glosses,
                [int(j) for j in neighbors[i]],
                w.trad,
                w.alts,
            ]
        )
    words_hash = _write_rows(out_dir / "words.json", {"fields": WORD_FIELDS}, rows)

    labels = region_labels(geo, k)
    regions = {
        "themes": [
            {
                "key": t["key"],
                "zh": t["zh"],
                "en": t["en"],
                "biome": t["biome"],
                "color": t["color"],
                "count": int(np.sum(theme == j)),
                "labels": labels[j],
            }
            for j, t in enumerate(themes_cfg)
        ],
        "geometry": {
            "theta0": round(geo.theta0, 6),
            "radii": [round(float(r), 3) for r in geo.radii],
            "mids": [round(float(r), 3) for r in geo.mids],
            "bounds": [[round(float(b), 5) for b in row] for row in geo.bounds],
        },
    }
    regions_text = json.dumps(regions, ensure_ascii=False, indent=1) + "\n"
    (out_dir / "regions.json").write_text(regions_text, encoding="utf-8")
    regions_hash = hashlib.sha256(regions_text.encode()).hexdigest()

    srows = [[s["id"], s["en_id"], s["en"], s["seg"]] for s in sentences]
    sentences_hash = _write_rows(
        out_dir / "sentences.json",
        {"fields": ["id", "en_id", "en", "seg"]},
        srows,
        {"byWord": by_word},
    )

    lock = load_lock()
    content_hash = hashlib.sha256(
        (words_hash + regions_hash + sentences_hash).encode()
    ).hexdigest()[:16]
    manifest = {
        "schema": SCHEMA_VERSION,
        "pack": "zh-en",
        "title": "Mandarin Chinese → English (HSK 3.0)",
        "target": {"lang": "zh-Hans", "name": "中文", "tts": "zh-CN"},
        "source": {"lang": "en", "name": "English"},
        "layoutVersion": LAYOUT_VERSION,
        "contentHash": content_hash,
        "files": {"words": "words.json", "regions": "regions.json", "sentences": "sentences.json"},
        "levels": [
            {
                "level": lvl,
                "label": LEVEL_LABELS[lvl],
                "inner": round(float(geo.radii[lvl - 1]), 3),
                "outer": round(float(geo.radii[lvl]), 3),
                "count": sum(1 for w in words if w.level == lvl),
            }
            for lvl in range(1, 8)
        ],
        "worldRadius": round(float(geo.radii[-1]), 3),
        "coreRadius": round(float(geo.radii[0]), 3),
        "starters": pick_starters(words, theme, k),
        "counts": {"words": len(words), "sentences": len(sentences)},
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
        "stats": stats,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    return manifest


def write_report(
    path: Path,
    words: list[Word],
    theme: np.ndarray,
    anchor: np.ndarray,
    themes_cfg: list[dict],
    manifest: dict,
) -> None:
    lines = [
        "# zh-en pack report",
        "",
        "Generated by `uv run langmap build`. Review this diff when the pipeline changes.",
        "",
        f"- Content hash: `{manifest['contentHash']}`",
        f"- Words: {len(words)}; sentences: {manifest['counts']['sentences']}",
        f"- World radius: {manifest['worldRadius']}",
        "",
        "## Regions",
        "",
        "| Region | " + " | ".join(LEVEL_LABELS[lvl] for lvl in range(1, 8)) + " | Total |",
        "|---|" + "---|" * 8,
    ]
    for j, t in enumerate(themes_cfg):
        counts = [
            int(np.sum((theme == j) & (np.array([w.level for w in words]) == lvl)))
            for lvl in range(1, 8)
        ]
        lines.append(
            f"| {t['zh']} {t['en']} | " + " | ".join(map(str, counts)) + f" | {sum(counts)} |"
        )
    lines += ["", "## Sentence coverage", "", "| Level | Words with sentences |", "|---|---|"]
    for lvl, (have, total) in manifest["stats"]["sentences"]["coverage_by_level"].items():
        lines.append(f"| {LEVEL_LABELS[int(lvl)]} | {have}/{total} ({100 * have / total:.0f}%) |")
    kids = Counter(int(a) for a in anchor if a >= 0)
    hubs = ", ".join(f"{words[i].hanzi} ({c})" for i, c in kids.most_common(20))
    lines += ["", "## Biggest hubs (children anchored to the word)", "", hubs, ""]
    lines += ["## Starters", "", ", ".join(words[i].hanzi for i in manifest["starters"]), ""]
    lines += ["## Stats", "", "```json", json.dumps(manifest["stats"], indent=1), "```", ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
