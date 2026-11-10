import { describe, expect, it } from 'vitest'
import type { Sentence } from '../data/types'
import { sentencePinyin } from './text'

const sentence = (seg: Sentence['seg']): Sentence => ({ id: 1, enId: 2, en: '', seg })

describe('sentencePinyin', () => {
  it('spaces syllables but hugs punctuation and quotes', () => {
    const s = sentence([['她', -1, 'tā'], ['说', -1, 'shuō'], ['：'], ['“'], ['再见', -1, 'zàijiàn'], ['”'], ['。']])
    expect(sentencePinyin(s)).toBe('tā shuō： “zàijiàn”。')
  })
})
