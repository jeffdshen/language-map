"""Kokoro phonemes for the pack's Chinese, read from the pack's own pinyin.

Clips (``langmap audio``, docs/audio.md) are synthesized from phonemes rather than text, so that
they say exactly the pinyin the app shows: the word's own reading, and each sentence token's
reading as segmented by ``sentences.py``. Kokoro's text front ends (misaki, sherpa-onnx's lexicon)
would guess readings themselves: sherpa-onnx reads 东西 dōngxī and 不去 bù qù.

Kokoro v1.1-zh's phonemes are misaki's: a zhuyin-like initial, one symbol per final (some finals
are written with a stand-in character, e.g. 言 for -ian), then the tone digit (5 = neutral);
erhua adds ``R`` before the tone. The tables below were derived from (and checked against) the
model's ``lexicon-zh.txt``.

Tone sandhi is applied here, as speakers do and as the pinyin in the app (dictionary tones) does
not: 不 and 一 before a fourth tone, 一 before other tones, and third tone before third tone.
"""

from __future__ import annotations

import re
import unicodedata
from functools import cache

from pypinyin import Style, lazy_pinyin, pinyin
from pypinyin.contrib.tone_convert import to_finals, to_initials

from .pinyin import strip_tones, syllable_tone

INITIALS = {
    "b": "ㄅ", "p": "ㄆ", "m": "ㄇ", "f": "ㄈ", "d": "ㄉ", "t": "ㄊ", "n": "ㄋ", "l": "ㄌ",
    "g": "ㄍ", "k": "ㄎ", "h": "ㄏ", "j": "ㄐ", "q": "ㄑ", "x": "ㄒ", "zh": "ㄓ", "ch": "ㄔ",
    "sh": "ㄕ", "r": "ㄖ", "z": "ㄗ", "c": "ㄘ", "s": "ㄙ",
}  # fmt: skip
FINALS = {
    "a": "ㄚ", "o": "ㄛ", "e": "ㄜ", "ê": "ㄝ", "ie": "ㄝ", "ai": "ㄞ", "ei": "ㄟ", "ao": "ㄠ",
    "ou": "ㄡ", "an": "ㄢ", "en": "ㄣ", "ang": "ㄤ", "eng": "ㄥ", "er": "ㄦ", "i": "ㄧ",
    "u": "ㄨ", "v": "ㄩ", "ia": "压", "ian": "言", "iang": "阳", "iao": "要", "in": "阴",
    "ing": "应", "iong": "用", "iou": "又", "ong": "中", "ua": "穵", "uai": "外", "uan": "万",
    "uang": "王", "uei": "为", "uen": "文", "ueng": "瓮", "uo": "我", "van": "元", "ve": "月",
    "vn": "云", "io": "又",
}  # fmt: skip
# -i after zh/ch/sh/r and after z/c/s are different vowels.
RETROFLEX_I, DENTAL_I = "十", "ㄭ"
# Syllabic nasals (嗯 ńg, 呣 m̀): no Kokoro phoneme, so the nearest syllable.
NASALS = {"n": ["ㄣ"], "ng": ["ㄥ"], "m": ["ㄇ", "ㄨ"], "hm": ["ㄏ", "ㄇ"], "hng": ["ㄏ", "ㄥ"]}
PUNCT = {
    "。": ".", "，": ",", "、": ",", "？": "?", "！": "!", "：": ":", "；": ";", "…": "…",
    "—": "—", "“": "“", "”": "”", "（": "(", "）": ")", "《": "“", "》": "”",
    ".": ".", ",": ",", "?": "?", "!": "!", ":": ":", ";": ";", '"': '"', "(": "(", ")": ")",
}  # fmt: skip
# misaki (Kokoro's training front end) follows these with a space; words are joined by "/".
SPACED = {".", ",", "?", "!", ":", ";", ")"}
WORD_SEP = "/"
HAN = re.compile(r"[\u3400-\u9fff]")
DIGITS = "零一二三四五六七八九"
NUMERAL_CHARS = set(DIGITS) | {"〇", "十", "百", "千", "万", "亿", "两"}

# (character, toneless pinyin with ü as v and a trailing r for erhua, tone 1-5)
Syl = tuple[str, str, int]


