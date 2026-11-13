import { afterEach, describe, expect, it, vi } from 'vitest'

describe('clipName', () => {
  it('matches the pipeline (pipeline/tests/test_audio.py has the same vectors)', async () => {
    const { clipName } = await import('./audio')
    expect(clipName('')).toBe('cbf29ce484222325')
    expect(clipName('a')).toBe('af63dc4c8601ec8c')
    expect(clipName('你好')).toBe('3d262481d7d5eaa3')
    expect(clipName('你好，欢迎来到语言地图。')).toBe('d5c8063e0f181e54')
    // NFC first, so decomposed input names the same clip.
    expect(clipName('e\u0301')).toBe('0ac21707b7181e01')
  })
})

/** Plays nothing; tests drive its events. */
class FakeAudio {
  static all: FakeAudio[] = []
  src = ''
  preload = ''
  playbackRate = 1
  defaultPlaybackRate = 1
  error: { code: number } | null = null
  onerror: (() => void) | null = null
  onplaying: (() => void) | null = null
  onended: (() => void) | null = null
  static playResult = () => Promise.resolve()
  play = vi.fn(() => FakeAudio.playResult())
  pause = vi.fn()
  constructor() {
    FakeAudio.all.push(this)
  }
}

const INDEX = { schema: 1, version: 'v1', engine: 'kokoro', voice: 'zf_001', speed: 0.85, count: 2 }

describe('speak', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    FakeAudio.all = []
    FakeAudio.playResult = () => Promise.resolve()
  })

  /** A fresh audio module with a fake media element, a fake clip server and a mocked browser-speech module. */
  async function setup(index: unknown = INDEX) {
    const listeners: Record<string, () => void> = {}
    vi.stubGlobal('window', { addEventListener: (type: string, fn: () => void) => (listeners[type] = fn), removeEventListener: () => {} })
    vi.stubGlobal('Audio', FakeAudio)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:silence')
    const fetchMock = vi.fn(async (url: string) =>
      index && url === '/base/zh-en/audio/index.json' ? { ok: true, json: async () => index } : { ok: false, json: async () => null },
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    vi.doMock('./tts', () => ({
      speak: vi.fn(),
      stopSpeaking: vi.fn(),
      onVoicesChanged: () => () => {},
      ttsSupported: () => false,
      hasVoice: () => false,
    }))
    const tts = await import('./tts')
    const audio = await import('./audio')
    await audio.loadClips('/base/zh-en/')
    return { audio, tts, listeners }
  }

  it('plays the clip for the text, at the requested rate relative to the generated speed', async () => {
    const { audio, tts } = await setup()
    expect(audio.canSpeak('zh-CN')).toBe(true)
    audio.speak('你好', 'zh-CN', 0.85)
    const a = FakeAudio.all[0]
    expect(a.src).toBe('/base/zh-en/audio/3d/3d262481d7d5eaa3.mp3?v=v1')
    expect(a.playbackRate).toBe(1)
    expect(a.defaultPlaybackRate).toBe(1)
    expect(a.play).toHaveBeenCalledTimes(1)
    expect(tts.speak).not.toHaveBeenCalled()
    a.onplaying?.()
    expect(audio.audioStatus()).toEqual({ kind: 'playing', via: 'clip' })
    audio.speak('你好', 'zh-CN', 0.85 * 0.65)
    expect(a.playbackRate).toBeCloseTo(0.65)
  })

  it('falls back to browser speech when the text has no clip', async () => {
    const { audio, tts } = await setup()
    audio.speak('新词', 'zh-CN', 0.9)
    const a = FakeAudio.all[0]
    a.error = { code: 4 }
    a.onerror?.()
    expect(tts.speak).toHaveBeenCalledWith('新词', 'zh-CN', 0.9)
    expect(audio.audioStatus()).toEqual({ kind: 'browser', why: 'no-clip' })
    // A late error from the same clip does not speak twice.
    a.onerror?.()
    expect(tts.speak).toHaveBeenCalledTimes(1)
  })

  it('ignores events of a clip that was replaced or stopped', async () => {
    const { audio, tts } = await setup()
    audio.speak('一', 'zh-CN')
    const a = FakeAudio.all[0]
    const failFirst = a.onerror
    audio.speak('二', 'zh-CN')
    a.error = { code: 4 }
    failFirst?.()
    expect(tts.speak).not.toHaveBeenCalled()
    audio.stopSpeaking()
    a.onerror?.()
    expect(tts.speak).not.toHaveBeenCalled()
    expect(audio.audioStatus()).toEqual({ kind: 'idle' })
  })

  it('reports a blocked autoplay instead of falling back', async () => {
    const { audio, tts } = await setup()
    FakeAudio.playResult = () => Promise.reject(new DOMException('no gesture', 'NotAllowedError'))
    audio.speak('一', 'zh-CN')
    await Promise.resolve()
    expect(audio.audioStatus()).toEqual({ kind: 'blocked', via: 'clip' })
    expect(tts.speak).not.toHaveBeenCalled()
  })

  it('uses browser speech when chosen, or when there are no clips', async () => {
    const { audio, tts } = await setup()
    audio.setAudioSource('browser')
    audio.speak('一', 'zh-CN')
    expect(tts.speak).toHaveBeenCalledWith('一', 'zh-CN', 0.9)
    expect(FakeAudio.all[0].play).not.toHaveBeenCalled()

    const none = await setup(null)
    expect(none.audio.clipIndex()).toBeNull()
    expect(none.audio.canSpeak('zh-CN')).toBe(false)
    none.audio.speak('二', 'zh-CN')
    expect(none.tts.speak).toHaveBeenCalledWith('二', 'zh-CN', 0.9)
    expect(none.audio.audioStatus()).toEqual({ kind: 'browser', why: 'no-pack' })
  })

  it('unlocks the media element with silence on the first tap', async () => {
    const { listeners } = await setup()
    listeners.pointerdown()
    const a = FakeAudio.all[0]
    expect(a.src).toBe('blob:silence')
    expect(a.play).toHaveBeenCalledTimes(1)
  })
})
