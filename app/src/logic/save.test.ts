import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, hasLegacyIds, migrateLegacyIds, newSave, parseSave } from './save'

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

  it('defaults to dim fog and full quests, and keeps listening mode', () => {
    expect(DEFAULT_SETTINGS.fogMode).toBe('dim')
    expect(DEFAULT_SETTINGS.questMode).toBe('full')
    const save = { ...newSave('zh-en', 2), settings: { questMode: 'listening' } }
    expect(parseSave(save, 'zh-en').settings.questMode).toBe('listening')
    const bad = { ...newSave('zh-en', 2), settings: { questMode: 'writing' } }
    expect(parseSave(bad, 'zh-en').settings.questMode).toBe('full')
  })

  it('renames word ids from the old word list and merges collisions', () => {
    const save = {
      ...newSave('zh-en', 1),
      progress: {
        'L1-0001': { revealed: '2024-01-03', stages: [{ days: ['2024-01-03'] }, { days: [], marked: true }] },
        'L1-0002': { revealed: '2024-01-01', stages: [{ days: ['2024-01-01', '2024-01-03'], completed: '2024-01-05' }] },
        'L2-0001': { stages: [] },
        w00009: { stages: [] },
      },
    }
    expect(hasLegacyIds(save)).toBe(true)
    const map = new Map([
      ['L1-0001', 'w00001'],
      ['L1-0002', 'w00001'],
    ])
    const r = migrateLegacyIds(save, map)
    expect(r.moved).toBe(2)
    expect(r.lost).toBe(1)
    expect(hasLegacyIds(r.save)).toBe(false)
    const parsed = parseSave(r.save, 'zh-en')
    expect(Object.keys(parsed.progress).sort()).toEqual(['w00001', 'w00009'])
    const wp = parsed.progress.w00001
    expect(wp.revealed).toBe('2024-01-01')
    expect(wp.stages[0].days).toEqual(['2024-01-01', '2024-01-03'])
    expect(wp.stages[0].completed).toBe('2024-01-05')
    expect(wp.stages[1].marked).toBe(true)
    expect(hasLegacyIds(newSave('zh-en', 2))).toBe(false)
  })
})
