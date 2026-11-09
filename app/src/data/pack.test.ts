import { describe, expect, it } from 'vitest'
import { makePack } from '../test/fixture'
import { cellIndex, legacyMap, regionAt, wordsNear } from './pack'

describe('pack', () => {
  const pack = makePack()
  const { world } = pack

  it('decodes terrain and run-length region rows', () => {
    expect(world.w).toBe(14)
    expect(world.groundCodes).toEqual(['~', '=', 'g'])
    expect(world.terrain[cellIndex(world, 0, -7)]).toBe(0) // sea row
    expect(world.terrain[cellIndex(world, 6, 0)]).toBe(1)
    expect(world.terrain[cellIndex(world, 0, 0)]).toBe(2)
    expect(regionAt(world, 0, -7)).toBe(-1)
    expect(regionAt(world, -7, 3)).toBe(0)
    expect(regionAt(world, 0, 3)).toBe(0)
    expect(regionAt(world, 1, 3)).toBe(1)
    expect(regionAt(world, 6, 6)).toBe(2)
    expect(regionAt(world, 7, 0)).toBe(-1) // off the grid
    expect(world.regions[2]).toMatchObject({ kind: 'wild', level: 7, en: 'Green Wilds' })
  })

  it('indexes words by cell and region', () => {
    expect(pack.wordAt[cellIndex(world, 0, 0)]).toBe(0)
    expect(pack.wordAt[cellIndex(world, 1, 0)]).toBe(-1)
    expect(pack.regionWords.map((l) => l.length)).toEqual([5, 3, 2])
    expect(pack.regionWords[0][0]).toBe(0)
  })

  it('finds words near a point, nearest first', () => {
    expect(wordsNear(pack, 0, 0, 2.3)).toEqual([0, 1, 2, 3, 4])
    expect(wordsNear(pack, 0.4, 0, 2)).toEqual([0, 1])
    expect(wordsNear(pack, -6, 5, 1.5)).toEqual([])
  })

  it('maps old word ids to new ones', () => {
    const map = legacyMap({ bands: [['L1', [3, 0, 12]], ['L7', [11000]]] })
    expect(map.get('L1-0001')).toBe('w00003')
    expect(map.has('L1-0002')).toBe(false)
    expect(map.get('L1-0003')).toBe('w00012')
    expect(map.get('L7-0001')).toBe('w11000')
  })
})
