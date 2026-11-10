import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, hasLegacyIds, migrateLegacyIds, newSave, parseSave } from './save'

describe('save', () => {
  it('round-trips and normalizes', () => {
    const save = newSave('zh-en', 1)
    save.progress['L1-0001'] = {
      revealed: '2024-01-01',
      stages: [{ n: 4, completed: '2024-01-02' }, { n: 0, marked: true }, { n: -3, completed: 'nope' }, { n: 2.7 }],
    }
    save.collected.listen.push(5, 5, 9)
    const parsed = parseSave(JSON.parse(JSON.stringify(save)), 'zh-en')
    const stages = parsed.progress['L1-0001'].stages
    expect(stages[0]).toEqual({ n: 4, completed: '2024-01-02' })
    expect(stages[1]).toEqual({ n: 0, marked: true })
    expect(stages[2]).toEqual({ n: 0 })
    expect(stages[3]).toEqual({ n: 2 })
    expect(parsed.collected).toEqual({ listen: [5, 9], read: [] })
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('turns good days from older saves into points', () => {
    const save = {
      ...newSave('zh-en', 1),
      settings: { daysPerStage: 2 },
      progress: {
        'L1-0001': {
          revealed: '2024-01-01',
          started: '2024-01-01',
          stages: [
            { days: ['2024-01-03', '2024-01-01', '2024-01-01'] },
            { days: ['2024-01-04'] },
            { days: [], marked: true },
            { days: ['2024-01-05'], completed: '2024-01-05' },
          ],
        },
      },
    }
    const parsed = parseSave(save, 'zh-en')
    const stages = parsed.progress['L1-0001'].stages
    // Two separate days reached the old requirement of 2, so the stage stays done.
    expect(stages[0]).toEqual({ n: 2, completed: '2024-01-03' })
    expect(stages[1]).toEqual({ n: 1 })
    expect(stages[2]).toEqual({ n: 0, marked: true })
    expect(stages[3]).toEqual({ n: 1, completed: '2024-01-05' })
    expect(parsed.progress['L1-0001'].started).toBe('2024-01-01')
    expect(parsed.collected).toEqual({ listen: [], read: [] })
    expect('daysPerStage' in parsed.settings).toBe(false)
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
    const save = { ...newSave('zh-en', 1), settings: { sentencesPerStage: 99, fogMode: 'weird', mapPinyin: 'sometimes' } }
    const s = parseSave(save, 'zh-en').settings
    expect(s.sentencesPerStage).toBe(30)
    expect(s.fogMode).toBe(DEFAULT_SETTINGS.fogMode)
    expect(s.mapPinyin).toBe('auto')
    expect(parseSave({ ...save, settings: { sentencesPerStage: 0 } }, 'zh-en').settings.sentencesPerStage).toBe(1)
    // The old on/off pinyin switch.
    expect(parseSave({ ...save, settings: { mapPinyin: false } }, 'zh-en').settings.mapPinyin).toBe('never')
    expect(parseSave({ ...save, settings: { mapPinyin: true } }, 'zh-en').settings.mapPinyin).toBe('auto')
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
    expect(wp.stages[0].n).toBe(2)
    expect(wp.stages[0].completed).toBe('2024-01-05')
    expect(wp.stages[1].marked).toBe(true)
    expect(hasLegacyIds(newSave('zh-en', 2))).toBe(false)
  })
})
