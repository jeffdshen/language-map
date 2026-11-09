"""Load and normalize the HSK 3.0 word list into language-agnostic Word records."""

from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass, field

from .paths import CONFIG_DIR
from .pinyin import normalize_numeric
from .sources import fetch

LEVELS = {"1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7-9": 7}
LEVEL_LABELS = {
    1: "HSK 1",
    2: "HSK 2",
    3: "HSK 3",
    4: "HSK 4",
    5: "HSK 5",
    6: "HSK 6",
    7: "HSK 7–9",
}

# hsk30 POS code -> generic category used by the app for shapes/appearance.
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


def _parse_cedict_key(key: str) -> tuple[str, str, str] | None:
    m = re.fullmatch(r"(.+?)\|(.+?)\[(.+)\]", key.strip())
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3)


def _forms_for_key(dk: dict, key: str) -> list[dict]:
    parsed = _parse_cedict_key(key)
    if not parsed:
        return []
    trad, simp, num = parsed
    entry = dk.get(simp)
    if not entry:
        return []
    forms = entry["f"]
    exact = [f for f in forms if f["t"] == trad and f["i"]["n"] == num]
    if exact:
        return exact
    loose = [f for f in forms if normalize_numeric(f["i"]["n"]) == normalize_numeric(num)]
    if loose:
        return [f for f in loose if f["t"] == trad] or loose
    return []


def load_words() -> list[Word]:
    rows = list(csv.DictReader(fetch("hsk30").open(encoding="utf-8")))
    dk = {w["s"]: w for w in json.loads(fetch("complete-hsk").read_text(encoding="utf-8"))}
    overrides = json.loads((CONFIG_DIR / "zh-en" / "gloss_overrides.json").read_text("utf-8"))

    words: list[Word] = []
    for r in rows:
        variants = json.loads(r["Variants"]) if r["Variants"] else []
        proper = [v for v in variants if not v.get("Example")]
        if proper:
            main = proper[0]
            hanzi, pinyin = main["Simplified"], main["Pinyin"]
            trad = main.get("Traditional", r["Traditional"]).split("|")[0]
            alts = []
            for v in proper[1:]:
                for a in (v["Simplified"], v["Pinyin"]):
                    if a not in alts and a not in (hanzi, pinyin):
                        alts.append(a)
        else:
            hanzi, pinyin = r["Simplified"], r["Pinyin"]
            trad = r["Traditional"].split("|")[0]
            alts = []
        pos = [p for p in r["POS"].split("/") if p] or []

        meanings: list[str] = []
        if r["ID"] in overrides:
            meanings = overrides[r["ID"]]
        else:
            for key in [k for k in r["CEDICT"].split("/") if k]:
                for f in _forms_for_key(dk, key):
                    meanings.extend(f["m"])
            if not meanings and hanzi in dk:
                for f in dk[hanzi]["f"]:
                    meanings.extend(f["m"])
        glosses = clean_glosses(meanings)

        words.append(
            Word(
                id=r["ID"],
                hanzi=hanzi,
                pinyin=pinyin,
                level=LEVELS[r["Level"]],
                pos=pos,
                trad=trad,
                glosses=glosses,
                alts=alts,
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


def load_char_levels() -> dict[str, int]:
    rows = csv.DictReader(fetch("hsk30-chars").open(encoding="utf-8"))
    return {r["Hanzi"]: LEVELS.get(r["Level"], 7) for r in rows}


def pos_category(w: Word) -> str:
    for p in w.pos:
        if p in POS_CATEGORY:
            return POS_CATEGORY[p]
    return "phrase"
