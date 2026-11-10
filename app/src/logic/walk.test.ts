import { describe, expect, it } from 'vitest'
import { makePack } from '../test/fixture'
import { collides, findPath, isBlocked, moveBody, nearestFree, walkGrid } from './walk'

describe('walk', () => {
  const pack = makePack()
  const g = walkGrid(pack)

  it('blocks water, landmarks, halls and the fountain', () => {
    expect(isBlocked(g, 6, 3)).toBe(true) // lake column
    expect(isBlocked(g, 0, -7)).toBe(true) // sea
    expect(isBlocked(g, 2, 0)).toBe(true) // 学生
    expect(isBlocked(g, 2, 1)).toBe(true) // School Town hall
    expect(isBlocked(g, 0, 0)).toBe(true) // fountain
    expect(isBlocked(g, 0, 3)).toBe(false)
    expect(isBlocked(g, 99, 0)).toBe(true) // off the grid
  })

  it('finds paths around obstacles without cutting corners', () => {
    const path = findPath(g, -6, 1, 4, 1)!
    expect(path).not.toBeNull()
    expect(path.at(-1)).toEqual([4, 1])
    let [x, y] = [-6, 1]
    for (const [nx, ny] of path) {
      expect(Math.max(Math.abs(nx - x), Math.abs(ny - y))).toBe(1)
      expect(isBlocked(g, nx, ny)).toBe(false)
      if (nx !== x && ny !== y) {
        expect(isBlocked(g, nx, y)).toBe(false)
        expect(isBlocked(g, x, ny)).toBe(false)
      }
      ;[x, y] = [nx, ny]
    }
  })

  it('walks up next to a landmark when it is the target', () => {
    const path = findPath(g, -6, 5, 1, 2)!
    const [ex, ey] = path.at(-1)!
    expect(Math.max(Math.abs(ex - 1), Math.abs(ey - 2))).toBe(1)
    expect(isBlocked(g, ex, ey)).toBe(false)
  })

  it('gives up past the node budget', () => {
    expect(findPath(g, -6, 5, 5, 5, 3)).toBeNull()
    expect(findPath(g, 3, 4, 3, 4)).toEqual([])
  })

  it('slides along walls', () => {
    expect(collides(g, 0, 1, 0.28)).toBe(false)
    // Moving up-right from between two rows of words: up is blocked by 老师/学/学生's row, right is open.
    const [x, y] = moveBody(g, 0, 1, 0.3, -0.5)
    expect(x).toBeCloseTo(0.3)
    expect(y).toBe(1)
    const [x2, y2] = moveBody(g, 4, 4, 0, -0.6)
    expect(x2).toBe(4)
    expect(y2).toBeCloseTo(3.4)
  })

  it('finds the nearest free cell', () => {
    const [x, y] = nearestFree(g, 2, 0)!
    expect(Math.max(Math.abs(x - 2), Math.abs(y))).toBe(1)
    expect(isBlocked(g, x, y)).toBe(false)
  })
})
