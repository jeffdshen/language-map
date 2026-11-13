"""``langmap audio-check``: measure how well the clips say what they should, without listening.

Two numbers, both recorded for each voice/setting change in docs/audio.md:

* **Syllable error** of a speech recogniser (SenseVoice, pinned in audio.lock.json) on a seeded
  sample of sentence clips: tone-numbered pinyin of what it heard vs. of the text. Reliable for
  sentences; for lone words a recogniser mostly guesses, so words get the next check instead.
* **Tone contrast** of words said through the carrier (``audio.synthesize``): for six sets of
  one syllable in all four tones (妈麻马骂 …), the pitch rise of tone 2 minus that of tone 4, and
  how much higher tone 1's lowest pitch sits than tone 3's, in semitones. Bigger is clearer.
"""

from __future__ import annotations

import random
import unicodedata

import numpy as np

from .audio import SAMPLE_RATE, VOICE, Clip, Kokoro, model_dir, synthesize

TONE_SETS = [
    [("妈", "mā"), ("麻", "má"), ("马", "mǎ"), ("骂", "mà")],
    [("衣", "yī"), ("姨", "yí"), ("椅", "yǐ"), ("意", "yì")],
    [("包", "bāo"), ("薄", "báo"), ("饱", "bǎo"), ("抱", "bào")],
    [("书", "shū"), ("熟", "shú"), ("鼠", "shǔ"), ("树", "shù")],
    [("汤", "tāng"), ("糖", "táng"), ("躺", "tǎng"), ("烫", "tàng")],
    [("飞", "fēi"), ("肥", "féi"), ("匪", "fěi"), ("费", "fèi")],
]


def pitch(audio: np.ndarray, sr: int = SAMPLE_RATE, hop: int = 240, win: int = 960) -> np.ndarray:
    """Autocorrelation F0 in Hz per 10 ms frame (NaN where unvoiced or quiet)."""
    out = []
    lo, hi = sr // 450, sr // 70
    for s in range(0, len(audio) - win, hop):
        x = audio[s : s + win] - audio[s : s + win].mean()
        if np.abs(x).max() < 0.03:
            out.append(np.nan)
            continue
        ac = np.correlate(x, x, "full")[win - 1 :]
        j = lo + int(np.argmax(ac[lo:hi]))
        out.append(sr / j if ac[j] > 0.5 * ac[0] else np.nan)
    return np.array(out)


def tone_contrast(tts: Kokoro) -> tuple[float, float]:
    rise: dict[int, list[float]] = {t: [] for t in range(1, 5)}
    low: dict[int, list[float]] = {t: [] for t in range(1, 5)}
    for group in TONE_SETS:
        for tone, tok in enumerate(group, 1):
            f = pitch(synthesize(tts, Clip("", (tok,), "word")))
            f = f[~np.isnan(f)]
            if len(f) < 6:
                continue
            st = 12 * np.log2(f / np.median(f))
            q = max(2, len(st) // 4)
            rise[tone].append(float(st[-q:].mean() - st[:q].mean()))
            low[tone].append(float(12 * np.log2(f.min() / 200)))
    mean = lambda d, t: float(np.mean(d[t])) if d[t] else float("nan")
    return mean(rise, 2) - mean(rise, 4), mean(low, 1) - mean(low, 3)


def syllables(text: str) -> list[str]:
    from pypinyin import Style, lazy_pinyin

    kept = "".join(c for c in text if unicodedata.category(c)[0] in "LN")
    return lazy_pinyin(kept, style=Style.TONE3, neutral_tone_with_five=True)


def edit_distance(a: list[str], b: list[str]) -> int:
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, cb in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (ca != cb))
    return d[-1]


def check(
    clips: list[Clip], voice: str = VOICE, sample: int = 40, seed: int = 0, log=print
) -> dict:
    import sherpa_onnx

    tts = Kokoro(model_dir(), voice)
    asr_dir = model_dir("sensevoice")
    asr = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(asr_dir / "model.int8.onnx"),
        tokens=str(asr_dir / "tokens.txt"),
        language="zh",
        use_itn=False,
    )
    sents = [c for c in clips if c.kind == "sentence"]
    pad = np.zeros(SAMPLE_RATE // 5, np.float32)
    errors = total = 0
    worst: list[tuple[int, str, str]] = []
    for c in random.Random(seed).sample(sents, min(sample, len(sents))):
        stream = asr.create_stream()
        stream.accept_waveform(SAMPLE_RATE, np.concatenate([pad, synthesize(tts, c), pad]))
        asr.decode_stream(stream)
        ref, got = syllables(c.key), syllables(stream.result.text)
        d = edit_distance(ref, got)
        errors += d
        total += len(ref)
        if d:
            worst.append((d, c.key, stream.result.text))
    t24, t13 = tone_contrast(tts)
    result = {
        "sentence_syllable_error": round(errors / max(total, 1), 4),
        "tone2_minus_tone4_rise": round(t24, 1),
        "tone1_minus_tone3_low": round(t13, 1),
    }
    for d, want, heard in sorted(worst, reverse=True)[:5]:
        log(f"  {d} off: {want}  heard: {heard}")
    return result
