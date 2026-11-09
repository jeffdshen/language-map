import { describe, expect, it } from 'vitest'
import { dayKey, daysBetween } from './dates'
import {
  currentStage,
  isDue,
  lockCompleted,
  markKnown,
  recordSuccess,
  resetWord,
  setStageMarked,
  startQuest,
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

  it('needs successes on N separate days per stage', () => {
    let p: Progress = startQuest({}, id, '2024-01-01')
    expect(wordStatus(p[id], 3)).toBe('active')
    expect(isDue(p[id], 3, '2024-01-01')).toBe(true)

    let r = recordSuccess(p, id, 0, '2024-01-01', 3)
    expect(r.counted).toBe(true)
    p = r.progress
    expect(isDue(p[id], 3, '2024-01-01')).toBe(false)

    r = recordSuccess(p, id, 0, '2024-01-01', 3)
    expect(r.counted).toBe(false) // same day doesn't count twice

    p = recordSuccess(p, id, 0, '2024-01-02', 3).progress
    expect(currentStage(p[id], 3)).toBe(0)
    p = recordSuccess(p, id, 0, '2024-01-05', 3).progress
    expect(currentStage(p[id], 3)).toBe(1)
    expect(stagesDone(p[id], 3)).toBe(1)
    // With a lower requirement the stage would already have been done.
    expect(stagesDone(p[id], 1)).toBe(1)
    // The next stage becomes due right away.
    expect(isDue(p[id], 3, '2024-01-05')).toBe(true)
  })

  it('supports self-marking stages and whole words', () => {
    let p: Progress = setStageMarked({}, id, 2, true, '2024-01-01')
    expect(stagesDone(p[id], 3)).toBe(1)
    expect(wordStatus(p[id], 3)).toBe('revealed')
    p = setStageMarked(p, id, 2, false, '2024-01-01')
    expect(stagesDone(p[id], 3)).toBe(0)

    p = markKnown(p, id, '2024-01-01')
    expect(wordStatus(p[id], 3)).toBe('learned')
    expect(currentStage(p[id], 3)).toBe(-1)
    expect(isDue({ ...p[id], started: '2024-01-01' }, 3, '2024-01-01')).toBe(false)

    p = resetWord(p, id, '2024-01-02')
    expect(wordStatus(p[id], 3)).toBe('revealed')
    expect(stagesDone(p[id], 3)).toBe(0)
  })

  it('keeps finished stages done when days-per-stage goes up', () => {
    let p: Progress = startQuest({}, id, '2024-01-01')
    p = recordSuccess(p, id, 0, '2024-01-01', 1).progress
    expect(p[id].stages[0].completed).toBe('2024-01-01')
    expect(stagesDone(p[id], 5)).toBe(1)

    // Stages done only by the old, lower requirement get locked in when the setting changes.
    let q: Progress = startQuest({}, id, '2024-01-01')
    q = recordSuccess(q, id, 1, '2024-01-03', 5).progress
    q = recordSuccess(q, id, 1, '2024-01-02', 5).progress
    expect(stagesDone(q[id], 5)).toBe(0)
    const locked = lockCompleted(q, 2)
    expect(locked[id].stages[1].completed).toBe('2024-01-03')
    expect(stagesDone(locked[id], 5)).toBe(1)
    expect(lockCompleted(locked, 2)).toBe(locked)
  })

  it('does not mutate the previous state', () => {
    const before: Progress = startQuest({}, id, '2024-01-01')
    const snapshot = JSON.stringify(before)
    recordSuccess(before, id, 0, '2024-01-01', 3)
    markKnown(before, id, '2024-01-01')
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
