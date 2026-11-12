import type { Pack } from '../data/pack'
import type { Region, World } from '../data/types'
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

/** A completed region (every word learned): bright yellow, with a bold border on the maps. */
const DONE: RGB = [255, 214, 74]

export const OVERVIEW_COLORS = { sea: rgb(SEA), learned: rgb(GOLD), done: rgb(DONE), doneBorder: 'rgba(110, 72, 0, 0.95)' }

/** Every word in the region is learned. */
export function regionDone(r: Region, view: MapView): boolean {
  return r.count > 0 && view.regionLearned[r.id] >= r.count
}

/**
 * Region color on the overview: parchment until you have explored some of it, then its own color, turning gold
 * as its words are learned, and bright yellow once all of them are.
 */
export function regionFill(color: string, count: number, seen: number, learned: number): RGB {
  if (count && learned >= count) return DONE
  const base = hexToRgb(color)
  const s = count ? Math.min(1, (seen / count) * 6) : 0
  const l = count ? learned / count : 0
  return mix(mix(PARCHMENT, base, 0.32 + 0.68 * s), GOLD, l * 0.7)
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

const outlineCache = new WeakMap<World, Map<number, Float32Array>>()

/**
 * Border of a region (against other regions and the sea) as straight segments `x1, y1, x2, y2, …` along cell
 * edges, in world coordinates (cell (x, y) spans x..x+1, y..y+1).
 */
export function regionOutline(world: World, region: number): Float32Array {
  let byRegion = outlineCache.get(world)
  if (!byRegion) outlineCache.set(world, (byRegion = new Map()))
  const hit = byRegion.get(region)
  if (hit) return hit
  const cells = regionCells(world)[region] ?? []
  let gx0 = Infinity
  let gy0 = Infinity
  let gx1 = -Infinity
  let gy1 = -Infinity
  for (let n = 0; n < cells.length; n += 2) {
    const gx = cells[n] - world.x0
    const gy = cells[n + 1] - world.y0
    gx0 = Math.min(gx0, gx)
    gy0 = Math.min(gy0, gy)
    gx1 = Math.max(gx1, gx)
    gy1 = Math.max(gy1, gy)
  }
  const inside = (gx: number, gy: number) =>
    gx >= 0 && gy >= 0 && gx < world.w && gy < world.h && world.regionGrid[gy * world.w + gx] === region
  const out: number[] = []
  // Horizontal edges on the line above row gy, merged into runs.
  for (let gy = gy0; gy <= gy1 + 1; gy++) {
    let start = -1
    for (let gx = gx0; gx <= gx1 + 1; gx++) {
      const edge = gx <= gx1 && inside(gx, gy - 1) !== inside(gx, gy)
      if (edge && start < 0) start = gx
      else if (!edge && start >= 0) {
        out.push(start + world.x0, gy + world.y0, gx + world.x0, gy + world.y0)
        start = -1
      }
    }
  }
  // Vertical edges on the line left of column gx.
  for (let gx = gx0; gx <= gx1 + 1; gx++) {
    let start = -1
    for (let gy = gy0; gy <= gy1 + 1; gy++) {
      const edge = gy <= gy1 && inside(gx - 1, gy) !== inside(gx, gy)
      if (edge && start < 0) start = gy
      else if (!edge && start >= 0) {
        out.push(gx + world.x0, start + world.y0, gx + world.x0, gy + world.y0)
        start = -1
      }
    }
  }
  const arr = Float32Array.from(out)
  byRegion.set(region, arr)
  return arr
}

/** Add a region's border to the current path, in cells relative to (x0, y0) (cell (x, y) spans x..x+1). */
export function traceOutline(ctx: CanvasRenderingContext2D, world: World, region: number, x0: number, y0: number): void {
  const seg = regionOutline(world, region)
  for (let n = 0; n < seg.length; n += 4) {
    ctx.moveTo(seg[n] - x0, seg[n + 1] - y0)
    ctx.lineTo(seg[n + 2] - x0, seg[n + 3] - y0)
  }
}

/** Zoom and pan of an overview in a W × H box: cell x is drawn at `(x - b.x0) * scale + ox` (same for y). */
export interface OverviewView {
  /** 1 = the whole map fits the box. */
  z: number
  ox: number
  oy: number
}

export const MAX_OVERVIEW_ZOOM = 10

/** CSS pixels per cell. */
export function viewScale(b: Bounds, W: number, H: number, z: number): number {
  return Math.min(W / b.w, H / b.h) * z
}

/** Clamp the zoom, keep the map covering the box, and center it along an axis where it fits. */
export function clampView(v: OverviewView, b: Bounds, W: number, H: number): OverviewView {
  const z = Math.min(MAX_OVERVIEW_ZOOM, Math.max(1, v.z))
  const s = viewScale(b, W, H, z)
  const fit = (o: number, content: number, box: number) =>
    content <= box ? (box - content) / 2 : Math.min(0, Math.max(box - content, o))
  return { z, ox: fit(v.ox, b.w * s, W), oy: fit(v.oy, b.h * s, H) }
}

/** Zoom by `factor`, keeping the map point under box point (px, py) in place. */
export function zoomViewAt(v: OverviewView, b: Bounds, W: number, H: number, px: number, py: number, factor: number): OverviewView {
  const cur = clampView(v, b, W, H)
  const s0 = viewScale(b, W, H, cur.z)
  const z = Math.min(MAX_OVERVIEW_ZOOM, Math.max(1, cur.z * factor))
  const s1 = viewScale(b, W, H, z)
  return clampView({ z, ox: px - ((px - cur.ox) / s0) * s1, oy: py - ((py - cur.oy) / s0) * s1 }, b, W, H)
}

/** The cell drawn at box point (px, py), or null outside the map. */
export function viewCellAt(v: OverviewView, b: Bounds, W: number, H: number, px: number, py: number): [number, number] | null {
  const cur = clampView(v, b, W, H)
  const s = viewScale(b, W, H, cur.z)
  const x = Math.floor((px - cur.ox) / s) + b.x0
  const y = Math.floor((py - cur.oy) / s) + b.y0
  if (x < b.x0 || y < b.y0 || x >= b.x0 + b.w || y >= b.y0 + b.h) return null
  return [x, y]
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
