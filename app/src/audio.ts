import type { AudioSource } from './logic/save'
import * as tts from './tts'

/**
 * Speech for the app: pre-generated clips (see docs/audio.md) played as ordinary media, falling back to the
 * browser's speech synthesis when there is no clip, a clip fails, or the player chose browser speech.
 *
 * Clips are named by a hash of a key (`clipName`): the text itself for sentences, and the hanzi with the pinyin
 * for words (`wordClip`), since words written alike can be read differently (得 dé, 得 děi). The app needs no
 * list of clips, and a clip can never play for text or a reading that has since changed: there is simply no
 * clip yet, and browser speech says it.
 */

/** `audio/index.json`, written by `langmap audio` next to the clips. */
export interface ClipIndex {
  schema: 1
  /** Changes whenever clips are regenerated; added to clip URLs so browsers don't replay cached old ones. */
  version: string
  engine: string
  voice: string
  /** Speed the clips were generated at; the rate setting is relative to the voice's normal pace (1). */
  speed: number
  count: number
}

export type { AudioSource }

/** What the last request did, for Settings (so a player can tell what is going on). */
export type AudioStatus =
  | { kind: 'idle' }
  | { kind: 'loading' | 'playing' | 'ended'; via: 'clip' }
  | { kind: 'blocked'; via: 'clip' }
  | { kind: 'browser'; why: 'chosen' | 'no-clip' | 'clip-failed' | 'no-pack' }

let pack: { base: string; index: ClipIndex } | null = null
let source: AudioSource = 'recorded'
let status: AudioStatus = { kind: 'idle' }
let player: HTMLAudioElement | null = null
/** Bumped by every speak/stop, so events of older clips do nothing. */
let token = 0
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

tts.onVoicesChanged(notify)

/** Called when clips load, the source changes, voices change or a clip's status changes. */
export function onAudioChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK = 0xffffffffffffffffn

/** 64-bit FNV-1a of the NFC UTF-8 text, as 16 hex digits. Must match `clip_name` in pipeline/langmap/audio.py. */
export function clipName(text: string): string {
  let h = FNV_OFFSET
  for (const b of new TextEncoder().encode(text.normalize('NFC'))) h = ((h ^ BigInt(b)) * FNV_PRIME) & MASK
  return h.toString(16).padStart(16, '0')
}

function validIndex(raw: unknown): raw is ClipIndex {
  const r = raw as Partial<ClipIndex> | null
  return !!r && r.schema === 1 && typeof r.version === 'string' && typeof r.speed === 'number' && r.speed > 0
}

/** Look for clips under `<base>audio/` (the pack folder). Without them everything uses browser speech. */
export async function loadClips(base: string): Promise<void> {
  try {
    const res = await fetch(`${base}audio/index.json`, { cache: 'no-cache' })
    if (!res.ok) return
    const index: unknown = await res.json()
    if (!validIndex(index)) return
    pack = { base, index }
    notify()
  } catch {
    // No clips (local dev without `langmap audio`, or offline): browser speech only.
  }
}

/** Forget loaded clips (tests). */
export function resetClips(): void {
  pack = null
  status = { kind: 'idle' }
  notify()
}

export function clipIndex(): ClipIndex | null {
  return pack?.index ?? null
}

export function setAudioSource(s: AudioSource): void {
  source = s
  notify()
}

export function audioStatus(): AudioStatus {
  return status
}

function setStatus(s: AudioStatus) {
  status = s
  notify()
}

/** The clip key of a word: its reading, not its `say` text (which only steers browser voices). */
export function wordClip(w: { hanzi: string; pinyin: string }): string {
  return `${w.hanzi}|${w.pinyin}`
}

/** The URL of the clip for `key`, if clips are loaded (whether there is one is only known by trying). */
export function clipUrl(key: string): string | null {
  if (!pack) return null
  const name = clipName(key)
  return `${pack.base}audio/${name.slice(0, 2)}/${name}.mp3?v=${encodeURIComponent(pack.index.version)}`
}

/** Whether the app can say things in `lang` at all: recorded clips, or a browser voice for the language. */
export function canSpeak(lang: string): boolean {
  return (source === 'recorded' && pack !== null) || (tts.ttsSupported() && tts.hasVoice(lang))
}

function getPlayer(): HTMLAudioElement | null {
  if (!player && typeof Audio !== 'undefined') {
    player = new Audio()
    player.preload = 'auto'
  }
  return player
}

/**
 * A short silent WAV. Safari only lets a media element play without a tap once it has played during one, so
 * the first tap or key press plays this on the shared element; later clips (e.g. a sentence that autoplays
 * once it has loaded) can then play.
 */
function silentWav(): string {
  const n = 800
  const buf = new ArrayBuffer(44 + n)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + n, true)
  str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, 8000, true)
  v.setUint32(28, 8000, true)
  v.setUint16(32, 1, true)
  v.setUint16(34, 8, true)
  str(36, 'data')
  v.setUint32(40, n, true)
  new Uint8Array(buf, 44).fill(128)
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
    const a = getPlayer()
    // A clip already started during this gesture has unlocked the element.
    if (!a || a.src) return
    a.src = silentWav()
    a.play().catch(() => {})
  }
  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('keydown', unlock, true)
}

function browser(text: string, lang: string, rate: number, why: Extract<AudioStatus, { kind: 'browser' }>['why']) {
  setStatus({ kind: 'browser', why })
  tts.speak(text, lang, rate)
}

/**
 * Say `text`: the recorded clip for `clip` (the text itself, or `wordClip` of a word) when there is one, else
 * browser speech. `rate` 1 is the voice's normal pace.
 */
export function speak(text: string, lang: string, rate = 0.9, clip = text): void {
  if (!text) return
  const id = ++token
  const a = getPlayer()
  a?.pause()
  if (source === 'browser') return browser(text, lang, rate, 'chosen')
  const url = clipUrl(clip)
  if (!url || !a || !pack) return browser(text, lang, rate, 'no-pack')
  tts.stopSpeaking()
  let settled = false
  const fail = (why: 'no-clip' | 'clip-failed') => {
    if (id !== token || settled) return
    settled = true
    browser(text, lang, rate, why)
  }
  // MEDIA_ERR_SRC_NOT_SUPPORTED (4) is also what a 404 gives.
  a.onerror = () => fail(a.error?.code === 4 ? 'no-clip' : 'clip-failed')
  a.onplaying = () => id === token && setStatus({ kind: 'playing', via: 'clip' })
  a.onended = () => id === token && setStatus({ kind: 'ended', via: 'clip' })
  a.src = url
  // Loading a new source resets playbackRate to defaultPlaybackRate; pitch is kept by default.
  a.defaultPlaybackRate = a.playbackRate = Math.min(4, Math.max(0.25, rate / pack.index.speed))
  setStatus({ kind: 'loading', via: 'clip' })
  a.play().catch((e: unknown) => {
    if (id !== token || settled) return
    const name = e instanceof DOMException ? e.name : ''
    // Superseded by another request, or the browser wants a tap first (browser speech would be blocked too).
    if (name === 'AbortError') return
    if (name === 'NotAllowedError') {
      settled = true
      setStatus({ kind: 'blocked', via: 'clip' })
      return
    }
    fail(name === 'NotSupportedError' ? 'no-clip' : 'clip-failed')
  })
}

export function stopSpeaking(): void {
  token++
  player?.pause()
  tts.stopSpeaking()
  if (status.kind !== 'idle') setStatus({ kind: 'idle' })
}
