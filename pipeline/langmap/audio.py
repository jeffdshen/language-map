"""Pre-generated speech: one MP3 per distinct text the app says (docs/audio.md).

``uv run --group audio langmap audio`` writes ``data/<pack>/audio/<hh>/<name>.mp3`` and
``audio/index.json``. Clips are named by ``clip_name`` of their key (app/src/audio.ts has the same
function): a sentence's text, or ``hanzi|pinyin`` for a word (``word_clip``). They are said from
the pack's own pinyin (``phonemes.py``) by Kokoro v1.1-zh, run directly with onnxruntime.

The clips are not committed (about 250 MB); .github/workflows/audio.yml generates them on
GitHub Actions and publishes a release asset that the Pages deploy downloads (pinned by
``audio.lock.json``).
"""

from __future__ import annotations

import hashlib
import json
import tarfile
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .paths import AUDIO_LOCK_FILE, CACHE_DIR
from .phonemes import Token, phonemes, text_tokens

# Settings → 🔊 Test (app/src/ui/SettingsModal.tsx).
TEST_PHRASE = "你好，欢迎来到语言地图。"
ENGINE = "kokoro-v1.1-zh"
MODEL_SOURCE = "kokoro-zh"
VOICE = "zf_001"
# Clips are said at this pace (Kokoro's own speed control, which sounds better than slowing
# playback); the app's rate setting is relative to 1, so its default 0.85 plays them as they are.
SPEED = 0.85
SAMPLE_RATE = 24000
BITRATE = 32
LOUDNESS = 0.12  # RMS of speech, about -18 dBFS: as loud as typical system voices
# Bump when phonemes.py changes how things are said, so clips are regenerated and re-cached.
PHONEMES_VERSION = 1
INDEX_SCHEMA = 1


