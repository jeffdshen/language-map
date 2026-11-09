"""Load and normalize the HSK 3.0 word list into language-agnostic Word records.

The word list, levels, order and parts of speech come from the official 2025 HSK
exam syllabus (via the HearMandarin dataset). English glosses are the dataset's
short teaching gloss followed by CC-CEDICT senses. The older 2021 list
(ivankra/hsk30) is only used to map ids from old saves and for alternate forms.
"""

from __future__ import annotations

import csv
import json
import re
from collections import Counter
from dataclasses import dataclass, field

from .pinyin import normalize_numeric
from .sources import fetch

LEGACY_LEVELS = {"1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7-9": 7}
LEVEL_LABELS = {
    1: "HSK 1",
    2: "HSK 2",
    3: "HSK 3",
    4: "HSK 4",
    5: "HSK 5",
    6: "HSK 6",
    7: "HSK 7–9",
}

# Official syllabus POS (Chinese) -> internal POS code (also used by themes.json pos_rules).
POS_ZH = {
    "名": "N",
    "动": "V",
    "形": "Adj",
    "副": "Adv",
    "代": "Pron",
    "数": "Num",
    "量": "M",
    "数量": "M",
    "介": "Prep",
    "连": "Conj",
    "助": "Aux",
    "叹": "Intj",
    "拟声": "Phonetic",
    "前缀": "Prefix",
    "后缀": "Suffix",
}

# POS code -> generic category used by the app for landmarks/appearance.
POS_CATEGORY = {
    "N": "noun",
    "V": "verb",
    "Adj": "adj",
    "Adv": "adv",
    "Pron": "pron",
    "Pr": "pron",
    "Num": "num",
    "M": "measure",
    "Prep": "prep",
    "Conj": "conj",
    "Aux": "particle",
    "Intj": "interj",
    "Prefix": "affix",
    "Suffix": "affix",
    "Phonetic": "onomat",
}

HAN_RE = re.compile(r"[\u3400-\u9fff\u3007]")


@dataclass
class Word:
    id: str
    hanzi: str
    pinyin: str
    level: int
    pos: list[str]
    trad: str
    glosses: list[str]
    alts: list[str] = field(default_factory=list)  # alternative forms / readings for search
    freq: float = 0.0  # Zipf frequency (wordfreq)
    index: int = -1

    @property
    def chars(self) -> list[str]:
        seen: list[str] = []
        for ch in self.hanzi:
            if HAN_RE.match(ch) and ch not in seen:
                seen.append(ch)
        return seen


_DROP_GLOSS = re.compile(
    r"^(surname |old variant of|variant of|see also |see |also written|also pr\.|"
    r"Taiwan pr\.|erhua variant|CL:|\(Tw\)|\(old\) variant)",
    re.IGNORECASE,
)
_REF_PAIR = re.compile(r"([^\s|\[\],;]+)\|([^\s|\[\],;]+)\[[^\]]*\]")
_REF_ONE = re.compile(r"([\u3400-\u9fff]+)\[[A-Za-z0-9: ]+\]")


def clean_glosses(meanings: list[str], limit: int = 8) -> list[str]:
    def tidy(m: str) -> str:
        m = re.sub(r"\s*\bCL:.*$", "", m)
        m = _REF_PAIR.sub(r"\2", m)
        m = _REF_ONE.sub(r"\1", m)
        return re.sub(r"\s+", " ", m).strip(" ;,")

    kept = [tidy(m) for m in meanings if not _DROP_GLOSS.match(m.strip())]
    if not kept:
        kept = [tidy(m) for m in meanings if not m.lower().startswith("surname")]
    if not kept:
        kept = [tidy(m) for m in meanings]
    out: list[str] = []
    for m in kept:
        if m and m not in out:
            out.append(m)
    return out[:limit]


def parse_pos_zh(pos_zh: str) -> list[str]:
    """'动、（名、量）' -> ['V', 'N', 'M']: primary uses first, parenthesized (minor) uses after."""
    primary: list[str] = []
    minor: list[str] = []
    in_paren = False
    for tok in pos_zh.split("、"):
        tok = tok.strip()
        opens, closes = tok.startswith("（"), tok.endswith("）")
        tok = tok.strip("（）() ")
        code = POS_ZH.get(tok)
        if code:
            dest = minor if (in_paren or opens) else primary
            if code not in primary and code not in minor:
                dest.append(code)
        if opens and not closes:
            in_paren = True
        if closes:
            in_paren = False
    return primary + minor


def _py_key(num: str, tones: bool = True) -> str:
    k = re.sub(r"[\s\-·']", "", normalize_numeric(num))
    return k if tones else re.sub(r"[1-5]", "", k)


def cedict_meanings(dk: dict, simp: str, pinyin_num: str) -> list[str]:
    """CC-CEDICT senses for (simplified, reading): exact tones, else toneless, else sole reading."""
    entry = dk.get(simp)
    if not entry:
        return []
    forms = entry["f"]
    match = [f for f in forms if _py_key(f["i"]["n"]) == _py_key(pinyin_num)]
    if not match:
        bare = _py_key(pinyin_num, tones=False)
        match = [f for f in forms if _py_key(f["i"]["n"], tones=False) == bare]
    if not match and len({_py_key(f["i"]["n"], tones=False) for f in forms}) == 1:
        match = forms
    return [m for f in match for m in f["m"]]


