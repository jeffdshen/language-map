import { describe, expect, it } from 'vitest'
import { computeView } from '../logic/explore'
import { credit, markKnown, reveal, type Progress } from '../logic/progress'
import { isBlocked, walkGrid } from '../logic/walk'
import { makePack } from '../test/fixture'
import { HALL_REACH, nearTarget, nextQuestWord, pathSpeed, Player, REACH, RUN_SPEED, TRIP_TIME, WALK_SPEED } from './player'

const T = '2024-01-01'
const R = { sentences: 3, count: 4 }

describe('player', () => {
  const pack = makePack()
  const g = walkGrid(pack)
  const none = computeView(pack, {}, R)

  it('never starts inside the fountain or a landmark', () => {
    const p = new Player(g, 0, 0)
    expect(isBlocked(g, p.x, p.y)).toBe(false)
    expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(1.5)
  })

  it('walks and runs with the keys, facing the way it goes', () => {
    const p = new Player(g, 0, 4)
    expect(p.update(0.1, { dx: 1, dy: 0, run: false })).toBe(true)
    expect(p.x).toBeCloseTo(WALK_SPEED * 0.1)
    expect(p.facing).toBe('right')
    p.update(0.1, { dx: 0, dy: -1, run: true })
    expect(p.y).toBeCloseTo(4 - RUN_SPEED * 0.1)
    expect(p.facing).toBe('up')
    expect(p.update(0.1, { dx: 0, dy: 0, run: false })).toBe(false)
    expect(p.moving).toBe(false)
  })

  it('follows a clicked path to a landmark and arrives next to it', () => {
    const p = new Player(g, -6, 5)
    let arrived = 0
    expect(p.walkTo(1, 2, () => arrived++)).toBe(true)
    expect(p.busy).toBe(true)
    for (let k = 0; k < 400 && p.busy; k++) {
      p.update(0.02, { dx: 0, dy: 0, run: false })
      expect(isBlocked(g, Math.round(p.x), Math.round(p.y))).toBe(false)
    }
    expect(p.busy).toBe(false)
    expect(arrived).toBe(1)
    expect(Math.max(Math.abs(p.x - 1), Math.abs(p.y - 2))).toBe(1)
  })

  it('drops the path when a key is pressed, and reports unreachable targets', () => {
    const p = new Player(g, -6, 5)
    let arrived = false
    p.walkTo(4, 5, () => (arrived = true))
    p.update(0.05, { dx: 0, dy: 1, run: false })
    expect(p.busy).toBe(false)
    for (let k = 0; k < 50; k++) p.update(0.05, { dx: 0, dy: 0, run: false })
    expect(arrived).toBe(false)
    expect(p.walkTo(99, 0)).toBe(false)
  })

  it('arrives at once when already there', () => {
    const p = new Player(g, -6, 5)
    let arrived = false
    expect(p.walkTo(-6, 5, () => (arrived = true))).toBe(true)
    expect(arrived).toBe(true)
    expect(p.busy).toBe(false)
  })

  it('teleports to the nearest free cell', () => {
    const p = new Player(g, -6, 5)
    p.teleport(2, 0) // 学生's lot
    expect(isBlocked(g, p.x, p.y)).toBe(false)
    expect(Math.max(Math.abs(p.x - 2), Math.abs(p.y))).toBe(1)
  })

  it('finds the landmark or hall within reach', () => {
    expect(nearTarget(pack, none, false, 2, -1)).toEqual({ word: 1 })
    expect(nearTarget(pack, none, false, -3, 2.2)).toEqual({ hall: 0 })
    expect(nearTarget(pack, none, false, -6, 5)).toBeNull()
    // Halls reach a little farther than words: two cells below the hall still counts, the words 2.2 away don't.
    expect(nearTarget(pack, none, false, -3, 3)).toEqual({ hall: 0 })
    expect(nearTarget(pack, none, false, -3, 3.5)).toBeNull()
    // Hidden fog: unexplored words can't be talked to (but halls still can).
    expect(nearTarget(pack, none, true, 2, -1.5)).toBeNull()
    expect(nearTarget(pack, none, true, -3, 2.2)).toEqual({ hall: 0 })
    const seen = computeView(pack, reveal({}, pack.words[0].id, T), R)
    expect(nearTarget(pack, seen, true, 2, -1.5)).toEqual({ word: 1 }) // frontier of 学
    expect(REACH).toBeGreaterThan(1.5)
    expect(HALL_REACH).toBeGreaterThan(2)
  })

  it('points to the nearest unexplored word of a region, then unfinished ones', () => {
    const region = pack.words[0].region
    let p: Progress = reveal({}, pack.words[0].id, T)
    expect(nextQuestWord(pack, computeView(pack, p, R), region, -4, 2)).toBe(7)
    p = reveal(p, pack.words[7].id, T)
    expect(nextQuestWord(pack, computeView(pack, p, R), region, -4, 2)).toBe(2) // 老师 (√8 away) before 大学 (3 away)
    // Just-visited words are skipped.
    expect(nextQuestWord(pack, computeView(pack, p, R), region, -4, 2, [2])).not.toBe(2)
    const all = pack.regionWords[region]
    for (const i of all) p = reveal(p, pack.words[i].id, T)
    // Everything is on the map: the nearest unfinished word next.
    const near = nextQuestWord(pack, computeView(pack, p, R), region, -4, 2)
    expect(near).not.toBeNull()
    expect(all).toContain(near)
    p = credit(p, pack.words[near!].id, 0, T, 3)
    expect(nextQuestWord(pack, computeView(pack, p, R), region, -4, 2, [near!])).not.toBe(near)
    // When everything else was just visited, the older visits come back before giving up.
    const others = all.filter((i) => i !== near)
    expect(nextQuestWord(pack, computeView(pack, p, R), region, -4, 2, [...others, near!])).not.toBeNull()
    for (const i of all) p = markKnown(p, pack.words[i].id, T)
    expect(nextQuestWord(pack, computeView(pack, p, R), region, -4, 2)).toBeNull()
  })

  it('walks long trips faster at a constant pace', () => {
    expect(pathSpeed(3)).toBe(WALK_SPEED)
    expect(pathSpeed(44)).toBeCloseTo(44 / TRIP_TIME)
    expect(pathSpeed(10_000)).toBeLessThan(200)
    // The pace doesn't drop as the path runs out.
    const p = new Player(g, -6, 5)
    p.walkTo(5, 5)
    const speeds: number[] = []
    for (let k = 0; k < 400 && p.busy; k++) {
      const x0 = p.x
      const y0 = p.y
      p.update(0.01, { dx: 0, dy: 0, run: false })
      if (p.busy) speeds.push(Math.hypot(p.x - x0, p.y - y0) / 0.01)
    }
    expect(speeds.length).toBeGreaterThan(3)
    for (const v of speeds) expect(v).toBeCloseTo(speeds[0], 5)
  })
})
