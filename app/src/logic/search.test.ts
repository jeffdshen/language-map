import { describe, expect, it } from 'vitest'
import { makePack } from '../test/fixture'
import { pinyinKey } from './pinyin'
import { buildSearchIndex, search } from './search'

describe('search', () => {
  const pack = makePack()
  const index = buildSearchIndex(pack.words)
  const top = (q: string) => pack.words[search(index, q)[0]?.i ?? -1]?.hanzi

  it('normalizes pinyin', () => {
    expect(pinyinKey('Xuésheng')).toBe('xuesheng')
    expect(pinyinKey('xue2 sheng5')).toBe('xuesheng')
    expect(pinyinKey('lǜ')).toBe('lv')
    expect(pinyinKey('lu:4')).toBe('lv')
  })

  it('finds by hanzi, exact first', () => {
    expect(top('学')).toBe('学')
    expect(search(index, '学').map((h) => pack.words[h.i].hanzi)).toContain('留学')
  })

  it('finds by toneless or numbered pinyin', () => {
    expect(top('xuesheng')).toBe('学生')
    expect(top('xue2sheng5')).toBe('学生')
    expect(top('lü')).toBe('绿')
    expect(top('lv')).toBe('绿')
    expect(top('chifan')).toBe('吃饭')
  })

  it('finds by English meaning', () => {
    expect(top('teacher')).toBe('老师')
    expect(top('eat')).toBe('吃')
    expect(top('to study')).toBe('学')
    expect(search(index, 'school').map((h) => pack.words[h.i].hanzi)).toContain('学校')
  })
})