def syllable_phonemes(base: str, tone: int) -> list[str]:
    """'hao', 3 -> ['ㄏ', 'ㄠ', '3']; 'nar' (哪儿) -> ['ㄋ', 'ㄚ', 'R', '3']."""
    erhua = base.endswith("r") and base != "er"
    if erhua:
        base = base[:-1]
    if base in NASALS:
        return [*NASALS[base], str(tone)]
    ini = to_initials(base, strict=True)
    fin = to_finals(base, strict=True)
    if fin == "i" and ini in ("zh", "ch", "sh", "r"):
        f = RETROFLEX_I
    elif fin == "i" and ini in ("z", "c", "s"):
        f = DENTAL_I
    elif fin in FINALS:
        f = FINALS[fin]
    else:
        raise ValueError(f"no phonemes for pinyin {base!r}")
    out = [INITIALS[ini]] if ini else []
    if erhua and fin == "e":  # 这儿 zhèr
        out.append(FINALS["er"])
    else:
        out.append(f)
        if erhua:
            out.append("R")
    return [*out, str(tone)]


@cache
def _readings(ch: str) -> tuple[str, ...]:
    """Every toneless reading of a character pypinyin knows, ü as v."""
    return tuple(
        dict.fromkeys(
            r.replace("ü", "v") for r in pinyin(ch, style=Style.NORMAL, heteronym=True)[0]
        )
    )


# Tone marks on syllabic nasals (嗯 ǹg), which pinyin.strip_tones doesn't know.
_NASAL_MARKS = {"ń": ("n", 2), "ň": ("n", 3), "ǹ": ("n", 4), "ḿ": ("m", 2)}


def _norm_pinyin(py: str) -> str:
    """Lowercase NFC pinyin without separators; of alternatives ('shéi/shuí') the first."""
    py = unicodedata.normalize("NFC", py.split("/")[0]).lower()
    return re.sub(r"[\s'’‘\-·]", "", py)


def _strip(marked: str) -> str:
    return "".join(_NASAL_MARKS[c][0] if c in _NASAL_MARKS else c for c in strip_tones(marked))


def _tone(marked: str) -> int:
    for c in marked:
        if c in _NASAL_MARKS:
            return _NASAL_MARKS[c][1]
    return syllable_tone(marked) or 5


def split_pinyin(hanzi: str, py: str) -> list[Syl] | None:
    """Align a word's pinyin with its characters: ('一会儿', 'yíhuìr') -> [('一','yi',2), ('会','huir',4)].

    Each character must be read as one of the readings pypinyin knows for it (tones may differ);
    a 儿 after the first character may instead be erhua, an ``r`` on the syllable before. None
    when the pinyin can't be matched that way.
    """
    marked = _norm_pinyin(py)
    plain = _strip(marked).replace("ü", "v")
    if len(plain) != len(marked) or not all(HAN.match(c) for c in hanzi):
        return None
    n = len(hanzi)

    @cache
    def match(i: int, j: int) -> tuple[tuple[int, int], ...] | None:
        """Spans of plain[j:] for hanzi[i:], or None."""
        if i == n:
            return () if j == len(plain) else None
        ch = hanzi[i]
        if ch == "儿" and i > 0 and plain.startswith("r", j):
            rest = match(i + 1, j + 1)
            if rest is not None:
                return ((j, j + 1), *rest)
        for r in sorted(_readings(ch), key=len, reverse=True):
            if plain.startswith(r, j):
                rest = match(i + 1, j + len(r))
                if rest is not None:
                    return ((j, j + len(r)), *rest)
        return None

    spans = match(0, 0)
    if spans is None:
        return None
    out: list[Syl] = []
    for ch, (a, b) in zip(hanzi, spans):
        if b - a == 1 and plain[a] == "r" and ch == "儿" and out:
            pc, pb, pt = out[-1]
            out[-1] = (pc + ch, pb + "r", pt)
            continue
        out.append((ch, plain[a:b], _tone(marked[a:b])))
    return out


def guess_syllables(text: str) -> list[Syl]:
    """pypinyin's reading of the Chinese characters in ``text`` (for text without pack pinyin)."""
    out: list[Syl] = []
    for run in re.findall(r"[\u3400-\u9fff]+", text):
        syls = lazy_pinyin(run, style=Style.TONE3, neutral_tone_with_five=True, v_to_u=False)
        out.extend((c, s[:-1], int(s[-1])) for c, s in zip(run, syls, strict=True))
    return out


def read_number(digits: str, after: str = "") -> str:
    """How a number in a sentence is said, in characters: '25' -> '二十五', '1998' + '年' -> '一九九八'."""
    if after.startswith("年") and len(digits) == 4 or len(digits) > 8 or digits.startswith("0"):
        return "".join(DIGITS[int(d)] for d in digits)
    n = int(digits)
    if n == 2 and after[:1] not in ("", "月", "号", "日", "点"):  # 2个 -> 两个
        return "两"
    return _chinese_int(n)


