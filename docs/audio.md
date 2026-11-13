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

(Being built; details may change as it lands.)

- **What:** one clip per distinct spoken text: every word's `say` text (11,000) and every
  example sentence (20,291).
- **Engine:** an open-weights TTS model run offline by the pipeline. Candidates (must have a
  license that allows redistributing the audio, and run on a CPU):
  - Kokoro-82M v1.1 (Apache-2.0; 100+ Mandarin voices) via `sherpa-onnx` (Apache-2.0), whose
    model files are on GitHub releases. **Preferred.**
  - MeloTTS zh (MIT) via `sherpa-onnx`: faster, plainer.
  - Rejected: the Baker-trained models (dataset is non-commercial), Edge "online" voices via
    `edge-tts` (terms don't allow redistribution), paid cloud APIs (keys, cost, not offline).
- **Format:** MP3, mono, 24 kHz, ~32 kbps: plays everywhere (Opus would be half the size but
  older Safari can't play it).
- **Naming:** content-addressed (`<hash of text>.mp3`), so a clip can never play for text that
  has changed, and the app needs no index: it hashes the text it wants to say.
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
