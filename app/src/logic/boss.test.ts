import { describe, expect, it } from 'vitest'
import { makePack } from '../test/fixture'
import { bossQuestion, bossQueue, rng, shortGloss } from './boss'
import { computeView } from './explore'
import { markKnown, reveal, startQuest, type Progress } from './progress'

const T = '2024-01-01'

describe('boss', () => {
  const pack = makePack()
  const id = (i: number) => pack.words[i].id

  it('queues unlearned region words, quests last', () => {
    let p: Progress = reveal({}, id(0), T)
    p = markKnown(p, id(2), T)
    p = startQuest(p, id(0), T)
    const view = computeView(pack, p, 3, T)
    const region = pack.words[0].region
    const q = bossQueue(pack, view, region)
    expect(q).not.toContain(2)
    expect(q.at(-1)).toBe(0)
    expect(new Set(q)).toEqual(new Set(pack.regionWords[region].filter((i) => i !== 2)))
  })

  it('builds questions with one right answer', () => {
    for (let seed = 1; seed < 30; seed++) {
      const q = bossQuestion(pack, 0, rng(seed))
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.options[q.answer]).toBe(0)
      // 学习 shares the sense "to learn" with 学, so it can't be a distractor.
      expect(q.options).not.toContain(5)
      const labels = q.options.map((j) => shortGloss(pack.words[j].glosses[0]))
      expect(new Set(labels).size).toBe(4)
    }
  })

  it('is deterministic for a seed', () => {
    expect(bossQuestion(pack, 1, rng(7))).toEqual(bossQuestion(pack, 1, rng(7)))
  })

  it('shortens glosses', () => {
    expect(shortGloss('to have a meal; to eat')).toBe('to have a meal')
    expect(shortGloss('(polite) you; thou')).toBe('you')
    expect(shortGloss('a'.repeat(60), 10)).toBe('aaaaaaaaa…')
  })
})
