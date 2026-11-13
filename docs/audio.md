# Audio: investigation and design

Status: **in progress** (see "Progress log" at the end). Started 2026-11-13.

## Problem

The owner reports that **no audio plays at all** (word 🔊 buttons, sentence playback, hall
listening, Settings → 🔊 Test), on Chrome on a Mac, after two rounds of fixes to the browser
speech code:

1. `1777fde` "Better text-to-speech": rank voices (natural/online first), voice picker, keep a
   reference to the utterance, speech hints (`Word.say`).
2. `3a98e4d` "Fix speech on Chrome/Mac": prefer installed voices over Chrome's online Google
   voices, retry with the next voice when one errors or doesn't start within 3 s, wait 120 ms
   after `cancel()`.

## How audio worked (before this work)

All audio was the browser's **Web Speech API** (`speechSynthesis`, `app/src/tts.ts`), speaking
`zh-CN` text: a word's `say` text (its hanzi, or the speech hint from `pipeline/langmap/tts.py`)
or a sentence's text. Nothing was pre-recorded.

## Investigation

- **The app's calls are correct.** Running the production build in Chrome 157 with an
  instrumented fake `speechSynthesis` (a healthy local "Tingting" voice plus an event-less
  Google voice) showed every path (quest card autoplay, 🔊 buttons, `R`) calling
  `speechSynthesis.speak()` once, with the Tingting voice, `lang zh-CN`, rate 0.85, after a user
  gesture, and the utterance starting and ending. No component remounts or stray
  `stopSpeaking()` calls cancel it.
- **The page can't see whether sound came out.** `speechSynthesis` plays straight to the OS; the
  page gets only events, never the audio. Events can be missing even while it plays, and can
  fire while nothing is heard.
- **Known engine bugs on the owner's platform:**
  - Chromium [409717085](https://issues.chromium.org/issues/409717085) (Chrome 135+, still
    reported in 2025–26): Chrome's online Google voices fire no `start`/`end` events and leave
    `speaking`/`pending` stuck at `true`, so later utterances queue behind them forever.
  - Reports on macOS (Chrome 135, M1) of the first `speak()` after Chrome starts producing no
    sound, and again after long idle periods, even with native voices.
  - The decade-old Chrome bug that cuts utterances off after ~15 s with some voices.
  - Output depends on which voices the OS has installed; the same page sounds different (or
    silent) on every machine.
- **Could not verify on the real platform:** the sandbox has headless Chrome on Linux with no
  voices and no speakers, and no Mac.

### Conclusion

The failure is in the browser/OS speech engine, below anything the page can observe or work
around reliably. Two rounds of voice-picking heuristics did not help because the problem isn't
which voice is picked. **The fundamental fix is to stop depending on browser speech:
pre-generate the audio offline and play it as ordinary media files**, which go through the same
audio path as any video or music on the web, and behave the same on every device.

## Design: pre-generated audio

- **What:** one clip per word *reading* (10,958: key `hanzi|pinyin`, since 得 dé and 得 děi are
  different words) and per example sentence (20,291: key = its text), plus the Settings test
  phrase. 31,250 clips.