def clip_name(text: str) -> str:
    """64-bit FNV-1a of the NFC UTF-8 text, as 16 hex digits. Must match clipName in app/src/audio.ts."""
    h = 0xCBF29CE484222325
    for b in unicodedata.normalize("NFC", text).encode("utf-8"):
        h = ((h ^ b) * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{h:016x}"


def clip_relpath(key: str) -> str:
    name = clip_name(key)
    return f"{name[:2]}/{name}.mp3"


def word_clip(hanzi: str, pinyin: str) -> str:
    """A word's clip key: its reading (words written alike can be read differently: 得 dé, děi).
    Must match wordClip in app/src/audio.ts."""
    return f"{hanzi}|{pinyin}"


@dataclass(frozen=True)
class Clip:
    key: str
    """What the app asks for: ``word_clip`` of a word, or the text of a sentence."""
    tokens: tuple[Token, ...]
    """(text, pinyin) tokens to say it from; pinyin None for punctuation and unknown text."""
    kind: str


def pack_clips(pack_dir: Path) -> list[Clip]:
    """Every clip the app can ask for, in name order."""
    words = json.loads((pack_dir / "words.json").read_text(encoding="utf-8"))
    sentences = json.loads((pack_dir / "sentences.json").read_text(encoding="utf-8"))
    rows = words["rows"]
    clips: dict[str, Clip] = {}

    def add(clip: Clip) -> None:
        clips.setdefault(clip.key, clip)

    for r in rows:
        add(Clip(word_clip(r[1], r[2]), ((r[1], r[2]),), "word"))
    for r in sentences["rows"]:
        toks: list[Token] = []
        for t in r[3]:
            if len(t) == 1:
                toks.append((t[0], None))
            elif len(t) == 2:
                toks.append((t[0], rows[t[1]][2] if t[1] >= 0 else None))
            else:
                toks.append((t[0], t[2]))
        add(Clip("".join(t[0] for t in r[3]), tuple(toks), "sentence"))
    add(Clip(TEST_PHRASE, tuple(text_tokens(TEST_PHRASE)), "phrase"))
    return sorted(clips.values(), key=lambda c: clip_name(c.key))


# Kokoro learned from sentences: a word said on its own comes out with flat, unclear tones (麻 má
# barely rises). So a word is said at the end of "这个词是：…。" and cut out (docs/audio.md).
CARRIER: tuple[Token, ...] = (("这个", "zhège"), ("词", "cí"), ("是", "shì"), ("：", None))
HOP = 600  # samples per Kokoro duration frame


def clip_phonemes(clip: Clip) -> list[str]:
    """What Kokoro is asked to say for a clip (for a word, the part after the carrier)."""
    ph = phonemes(list(clip.tokens))
    if ph and ph[-1][-1].isdigit():
        ph.append(".")
    return ph


def synthesize(tts: Kokoro, clip: Clip, speed: float = SPEED) -> np.ndarray:
    ph = clip_phonemes(clip)
    if clip.kind != "word":
        return trim(tts(ph, speed)[0])
    lead = phonemes(list(CARRIER)) + [" "]
    audio, dur = tts(lead + ph, speed)
    # dur[0] is the start pad, dur[1:] the tokens; cut halfway through the pause after the colon.
    cut = (int(dur[: len(lead)].sum()) + int(dur[len(lead)]) // 2) * HOP
    return trim(audio[cut:])


def model_dir(source: str = MODEL_SOURCE) -> Path:
    """Download (once, checksummed) and unpack a model pinned in audio.lock.json."""
    from .sources import fetch

    archive = fetch(source, AUDIO_LOCK_FILE)
    dest = CACHE_DIR / source
    done = dest / ".unpacked"
    if not done.exists():
        with tarfile.open(archive) as tar:
            tar.extractall(dest, filter="data")
        done.write_text(archive.name)
    (top,) = [p for p in dest.iterdir() if p.is_dir()]
    return top


def in_shard(key: str, shard: tuple[int, int]) -> bool:
    i, n = shard
    return int(clip_name(key), 16) % n == i


class Kokoro:
    """Kokoro v1.1-zh (sherpa-onnx's int8 export) on onnxruntime, fed phonemes directly."""

    def __init__(self, path: Path, voice: str = VOICE, threads: int = 0):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        if threads:
            opts.intra_op_num_threads = threads
        self.session = ort.InferenceSession(
            str(path / "model.int8.onnx"), opts, providers=["CPUExecutionProvider"]
        )
        meta = self.session.get_modelmeta().custom_metadata_map
        names = meta["speaker_names"].split(",")
        styles = np.fromfile(path / "voices.bin", dtype=np.float32).reshape(len(names), -1, 256)
        self.style = styles[names.index(voice)]
        self.vocab: dict[str, int] = {}
        for line in (path / "tokens.txt").read_text(encoding="utf-8").splitlines():
            sym, _, idx = line.rpartition(" ")
            self.vocab[sym] = int(idx)

    def __call__(self, phones: list[str], speed: float = SPEED) -> tuple[np.ndarray, np.ndarray]:
        """Audio at 24 kHz, and each token's duration in HOP-sample frames (with the two pads)."""
        ids = [self.vocab[p] for p in phones]
        style = self.style[min(len(ids), len(self.style) - 1)]
        audio, dur = self.session.run(
            None,
            {
                "tokens": np.array([[0, *ids, 0]], dtype=np.int64),
                "style": style[None, :],
                "speed": np.array([speed], dtype=np.float32),
            },
        )
        return np.asarray(audio, dtype=np.float32).reshape(-1), np.asarray(dur).reshape(-1)


def trim(audio: np.ndarray, sr: int = SAMPLE_RATE, pad: float = 0.06) -> np.ndarray:
    """Cut leading/trailing near-silence (keeping ``pad`` seconds) and fade the ends."""
    if not audio.size:
        return audio
    win = int(sr * 0.01)
    frames = np.abs(audio[: len(audio) // win * win]).reshape(-1, win).max(axis=1)
    loud = np.nonzero(frames > max(0.01, frames.max() * 0.02))[0]
    if loud.size:
        a = max(0, loud[0] * win - int(sr * pad))
        b = min(len(audio), (loud[-1] + 1) * win + int(sr * pad))
        audio = audio[a:b]
    fade = min(len(audio) // 2, int(sr * 0.005))
    if fade:
        ramp = np.linspace(0, 1, fade, dtype=np.float32)
        audio = audio.copy()
        audio[:fade] *= ramp
        audio[-fade:] *= ramp[::-1]
    return audio


def normalize(audio: np.ndarray, sr: int = SAMPLE_RATE, rms: float = LOUDNESS) -> np.ndarray:
    """Scale so the speech (10 ms frames within 30 dB of the loudest) has RMS ``rms``, with peaks
    kept under 0.95. Kokoro's output is quiet (peaks around 0.25) and varies from clip to clip."""
    win = int(sr * 0.01)
    if len(audio) < win:
        return audio
    frames = audio[: len(audio) // win * win].reshape(-1, win)
    power = (frames**2).mean(axis=1)
    speech = power[power > power.max() * 1e-3]
    gain = rms / max(float(np.sqrt(speech.mean())), 1e-6)
    gain = min(gain, 0.95 / max(float(np.abs(audio).max()), 1e-6))
    return (audio * gain).astype(np.float32)


def encode_mp3(audio: np.ndarray, sr: int = SAMPLE_RATE, kbps: int = BITRATE) -> bytes:
    import lameenc

    pcm = (np.clip(normalize(audio, sr), -1, 1) * 32767).astype("<i2").tobytes()
    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(sr)
    enc.set_out_sample_rate(sr)
    enc.set_channels(1)
    enc.set_quality(2)
    return bytes(enc.encode(pcm) + enc.flush())


def settings() -> dict:
    return {
        "engine": ENGINE,
        "voice": VOICE,
        "speed": SPEED,
        "bitrate": BITRATE,
        "loudness": LOUDNESS,
        "phonemes": PHONEMES_VERSION,
    }


def clips_version(clips: Iterable[Clip]) -> str:
    """Changes whenever any clip would sound different (text, reading, voice, settings)."""
    h = hashlib.sha256(json.dumps(settings(), sort_keys=True).encode())
    for c in clips:
        h.update(f"{c.key}\t{' '.join(clip_phonemes(c))}\n".encode())
    return h.hexdigest()[:12]


def generate(
    pack_dir: Path,
    shard: tuple[int, int] = (0, 1),
    limit: int | None = None,
    force: bool = False,
    threads: int = 0,
    log=print,
) -> int:
    """Write this shard's clips under ``pack_dir/audio`` (skipping existing ones); returns how many."""
    import time

    out_dir = pack_dir / "audio"
    clips = pack_clips(pack_dir)
    todo = [c for c in clips if in_shard(c.key, shard)]
    todo = [c for c in todo if force or not (out_dir / clip_relpath(c.key)).exists()]
    if limit is not None:
        todo = todo[:limit]
    tts = Kokoro(model_dir(), threads=threads)
    t0 = time.time()
    seconds = 0.0
    for k, c in enumerate(todo, 1):
        audio = synthesize(tts, c)
        seconds += len(audio) / SAMPLE_RATE
        path = out_dir / clip_relpath(c.key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(encode_mp3(audio))
        tmp.replace(path)
        if k % 200 == 0 or k == len(todo):
            el = time.time() - t0
            log(f"[audio] {k}/{len(todo)} clips, {seconds / 60:.1f} min of audio, {el:.0f}s")
    return len(todo)


def write_index(pack_dir: Path) -> dict:
    """Check every clip is there and write ``audio/index.json`` (what the app looks for)."""
    out_dir = pack_dir / "audio"
    clips = pack_clips(pack_dir)
    missing = [c.key for c in clips if not (out_dir / clip_relpath(c.key)).exists()]
    if missing:
        raise SystemExit(f"{len(missing)} clips missing, e.g. {missing[:5]}")
    size = sum((out_dir / clip_relpath(c.key)).stat().st_size for c in clips)
    index = {
        "schema": INDEX_SCHEMA,
        "version": clips_version(clips),
        **{k: settings()[k] for k in ("engine", "voice", "speed")},
        "count": len(clips),
        "bytes": size,
    }
    (out_dir / "index.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8")
    return index


def make_tarball(pack_dir: Path, dest: Path) -> str:
    """Tar ``pack_dir/audio`` (clips listed by the pack, plus index.json) to ``dest``; returns sha256."""
    out_dir = pack_dir / "audio"
    clips = pack_clips(pack_dir)
    names = sorted(clip_relpath(c.key) for c in clips) + ["index.json"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(dest, "w") as tar:
        for rel in names:
            info = tar.gettarinfo(out_dir / rel, arcname=f"audio/{rel}")
            info.mtime, info.uid, info.gid, info.uname, info.gname = 0, 0, 0, "", ""
            with (out_dir / rel).open("rb") as f:
                tar.addfile(info, f)
    return hashlib.sha256(dest.read_bytes()).hexdigest()
