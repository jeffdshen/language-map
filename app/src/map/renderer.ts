import type { Pack } from '../data/pack'
import { Vis, type MapView } from '../logic/explore'
import type { Settings } from '../logic/save'
import {
  DECOR_DENSITY,
  drawDecor,
  drawFountain,
  drawLandmark,
  GOLD,
  hash2,
  hashString,
  hexToRgb,
  landmarkKind,
  mix,
  rgb,
  roundRect,
  shade,
  valueNoise,
  type LandmarkKind,
  type RGB,
} from './draw'

export interface RenderState {
  pack: Pack
  view: MapView
  settings: Settings
  selected: number | null
  hovered: number | null
}

interface Camera {
  /** Center, in cells. */
  x: number
  y: number
  /** CSS pixels per cell. */
  scale: number
}

export interface CameraInfo extends Camera {
  /** Default (100%) zoom for this screen. */
  base: number
  /** Visible size, in cells. */
  cols: number
  rows: number
}

interface Anim {
  from: Camera
  to: Camera
  t0: number
  dur: number
}

interface Transform {
  /** CSS px per cell (snapped so a cell is a whole number of device pixels). */
  s: number
  cellPx: number
  /** Screen position of cell (0, 0)'s center. */
  ox: number
  oy: number
}

const FONT_ZH = '"Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Zen Hei", sans-serif'
const FONT_UI = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export const STATUS_COLORS = {
  learned: '#e0a526',
  learnedStroke: '#8a5a00',
  active: '#2f6fd6',
  revealed: '#ffffff',
  due: '#ffd23f',
}

/** Zoom range around the default game view. */
export const ZOOM_MIN = 0.55
export const ZOOM_MAX = 1.6

const WATER = new Set(['~', '='])

export class MapRenderer {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private dpr = 1
  private w = 1
  private h = 1
  private base = 48
  cam: Camera = { x: 0, y: 0, scale: 48 }
  private anim: Anim | null = null
  private raf = 0
  private state: RenderState | null = null
  onCamera: ((cam: CameraInfo) => void) | null = null

  private pack: Pack | null = null
  private groundRgb: RGB[] = []
  private waterIdx = new Set<number>()
  private oceanIdx = 0
  private regionRgb: RGB[] = []
  private regionLevel: number[] = []
  private wordKind: LandmarkKind[] = []
  private wordHash: Float32Array = new Float32Array(0)
  private wordRgb: RGB[] = []
  private bounds = { x0: -10, y0: -10, x1: 10, y1: 10 }

  private buf: HTMLCanvasElement | null = null
  private bufKey = { cellPx: 0, x0: 0, y0: 0, cols: 0, rows: 0 }
  private fog: HTMLCanvasElement | null = null
  private fogKey = ''

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  setState(state: RenderState): void {
    if (state.pack !== this.pack) this.preparePack(state.pack)
    this.state = state
    this.requestDraw()
  }

  private preparePack(pack: Pack) {
    this.pack = pack
    const { world } = pack
    this.groundRgb = world.ground.map((g) => hexToRgb(g.color))
    this.waterIdx = new Set(world.groundCodes.flatMap((c, k) => (WATER.has(c) ? [k] : [])))
    this.oceanIdx = Math.max(0, world.groundCodes.indexOf('~'))
    this.regionRgb = world.regions.map((r) => hexToRgb(r.color))
    this.regionLevel = world.regions.map((r) => r.level)
    this.wordKind = pack.words.map((w) => landmarkKind(w.pos, world.regions[w.region]?.kind ?? 'town'))
    this.wordHash = Float32Array.from(pack.words, (w) => hashString(w.id))
    this.wordRgb = pack.words.map((w) => {
      const reg = this.regionRgb[w.region] ?? [180, 180, 180]
      const theme = hexToRgb(world.themes[w.theme]?.color ?? '#b4b4b4')
      return mix(reg, theme, 0.45)
    })
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let k = 0; k < world.regionGrid.length; k++) {
      if (world.regionGrid[k] < 0) continue
      const x = (k % world.w) + world.x0
      const y = Math.floor(k / world.w) + world.y0
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    this.bounds = { x0, y0, x1, y1 }
    this.buf = null
    this.bufKey.cellPx = 0
    this.fogKey = ''
  }

