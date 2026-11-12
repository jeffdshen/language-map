import { afterEach, describe, expect, it, vi } from 'vitest'
import { rankVoices } from './tts'

const voice = (name: string, lang: string, localService = true, isDefault = false) => ({
  name,
  lang,
  localService,
  default: isDefault,
})

const names = (list: { name: string }[]) => list.map((v) => v.name)

describe('rankVoices', () => {
  it('prefers natural mainland voices on Windows/Edge', () => {
    const list = [
      voice('Microsoft David - English (United States)', 'en-US', true, true),
      voice('Microsoft Huihui - Chinese (Simplified, PRC)', 'zh-CN'),
      voice('Microsoft HsiaoChen Online (Natural) - Chinese (Taiwan)', 'zh-TW', false),
      voice('Microsoft HiuGaai Online (Natural) - Chinese (Cantonese Traditional)', 'zh-HK', false),
      voice('Microsoft Xiaobei Online (Natural) - Chinese (Northeastern Mandarin)', 'zh-CN-liaoning', false),
      voice('Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)', 'zh-CN', false),
    ]
    expect(names(rankVoices(list, 'zh-CN'))).toEqual([
      'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)',
      'Microsoft Huihui - Chinese (Simplified, PRC)',
      'Microsoft Xiaobei Online (Natural) - Chinese (Northeastern Mandarin)',
      'Microsoft HsiaoChen Online (Natural) - Chinese (Taiwan)',
      'Microsoft HiuGaai Online (Natural) - Chinese (Cantonese Traditional)',
    ])
  })

  it("picks Chrome's Google voice over Cantonese and Taiwan ones", () => {
    const list = [
      voice('Google 粤語（香港）', 'zh-HK', false),
      voice('Google 國語（臺灣）', 'zh-TW', false),
      voice('Google 普通话（中国大陆）', 'zh-CN', false),
    ]
    expect(rankVoices(list, 'zh-CN')[0].name).toBe('Google 普通话（中国大陆）')
  })

  it('handles Android locale tags and Apple voice qualities', () => {
    const android = [voice('cmn-tw-x-ctc-network', 'cmn-Hant-TW', false), voice('cmn-cn-x-ccc-local', 'cmn-Hans-CN')]
    expect(rankVoices(android, 'zh-CN')[0].name).toBe('cmn-cn-x-ccc-local')
    const apple = [voice('Tingting', 'zh-CN'), voice('Meijia', 'zh-TW'), voice('Lili (Premium)', 'zh-CN')]
    expect(names(rankVoices(apple, 'zh-CN'))).toEqual(['Lili (Premium)', 'Tingting', 'Meijia'])
  })

  it("prefers macOS's installed voices over Chrome's online Google voice and the Eloquence voices", () => {
    const list = [
      voice('Eddy (中文（中国大陆）)', 'zh-CN'),
      voice('Google 普通话（中国大陆）', 'zh-CN', false),
      voice('Tingting', 'zh-CN'),
    ]
    expect(names(rankVoices(list, 'zh-CN'))).toEqual(['Tingting', 'Google 普通话（中国大陆）', 'Eddy (中文（中国大陆）)'])
  })

  it('falls back to any voice of the language and ignores others', () => {
    expect(names(rankVoices([voice('Sinji', 'zh-HK'), voice('Alex', 'en-US')], 'zh-CN'))).toEqual(['Sinji'])
    expect(rankVoices([voice('Alex', 'en-US')], 'zh-CN')).toEqual([])
  })
})

class FakeUtterance {
  lang = ''
  rate = 1
  voice: unknown = null
  onstart: (() => void) | null = null
  onboundary: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  text: string
  constructor(text: string) {
    this.text = text
  }
}

describe('speak', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** A fresh tts module on a fake speech engine that holds whatever it was last asked to speak. */
  async function setup() {
    vi.useFakeTimers()
    const google = { ...voice('Google 普通话（中国大陆）', 'zh-CN', false), voiceURI: 'google' }
    const tingting = { ...voice('Tingting', 'zh-CN'), voiceURI: 'tingting' }
    const spoken: FakeUtterance[] = []
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => [google, tingting],
      addEventListener: () => {},
      speak: (u: FakeUtterance) => {
        spoken.push(u)
        synth.speaking = true
      },
      cancel: vi.fn(() => {
        synth.speaking = false
      }),
      resume: () => {},
    }
    vi.stubGlobal('window', { speechSynthesis: synth })
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.resetModules()
    const tts = await import('./tts')
    return { tts, synth, spoken, google, tingting }
  }

  it('only cancels when something is speaking, and waits a moment before the next utterance', async () => {
    const { tts, synth, spoken } = await setup()
    tts.speak('一', 'zh-CN')
    expect(synth.cancel).not.toHaveBeenCalled()
    expect(spoken.map((u) => u.text)).toEqual(['一'])
    spoken[0].onstart?.()
    tts.speak('二', 'zh-CN')
    tts.speak('三', 'zh-CN')
    expect(synth.cancel).toHaveBeenCalledTimes(1)
    expect(spoken).toHaveLength(1)
    vi.advanceTimersByTime(500)
    // Only the latest request is spoken.
    expect(spoken.map((u) => u.text)).toEqual(['一', '三'])
  })

  it('switches to the next voice when the chosen one fails, and keeps skipping it', async () => {
    const { tts, spoken, google, tingting } = await setup()
    tts.setPreferredVoice('google')
    tts.speak('你好', 'zh-CN')
    expect(spoken[0].voice).toBe(google)
    spoken[0].onerror?.({ error: 'synthesis-failed' })
    vi.advanceTimersByTime(500)
    expect(spoken.map((u) => [u.text, u.voice])).toEqual([
      ['你好', google],
      ['你好', tingting],
    ])
    expect(tts.voiceFailed('google')).toBe(true)
    spoken[1].onstart?.()
    spoken[1].onend?.()
    tts.speak('再见', 'zh-CN')
    vi.advanceTimersByTime(500)
    expect(spoken[2].voice).toBe(tingting)
  })

  it('treats an utterance that never starts as dropped and retries with the next voice', async () => {
    const { tts, spoken, google, tingting } = await setup()
    tts.setPreferredVoice('google')
    tts.speak('你好', 'zh-CN')
    vi.advanceTimersByTime(1000)
    expect(spoken).toHaveLength(1)
    vi.advanceTimersByTime(2500)
    expect(spoken.map((u) => u.voice)).toEqual([google, tingting])
    // A voice that started is never cut off, and a cancel is not a failure.
    spoken[1].onstart?.()
    vi.advanceTimersByTime(10_000)
    spoken[1].onerror?.({ error: 'interrupted' })
    expect(spoken).toHaveLength(2)
    expect(tts.voiceFailed('tingting')).toBe(false)
  })
})
