let voices: SpeechSynthesisVoice[] = []
const listeners = new Set<() => void>()
/** voiceURI the player picked in Settings ('' = pick automatically). */
let preferred = ''
/** The utterance being spoken: Chrome cuts speech off if it is garbage-collected mid-sentence. */
let current: SpeechSynthesisUtterance | null = null

function refresh() {
  voices = window.speechSynthesis?.getVoices() ?? []
  listeners.forEach((fn) => fn())
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
  else if (/google|network/.test(name)) score += 15
  if (/huihui|kangkang|yaoyao|espeak|ekho|compact/.test(name)) score -= 10
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

/** The voice to speak the language with: the player's pick if installed, else the best ranked one. */
export function voiceFor(lang: string): SpeechSynthesisVoice | null {
  const list = voicesFor(lang)
  return (preferred && list.find((v) => v.voiceURI === preferred)) || list[0] || null
}

export function hasVoice(lang: string): boolean {
  return voiceFor(lang) !== null
}

export function speak(text: string, lang: string, rate = 0.9): void {
  if (!ttsSupported()) return
  const synth = window.speechSynthesis
  synth.cancel()
  if (synth.paused) synth.resume()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  u.rate = rate
  const v = voiceFor(lang)
  if (v) {
    u.voice = v
    u.lang = v.lang
  }
  u.onend = u.onerror = () => {
    if (current === u) current = null
  }
  current = u
  synth.speak(u)
}

export function stopSpeaking(): void {
  current = null
  if (ttsSupported()) window.speechSynthesis.cancel()
}
