import type { Pack } from '../data/pack'

/** Where the player can stand: everything except water, landmarks, region halls and the fountain. */
export interface WalkGrid {
  x0: number
  y0: number
  w: number
  h: number
  /** 1 = blocked, row-major. */
  blocked: Uint8Array
}

const cache = new WeakMap<Pack, WalkGrid>()

export function walkGrid(pack: Pack): WalkGrid {
  let g = cache.get(pack)
  if (g) return g
  const { world, wordAt } = pack
  const water = world.groundCodes.map((c) => c === '~' || c === '=')
  const blocked = new Uint8Array(world.w * world.h)
  for (let k = 0; k < blocked.length; k++) {
    if (water[world.terrain[k]] || wordAt[k] >= 0 || pack.hallAt[k] >= 0) blocked[k] = 1
  }
  const s = (world.spawn[1] - world.y0) * world.w + (world.spawn[0] - world.x0)
  if (s >= 0 && s < blocked.length) blocked[s] = 1
  g = { x0: world.x0, y0: world.y0, w: world.w, h: world.h, blocked }
  cache.set(pack, g)
  return g
}

export function isBlocked(g: WalkGrid, x: number, y: number): boolean {
  const cx = Math.round(x) - g.x0
  const cy = Math.round(y) - g.y0
  if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return true
  return g.blocked[cy * g.w + cx] === 1
}

/** Whether a square body of half-size `r` centered at (x, y) overlaps a blocked cell. */
export function collides(g: WalkGrid, x: number, y: number, r: number): boolean {
  const xa = Math.round(x - r)
  const xb = Math.round(x + r)
  const ya = Math.round(y - r)
  const yb = Math.round(y + r)
  for (let cy = ya; cy <= yb; cy++) for (let cx = xa; cx <= xb; cx++) if (isBlocked(g, cx, cy)) return true
  return false
}

/** Move by (dx, dy), sliding along walls: each axis is tried on its own. */
export function moveBody(g: WalkGrid, x: number, y: number, dx: number, dy: number, r = 0.28): [number, number] {
  // Short sub-steps so fast movement can't tunnel through a one-cell landmark.
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.25))
  for (let k = 0; k < n; k++) {
    const sx = dx / n
    const sy = dy / n
    if (sx && !collides(g, x + sx, y, r)) x += sx
    if (sy && !collides(g, x, y + sy, r)) y += sy
  }
  return [x, y]
}

/** Nearest free cell to (x, y), searching outward ring by ring. */
export function nearestFree(g: WalkGrid, x: number, y: number, maxR = 40): [number, number] | null {
  const cx = Math.round(x)
  const cy = Math.round(y)
  let best: [number, number] | null = null
  let bestD = Infinity
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (isBlocked(g, cx + dx, cy + dy)) continue
        const d = Math.hypot(cx + dx - x, cy + dy - y)
        if (d < bestD) {
          bestD = d
          best = [cx + dx, cy + dy]
        }
      }
    }
    if (best) return best
  }
  return null
}

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
]

/**
 * Shortest 8-connected path from (sx, sy) to (tx, ty), as cells after the start. Diagonal steps never cut the
 * corner of a blocked cell. If the target is blocked (a landmark or hall), the path ends on a free cell next to it.
 * Returns null when unreachable within `maxNodes` expansions.
 */
export function findPath(
  g: WalkGrid,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  maxNodes = 200_000,
): [number, number][] | null {
  sx = Math.round(sx)
  sy = Math.round(sy)
  tx = Math.round(tx)
  ty = Math.round(ty)
  const idx = (x: number, y: number) => (y - g.y0) * g.w + (x - g.x0)
  const inside = (x: number, y: number) => x >= g.x0 && y >= g.y0 && x < g.x0 + g.w && y < g.y0 + g.h
  if (!inside(sx, sy) || !inside(tx, ty)) return null
  const goals = new Set<number>()
  if (!isBlocked(g, tx, ty)) goals.add(idx(tx, ty))
  else {
    for (const [dx, dy] of DIRS) if (inside(tx + dx, ty + dy) && !isBlocked(g, tx + dx, ty + dy)) goals.add(idx(tx + dx, ty + dy))
  }
  if (!goals.size) return null
  const start = idx(sx, sy)
  if (goals.has(start)) return []
  const reach = isBlocked(g, tx, ty) ? 1 : 0
  const h = (x: number, y: number) => {
    const ax = Math.abs(x - tx)
    const ay = Math.abs(y - ty)
    return Math.max(0, Math.max(ax, ay) + (Math.SQRT2 - 1) * Math.min(ax, ay) - reach * Math.SQRT2)
  }
  const gScore = new Map<number, number>([[start, 0]])
  const parent = new Map<number, number>()
  const closed = new Set<number>()
  const heap = new MinHeap()
  heap.push(h(sx, sy), start)
  let expanded = 0
  while (heap.size) {
    const cur = heap.pop()
    if (closed.has(cur)) continue
    if (goals.has(cur)) {
      const out: [number, number][] = []
      for (let k = cur; k !== start; k = parent.get(k)!) out.push([(k % g.w) + g.x0, Math.floor(k / g.w) + g.y0])
      return out.reverse()
    }
    closed.add(cur)
    if (++expanded > maxNodes) return null
    const cx = (cur % g.w) + g.x0
    const cy = Math.floor(cur / g.w) + g.y0
    const gc = gScore.get(cur)!
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx
      const ny = cy + dy
      if (!inside(nx, ny) || isBlocked(g, nx, ny)) continue
      if (dx && dy && (isBlocked(g, cx + dx, cy) || isBlocked(g, cx, cy + dy))) continue
      const nk = idx(nx, ny)
      if (closed.has(nk)) continue
      const ng = gc + cost
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng)
        parent.set(nk, cur)
        heap.push(ng + h(nx, ny), nk)
      }
    }
  }
  return null
}

class MinHeap {
  private keys: number[] = []
  private vals: number[] = []

  get size(): number {
    return this.keys.length
  }

  push(key: number, val: number): void {
    const { keys, vals } = this
    let i = keys.length
    keys.push(key)
    vals.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= key) break
      keys[i] = keys[p]
      vals[i] = vals[p]
      i = p
    }
    keys[i] = key
    vals[i] = val
  }

  pop(): number {
    const { keys, vals } = this
    const top = vals[0]
    const lastK = keys.pop()!
    const lastV = vals.pop()!
    const n = keys.length
    if (n) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const c = l + 1 < n && keys[l + 1] < keys[l] ? l + 1 : l
        if (keys[c] >= lastK) break
        keys[i] = keys[c]
        vals[i] = vals[c]
        i = c
      }
      keys[i] = lastK
      vals[i] = lastV
    }
    return top
  }
}