def split_gloss(gloss: str) -> list[str]:
    return [g.strip() for g in gloss.split(";") if g.strip()]


def dedupe_senses(glosses: list[str], limit: int = 8) -> list[str]:
    """Drop ';'-separated parts already given by an earlier sense ('eight', 'eight; 8' -> '8')."""
    seen: set[str] = set()
    out: list[str] = []
    for g in glosses:
        parts = [p for p in split_gloss(g) if p.lower() not in seen]
        seen.update(p.lower() for p in parts)
        if parts:
            out.append("; ".join(parts))
    return out[:limit]


def _legacy_rows() -> list[dict]:
    """The 2021 list (ivankra/hsk30) as {id, hanzi, pinyin, level, alts} rows."""
    out = []
    for r in csv.DictReader(fetch("hsk30").open(encoding="utf-8")):
        variants = json.loads(r["Variants"]) if r["Variants"] else []
        proper = [v for v in variants if not v.get("Example")]
        alts: list[str] = []
        if proper:
            hanzi, pinyin = proper[0]["Simplified"], proper[0]["Pinyin"]
            for v in proper[1:]:
                for a in (v["Simplified"], v["Pinyin"]):
                    if a not in alts and a not in (hanzi, pinyin):
                        alts.append(a)
        else:
            hanzi, pinyin = r["Simplified"], r["Pinyin"]
        out.append(
            {
                "id": r["ID"],
                "hanzi": hanzi,
                "pinyin": pinyin,
                "level": LEGACY_LEVELS[r["Level"]],
                "alts": alts,
            }
        )
    return out


def _match_key(hanzi: str, pinyin: str) -> tuple[str, str]:
    return hanzi, re.sub(r"[\s\-·']", "", pinyin.lower())


def legacy_id_map(words: list[Word]) -> dict[str, str]:
    """Old (2021 list) word id -> new id, for migrating saves. Unmatched ids are omitted.

    Matches on (hanzi, pinyin), then hanzi alone; among several candidates (the
    syllabus repeats some words at different levels) the closest level wins.
    """
    by_key: dict[tuple[str, str], list[Word]] = {}
    by_hanzi: dict[str, list[Word]] = {}
    for w in words:
        by_key.setdefault(_match_key(w.hanzi, w.pinyin), []).append(w)
        by_hanzi.setdefault(w.hanzi, []).append(w)
    out: dict[str, str] = {}
    for r in _legacy_rows():
        cands = by_key.get(_match_key(r["hanzi"], r["pinyin"])) or by_hanzi.get(r["hanzi"])
        if cands:
            best = min(cands, key=lambda w: (abs(w.level - r["level"]), w.index))
            out[r["id"]] = best.id
    return out


def load_words() -> list[Word]:
    rows = [
        r
        for r in csv.DictReader(fetch("hsk2025").open(encoding="utf-8"))
        if r["hsk3_band"] and r["hsk3_seq"]
    ]
    rows.sort(key=lambda r: int(r["hsk3_seq"]))
    dk = {w["s"]: w for w in json.loads(fetch("complete-hsk").read_text(encoding="utf-8"))}
    legacy_alts: dict[tuple[str, str], list[str]] = {}
    for r in _legacy_rows():
        legacy_alts.setdefault(_match_key(r["hanzi"], r["pinyin"]), []).extend(r["alts"])
    repeated = Counter(_match_key(r["simplified"], r["pinyin"]) for r in rows)

    words: list[Word] = []
    for r in rows:
        hanzi, pinyin = r["simplified"].strip(), r["pinyin"].strip()
        key = _match_key(hanzi, pinyin)
        glosses = [r["gloss_en"].strip()]
        # Words the syllabus lists twice (different senses) keep only their own teaching gloss.
        if repeated[key] == 1:
            glosses += clean_glosses(cedict_meanings(dk, hanzi, r["pinyin_num"]))
        words.append(
            Word(
                id=r["id"],
                hanzi=hanzi,
                pinyin=pinyin,
                level=int(r["hsk3_band"]),
                pos=parse_pos_zh(r["pos_zh"]),
                trad=r["traditional"].strip() or hanzi,
                glosses=dedupe_senses(glosses),
                alts=[a for a in legacy_alts.get(key, []) if a not in (hanzi, pinyin)],
            )
        )

    _add_frequencies(words)
    for i, w in enumerate(words):
        w.index = i
    return words


def _add_frequencies(words: list[Word]) -> None:
    from wordfreq import zipf_frequency

    for w in words:
        w.freq = round(float(zipf_frequency(w.hanzi, "zh")), 2)


def char_levels(words: list[Word]) -> dict[str, int]:
    """Level at which each character first appears in the word list."""
    out: dict[str, int] = {}
    for w in words:
        for ch in w.chars:
            out[ch] = min(out.get(ch, 99), w.level)
    return out


def pos_category(w: Word) -> str:
    for p in w.pos:
        if p in POS_CATEGORY:
            return POS_CATEGORY[p]
    return "phrase"
