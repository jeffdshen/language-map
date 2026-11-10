import { describe, expect, it } from 'vitest'
import { makePack } from '../test/fixture'
import { clampView, MAX_OVERVIEW_ZOOM, regionOutline, viewCellAt, viewScale, zoomViewAt, type Bounds } from './overview'

describe('regionOutline', () => {
  const { world } = makePack()

  it('traces a rectangular region as its four merged sides', () => {
    // Region 1 covers x 1..4, y -6..6.
    const seg = [...regionOutline(world, 1)]
    const sides = []
    for (let n = 0; n < seg.length; n += 4) sides.push(seg.slice(n, n + 4))
    expect(sides).toHaveLength(4)
    expect(sides).toEqual(
      expect.arrayContaining([
        [1, -6, 5, -6],
        [1, 7, 5, 7],
        [1, -6, 1, 7],
        [5, -6, 5, 7],
      ]),
    )
  })

  it('outlines regions against the edge of the grid too', () => {
    // Region 0 runs to the grid's left edge (x = -7).
    const seg = regionOutline(world, 0)
    expect(seg.length / 4).toBe(4)
    expect([...seg]).toEqual(expect.arrayContaining([-7, -6, -7, 7]))
  })
})

describe('overview zoom', () => {
  const b: Bounds = { x0: -50, y0: -30, w: 100, h: 60 }
  const W = 500
  const H = 300

  it('fits the whole map at zoom 1 and clamps zoom to its range', () => {
    expect(clampView({ z: 1, ox: 40, oy: -20 }, b, W, H)).toEqual({ z: 1, ox: 0, oy: 0 })
    expect(clampView({ z: 0.2, ox: 0, oy: 0 }, b, W, H).z).toBe(1)
    expect(clampView({ z: 99, ox: 0, oy: 0 }, b, W, H).z).toBe(MAX_OVERVIEW_ZOOM)
  })

  it('centers the map along an axis where it is smaller than the box', () => {
    // Twice as wide a box: the map fits the height and sits in the middle horizontally.
    expect(clampView({ z: 1, ox: 0, oy: 0 }, b, 2 * W, H)).toEqual({ z: 1, ox: 250, oy: 0 })
  })

  it('keeps the point under the cursor fixed while zooming', () => {
    const at: [number, number] = [137, 211]
    const before = viewCellAt({ z: 1, ox: 0, oy: 0 }, b, W, H, ...at)
    const v = zoomViewAt({ z: 1, ox: 0, oy: 0 }, b, W, H, ...at, 3)
    expect(v.z).toBe(3)
    expect(viewCellAt(v, b, W, H, ...at)).toEqual(before)
    // The map-space point under the cursor stays put exactly.
    const s0 = viewScale(b, W, H, 1)
    const s1 = viewScale(b, W, H, v.z)
    expect((at[0] - v.ox) / s1).toBeCloseTo(at[0] / s0)
    expect((at[1] - v.oy) / s1).toBeCloseTo(at[1] / s0)
  })

  it('never pans the map away from the box edges', () => {
    const v = clampView({ z: 2, ox: 300, oy: -10_000 }, b, W, H)
    expect(v.ox).toBe(0)
    expect(v.oy).toBe(H - b.h * viewScale(b, W, H, 2))
    expect(viewCellAt(v, b, W, H, 0, 0)).toEqual([b.x0, b.y0 + b.h / 2])
    // Left of a centered map is outside it.
    expect(viewCellAt({ z: 1, ox: 0, oy: 0 }, b, 2 * W, H, 10, 10)).toBeNull()
  })
})
