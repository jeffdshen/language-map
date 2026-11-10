import { describe, expect, it } from 'vitest'
import { dayKey, daysBetween } from './dates'
import {
  credit,
  currentStage,
  heard,
  lockCompleted,
  markKnown,
  resetWord,
  setStageMarked,
  stageNeeds,
  stagesDone,
  wordStatus,
  type Progress,
} from './progress'

describe('dates', () => {
  it('rolls the learning day over at 4am local time', () => {
    expect(dayKey(new Date(2024, 0, 2, 3, 59))).toBe('2024-01-01')
    expect(dayKey(new Date(2024, 0, 2, 4, 0))).toBe('2024-01-02')
    expect(dayKey(new Date(2024, 0, 2, 0, 30), 0)).toBe('2024-01-02')
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2)
  })
})

describe('progress', () => {
  const id = 'L1-0001'
  const T = '2024-01-01'

  it('needs N sentences on sentence stages and one check on word-alone stages', () => {
    expect(stageNeeds(5, 10)).toEqual([10, 1, 10, 1])
    // No example sentences: every stage is a single check.
    expect(stageNeeds(0, 10)).toEqual([1, 1, 1, 1])
  })

  it('counts points, not days', () => {
    const needs = stageNeeds(3, 3)
    let p: Progress = credit({}, id, 0, T, needs[0])
    expect(wordStatus(p[id], needs)).toBe('active')
    expect(p[id].revealed).toBe(T)
    // Several points on the same day all count.
    p = credit(p, id, 0, T, needs[0])
    expect(currentStage(p[id], needs)).toBe(0)
    p = credit(p, id, 0, T, needs[0])
    expect(p[id].stages[0]).toEqual({ n: 3, completed: T })
    expect(currentStage(p[id], needs)).toBe(1)
    expect(heard(p[id], needs)).toBe(false)
    p = credit(p, id, 1, T, needs[1])
    expect(heard(p[id], needs)).toBe(true)
    expect(stagesDone(p[id], needs)).toBe(2)
    // Listening mode counts only the first two stages.
    expect(wordStatus(p[id], needs, 2)).toBe('learned')
    expect(wordStatus(p[id], needs, 4)).toBe('active')
  })

  it('supports self-marking stages and whole words', () => {
    const needs = stageNeeds(3, 3)
    let p: Progress = setStageMarked({}, id, 2, true, T)
    expect(stagesDone(p[id], needs)).toBe(1)
    expect(wordStatus(p[id], needs)).toBe('revealed')
    p = setStageMarked(p, id, 2, false, T)
    expect(stagesDone(p[id], needs)).toBe(0)

    p = markKnown(p, id, T)
    expect(wordStatus(p[id], needs)).toBe('learned')
    expect(currentStage(p[id], needs)).toBe(-1)

    p = resetWord(p, id, '2024-01-02')
    expect(wordStatus(p[id], needs)).toBe('revealed')
    expect(stagesDone(p[id], needs)).toBe(0)
  })

  it('keeps finished stages done when sentences-per-stage goes up', () => {
    let p: Progress = credit({}, id, 0, T, 1)
    expect(p[id].stages[0].completed).toBe(T)
    expect(stagesDone(p[id], stageNeeds(3, 10))).toBe(1)

    // Points earned under a lower requirement get locked in when the setting changes.
    let q: Progress = credit({}, id, 2, T, 10)
    q = credit(q, id, 2, T, 10)
    expect(stagesDone(q[id], stageNeeds(3, 10))).toBe(0)
    const locked = lockCompleted(q, () => stageNeeds(3, 2), '2024-01-03')
    expect(locked[id].stages[2].completed).toBe('2024-01-03')
    expect(stagesDone(locked[id], stageNeeds(3, 10))).toBe(1)
    expect(lockCompleted(locked, () => stageNeeds(3, 2), '2024-01-04')).toBe(locked)
    // Unknown ids are left alone.
    expect(lockCompleted(q, () => null, T)).toBe(q)
  })

  it('does not mutate the previous state', () => {
    const before: Progress = credit({}, id, 0, T, 3)
    const snapshot = JSON.stringify(before)
    credit(before, id, 0, T, 3)
    markKnown(before, id, T)
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