  resize(width: number, height: number, dpr: number): void {
    const first = this.w <= 1
    this.w = Math.max(1, width)
    this.h = Math.max(1, height)
    this.dpr = dpr
    this.canvas.width = Math.round(this.w * dpr)
    this.canvas.height = Math.round(this.h * dpr)
    const zoom = first ? 1 : this.cam.scale / this.base
    this.base = Math.min(60, Math.max(34, Math.min(this.w, this.h) / 16))
    this.cam = this.clampCam({ ...this.cam, scale: this.base * zoom })
    this.bufKey.cellPx = 0
    this.requestDraw()
  }

  // ---- camera -------------------------------------------------------------

  info(): CameraInfo {
    const t = this.xf()
    return { ...this.cam, base: this.base, cols: this.w / t.s, rows: this.h / t.s }
  }

  private clampCam(c: Camera): Camera {
    const b = this.bounds
    const scale = Math.min(this.base * ZOOM_MAX, Math.max(this.base * ZOOM_MIN, c.scale))
    return {
      x: Math.min(b.x1, Math.max(b.x0, c.x)),
      y: Math.min(b.y1, Math.max(b.y0, c.y)),
      scale,
    }
  }

  private xf(): Transform {
    const cellPx = Math.max(6, Math.round(this.cam.scale * this.dpr))
    const s = cellPx / this.dpr
    const ox = Math.round((this.w / 2 - this.cam.x * s) * this.dpr) / this.dpr
    const oy = Math.round((this.h / 2 - this.cam.y * s) * this.dpr) / this.dpr
    return { s, cellPx, ox, oy }
  }

  /** Jump to a cell at a zoom relative to the default view. */
  jump(x: number, y: number, zoom = 1): void {
    this.anim = null
    this.cam = this.clampCam({ x, y, scale: this.base * zoom })
    this.requestDraw()
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const t = this.xf()
    return [(sx - t.ox) / t.s, (sy - t.oy) / t.s]
  }

  worldToScreen(x: number, y: number): [number, number] {
    const t = this.xf()
    return [t.ox + x * t.s, t.oy + y * t.s]
  }

  panBy(dx: number, dy: number): void {
    this.anim = null
    this.cam = this.clampCam({ ...this.cam, x: this.cam.x - dx / this.cam.scale, y: this.cam.y - dy / this.cam.scale })
    this.requestDraw()
  }

  /** Pan by a number of cells (keyboard movement). */
  panCells(dx: number, dy: number): void {
    this.anim = null
    this.cam = this.clampCam({ ...this.cam, x: this.cam.x + dx, y: this.cam.y + dy })
    this.requestDraw()
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.anim = null
    const [wx, wy] = this.screenToWorld(sx, sy)
    const scale = Math.min(this.base * ZOOM_MAX, Math.max(this.base * ZOOM_MIN, this.cam.scale * factor))
    this.cam = this.clampCam({ x: wx - (sx - this.w / 2) / scale, y: wy - (sy - this.h / 2) / scale, scale })
    this.requestDraw()
  }

  zoomBy(factor: number): void {
    this.animateTo({ ...this.cam, scale: this.cam.scale * factor }, 250)
  }

  /** Screen area not covered by the word panel (side panel on desktop, bottom sheet on mobile). */
  private freeRect(panelOpen: boolean): { l: number; r: number; t: number; b: number } {
    const top = this.w > 700 ? 64 : 104
    if (!panelOpen) return { l: 0, r: this.w, t: top, b: this.h }
    if (this.w > 700) return { l: 0, r: this.w - 414, t: top, b: this.h }
    return { l: 0, r: this.w, t: top, b: this.h * 0.38 }
  }

  flyTo(x: number, y: number, opts: { resetZoom?: boolean; panelOpen?: boolean } = {}): void {
    const s = opts.resetZoom ? this.base : this.cam.scale
    const f = this.freeRect(!!opts.panelOpen)
    const dx = ((f.l + f.r) / 2 - this.w / 2) / s
    const dy = ((f.t + f.b) / 2 - this.h / 2) / s
    const dist = Math.hypot(x - dx - this.cam.x, y - dy - this.cam.y)
    this.animateTo({ x: x - dx, y: y - dy, scale: s }, Math.min(900, 380 + dist * 6))
  }