def _chinese_int(n: int) -> str:
    if n == 0:
        return "零"
    if n >= 10000:
        hi, lo = divmod(n, 10000)
        head = "两" if hi == 2 else _chinese_int(hi)
        return head + "万" + ("" if lo == 0 else ("零" if lo < 1000 else "") + _chinese_int(lo))
    out = ""
    zero = False
    for unit, place in ((1000, "千"), (100, "百"), (10, "十"), (1, "")):
        d, n = divmod(n, unit)
        if d:
            if zero and out:
                out += "零"
            zero = False
            # 两千, 两百 at the start; 二十, 十二.
            out += ("两" if d == 2 and not out and unit >= 100 else DIGITS[d]) + place
        elif out:
            zero = True
    # 十五, not 一十五, at the start.
    return out[1:] if out.startswith("一十") else out


def apply_sandhi(words: list[list[Syl]]) -> list[list[Syl]]:
    """Tone sandhi over one phrase (no punctuation inside), given as words of syllables."""
    flat = [s for w in words for s in w]
    orig = [t for _, _, t in flat]
    tones = list(orig)
    starts = set()
    k = 0
    for w in words:
        starts.add(k)
        k += len(w)
    for i, (ch, _, t) in enumerate(flat):
        prev = flat[i - 1][0] if i > 0 else ""
        nxt = flat[i + 1][0] if i + 1 < len(flat) else ""
        nt = orig[i + 1] if nxt else 0
        if ch == "一" and t == 1:
            if not nxt or prev[-1:] == "第" or nxt in NUMERAL_CHARS - {"百", "千", "万", "亿"}:
                continue
            if prev and prev == nxt:  # 看一看
                tones[i] = 5
            elif prev[-1:] in NUMERAL_CHARS:  # 十一, 一一
                continue
            else:
                tones[i] = 2 if nt in (4, 5) else 4
        elif ch == "不" and t == 4 and nxt:
            if prev and prev == nxt:  # 好不好
                tones[i] = 5
            elif nt == 4:
                tones[i] = 2
    # Third tone before third tone: all but the last of a run inside a word, and across a word
    # boundary when either word is a single syllable (很好, 我想).
    for i in range(len(flat) - 1):
        if tones[i] != 3 or orig[i + 1] != 3:
            continue
        if i + 1 not in starts:
            tones[i] = 2
        else:
            left = max(s for s in starts if s <= i)
            right_end = min([s for s in starts if s > i + 1] + [len(flat)])
            if i - left == 0 or right_end - (i + 1) == 1:
                tones[i] = 2
    out: list[list[Syl]] = []
    k = 0
    for w in words:
        out.append([(c, b, tones[k + j]) for j, (c, b, _) in enumerate(w)])
        k += len(w)
    return out


Token = tuple[str, str | None]


def phonemes(tokens: list[Token], sep: str = WORD_SEP) -> list[str]:
    """Kokoro phonemes for a sentence (or a word) given as (text, pinyin) tokens.

    ``pinyin`` is the token's reading as the app shows it; None for punctuation, numbers, and
    text the pack has no reading for (read with pypinyin). Laid out as misaki does: ``sep``
    between words, a space after punctuation.
    """
    phrases: list[list[list[Syl]] | str] = []
    cur: list[list[Syl]] = []

    def close(p: str | None = None) -> None:
        nonlocal cur
        if cur:
            phrases.append(cur)
            cur = []
        if p:
            phrases.append(p)

    for k, (text, py) in enumerate(tokens):
        text = unicodedata.normalize("NFC", text).strip()
        if not text:
            continue
        if text.isdigit():
            after = tokens[k + 1][0] if k + 1 < len(tokens) else ""
            cur.append(guess_syllables(read_number(text, after)))
        elif not HAN.search(text):
            for ch in text:
                if ch in PUNCT:
                    close(PUNCT[ch])
            continue
        else:
            syls = split_pinyin(text, py) if py else None
            cur.append(syls if syls is not None else guess_syllables(text))
    close()

    out: list[str] = []
    for k, p in enumerate(phrases):
        if isinstance(p, str):
            out.append(p)
            if p in SPACED and k + 1 < len(phrases):
                out.append(" ")
            continue
        for wi, w in enumerate(apply_sandhi(p)):
            if wi and sep:
                out.append(sep)
            for _, base, tone in w:
                out.extend(syllable_phonemes(base, tone))
    return out


def text_tokens(text: str) -> list[Token]:
    """Tokens for text that isn't in the pack (read with jieba + pypinyin)."""
    import logging

    import jieba

    jieba.setLogLevel(logging.WARNING)
    return [(t, None) for t in jieba.lcut(text, HMM=False)]
