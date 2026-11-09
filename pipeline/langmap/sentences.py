"""Example sentence selection from Tatoeba (deterministic).

For each word, choose up to N sentences that contain it as a segmented token and
whose other words are mostly at or below the word's HSK level. Sentences must
be in simplified characters and have an English translation.
"""

from __future__ import annotations

import json
import re
import tarfile
from dataclasses import dataclass

import jieba
from opencc import OpenCC
from pypinyin import Style, lazy_pinyin

from .pinyin import strip_tones
from .sources import fetch
from .words import Word

MAX_PER_WORD = 6
HAN = re.compile(r"[\u3400-\u9fff]")
ALLOWED = re.compile(r"^[\u3400-\u9fff\u3007，。！？、；：“”‘’（）《》…—·0-9０-９ ]+$")
UNKNOWN_LEVEL = 8


@dataclass
class Sentence:
    id: int
    zh: str
    en_id: int
    en: str
    tokens: list[str]


def load_tatoeba() -> list[tuple[int, str, int, str]]:
    with tarfile.open(fetch("tatoeba"), "r:gz") as tar:
        member = tar.getmember("package/sentences.json")
        data = json.load(tar.extractfile(member))  # type: ignore[arg-type]
    best: dict[int, tuple[str, int, str]] = {}
    for cid, zh, eid, en in data:
        c, e = int(cid), int(eid)
        if c not in best or e < best[c][1]:
            best[c] = (zh, e, en)
    return [(c, zh, e, en) for c, (zh, e, en) in sorted(best.items())]


def make_tokenizer(words: list[Word]) -> jieba.Tokenizer:
    tok = jieba.Tokenizer()
    tok.initialize()
    for form in sorted(
        {w.hanzi for w in words} | {a for w in words for a in w.alts if HAN.search(a)}
    ):
        if len(form) > 1:
            tok.add_word(form)
    return tok


def filter_sentences(rows: list[tuple[int, str, int, str]]) -> list[tuple[int, str, int, str]]:
    cc = OpenCC("t2s")
    out = []
    for c, zh, e, en in rows:
        zh = zh.strip()
        n_han = len(HAN.findall(zh))
        if not (3 <= n_han <= 28) or not ALLOWED.match(zh):
            continue
        if cc.convert(zh) != zh:  # keep sentences already in simplified script
            continue
        out.append((c, zh, e, en.strip()))
    return out


def _py_key(p: str) -> str:
    return re.sub(r"[\s'’\-·]", "", p.lower())


def _encode_seg(words: list[Word], tok: str, py: str, w: int) -> list:
    """[tok] for punctuation, [tok, w] when the word's own pinyin applies, else [tok, w, py]."""
    if not py and w < 0:
        return [tok]
    if w >= 0 and tok == words[w].hanzi and py == words[w].pinyin:
        return [tok, w]
    return [tok, w, py]


def select_sentences(
    words: list[Word], char_levels: dict[str, int]
) -> tuple[list[dict], list[list[int]], dict]:
    rows = filter_sentences(load_tatoeba())
    tok = make_tokenizer(words)

    by_form: dict[str, list[int]] = {}
    for w in words:
        by_form.setdefault(w.hanzi, []).append(w.index)
        for a in w.alts:
            if HAN.search(a) and a != w.hanzi:
                by_form.setdefault(a, []).append(w.index)

    def token_level(t: str) -> int | None:
        if not HAN.search(t):
            return None
        if t in by_form:
            return min(words[i].level for i in by_form[t])
        lv = [char_levels.get(ch, UNKNOWN_LEVEL) for ch in t if HAN.match(ch)]
        return min(UNKNOWN_LEVEL, max(lv) + (1 if len(t) > 1 else 0))

    candidates: dict[int, list[tuple[float, int, int]]] = {}
    sentences: list[Sentence] = []
    seg_cache: list[list[tuple[str, str, int]]] = []
    for c, zh, e, en in rows:
        tokens = tok.lcut(zh, HMM=False)
        segs: list[tuple[str, str, int]] = []
        occurrences: list[int] = []
        for t in tokens:
            py = "".join(lazy_pinyin(t, style=Style.TONE)) if HAN.search(t) else ""
            widx = -1
            if t in by_form:
                ids = by_form[t]
                if len(ids) > 1:  # homographs: match by reading
                    exact = [i for i in ids if _py_key(words[i].pinyin) == _py_key(py)]
                    loose = [
                        i
                        for i in ids
                        if _py_key(strip_tones(words[i].pinyin)) == _py_key(strip_tones(py))
                    ]
                    ids = exact or loose or ids[:1]
                widx = ids[0]
                py = words[widx].pinyin if t == words[widx].hanzi else py
                occurrences.extend(ids)
            segs.append((t, py, widx))
        if not occurrences:
            continue
        s_idx = len(sentences)
        sentences.append(Sentence(c, zh, e, en, tokens))
        seg_cache.append(segs)
        levels = [token_level(t) for t in tokens]
        n_han = len(HAN.findall(zh))
        for wi in dict.fromkeys(occurrences):
            L = words[wi].level
            others = [lv for t, lv in zip(tokens, levels) if lv is not None]
            if others:
                others.remove(min(others, key=lambda v: abs(v - L)))
            over = [max(0, lv - L) for lv in others]
            k = max(1, len(others))
            difficulty = sum(over) / k + 0.6 * sum(1 for o in over if o > 0) / k
            lo, hi = (4, 14) if L <= 3 else (6, 20)
            length_pen = 0.04 * (max(0, lo - n_han) + max(0, n_han - hi))
            candidates.setdefault(wi, []).append((round(difficulty + length_pen, 6), n_han, s_idx))

    by_word: list[list[int]] = [[] for _ in words]
    used: dict[int, int] = {}
    for wi in sorted(candidates):
        chosen: list[int] = []
        seen_zh: set[str] = set()
        seen_en: set[str] = set()
        for _, _, s_idx in sorted(candidates[wi], key=lambda x: (x[0], x[1], sentences[x[2]].id)):
            s = sentences[s_idx]
            key_zh = re.sub(r"[^\u3400-\u9fff]", "", s.zh)
            key_en = s.en.lower().strip(" .!?")
            if key_zh in seen_zh or key_en in seen_en:
                continue
            seen_zh.add(key_zh)
            seen_en.add(key_en)
            chosen.append(s_idx)
            if len(chosen) >= MAX_PER_WORD:
                break
        by_word[wi] = chosen
        for s_idx in chosen:
            used.setdefault(s_idx, 0)

    # Re-index to only the used sentences, ordered by Tatoeba id.
    used_sorted = sorted(used, key=lambda i: sentences[i].id)
    remap = {old: new for new, old in enumerate(used_sorted)}
    out_sentences = [
        {
            "id": sentences[i].id,
            "en_id": sentences[i].en_id,
            "en": sentences[i].en,
            "seg": [_encode_seg(words, t, py, w) for t, py, w in seg_cache[i]],
        }
        for i in used_sorted
    ]
    out_by_word = [[remap[i] for i in lst] for lst in by_word]
    stats = {
        "tatoeba_pairs_simplified": len(rows),
        "sentences_used": len(out_sentences),
        "coverage_by_level": {
            str(lvl): [
                sum(1 for w in words if w.level == lvl and out_by_word[w.index]),
                sum(1 for w in words if w.level == lvl),
            ]
            for lvl in range(1, 8)
        },
    }
    return out_sentences, out_by_word, stats
