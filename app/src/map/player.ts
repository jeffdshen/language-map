import type { Pack } from '../data/pack'
import { Vis, type MapView } from '../logic/explore'
import { findPath, moveBody, nearestFree, type WalkGrid } from '../logic/walk'
import type { Facing, PlayerSprite, Target } from './renderer'

/** Cells per second. */
export const WALK_SPEED = 6
export const RUN_SPEED = 11
/** Click-to-walk trips longer than a few cells speed up so that none takes much longer than this (seconds). */
export const TRIP_TIME = 1.1
const MAX_PATH_SPEED = 160
/** How close (in cells) the player must be to talk to a landmark. */
export const REACH = 1.75
/** Halls are bigger, so they can be entered from a little farther away. */
export const HALL_REACH = 2.3

export interface MoveInput {
  dx: number
  dy: number
  run: boolean
}

/** The traveller on the map: keyboard movement with collisions, or walking a path after a click. */
export class Player implements PlayerSprite {
  x: number
  y: number
  facing: Facing = 'down'
  step = 0
  moving = false
  private path: [number, number][] = []
  /** Constant speed for the current path, set from its full length (so there's no slowdown near the end). */
  private pathSpeed = WALK_SPEED
  private arrive: (() => void) | null = null
  private readonly grid: WalkGrid

  constructor(grid: WalkGrid, x: number, y: number) {
    this.grid = grid
    const p = nearestFree(grid, Math.round(x), Math.round(y)) ?? [Math.round(x), Math.round(y)]
    this.x = p[0]
    this.y = p[1]
  }

  /** True while walking a path. */
  get busy(): boolean {
    return this.path.length > 0
  }

  /**
   * Walk to cell (tx, ty), or next to it if it is a landmark. `arrive` runs once there (right away if already
   * there). Returns false if there is no way there.
   */
  walkTo(tx: number, ty: number, arrive?: () => void): boolean {
    const path = findPath(this.grid, this.x, this.y, tx, ty)
    if (!path) return false
    this.path = path
    this.pathSpeed = pathSpeed(path.length)
    this.arrive = arrive ?? null
    if (!path.length) this.finish()
    return true
  }

  stop(): void {
    this.path = []
    this.arrive = null
  }

  /** Jump to the free cell nearest (x, y). */
  teleport(x: number, y: number): void {
    this.stop()
    const p = nearestFree(this.grid, Math.round(x), Math.round(y))
    if (!p) return
    this.x = p[0]
    this.y = p[1]
    this.facing = 'down'
    this.moving = false
  }

  /** Advance by `dt` seconds. Returns true if the player moved. */
  update(dt: number, input: MoveInput): boolean {
    const len = Math.hypot(input.dx, input.dy)
    const x0 = this.x
    const y0 = this.y
    if (len > 0) {
      this.stop()
      const v = (input.run ? RUN_SPEED : WALK_SPEED) * dt
      ;[this.x, this.y] = moveBody(this.grid, this.x, this.y, (input.dx / len) * v, (input.dy / len) * v)
      this.face(input.dx, input.dy)
    } else if (this.path.length) {
      let budget = this.pathSpeed * dt
      while (budget > 0 && this.path.length) {
        const [tx, ty] = this.path[0]
        const dx = tx - this.x
        const dy = ty - this.y
        const d = Math.hypot(dx, dy)
        if (d > 1e-6) this.face(dx, dy)
        if (d <= budget) {
          this.x = tx
          this.y = ty
          budget -= d
          this.path.shift()
        } else {
          this.x += (dx / d) * budget
          this.y += (dy / d) * budget
          budget = 0
        }
      }
      if (!this.path.length) this.finish()
    }
    const moved = Math.hypot(this.x - x0, this.y - y0)
    this.moving = moved > 1e-4
    if (this.moving) this.step += moved * 1.4
    return this.moving
  }

  private finish() {
    const fn = this.arrive
    this.arrive = null
    fn?.()
  }

  private face(dx: number, dy: number) {
    if (Math.abs(dx) > Math.abs(dy) * 1.05) this.facing = dx < 0 ? 'left' : 'right'
    else if (dy !== 0) this.facing = dy < 0 ? 'up' : 'down'
  }
}

/** Cells per second for a click-to-walk trip of `cells` steps: walking pace for short hops, faster for long trips. */
export function pathSpeed(cells: number): number {
  return Math.max(WALK_SPEED, Math.min(MAX_PATH_SPEED, cells / TRIP_TIME))
}

/** The landmark or hall within reach of (x, y), nearest first. */
export function nearTarget(pack: Pack, view: MapView, hiddenFog: boolean, x: number, y: number): Target | null {
  const { world, wordAt, hallAt } = pack
  let best: Target | null = null
  let bestD = HALL_REACH
  const cx = Math.round(x)
  const cy = Math.round(y)
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const gx = cx + dx - world.x0
      const gy = cy + dy - world.y0
      if (gx < 0 || gy < 0 || gx >= world.w || gy >= world.h) continue
      const k = gy * world.w + gx
      const d = Math.hypot(cx + dx - x, cy + dy - y)
      if (d >= bestD) continue
      const j = wordAt[k]
      if (j >= 0 && d < REACH && (!hiddenFog || view.vis[j] >= Vis.Frontier)) {
        best = { word: j }
        bestD = d
      } else if (hallAt[k] >= 0) {
        best = { hall: hallAt[k] }
        bestD = d
      }
    }
  }
  return best
}

/**
 * The next word to work on in `region`: the nearest one not on the map yet, else the nearest unfinished one.
 * Words in `avoid` (just visited) are skipped unless nothing else is left.
 */
export function nextQuestWord(
  pack: Pack,
  view: MapView,
  region: number,
  x: number,
  y: number,
  avoid: readonly number[] = [],
): number | null {
  const pick = (skip: readonly number[]) => {
    let best: number | null = null
    let bestD = Infinity
    for (const i of pack.regionWords[region] ?? []) {
      const v = view.vis[i]
      if (v === Vis.Learned || skip.includes(i)) continue
      const w = pack.words[i]
      const d = Math.hypot(w.x - x, w.y - y) + (v >= Vis.Revealed ? 1e6 : 0)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }
  return pick(avoid) ?? pick(avoid.slice(-1))
}

interface SavedPlayer {
  x: number
  y: number
  /** Layout version the position belongs to. */
  v: number
}

const key = (pack: string) => `language-map:player:${pack}`

export function loadPlayer(pack: string, layoutVersion: number): { x: number; y: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key(pack)) ?? 'null') as Partial<SavedPlayer> | null
    if (!raw || raw.v !== layoutVersion || ![raw.x, raw.y].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
    return { x: raw.x!, y: raw.y! }
  } catch {
    return null
  }
}

export function savePlayer(pack: string, layoutVersion: number, x: number, y: number): void {
  try {
    localStorage.setItem(key(pack), JSON.stringify({ x: +x.toFixed(2), y: +y.toFixed(2), v: layoutVersion }))
  } catch {
    // Storage full or blocked: the player starts at the fountain next time.
  }
}
