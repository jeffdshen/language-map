import { describe, expect, it } from 'vitest'
import { makePack } from '../test/fixture'
import { autoRevealPicks, computeView, linksOf, nearestExplored, nextHiddenWithChar, revealCandidates, Vis } from './explore'
import { activeStages, credit, markKnown, reveal, setStageMarked, type Progress, type Rules } from './progress'

const T = '2024-01-01'
const R: Rules = { sentences: 3, count: 4 }

describe('explore', () => {
  const pack = makePack()
  const id = (i: number) => pack.words[i].id

  it('derives children and char index', () => {
    expect(pack.children[0]).toEqual([4, 5]) // 大学, 学习 anchor to 学
    expect(pack.charIndex.get('学')?.[0]).toBe(0)
  })

  it('marks hidden words near explored ones as frontier', () => {
    const p = reveal({}, id(0), T)
    const view = computeView(pack, p, R)
    expect(view.vis[0]).toBe(Vis.Revealed)
    expect(view.vis[1]).toBe(Vis.Frontier) // 2 cells away
    expect(view.vis[3]).toBe(Vis.Frontier) // √5 away
    expect(view.vis[5]).toBe(Vis.Frontier) // √13 ≈ 3.6 away
    expect(view.vis[6]).toBe(Vis.Hidden) // far away, even though it is a root word
    expect(view.vis[8]).toBe(Vis.Hidden)
    expect(view.openCount).toBe(1)
  })

  it('counts discovered and learned words per region', () => {
    let p: Progress = reveal({}, id(0), T)
    p = markKnown(p, id(2), T)
    p = reveal(p, id(3), T)
    const view = computeView(pack, p, R)
    expect(pack.words[0].region).toBe(0)
    expect(pack.words[3].region).toBe(1)
    expect([...view.regionSeen]).toEqual([2, 1, 0])
    expect([...view.regionLearned]).toEqual([1, 0, 0])
  })

  it('counts only the listening stages in listening mode', () => {
    let p: Progress = credit({}, id(0), 0, T, 3)
    p = setStageMarked(p, id(0), 0, true, T)
    p = setStageMarked(p, id(0), 1, true, T)
    const full = computeView(pack, p, R)
    expect(full.vis[0]).toBe(Vis.Active)
    expect(full.stageCount).toBe(4)
    const listening = computeView(pack, p, { ...R, count: activeStages('listening') })
    expect(listening.vis[0]).toBe(Vis.Learned)
    expect(listening.stageCount).toBe(2)
    expect([...listening.regionHeard]).toEqual([1, 0, 0])
  })

  it('finds the explored word nearest a point', () => {
    const p = reveal(reveal({}, id(0), T), id(6), T)
    const view = computeView(pack, p, R)
    expect(nearestExplored(pack, view, -4, -1, 5)).toBe(6)
    expect(nearestExplored(pack, view, 1, 1, 5)).toBe(0)
    expect(nearestExplored(pack, view, 6, 4, 2)).toBeNull()
  })

  it('counts open, active and learned words', () => {
    let p: Progress = credit({}, id(0), 0, T, 3)
    p = reveal(p, id(6), T)
    p = markKnown(p, id(2), T)
    const view = computeView(pack, p, R)
    expect(view.openCount).toBe(2)
    expect(view.activeCount).toBe(1)
    expect(view.learnedCount).toBe(1)
    expect(view.learnedByLevel[1]).toBe(1)
  })

  it('ranks reveal candidates by level then link strength', () => {
    const p = reveal({}, id(0), T)
    const view = computeView(pack, p, R)
    const picks = revealCandidates(pack, view, 0)
    expect(pack.words[picks[0]].level).toBe(1)
    expect(picks).not.toContain(0)
    const levels = picks.map((j) => pack.words[j].level)
    expect([...levels].sort()).toEqual(levels)
  })

  it('auto-reveals without a cap', () => {
    let p: Progress = reveal(reveal({}, id(0), T), id(6), T)
    for (const j of [1, 2, 3]) p = reveal(p, id(j), T)
    const view = computeView(pack, p, R)
    expect(view.openCount).toBe(5)
    expect(autoRevealPicks(pack, view, 0, 0)).toEqual([])
    const picks = autoRevealPicks(pack, view, 0, 2)
    expect(picks).toHaveLength(2)
    for (const j of picks) expect(view.vis[j]).toBeLessThan(Vis.Revealed)
  })

  it('needs one check per stage for words without sentences', () => {
    // 绿 (index 8) has no example sentences.
    expect(pack.words[8].ex).toBe(0)
    let p: Progress = credit({}, id(8), 0, T, 1)
    const view = computeView(pack, p, R)
    expect(view.stages[8]).toBe(1)
    p = credit(credit(credit(p, id(8), 1, T, 1), id(8), 2, T, 1), id(8), 3, T, 1)
    expect(computeView(pack, p, R).vis[8]).toBe(Vis.Learned)
  })

  it('finds the next hidden word sharing a character', () => {
    const p = reveal(reveal({}, id(0), T), id(1), T)
    const view = computeView(pack, p, R)
    const j = nextHiddenWithChar(pack, view, '学')
    expect(j).not.toBeNull()
    expect(pack.words[j!].hanzi).toContain('学')
    expect(view.vis[j!]).toBeLessThan(Vis.Revealed)
  })

  it('never suggests the excluded (selected) word itself', () => {
    const view = computeView(pack, {}, R)
    expect(nextHiddenWithChar(pack, view, '学')).toBe(0)
    const j = nextHiddenWithChar(pack, view, '学', 0)
    expect(j).not.toBeNull()
    expect(j).not.toBe(0)
    expect(pack.words[j!].hanzi).toContain('学')
  })

  it('links include anchors, children, neighbors and shared characters', () => {
    const kinds = new Set(linksOf(pack, 0).map((l) => l.kind))
    expect(kinds).toEqual(new Set(['child', 'neighbor', 'char']))
    expect(linksOf(pack, 4)[0]).toMatchObject({ j: 0 })
  })
})
