import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, newSave, parseSave } from './save'

describe('save', () => {
  it('round-trips and normalizes', () => {
    const save = newSave('zh-en', 1)
    save.progress['L1-0001'] = {
      revealed: '2024-01-01',
      stages: [
        { days: ['2024-01-02', '2024-01-01', '2024-01-01'], completed: '2024-01-02' },
        { days: [], marked: true },
        { days: [], completed: 'nope' },
        { days: [] },
      ],
    }
    const parsed = parseSave(JSON.parse(JSON.stringify(save)), 'zh-en')
    expect(parsed.progress['L1-0001'].stages[0].days).toEqual(['2024-01-01', '2024-01-02'])
    expect(parsed.progress['L1-0001'].stages[0].completed).toBe('2024-01-02')
    expect(parsed.progress['L1-0001'].stages[1].marked).toBe(true)
    expect(parsed.progress['L1-0001'].stages[2]).toEqual({ days: [] })
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('rejects foreign files and drops unknown words', () => {
    expect(() => parseSave({ hello: 1 }, 'zh-en')).toThrow()
    expect(() => parseSave({ ...newSave('xx', 1) }, 'zh-en')).toThrow(/pack/)
    const save = { ...newSave('zh-en', 1), progress: { 'L1-0001': { stages: [] }, nope: { stages: [] } } }
    const parsed = parseSave(save, 'zh-en', new Set(['L1-0001']))
    expect(Object.keys(parsed.progress)).toEqual(['L1-0001'])
    expect(parsed.progress['L1-0001'].stages).toHaveLength(4)
  })

  it('clamps settings', () => {
    const save = { ...newSave('zh-en', 1), settings: { daysPerStage: 99, fogMode: 'weird', openCap: 1 } }
    const s = parseSave(save, 'zh-en').settings
    expect(s.daysPerStage).toBe(10)
    expect(s.fogMode).toBe(DEFAULT_SETTINGS.fogMode)
    expect(s.openCap).toBe(3)
  })
})