- **Engine:** Kokoro-82M v1.1-zh (Apache-2.0, 100 Mandarin voices), sherpa-onnx's int8 ONNX
  export (a GitHub release asset, pinned in `pipeline/audio.lock.json`), run directly with
  onnxruntime. Considered and rejected: MeloTTS zh (plainer), the Baker-trained models (dataset
  is non-commercial), Edge "online" voices via `edge-tts` (terms don't allow redistribution),
  paid cloud APIs (keys, cost, not offline).
- **Said from the pack's pinyin, not from text** (`pipeline/langmap/phonemes.py`): see
  "Pipeline side" below. This is what makes it correct, not just audible.
- **Format:** MP3, mono, 24 kHz, 32 kbps: plays everywhere (Opus would be half the size but
  older Safari can't play it).
- **Naming:** content-addressed (`<FNV-1a of key>.mp3`), so the app needs no list of clips: it
  hashes the key it wants to say.
- **Playback:** an `HTMLAudioElement`, with `playbackRate` for the speed setting and slow mode
  (pitch is preserved). If a clip is missing or fails, fall back to browser speech.

### Decisions for the owner

- **Hosting the audio (~200–250 MB).** Committing it to `main` would bloat every clone, and
  each regeneration would add another copy to history. Options: (a) GitHub release assets,
  pinned by sha256 in the repo and downloaded by the Pages deploy (current choice: no repo
  bloat, reproducible); (b) generate in the deploy workflow with a cache (slow cold builds);
  (c) Git LFS (bandwidth quota); (d) a separate audio repo/site.
- **Voice.** One voice to keep size down; picked by an automatic intelligibility check (ASR
  round-trip), not by ear. A listen-through by a person is still worth doing.
- **Browser speech as an option.** Kept as the fallback and as a Settings choice for people who
  prefer their own system voices.

## Progress log

- 2026-11-13: Investigation above; decided on pre-generated audio. AGENTS.md asks agents to keep
  these notes current.
- 2026-11-13: App side landed: `app/src/audio.ts` (clip player, routing, fallback), Settings →
  Audio (recorded voice / browser speech) with a status line under 🔊 Test, all call sites
  switched from `tts.ts` to `audio.ts`. Until clips are deployed, everything still falls back to
  browser speech (`no-pack`).
- 2026-11-13: Pipeline generator: phonemizer from pack pinyin, Kokoro on onnxruntime, carrier
  for words, `langmap audio` / `audio-pack` / `audio-check`. Word clips keyed by
  `hanzi|pinyin` in both app and pipeline (72 words share a `say` text with another reading).
  Next: pick the voice, Actions workflow to generate + publish, Pages deploy downloads it.

## Pipeline side (`pipeline/langmap/{phonemes,audio,audio_check}.py`)

Commands (`cd pipeline`; the `audio` dependency group holds onnxruntime and lameenc, the
`audio-check` group adds sherpa-onnx for the recogniser):

- `uv run --group audio langmap audio [--shard i/N] [--limit K] [--threads T]`: writes
  `data/zh-en/audio/<hh>/<name>.mp3`, skipping clips that exist. `--shard` splits the clips by
  name hash for parallel jobs.
- `uv run --group audio langmap audio-pack [--tar out.tar]`: fails unless every clip exists;
  writes `audio/index.json` (what the app loads) and a deterministic tarball, printing sha256.
- `uv run --group audio-check langmap audio-check [--voice zm_010] [--sample 40]`: the numbers
  in the table below, so a voice or phonemizer change can be compared without listening.

### Why phonemes from the pack's pinyin

Kokoro's own text front ends guess readings. sherpa-onnx's is a plain lexicon lookup: it read
东西 "thing" as dōngxī, 不去 as bù qù (no sandhi), and put no word boundaries in. misaki (the
Python front end Kokoro was trained with) uses jieba + pypinyin and has the same kind of errors.
The pack already has the right reading of every word and sentence token (that is what the app
shows), so `phonemes.py` turns that pinyin into Kokoro's phonemes directly:

- Phone set derived from (and checked against) the model's `lexicon-zh.txt`: zhuyin initial +
  one symbol per final (some finals use a stand-in character, e.g. 言 for -ian) + tone digit
  (5 = neutral), `R` before the tone for erhua.
- Layout copied from misaki's `zh_frontend.py`, i.e. what the model saw in training: words
  joined with `/`, punctuation mapped to ASCII and followed by a space.
- Tone sandhi applied (the app's pinyin is dictionary tones): 不 before tone 4; 一 before 4 / other
  tones (not after 第, at the end, or in numbers; neutral in 看一看); third-tone runs.
- Digits in sentences are read as words (`1998年` digit by digit, `2个` as 两).
- Every one of the 31,250 clips aligns and uses only symbols in the model's vocabulary
  (`tests/test_audio.py`, `tests/test_phonemes.py`).

### Words are said inside a carrier sentence

Kokoro learned from sentences. A word said alone comes out with flattened tones (麻 má barely
rises), and at speed 0.85 a lone word often got a spurious extra syllable at the start. So each
word is said as `这个词是：<word>.` and the audio is cut at the end of the colon's pause, found
from the model's second output (per-token durations, in 600-sample frames). Sentences and the
test phrase are said as they are.

### Measurements (voice zf_001 unless noted; `audio-check`-style scripts)

Speech recogniser (SenseVoice) syllable error, tone-numbered pinyin, seeded samples:

| Setup | Words alone | Sentences |
|---|---|---|
| sherpa-onnx text front end, 9 voices | 30–60% | 2.4–5.6% |
| Our phonemes, no `/` between words | 28% | 1.0% |
| Our phonemes, `/` between words (misaki layout) | | 0.3% |
| Our phonemes, word + `.`, speed 0.85 | 54% (extra onset syllable) | 1.0% |
| Our phonemes, carrier, speed 0.85 | 31% | 1.0% |

A recogniser can't tell a lone syllable's meaning, so word error stays high whatever the audio;
use it for sentences only. For words, tone contrast (pitch, semitones, 6 sets of four tones):

| Word setup | Tone-2 rise − tone-4 rise | Tone-1 low − tone-3 low |
|---|---|---|
| Alone | 2.8 | 0.1 |
| Alone, longer style vector (index 40 / 80) | 4.4 / 4.8 | |
| Carrier, speed 1.0 | 8.4 | 3.8 |
| Carrier, speed 0.85 | 7.7 | 3.7 |

## App side (`app/src/audio.ts`)

- `loadClips(packBase)` fetches `<pack>/audio/index.json` (`{schema: 1, version, engine, voice,
  speed, count}`); without it every request goes to browser speech.
- `speak(text, lang, rate, clip = text)`: `clip` is the key (`wordClip(w)` for words); `text`
  is what browser speech says if there is no clip (a word's `say` hint).
- `clipName(text)`: 64-bit FNV-1a of the NFC UTF-8 text, 16 hex digits. Clip URL:
  `<pack>/audio/<first 2 hex>/<name>.mp3?v=<version>`. The same function is in the pipeline;
  both test suites share vectors, so if one changes the other's tests fail.
- One shared `HTMLAudioElement`. `playbackRate = rate / index.speed` (the rate setting is
  relative to the voice's normal pace; clips are generated at `speed`). Setting `src` resets
  `playbackRate`, so `defaultPlaybackRate` is set too.
- Fallback to `tts.speak` when the clip 404s (`MediaError` code 4), fails, or there is no pack.
  `NotAllowedError` (autoplay without a gesture) is reported as `blocked`, not sent to browser
  speech, which would be blocked too.
- Safari only lets a media element play outside a gesture once it has played inside one, so the
  first `pointerdown`/`keydown` plays a tiny silent WAV on the shared element (sentences
  autoplay after an async load, outside the gesture).
- `Settings.audioSource` (`'recorded'` default, `'browser'`). Existing saves get `'recorded'`,
  which is the point: whatever browser voice they had saved is no longer in the way.
- Settings shows what the last request did (played the recording / fell back and why / blocked),
  since "nothing happened" was impossible to diagnose before.
