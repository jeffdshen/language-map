let voices: SpeechSynthesisVoice[] = []
const listeners = new Set<() => void>()
/** voiceURI the player picked in Settings ('' = pick automatically). */
let preferred = ''
/** The utterance being spoken: Chrome cuts speech off if it is garbage-collected mid-sentence. */
let current: SpeechSynthesisUtterance | null = null
/** voiceURIs that failed to speak this session (e.g. Chrome's online Google voices on some Macs); skipped from then on. */
const failed = new Set<string>()
/** Bumped by every speak/stop, so timers and events of older utterances do nothing. */
let token = 0
let timer: ReturnType<typeof setTimeout> | undefined
let cancelledAt = -Infinity

/** Chrome can drop an utterance queued right after cancel(), so speaking waits this long after one. */
const AFTER_CANCEL_MS = 120
/** An utterance that has not started by then counts as dropped, and the next voice gets a try. */
const START_TIMEOUT_MS = 3000
/** Errors that are not the voice's fault, so another voice would not help. */
const NOT_THE_VOICE = new Set(['interrupted', 'canceled', 'not-allowed', 'audio-busy', 'audio-hardware', 'text-too-long'])

function notify() {
  listeners.forEach((fn) => fn())
}

function refresh() {
  voices = window.speechSynthesis?.getVoices() ?? []
  notify()
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refresh()
  window.speechSynthesis.addEventListener?.('voiceschanged', refresh)
}

export function onVoicesChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

type VoiceInfo = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService' | 'default'>

const norm = (s: string) => s.toLowerCase().replace(/_/g, '-')
const baseOf = (lang: string) => {
  const b = norm(lang).split('-')[0]
  return b === 'cmn' ? 'zh' : b
}

/**
 * How well a voice suits the language, or -Infinity if it speaks another one. Prefers the exact locale
 * (zh-CN over Taiwan, Cantonese and regional voices) and natural/neural voices over older robotic ones.
 */
export function rankVoice(v: VoiceInfo, lang: string): number {
  const want = norm(lang)
  const got = norm(v.lang)
  if (baseOf(got) !== baseOf(want)) return -Infinity
  // cmn-Hans-CN (Android) is the same locale as zh-CN.
  const canon = got.replace(/^cmn/, 'zh').replace('-hans', '')
  const name = v.name.toLowerCase()
  let score = 0
  if (canon === want) score += 40
  const tags = `${got} ${name}`
  if (/\b(hk|mo|yue)\b|cantonese|粤|粵/.test(tags)) score -= 80
  else if (/\b(tw|hant)\b|taiwan|臺灣|台灣/.test(tags)) score -= 50
  else if (canon.split('-').length > 2 || /dialect|northeastern|shaanxi|sichuan|zhongyuan|liaoning|\bwu\b/.test(name)) score -= 40
  if (/natural|neural|online|premium|enhanced/.test(name)) score += 20
  // Installed voices are the dependable ones: Chrome's online Google voices are cut off after ~15 s and, on some
  // Macs, never start at all.
  if (v.localService) score += 5
  // Robotic voices: old Windows ones, eSpeak, and the Eloquence voices macOS lists for every language.
  if (/huihui|kangkang|yaoyao|espeak|ekho|compact|\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/.test(name)) score -= 10
  if (v.default) score += 1
  return score
}

/** The language's voices from `list`, best first. */
export function rankVoices<V extends VoiceInfo>(list: readonly V[], lang: string): V[] {
  return list
    .map((v) => [v, rankVoice(v, lang)] as const)
    .filter(([, s]) => s > -Infinity)
    .sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name))
    .map(([v]) => v)
}

/** Installed voices for the language, best first. */
export function voicesFor(lang: string): SpeechSynthesisVoice[] {
  return rankVoices(voices, lang)
}

/** Use this voice (by voiceURI) when it is installed; '' picks the best voice automatically. */
export function setPreferredVoice(uri: string): void {
  preferred = uri
}

/** The voice Auto uses: the best ranked one that has not failed this session. */
export function autoVoice(lang: string): SpeechSynthesisVoice | null {
  return voicesFor(lang).find((v) => !failed.has(v.voiceURI)) ?? null
}

/** The voice to speak the language with: the player's pick if installed and working, else Auto's. */
export function voiceFor(lang: string): SpeechSynthesisVoice | null {
  const pick = preferred && !failed.has(preferred) ? voicesFor(lang).find((v) => v.voiceURI === preferred) : undefined
  return pick ?? autoVoice(lang)
}

/** Whether the voice failed to speak this session (so it is being skipped). */
export function voiceFailed(uri: string): boolean {
  return failed.has(uri)
}

export function hasVoice(lang: string): boolean {
  return voicesFor(lang).length > 0
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Cancel whatever is speaking or queued. Only when there is something to cancel: see AFTER_CANCEL_MS. */
function hush(synth: SpeechSynthesis) {
  if (!synth.speaking && !synth.pending) return
  synth.cancel()
  cancelledAt = now()
}

export function speak(text: string, lang: string, rate = 0.9): void {
  if (!ttsSupported() || !text) return
  const synth = window.speechSynthesis
  const id = ++token
  clearTimeout(timer)
  current = null
  hush(synth)
  if (synth.paused) synth.resume()
  const wait = cancelledAt + AFTER_CANCEL_MS - now()
  if (wait > 0) timer = setTimeout(() => attempt(id, text, lang, rate), wait)
  else attempt(id, text, lang, rate)
}

/** Speak with the current voice; if it errors or never starts, mark it failed and try the next one. */
function attempt(id: number, text: string, lang: string, rate: number) {
  if (id !== token) return
  const synth = window.speechSynthesis
  const voice = voiceFor(lang)
  const u = new SpeechSynthesisUtterance(text)
  u.lang = voice?.lang ?? lang
  u.rate = rate
  if (voice) u.voice = voice
  /** It started (or ended), or was given up on: either way this attempt is over. */
  let settled = false
  const live = () => {
    settled = true
    if (id === token) clearTimeout(timer)
  }
  const giveUp = () => {
    if (id !== token || settled) return
    settled = true
    clearTimeout(timer)
    current = null
    // With no voice set the browser picked one itself, so there is nothing left to try. Before the first tap or
    // key press browsers block speech (iOS without a word), which is not the voice's fault.
    if (!voice || (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === false)) return
    failed.add(voice.voiceURI)
    notify()
    hush(synth)
    timer = setTimeout(() => attempt(id, text, lang, rate), AFTER_CANCEL_MS)
  }
  u.onstart = u.onboundary = live
  u.onend = () => {
    live()
    if (current === u) current = null
  }
  u.onerror = (e) => {
    if (current === u) current = null
    if (!NOT_THE_VOICE.has(e.error)) giveUp()
  }
  current = u
  timer = setTimeout(giveUp, START_TIMEOUT_MS)
  synth.speak(u)
}

export function stopSpeaking(): void {
  token++
  clearTimeout(timer)
  current = null
  if (ttsSupported()) hush(window.speechSynthesis)
}
