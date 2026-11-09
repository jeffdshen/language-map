"""Word embeddings from ConceptNet Numberbatch (multilingual, aligned zh/en space).

Each word gets ``normalize(zh_vec) + normalize(gloss_vec)`` where available:
- ``zh_vec``: Numberbatch vector for the simplified (or traditional) form;
- ``gloss_vec``: weighted mean of Numberbatch English phrase/word vectors for
  the English glosses.
Only the needed rows are extracted from the 1.2 GB source and cached.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re

import numpy as np

from .paths import CACHE_DIR
from .sources import fetch
from .words import Word

DIM = 300
_STOP = set(
    "a an the to of in on at for by with from as or and be is are was something someone sth sb "
    "one's oneself etc used particle form bound coll lit fig e g i e it its this that very "
    "kind sort".split()
)


def _zh_key(s: str) -> str:
    return "/c/zh/" + s


def _en_key(s: str) -> str:
    return "/c/en/" + s


def gloss_units(glosses: list[str], max_glosses: int = 4) -> list[tuple[float, list[str]]]:
    """Split glosses into weighted units; each unit is a list of candidate tokens.

    Returns [(weight, [phrase_key_words...])]. A unit's first element is the
    whole phrase (underscore-joined); remaining elements are content words.
    """
    units: list[tuple[float, list[str]]] = []
    for gi, g in enumerate(glosses[:max_glosses]):
        w = 1.0 / (1.0 + 0.5 * gi)
        subs = [s for s in re.split(r"[;,/]", g) if s.strip()]
        for s in subs[:4]:
            s = re.sub(r"\([^)]*\)", " ", s).lower()
            s = re.sub(r"[^a-z' -]", " ", s)
            toks = [t for t in s.replace("-", " ").split() if t]
            while toks and toks[0] in ("to", "a", "an", "the", "be"):
                toks = toks[1:]
            if not toks:
                continue
            content = [t for t in toks if t not in _STOP and len(t) > 1]
            units.append((w / len(subs[:4]), ["_".join(toks)] + content))
    return units


def _needed_keys(words: list[Word], extra_en: list[str], extra_zh: list[str]) -> set[str]:
    keys: set[str] = set()
    for w in words:
        keys.add(_zh_key(w.hanzi))
        keys.add(_zh_key(w.trad))
        for ch in w.chars:
            keys.add(_zh_key(ch))
        for _, unit in gloss_units(w.glosses):
            keys.update(_en_key(t) for t in unit)
    keys.update(_en_key(k.replace(" ", "_")) for k in extra_en)
    keys.update(_zh_key(k) for k in extra_zh)
    return keys


def load_vectors(keys: set[str]) -> dict[str, np.ndarray]:
    digest = hashlib.sha256("\n".join(sorted(keys)).encode()).hexdigest()[:16]
    cache = CACHE_DIR / f"numberbatch-subset-{digest}.npz"
    if cache.exists():
        with np.load(cache, allow_pickle=False) as data:
            keys_arr, vec_arr = data["keys"].tolist(), data["vecs"]
        return {k: vec_arr[i] for i, k in enumerate(keys_arr)}
    src = fetch("numberbatch")
    found: dict[str, np.ndarray] = {}
    print(f"[embed] scanning numberbatch for {len(keys)} keys ...")
    with gzip.open(src, "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            if not line.startswith(("/c/zh/", "/c/en/")):
                continue
            k, _, rest = line.partition(" ")
            if k in keys:
                found[k] = np.array(rest.split(), dtype=np.float32)
    ks = sorted(found)
    np.savez_compressed(cache, keys=np.array(ks), vecs=np.stack([found[k] for k in ks]))
    return found


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


def gloss_vector(glosses: list[str], vecs: dict[str, np.ndarray]) -> np.ndarray | None:
    acc = np.zeros(DIM, dtype=np.float64)
    total = 0.0
    for weight, unit in gloss_units(glosses):
        phrase = vecs.get(_en_key(unit[0]))
        if phrase is not None:
            v = _unit(phrase.astype(np.float64))
        else:
            parts = [vecs[_en_key(t)] for t in unit[1:] if _en_key(t) in vecs]
            if not parts:
                continue
            v = _unit(np.mean([_unit(p.astype(np.float64)) for p in parts], axis=0))
        acc += weight * v
        total += weight
    return _unit(acc) if total > 0 else None


def embed_words(words: list[Word], themes: list[dict]) -> tuple[np.ndarray, dict]:
    """Return (N x DIM unit vectors, stats)."""
    extra_en = [k for t in themes for k in t["en_keywords"]]
    extra_zh = [k for t in themes for k in t["zh_keywords"]]
    vecs = load_vectors(_needed_keys(words, extra_en, extra_zh))

    out = np.zeros((len(words), DIM), dtype=np.float64)
    stats = {"zh+en": 0, "zh": 0, "en": 0, "chars": 0}
    missing: list[int] = []
    for i, w in enumerate(words):
        zh = vecs.get(_zh_key(w.hanzi))
        if zh is None:
            zh = vecs.get(_zh_key(w.trad))
        en = gloss_vector(w.glosses, vecs)
        if zh is not None and en is not None:
            out[i] = _unit(_unit(zh.astype(np.float64)) + en)
            stats["zh+en"] += 1
        elif zh is not None:
            out[i] = _unit(zh.astype(np.float64))
            stats["zh"] += 1
        elif en is not None:
            out[i] = en
            stats["en"] += 1
        else:
            missing.append(i)
    for i in missing:
        parts = [vecs[_zh_key(c)] for c in words[i].chars if _zh_key(c) in vecs]
        if parts:
            out[i] = _unit(np.mean([_unit(p.astype(np.float64)) for p in parts], axis=0))
            stats["chars"] += 1
    stats["none"] = int(sum(1 for i in missing if not np.any(out[i])))
    return out.astype(np.float32), {**stats, "vectors": vecs}


def theme_vectors(themes: list[dict], vecs: dict[str, np.ndarray]) -> np.ndarray:
    rows = []
    for t in themes:
        parts = [vecs.get(_en_key(k.replace(" ", "_"))) for k in t["en_keywords"]]
        parts += [vecs.get(_zh_key(k)) for k in t["zh_keywords"]]
        parts = [_unit(p.astype(np.float64)) for p in parts if p is not None]
        rows.append(_unit(np.mean(parts, axis=0)))
    return np.stack(rows).astype(np.float32)


def embedding_digest(emb: np.ndarray) -> str:
    return hashlib.sha256(np.round(emb, 5).tobytes()).hexdigest()[:16]


def dump_stats(stats: dict) -> str:
    return json.dumps({k: v for k, v in stats.items() if k != "vectors"})
