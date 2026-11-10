"""Speech hints: what the app's text-to-speech should read aloud for a word.

Browser voices give a character on its own its most common reading, so a word whose reading is
not the usual one (地 de, 还 huán, 行 háng) is read wrong when spoken alone, and so is the rarer
of two words written the same way (结果 jiēguǒ "to bear fruit" vs jiéguǒ "result"). For those
words ``say`` swaps the misread characters for common characters that are (almost) only ever read
the wanted way: 还 huán -> 环, 行 háng -> 航, 结果 jiēguǒ -> 接果.

pypinyin's default reading stands in for what a voice would say, except for a lone character that
is also taught with another reading (长 cháng / zhǎng): voices differ there, so unless the
character is itself nearly always read one way, every reading of it is spelled out. Neutral-tone
differences (得 de vs dé) and 一/不 tone sandhi are left alone: voices handle those well enough.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Sequence
from functools import cache

from opencc import OpenCC
from pypinyin import Style, lazy_pinyin, pinyin
from wordfreq import get_frequency_dict

from .pinyin import strip_tones, syllable_tone

HAN = re.compile(r"[\u3400-\u9fff]")
# Characters voices already read right in context (tone sandhi).
SANDHI = set("一不")
# A stand-in must be common enough for every voice to know it (about the 3,500 most common)...
MIN_CHAR_FREQ = 1e-5
# ...and read the one way in this share of its uses, so a voice reads it that way on its own.
MIN_SHARE = 0.9


def _norm(p: str) -> str:
    return re.sub(r"[\s'’\-·]", "", unicodedata.normalize("NFC", p).lower())


def _readings(ch: str) -> list[str]:
    out = list(pinyin(ch, style=Style.TONE, heteronym=True)[0])
    out += [strip_tones(r) for r in out]
    if ch == "儿":
        out.append("r")
    return list(dict.fromkeys(out))


def align(hanzi: str, py: str) -> list[str] | None:
    """Split a word's pinyin into one syllable per character ('jiēguǒ' -> ['jiē', 'guǒ'])."""
    chars = list(hanzi)

    def go(k: int, rest: str) -> list[str] | None:
        if k == len(chars):
            return [] if not rest else None
        if not HAN.match(chars[k]):
            return None
        for r in sorted(_readings(chars[k]), key=len, reverse=True):
            if rest.startswith(r):
                tail = go(k + 1, rest[len(r) :])
                if tail is not None:
                    return [r, *tail]
        return None

    return go(0, _norm(py))


def misread(want: str, got: str) -> bool:
    """A voice saying ``got`` for ``want`` is wrong (a neutral tone on either side is fine)."""
    if strip_tones(want) != strip_tones(got):
        return True
    a, b = syllable_tone(want), syllable_tone(got)
    return bool(a and b and a != b)


@cache
def char_readings() -> dict[str, Counter[str]]:
    """Han character -> how often it occurs read each way in running text (wordfreq's words, read
    with pypinyin's phrase dictionary). A neutral tone counts as the character's own tone when it
    has just one for that syllable (子 in 桌子 counts as zǐ)."""
    raw: dict[str, Counter[str]] = {}
    for word, f in get_frequency_dict("zh").items():
        readings = lazy_pinyin(word, style=Style.TONE)
        if len(readings) != len(word):
            continue
        for ch, r in zip(word, readings):
            if HAN.match(ch):
                raw.setdefault(ch, Counter())[unicodedata.normalize("NFC", r)] += f
    out = {}
    for ch, counts in raw.items():
        folded: Counter[str] = Counter()
        for r, f in counts.items():
            toned = [t for t in counts if syllable_tone(t) and strip_tones(t) == r]
            folded[toned[0] if not syllable_tone(r) and len(toned) == 1 else r] += f
        out[ch] = folded
    return out


@cache
def stand_ins() -> dict[str, str]:
    """Reading -> the common simplified character a voice reads that way on its own."""
    t2s = OpenCC("t2s")
    best: dict[str, tuple[float, str]] = {}
    for ch, counts in char_readings().items():
        total = sum(counts.values())
        if total < MIN_CHAR_FREQ or not 0x4E00 <= ord(ch) <= 0x9FFF or t2s.convert(ch) != ch:
            continue
        r, f = counts.most_common(1)[0]
        share = f / total
        if share < MIN_SHARE:
            continue
        score = total * share**8
        if r not in best or (score, ch) > best[r]:
            best[r] = (score, ch)
    return {r: ch for r, (_, ch) in best.items()}


def say_for(hanzi: str, py: str, others: Sequence[str] = ()) -> str | None:
    """Text to speak for a word, or None when its characters are read right as they are.

    ``others`` are the pinyin of other words written the same way. Multi-character words are only
    checked when there are some: voices read words from a dictionary, so only a homograph's rarer
    reading goes wrong. A lone character that is also taught with another reading (长 cháng /
    zhǎng) may be read either way, so each of its readings is spelled out."""
    if len(hanzi) > 1 and not others:
        return None
    alts = [a for a in py.split("/") if a.strip()]
    got = lazy_pinyin(hanzi, style=Style.TONE)
    if not alts or len(got) != len(hanzi):
        return None
    want = align(hanzi, alts[0])
    if want is None:
        return None
    if len(hanzi) == 1 and any(misread(want[0], _norm(o.split("/")[0])) for o in others):
        wrong = [True]
    else:
        for alt in alts:
            w = align(hanzi, alt)
            if w is not None and not any(misread(a, b) for a, b in zip(w, got)):
                return None
        wrong = [misread(w, g) for w, g in zip(want, got)]
    out = []
    for ch, w, bad in zip(hanzi, want, wrong):
        sub = stand_ins().get(w) if bad and ch not in SANDHI else None
        out.append(sub or ch)
    say = "".join(out)
    return say if say != hanzi else None


def speech_overrides(entries: list[tuple[str, str, str]]) -> list[list[str]]:
    """``[[word id, text to speak], ...]`` for words a voice would misread. ``entries`` are
    (id, hanzi, pinyin)."""
    readings: dict[str, list[tuple[str, str]]] = {}
    for wid, hanzi, py in entries:
        readings.setdefault(hanzi, []).append((wid, py))
    out = []
    for wid, hanzi, py in entries:
        others = [p for i, p in readings[hanzi] if i != wid]
        say = say_for(hanzi, py, others)
        if say:
            out.append([wid, say])
    return out
