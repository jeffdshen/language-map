import type { Pack } from '../data/pack'
import type { World } from '../data/types'
import { Vis, type MapView } from '../logic/explore'
import { GOLD, hexToRgb, mix, rgb, shade, type RGB } from './draw'

/** Part of the grid that holds land, in cells. */
export interface Bounds {
  x0: number
  y0: number
  w: number
  h: number
}

const boundsCache = new WeakMap<World, Bounds>()

export function landBounds(world: World): Bounds {
  let b = boundsCache.get(world)
  if (b) return b
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let k = 0; k < world.regionGrid.length; k++) {
    if (world.regionGrid[k] < 0) continue
    const x = k % world.w
    const y = Math.floor(k / world.w)
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (x0 > x1) [x0, y0, x1, y1] = [0, 0, world.w - 1, world.h - 1]
  const m = 3
  x0 = Math.max(0, x0 - m)
  y0 = Math.max(0, y0 - m)
  x1 = Math.min(world.w - 1, x1 + m)
  y1 = Math.min(world.h - 1, y1 + m)
  b = { x0: x0 + world.x0, y0: y0 + world.y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  boundsCache.set(world, b)
  return b
}

const PARCHMENT: RGB = [226, 216, 192]
const SEA: RGB = [46, 84, 124]
const LAKE: RGB = [92, 146, 190]
const MUTED: RGB = [196, 194, 188]

export const OVERVIEW_COLORS = { sea: rgb(SEA), learned: rgb(GOLD) }

/**
 * Region color on the overview: parchment until you have explored some of it, then its own color, turning gold
 * as its words are learned.
 */
export function regionFill(color: string, count: number, seen: number, learned: number): RGB {
  const base = hexToRgb(color)
  const s = count ? Math.min(1, (seen / count) * 6) : 0
  const l = count ? learned / count : 0
  return mix(mix(PARCHMENT, base, 0.32 + 0.68 * s), GOLD, l * 0.85)
}

export interface OverviewOptions {
  /** Pixels per cell. */
  k: number
  /** Gray out every region so highlights stand out. */
  muted?: boolean
  /** Paint discovered words as small squares. */
  words?: boolean
}

/** Simplified map: one flat color per region, borders, water, and optionally discovered words. */
export function renderOverview(pack: Pack, view: MapView, opts: OverviewOptions): HTMLCanvasElement {
  const { world } = pack
  const b = landBounds(world)
  const k = Math.max(1, Math.round(opts.k))
  const canvas = document.createElement('canvas')
  canvas.width = b.w * k
  canvas.height = b.h * k
  const g = canvas.getContext('2d')!
  const img = g.createImageData(canvas.width, canvas.height)
  const data = img.data
  const fills = world.regions.map((r) => {
    const c = regionFill(r.color, r.count, view.regionSeen[r.id], view.regionLearned[r.id])
    return opts.muted ? mix(c, MUTED, 0.65) : c
  })
  const isWater = world.groundCodes.map((c) => c === '~' || c === '=')
  const regionAt = (x: number, y: number): number => {
    const gx = x - world.x0
    const gy = y - world.y0
    if (gx < 0 || gy < 0 || gx >= world.w || gy >= world.h) return -1
    return world.regionGrid[gy * world.w + gx]
  }
  const W = canvas.width
  const put = (px: number, py: number, c: RGB) => {
    const o = (py * W + px) * 4
    data[o] = c[0]
    data[o + 1] = c[1]
    data[o + 2] = c[2]
    data[o + 3] = 255
  }
  for (let cy = 0; cy < b.h; cy++) {
    for (let cx = 0; cx < b.w; cx++) {
      const x = b.x0 + cx
      const y = b.y0 + cy
      const kk = (y - world.y0) * world.w + (x - world.x0)
      const reg = world.regionGrid[kk]
      let col: RGB
      if (reg < 0) col = SEA
      else if (isWater[world.terrain[kk]]) col = opts.muted ? mix(LAKE, MUTED, 0.5) : LAKE
      else col = fills[reg]
      const right = regionAt(x + 1, y)
      const down = regionAt(x, y + 1)
      const edge = (other: number) =>
        reg >= 0 && other >= 0 && other !== reg
          ? world.regions[reg].level !== world.regions[other].level
            ? shade(col, -0.55)
            : shade(col, -0.28)
          : null
      const er = edge(right)
      const ed = edge(down)
      for (let py = 0; py < k; py++) {
        for (let px = 0; px < k; px++) {
          let c = col
          if (er && px === k - 1) c = er
          else if (ed && py === k - 1) c = ed
          put(cx * k + px, cy * k + py, c)
        }
      }
    }
  }
  if (opts.words) {
    for (const w of pack.words) {
      const v = view.vis[w.i]
      if (v < Vis.Revealed) continue
      const c: RGB = v === Vis.Learned ? [255, 214, 74] : v === Vis.Active ? [47, 111, 214] : [255, 255, 255]
      const px = (w.x - b.x0) * k
      const py = (w.y - b.y0) * k
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) put(px + dx, py + dy, c)
    }
  }
  g.putImageData(img, 0, 0)
  return canvas
}

const cellsCache = new WeakMap<World, number[][]>()

/** Cells of each region, as [x, y] pairs flattened (world coordinates). */
export function regionCells(world: World): number[][] {
  let out = cellsCache.get(world)
  if (out) return out
  out = world.regions.map(() => [])
  for (let k = 0; k < world.regionGrid.length; k++) {
    const r = world.regionGrid[k]
    if (r >= 0) out[r].push((k % world.w) + world.x0, Math.floor(k / world.w) + world.y0)
  }
  cellsCache.set(world, out)
  return out
}

/** Paint a translucent highlight over a region (on a context already scaled to cells). */
export function fillRegion(ctx: CanvasRenderingContext2D, world: World, region: number, b: Bounds, style: string): void {
  const cells = regionCells(world)[region]
  if (!cells) return
  ctx.fillStyle = style
  ctx.beginPath()
  for (let n = 0; n < cells.length; n += 2) ctx.rect(cells[n] - b.x0, cells[n + 1] - b.y0, 1, 1)
  ctx.fill()
}
