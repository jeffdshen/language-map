import { describe, expect, it } from 'vitest'
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

  it('falls back to any voice of the language and ignores others', () => {
    expect(names(rankVoices([voice('Sinji', 'zh-HK'), voice('Alex', 'en-US')], 'zh-CN'))).toEqual(['Sinji'])
    expect(rankVoices([voice('Alex', 'en-US')], 'zh-CN')).toEqual([])
  })
})
