let voices: SpeechSynthesisVoice[] = []
const listeners = new Set<() => void>()

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

/** Best voice for the language (exact locale first, then any Chinese voice). */
export function voiceFor(lang: string): SpeechSynthesisVoice | null {
  const norm = (s: string) => s.toLowerCase().replace('_', '-')
  const want = norm(lang)
  const base = want.split('-')[0]
  return (
    voices.find((v) => norm(v.lang) === want && v.localService) ??
    voices.find((v) => norm(v.lang) === want) ??
    voices.find((v) => norm(v.lang).startsWith(base) && !/hk|tw|yue/.test(norm(v.lang))) ??
    voices.find((v) => norm(v.lang).startsWith(base)) ??
    null
  )
}

export function hasVoice(lang: string): boolean {
  return voiceFor(lang) !== null
}

export function speak(text: string, lang: string, rate = 0.9): void {
  if (!ttsSupported()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  u.rate = rate
  const v = voiceFor(lang)
  if (v) u.voice = v
  synth.speak(u)
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel()
}