  /** Pan just enough that cell (x, y) is not hidden behind the word panel. */
  keepVisible(x: number, y: number, panelOpen: boolean): void {
    if (this.anim) return
    const f = this.freeRect(panelOpen)
    const m = 70
    const [sx, sy] = this.worldToScreen(x, y)
    let dx = 0
    let dy = 0
    if (sx < f.l + m) dx = sx - (f.l + m)
    else if (sx > f.r - m) dx = sx - (f.r - m)
    if (sy < f.t + m) dy = sy - (f.t + m)
    else if (sy > f.b - m) dy = sy - (f.b - m)
    if (dx || dy) {
      this.animateTo({ ...this.cam, x: this.cam.x + dx / this.cam.scale, y: this.cam.y + dy / this.cam.scale }, 400)
    }
  }

  private animateTo(to: Camera, dur = 650): void {
    this.anim = { from: { ...this.cam }, to: this.clampCam(to), t0: performance.now(), dur }
    this.requestDraw()
  }

  private step(now: number): boolean {
    const a = this.anim
    if (!a) return false
    // rAF timestamps can predate the performance.now() taken in animateTo, so clamp at 0 too.
    const t = Math.max(0, Math.min(1, (now - a.t0) / a.dur))
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    const ls = Math.log(a.from.scale) + (Math.log(a.to.scale) - Math.log(a.from.scale)) * e
    this.cam = { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e, scale: Math.exp(ls) }
    if (t >= 1) this.anim = null
    return this.anim !== null
  }

  get animating(): boolean {
    return this.anim !== null
  }

  // ---- hit testing --------------------------------------------------------

  private drawable(i: number): boolean {
    const st = this.state!
    return st.settings.fogMode !== 'hidden' || st.view.vis[i] >= Vis.Frontier
  }

