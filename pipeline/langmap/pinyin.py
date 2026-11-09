"""Pinyin helpers (tone marks <-> numbers, search normalization)."""

from __future__ import annotations

import re
import unicodedata

_TONE_MARKS = {
    "a": "āáǎà",
    "e": "ēéěè",
    "i": "īíǐì",
    "o": "ōóǒò",
    "u": "ūúǔù",
    "ü": "ǖǘǚǜ",
}
_MARK_TO_BASE = {
    m: (base, i + 1) for base, marks in _TONE_MARKS.items() for i, m in enumerate(marks)
}


def strip_tones(s: str) -> str:
    """'xué sheng' -> 'xue sheng'; 'lǜ' -> 'lü'."""
    out = []
    for ch in s:
        if ch in _MARK_TO_BASE:
            out.append(_MARK_TO_BASE[ch][0])
        else:
            out.append(ch)
    return "".join(out)


def search_key(s: str) -> str:
    """Lowercase, toneless, ü->v, letters only. 'Xuésheng' -> 'xuesheng'."""
    s = strip_tones(unicodedata.normalize("NFC", s)).lower().replace("ü", "v").replace("u:", "v")
    return re.sub(r"[^a-z]", "", s)


def numeric_syllable_to_marked(syl: str) -> str:
    """'xue2' -> 'xué', 'lu:4' -> 'lǜ', 'de5' -> 'de'."""
    m = re.fullmatch(r"([A-Za-zü:]+)([1-5])?", syl)
    if not m:
        return syl
    body, tone = m.group(1).replace("u:", "ü").replace("v", "ü"), m.group(2)
    if not tone or tone == "5":
        return body
    t = int(tone) - 1
    lower = body.lower()
    # Standard placement: a/e first, 'ou' -> o, else last vowel.
    if "a" in lower:
        idx = lower.index("a")
    elif "e" in lower:
        idx = lower.index("e")
    elif "ou" in lower:
        idx = lower.index("o")
    else:
        idx = max(lower.rfind(v) for v in "iouü")
        if idx < 0:
            return body
    base = lower[idx]
    marked = _TONE_MARKS[base][t]
    if body[idx].isupper():
        marked = marked.upper()
    return body[:idx] + marked + body[idx + 1 :]


def normalize_numeric(p: str) -> str:
    """Normalize numbered pinyin for comparisons: lowercase, ü/u: -> v."""
    return p.lower().replace("u:", "v").replace("ü", "v").strip()