  hitTest(sx: number, sy: number): number | null {
    const st = this.state
    if (!st) return null
    const [wx, wy] = this.screenToWorld(sx, sy)
    const { world, wordAt, words } = st.pack
    let best: number | null = null
    let bestD = 0.62
    const cx = Math.round(wx)
    const cy = Math.round(wy)
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const gx = cx + dx - world.x0
        const gy = cy + dy - world.y0
        if (gx < 0 || gy < 0 || gx >= world.w || gy >= world.h) continue
        const j = wordAt[gy * world.w + gx]
        if (j < 0 || !this.drawable(j)) continue
        const w = words[j]
        // The landmark, or its name plate just below it.
        const dIcon = Math.hypot(wx - w.x, wy - (w.y - 0.05))
        const dLabel = Math.hypot((wx - w.x) * 0.75, wy - (w.y + 0.72)) * 1.2
        const d = Math.min(dIcon, dLabel)
        if (d < bestD) {
          bestD = d
          best = j
        }
      }
    }
    return best
  }

  // ---- drawing -------------------------------------------------------------

  requestDraw(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame((now) => {
      this.raf = 0
      const more = this.step(now)
      this.draw()
      if (more) this.requestDraw()
    })
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private visibleCells(t: Transform, margin = 0): [number, number, number, number] {
    return [
      Math.floor(-t.ox / t.s - 0.5) - margin,
      Math.floor(-t.oy / t.s - 0.5) - margin,
      Math.ceil((this.w - t.ox) / t.s + 0.5) + margin,
      Math.ceil((this.h - t.oy) / t.s + 0.5) + margin,
    ]
  }

  private draw() {
    const st = this.state
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = rgb(this.groundRgb[this.oceanIdx] ?? [63, 111, 158])
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    if (!st) return
    const t = this.xf()
    this.ensureTerrain(t)
    if (this.buf) {
      const k = this.bufKey
      const dx = Math.round((t.ox + (k.x0 - 0.5) * t.s) * this.dpr)
      const dy = Math.round((t.oy + (k.y0 - 0.5) * t.s) * this.dpr)
      ctx.drawImage(this.buf, dx, dy)
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.drawFog(t)
    this.drawSpawn(t)
    this.drawRegionLabels(t)
    this.drawWords(t)
    this.onCamera?.(this.info())
  }

  // ---- terrain ------------------------------------------------------------

  private ensureTerrain(t: Transform) {
    const [x0, y0, x1, y1] = this.visibleCells(t)
    const k = this.bufKey
    if (k.cellPx === t.cellPx && x0 >= k.x0 && y0 >= k.y0 && x1 < k.x0 + k.cols && y1 < k.y0 + k.rows) return
    let margin = 4
    const area = (m: number) => (x1 - x0 + 1 + 2 * m) * (y1 - y0 + 1 + 2 * m) * t.cellPx * t.cellPx
    while (margin > 1 && area(margin) > 16e6) margin--
    this.renderTerrain(x0 - margin, y0 - margin, x1 - x0 + 1 + 2 * margin, y1 - y0 + 1 + 2 * margin, t.cellPx)
  }

  private renderTerrain(bx0: number, by0: number, cols: number, rows: number, u: number) {
    const pack = this.pack!
    const { world, wordAt } = pack
    const c = this.buf ?? document.createElement('canvas')
    c.width = cols * u
    c.height = rows * u
    const g = c.getContext('2d')!
    const codes = world.groundCodes
    const at = (x: number, y: number): number => {
      const gx = x - world.x0
      const gy = y - world.y0
      return gx < 0 || gy < 0 || gx >= world.w || gy >= world.h ? -1 : gy * world.w + gx
    }
    const groundOf = (k: number) => (k < 0 ? this.oceanIdx : world.terrain[k])
    const isWater = (k: number) => this.waterIdx.has(groundOf(k))
    const colors: RGB[] = new Array(cols * rows)
    // Base tiles, painted 2 px per cell and scaled up smoothly so neighbouring grounds blend
    // across each cell edge while every cell keeps a solid core.
    const tiles = document.createElement('canvas')
    tiles.width = cols * 2
    tiles.height = rows * 2
    const tctx = tiles.getContext('2d')!
    const img = tctx.createImageData(cols * 2, rows * 2)
    const px = img.data

    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const x = bx0 + q
        const y = by0 + r
        const k = at(x, y)
        const gi = groundOf(k)
        let col = this.groundRgb[gi]
        const reg = k < 0 ? -1 : world.regionGrid[k]
        if (reg >= 0) col = mix(col, this.regionRgb[reg], 0.1)
        const n = valueNoise(x * 0.17, y * 0.17, 3) - 0.5 + (hash2(x, y, 1) - 0.5) * 0.35
        col = shade(col, n * 0.13)
        if (this.waterIdx.has(gi)) {
          let shore = false
          for (let dy = -1; dy <= 1 && !shore; dy++)
            for (let dx = -1; dx <= 1; dx++) if (!isWater(at(x + dx, y + dy))) shore = true
          if (shore) col = shade(col, 0.22)
        }
        colors[r * cols + q] = col
        for (let j = 0; j < 4; j++) {
          const o = ((r * 2 + (j >> 1)) * cols * 2 + q * 2 + (j & 1)) * 4
          px[o] = col[0]
          px[o + 1] = col[1]
          px[o + 2] = col[2]
          px[o + 3] = 255
        }
      }
    }
    tctx.putImageData(img, 0, 0)
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'low'
    g.drawImage(tiles, 0, 0, cols * u, rows * u)

    // Decorations on empty cells (not on words or the name plates under them).
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const x = bx0 + q
        const y = by0 + r
        const k = at(x, y)
        if (k >= 0 && wordAt[k] >= 0) continue
        const above = at(x, y - 1)
        if (above >= 0 && wordAt[above] >= 0) continue
        if (Math.hypot(x - world.spawn[0], y - world.spawn[1]) < 1.6) continue
        const code = codes[groundOf(k)]
        const h = hash2(x, y, 11)
        if (h >= (DECOR_DENSITY[code] ?? 0)) continue
        drawDecor(g, code, q * u + u / 2, r * u + u / 2, u, hash2(x, y, 12), colors[r * cols + q])
      }
    }

    // Region borders, level borders and the coastline. Borders run through the midpoints
    // of the edges between differing cells (marching squares on the dual grid), so
    // diagonal borders come out as 45° lines instead of staircases.
    const thin = new Path2D()
    const thick = new Path2D()
    const coast = new Path2D()
    const paths = [coast, thick, thin]
    const kind = (k: number, kb: number): number => {
      if (isWater(k) !== isWater(kb)) return 0
      const a = k < 0 ? -1 : world.regionGrid[k]
      const b = kb < 0 ? -1 : world.regionGrid[kb]
      if (a === b || a < 0 || b < 0) return -1
      return this.regionLevel[a] !== this.regionLevel[b] ? 1 : 2
    }
    const mids: [number, number][][] = [[], [], []]
    for (let r = 0; r < rows - 1; r++) {
      for (let q = 0; q < cols - 1; q++) {
        const x = bx0 + q
        const y = by0 + r
        const k00 = at(x, y)
        const k10 = at(x + 1, y)
        const k01 = at(x, y + 1)
        const k11 = at(x + 1, y + 1)
        const cx = (q + 1) * u
        const cy = (r + 1) * u
        const h = u / 2
        mids[0].length = mids[1].length = mids[2].length = 0
        const edges: [number, number, number][] = [
          [kind(k00, k10), cx, cy - h],
          [kind(k01, k11), cx, cy + h],
          [kind(k00, k01), cx - h, cy],
          [kind(k10, k11), cx + h, cy],
        ]
        for (const [kd, ex, ey] of edges) if (kd >= 0) mids[kd].push([ex, ey])
        for (let kd = 0; kd < 3; kd++) {
          const m = mids[kd]
          if (m.length === 0) continue
          const path = paths[kd]
          if (m.length === 2) {
            path.moveTo(m[0][0], m[0][1])
            path.lineTo(m[1][0], m[1][1])
          } else {
            for (const [ex, ey] of m) {
              path.moveTo(ex, ey)
              path.lineTo(cx, cy)
            }
          }
        }
      }
    }
    g.lineCap = 'round'
    g.strokeStyle = 'rgba(40, 70, 96, 0.45)'
    g.lineWidth = Math.max(1, u * 0.05)
    g.stroke(coast)
    g.strokeStyle = 'rgba(255, 250, 235, 0.35)'
    g.lineWidth = Math.max(2, u * 0.09)
    g.stroke(thin)
    g.strokeStyle = 'rgba(80, 58, 34, 0.38)'
    g.lineWidth = Math.max(1, u * 0.03)
    g.stroke(thin)
    g.strokeStyle = 'rgba(255, 248, 230, 0.55)'
    g.lineWidth = Math.max(3, u * 0.14)
    g.stroke(thick)
    g.strokeStyle = 'rgba(92, 64, 34, 0.6)'
    g.lineWidth = Math.max(1.5, u * 0.06)
    g.stroke(thick)

    this.buf = c
    this.bufKey = { cellPx: u, x0: bx0, y0: by0, cols, rows }
  }

  /** Fog over terrain far from anything explored (only when the fog covers terrain too). */
  private drawFog(t: Transform) {
    const st = this.state!
    if (st.settings.fogScope !== 'terrain' || st.settings.fogMode === 'off') return
    const { world, words } = st.pack
    const key = `${st.view.version}`
    if (key !== this.fogKey || !this.fog) {
      this.fogKey = key
      const R = 7
      const dist = new Float32Array(world.w * world.h).fill(R)
      for (const w of words) {
        const v = st.view.vis[w.i]
        if (v < Vis.Revealed) continue
        const cx = w.x - world.x0
        const cy = w.y - world.y0
        for (let dy = -R; dy <= R; dy++) {
          const y = cy + dy
          if (y < 0 || y >= world.h) continue
          for (let dx = -R; dx <= R; dx++) {
            const x = cx + dx
            if (x < 0 || x >= world.w) continue
            const d = Math.hypot(dx, dy)
            const k = y * world.w + x
            if (d < dist[k]) dist[k] = d
          }
        }
      }
      const sx = world.spawn[0] - world.x0
      const sy = world.spawn[1] - world.y0
      const c = this.fog ?? document.createElement('canvas')
      c.width = world.w
      c.height = world.h
      const g = c.getContext('2d')!
      const img = g.createImageData(world.w, world.h)
      for (let k = 0; k < dist.length; k++) {
        const x = k % world.w
        const y = Math.floor(k / world.w)
        const d = Math.min(dist[k], Math.hypot(x - sx, y - sy) - 2)
        const a = Math.max(0, Math.min(1, (d - 3) / 4))
        img.data[k * 4] = 34
        img.data[k * 4 + 1] = 42
        img.data[k * 4 + 2] = 56
        img.data[k * 4 + 3] = Math.round(a * 200)
      }
      g.putImageData(img, 0, 0)
      this.fog = c
    }
    const ctx = this.ctx
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(this.fog, t.ox + (world.x0 - 0.5) * t.s, t.oy + (world.y0 - 0.5) * t.s, world.w * t.s, world.h * t.s)
  }

  private drawSpawn(t: Transform) {
    const { world } = this.state!.pack
    const [x, y] = world.spawn
    const sx = t.ox + x * t.s
    const sy = t.oy + y * t.s
    if (sx < -2 * t.s || sy < -2 * t.s || sx > this.w + 2 * t.s || sy > this.h + 2 * t.s) return
    const ctx = this.ctx
    drawFountain(ctx, sx, sy, t.s)
    const px = Math.max(11, Math.min(18, t.s * 0.3))
    ctx.font = `700 ${px}px ${FONT_ZH}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(255, 252, 244, 0.9)'
    ctx.fillStyle = 'rgba(92, 64, 30, 0.95)'
    ctx.strokeText('起点 · Start', sx, sy + t.s * 0.62)
    ctx.fillText('起点 · Start', sx, sy + t.s * 0.62)
  }

  private drawRegionLabels(t: Transform) {
    const { world } = this.state!.pack
    const ctx = this.ctx
    const [x0, y0, x1, y1] = this.visibleCells(t, 6)
    const px = Math.max(13, Math.min(24, t.s * 0.44))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (const r of world.regions) {
      if (r.x < x0 || r.x > x1 || r.y < y0 || r.y > y1) continue
      // Words sit on even rows, so odd rows are free for names.
      const ly = r.y % 2 === 0 ? r.y + 1 : r.y
      const sx = t.ox + r.x * t.s
      const sy = t.oy + ly * t.s + t.s * 0.12
      const dark = rgb(shade(this.regionRgb[r.id], -0.6))
      ctx.globalAlpha = 0.9
      ctx.font = `800 ${px}px ${FONT_ZH}`
      ctx.lineWidth = Math.max(3, px * 0.24)
      ctx.strokeStyle = 'rgba(255, 252, 244, 0.85)'
      ctx.fillStyle = dark
      ctx.strokeText(r.zh, sx, sy)
      ctx.fillText(r.zh, sx, sy)
      const sub = `${r.en.toUpperCase()} · ${this.levelLabel(r.level)}`
      ctx.font = `700 ${Math.max(9, px * 0.46)}px ${FONT_UI}`
      ctx.lineWidth = 3
      ctx.strokeText(sub, sx, sy + px * 0.8)
      ctx.fillText(sub, sx, sy + px * 0.8)
      ctx.globalAlpha = 1
    }
  }

  private levelLabel(level: number): string {
    return this.state!.pack.manifest.levels[level - 1]?.label ?? `L${level}`
  }

  // ---- words --------------------------------------------------------------

  private drawWords(t: Transform) {
    const st = this.state!
    const { pack, view, settings } = st
    const { world, wordAt, words } = pack
    const { vis, due, stages } = view
    const { fogMode } = settings
    const ctx = this.ctx
    const s = t.s
    const [x0, y0, x1, y1] = this.visibleCells(t, 1)

    const idx: number[] = []
    for (let y = Math.max(y0, world.y0); y <= Math.min(y1, world.y0 + world.h - 1); y++) {
      const row = (y - world.y0) * world.w
      for (let x = Math.max(x0, world.x0); x <= Math.min(x1, world.x0 + world.w - 1); x++) {
        const j = wordAt[row + x - world.x0]
        if (j >= 0 && (this.drawable(j) || j === st.selected)) idx.push(j)
      }
    }

    // Landmarks, back to front (row by row).
    for (const i of idx) {
      const w = words[i]
      const sx = t.ox + w.x * s
      const sy = t.oy + w.y * s
      const v = vis[i]
      const unexplored = v <= Vis.Frontier
      if (i === st.selected || i === st.hovered) this.drawRing(sx, sy, s, i === st.selected)
      if (v === Vis.Learned || v === Vis.Active || v === Vis.Revealed) this.drawBase(sx, sy, s, v)
      if (unexplored && fogMode === 'hidden') {
        this.drawMystery(sx, sy, s)
        continue
      }
      const fogged = unexplored && fogMode !== 'off'
      ctx.globalAlpha = fogged ? (v === Vis.Frontier ? 0.75 : 0.5) : 1
      const zoomFactor = 0.86 + Math.min(0.24, Math.max(0, (w.freq - 3) * 0.06))
      drawLandmark(ctx, this.wordKind[i], sx, sy, s * zoomFactor, {
        color: this.wordRgb[i],
        h: this.wordHash[i],
        muted: fogged ? (v === Vis.Frontier ? 0.45 : 0.7) : 0,
      })
      ctx.globalAlpha = 1
    }

    // Name plates, most important first; skipped where they would overlap.
    const prio = (i: number) => {
      const v = vis[i]
      return (i === st.selected ? 100 : i === st.hovered ? 90 : 0) + (due[i] ? 8 : 0) + v * 2
    }
    const order = [...idx].sort((a, b) => prio(b) - prio(a) || a - b)
    const occ = new Occupancy(this.w, this.h)
    const zhPx = Math.max(11, Math.min(20, s * 0.34))
    const pyPx = Math.max(9, Math.min(13, s * 0.22))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    for (const i of order) {
      const v = vis[i]
      const forced = i === st.selected || i === st.hovered
      const explored = v >= Vis.Revealed
      if (!explored && fogMode === 'hidden') continue
      const w = words[i]
      const sx = t.ox + w.x * s
      const top = t.oy + w.y * s + s * 0.42
      const withPinyin = settings.mapPinyin && s >= 30 && (explored || fogMode === 'off')
      const zhW = textWidth(w.hanzi) * zhPx
      const pyW = withPinyin ? w.pinyin.length * pyPx * 0.56 : 0
      const plate = explored
      const padX = plate ? 5 : 2
      const bw = Math.max(zhW, pyW) + padX * 2
      const bh = zhPx * 1.18 + (withPinyin ? pyPx * 1.2 : 0) + (plate ? 2 : 0)
      if (forced) occ.place(sx - bw / 2, top, bw, bh)
      else if (!occ.tryPlace(sx - bw / 2, top, bw, bh)) continue
      ctx.globalAlpha = !explored && fogMode !== 'off' ? (v === Vis.Frontier ? 0.75 : 0.55) : 1
      if (plate) {
        roundRect(ctx, sx - bw / 2, top, bw, bh, Math.min(6, bh / 2))
        ctx.fillStyle =
          v === Vis.Learned ? 'rgba(255, 244, 214, 0.96)' : v === Vis.Active ? 'rgba(232, 240, 255, 0.96)' : 'rgba(255, 253, 247, 0.94)'
        ctx.fill()
        ctx.lineWidth = 1.2
        ctx.strokeStyle =
          v === Vis.Learned ? STATUS_COLORS.learnedStroke : v === Vis.Active ? STATUS_COLORS.active : rgb(shade(this.wordRgb[i], -0.45))
        ctx.stroke()
      }
      const ty = top + (plate ? 2 : 0)
      ctx.font = `${v === Vis.Learned ? 700 : 600} ${zhPx}px ${FONT_ZH}`
      ctx.fillStyle = v === Vis.Learned ? '#6b4300' : '#1f1a14'
      if (!plate) {
        ctx.lineWidth = Math.max(2.5, zhPx * 0.22)
        ctx.strokeStyle = 'rgba(255, 253, 247, 0.9)'
        ctx.strokeText(w.hanzi, sx, ty)
      }
      ctx.fillText(w.hanzi, sx, ty)
      if (withPinyin) {
        ctx.font = `500 ${pyPx}px ${FONT_UI}`
        ctx.fillStyle = '#4a4036'
        if (!plate) {
          ctx.lineWidth = 3
          ctx.strokeText(w.pinyin, sx, ty + zhPx * 1.1)
        }
        ctx.fillText(w.pinyin, sx, ty + zhPx * 1.1)
      }
      ctx.globalAlpha = 1
    }

    // Status badges on top.
    for (const i of idx) {
      const v = vis[i]
      if (v < Vis.Revealed) continue
      const w = words[i]
      const sx = t.ox + w.x * s
      const sy = t.oy + w.y * s
      if (due[i]) this.drawQuestMark(sx, sy - s * 0.66, s)
      else if (v === Vis.Learned) this.drawStar(sx + s * 0.3, sy - s * 0.36, Math.max(5, s * 0.13))
      if (v === Vis.Active) this.drawPips(sx - s * 0.46, sy, s, stages[i], view.stageCount)
    }
  }

  private drawRing(sx: number, sy: number, s: number, selected: boolean) {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.ellipse(sx, sy + s * 0.34, s * 0.5, s * 0.18, 0, 0, Math.PI * 2)
    ctx.fillStyle = selected ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 0.3)'
    ctx.fill()
    ctx.lineWidth = selected ? 3 : 2
    ctx.strokeStyle = selected ? '#16120c' : 'rgba(30, 30, 30, 0.45)'
    ctx.stroke()
  }

  private drawBase(sx: number, sy: number, s: number, v: number) {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.ellipse(sx, sy + s * 0.34, s * 0.4, s * 0.13, 0, 0, Math.PI * 2)
    if (v === Vis.Learned) {
      ctx.fillStyle = rgb(GOLD, 0.55)
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = STATUS_COLORS.learnedStroke
    } else if (v === Vis.Active) {
      ctx.fillStyle = 'rgba(47, 111, 214, 0.25)'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = STATUS_COLORS.active
    } else {
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    }
    ctx.stroke()
  }

  /** Undiscovered word next to explored ones, in "hidden" fog mode. */
  private drawMystery(sx: number, sy: number, s: number) {
    const ctx = this.ctx
    const r = s * 0.26
    ctx.fillStyle = 'rgba(70, 78, 90, 0.55)'
    ctx.beginPath()
    ctx.arc(sx - r * 0.6, sy + r * 0.2, r * 0.8, 0, Math.PI * 2)
    ctx.arc(sx + r * 0.6, sy + r * 0.2, r * 0.8, 0, Math.PI * 2)
    ctx.arc(sx, sy - r * 0.25, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `800 ${Math.max(10, r * 1.4)}px ${FONT_UI}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('?', sx, sy)
  }

  /** "!" over a word whose quest is due today, like a quest giver. */
  private drawQuestMark(x: number, y: number, s: number) {
    const ctx = this.ctx
    const r = Math.max(7, Math.min(12, s * 0.2))
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.moveTo(x - r * 0.35, y + r * 0.85)
    ctx.lineTo(x, y + r * 1.45)
    ctx.lineTo(x + r * 0.35, y + r * 0.85)
    ctx.fillStyle = STATUS_COLORS.due
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#5c4200'
    ctx.stroke()
    ctx.fillStyle = '#3d2c00'
    ctx.font = `900 ${r * 1.45}px ${FONT_UI}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('!', x, y + r * 0.08)
  }

  private drawStar(x: number, y: number, r: number) {
    const ctx = this.ctx
    ctx.beginPath()
    for (let k = 0; k < 10; k++) {
      const a = (Math.PI / 5) * k - Math.PI / 2
      const rr = k % 2 ? r * 0.45 : r
      const px = x + Math.cos(a) * rr
      const py = y + Math.sin(a) * rr
      if (k) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
    }
    ctx.closePath()
    ctx.fillStyle = STATUS_COLORS.learned
    ctx.fill()
    ctx.lineWidth = 1.2
    ctx.strokeStyle = STATUS_COLORS.learnedStroke
    ctx.stroke()
  }

  private drawPips(x: number, y: number, s: number, done: number, count: number) {
    const ctx = this.ctx
    const r = Math.max(2, s * 0.05)
    const gap = r * 2.8
    for (let k = 0; k < count; k++) {
      ctx.beginPath()
      ctx.arc(x, y + s * 0.3 - k * gap, r, 0, Math.PI * 2)
      ctx.fillStyle = k < done ? STATUS_COLORS.learned : 'rgba(255,255,255,0.92)'
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(60, 45, 20, 0.8)'
      ctx.stroke()
    }
  }
}

function textWidth(s: string): number {
  let n = 0
  for (const ch of s) n += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.6
  return n
}

class Occupancy {
  private rects: number[][] = []
  private buckets = new Map<number, number[]>()
  private readonly B = 48
  private w: number
  private h: number

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
  }

  private keys(x: number, y: number, w: number, h: number): number[] {
    const out: number[] = []
    for (let bx = Math.floor(x / this.B); bx <= Math.floor((x + w) / this.B); bx++)
      for (let by = Math.floor(y / this.B); by <= Math.floor((y + h) / this.B); by++) out.push((bx + 100) * 4096 + by + 100)
    return out
  }

  tryPlace(x: number, y: number, w: number, h: number): boolean {
    if (x + w < 0 || y + h < 0 || x > this.w || y > this.h) return false
    for (const k of this.keys(x, y, w, h)) {
      for (const r of this.buckets.get(k) ?? []) {
        const o = this.rects[r]
        if (x < o[0] + o[2] && x + w > o[0] && y < o[1] + o[3] && y + h > o[1]) return false
      }
    }
    this.place(x, y, w, h)
    return true
  }

  place(x: number, y: number, w: number, h: number): void {
    const id = this.rects.length
    this.rects.push([x, y, w, h])
    for (const k of this.keys(x, y, w, h)) {
      let b = this.buckets.get(k)
      if (!b) this.buckets.set(k, (b = []))
      b.push(id)
    }
  }
}
