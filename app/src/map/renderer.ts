import type { Pack } from '../data/pack'
import { Vis, type MapView } from '../logic/explore'
import type { Settings } from '../logic/save'
import { DECOR_DENSITY, drawDecor, drawFountain, hash2, hashString, hexToRgb, mix, rgb, roundRect, shade, valueNoise, type RGB } from './draw'
import { drawHall, drawLandmark, drawPlayer, LANDMARK_TOP, landmarkFor, landmarkWidth, type LandmarkKind, type TextSpot } from './landmarks'

export interface RenderState {
  pack: Pack
  view: MapView
  settings: Settings
  selected: number | null
  hovered: number | null
  /** Region whose hall dialog is open. */
  hall: number | null
}

/** Something on the map the player can interact with. */
export type Target = { word: number } | { hall: number }

export type Facing = 'up' | 'down' | 'left' | 'right'

export interface PlayerSprite {
  /** Position in cells (continuous); the feet are a little below (x, y). */
  x: number
  y: number
  facing: Facing
  /** Walk cycle phase. */
  step: number
  moving: boolean
}

/** What covers part of the map: nothing, the word dialog at the bottom, or the details panel. */
export type PanelMode = 'none' | 'popover' | 'details'

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
  /** Player position, if any. */
  px?: number
  py?: number
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

/** How far below a cell's center the feet of the player stand, in cells. */
export const PLAYER_FEET = 0.25

const WATER = new Set(['~', '='])
/** Road classes: 1 = town road, 2 = trail, 3 = bridge. */
const ROAD_CLASS: Record<string, number> = { '+': 1, ',': 2, b: 3 }

/** A word's spot on screen this frame (for the badge pass). */
interface Drawn {
  i: number
  sx: number
  sy: number
  spot: TextSpot
  /** Half the text plaque width, in px. */
  half: number
}

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
  private lastStep = 0
  private state: RenderState | null = null
  onCamera: ((cam: CameraInfo) => void) | null = null

  private player: PlayerSprite | null = null
  private following = true
  private panel: PanelMode = 'none'
  private near: Target | null = null
  private keyHints = false
  private hallHover: number | null = null

  private pack: Pack | null = null
  private groundRgb: RGB[] = []
  private waterIdx = new Set<number>()
  private oceanIdx = 0
  private regionRgb: RGB[] = []
  private regionLevel: number[] = []
  private wordKind: LandmarkKind[] = []
  private wordHash: Float32Array = new Float32Array(0)
  /** Landmark width, in cells. */
  private wordW: Float32Array = new Float32Array(0)
  private wordSnow: Uint8Array = new Uint8Array(0)
  /** Ground drawn under each cell (roads and bridges get the ground around them). */
  private baseGround: Int16Array = new Int16Array(0)
  private roadClass: Uint8Array = new Uint8Array(0)
  /** Cells kept clear of decorations (under landmarks, halls and the fountain). */
  private noDecor: Uint8Array = new Uint8Array(0)
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
    const codes = world.groundCodes
    const N = world.w * world.h
    this.groundRgb = world.ground.map((g) => hexToRgb(g.color))
    this.waterIdx = new Set(codes.flatMap((c, k) => (WATER.has(c) ? [k] : [])))
    this.oceanIdx = Math.max(0, codes.indexOf('~'))
    this.regionRgb = world.regions.map((r) => hexToRgb(r.color))
    this.regionLevel = world.regions.map((r) => r.level)
    const cell = (x: number, y: number) => (y - world.y0) * world.w + (x - world.x0)

    // Roads: remember their class, and paint the ground around them underneath.
    this.roadClass = new Uint8Array(N)
    this.baseGround = Int16Array.from(world.terrain)
    for (let k = 0; k < N; k++) this.roadClass[k] = ROAD_CLASS[codes[world.terrain[k]]] ?? 0
    const counts = new Map<number, number>()
    for (let k = 0; k < N; k++) {
      const rc = this.roadClass[k]
      if (!rc) continue
      const x = k % world.w
      const y = Math.floor(k / world.w)
      counts.clear()
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= world.w || yy >= world.h) continue
          const kk = yy * world.w + xx
          if (this.roadClass[kk]) continue
          const g = world.terrain[kk]
          if ((rc === 3) !== this.waterIdx.has(g)) continue
          counts.set(g, (counts.get(g) ?? 0) + 1)
        }
      }
      let best = rc === 3 ? this.oceanIdx : Math.max(0, codes.indexOf('g'))
      let bestN = 0
      for (const [g, n] of counts) {
        if (n > bestN || (n === bestN && g < best)) {
          best = g
          bestN = n
        }
      }
      this.baseGround[k] = best
    }

    this.wordHash = Float32Array.from(pack.words, (w) => hashString(w.id))
    this.wordKind = pack.words.map((w, i) => {
      const k = cell(w.x, w.y)
      const code = codes[this.baseGround[k] ?? 0] ?? 'g'
      return landmarkFor(code, world.regions[w.region]?.kind === 'wild', this.wordHash[i])
    })
    this.wordSnow = Uint8Array.from(pack.words, (w) => {
      const code = codes[this.baseGround[cell(w.x, w.y)] ?? 0]
      return code === 'k' || code === 's' ? 1 : 0
    })
    this.wordW = Float32Array.from(pack.words, (w, i) => landmarkWidth(this.wordKind[i], textWidth(w.hanzi) * 0.36))

    this.noDecor = new Uint8Array(N)
    const clear = (x: number, y: number) => {
      if (x < world.x0 || y < world.y0 || x >= world.x0 + world.w || y >= world.y0 + world.h) return
      this.noDecor[cell(x, y)] = 1
    }
    for (const w of pack.words) for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 1; dx++) clear(w.x + dx, w.y + dy)
    for (const r of world.regions) for (let dy = -2; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) clear(r.x + dx, r.y + dy)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) clear(world.spawn[0] + dx, world.spawn[1] + dy)

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
    this.base = Math.min(64, Math.max(36, Math.min(this.w, this.h) / 13))
    this.cam = this.clampCam({ ...this.cam, scale: this.base * zoom })
    if (this.following && this.player) this.cam = this.followCam()
    this.bufKey.cellPx = 0
    this.requestDraw()
  }

  // ---- player & interaction state -------------------------------------------

  setPlayer(p: PlayerSprite | null): void {
    this.player = p
    this.requestDraw()
  }

  /** Follow the player again; `snap` jumps there instead of easing. */
  follow(snap = false): void {
    this.following = true
    if (snap && this.player) {
      this.anim = null
      this.cam = this.followCam()
    }
    this.requestDraw()
  }

  get isFollowing(): boolean {
    return this.following
  }

  /** Glide the camera to the player (after a long jump). */
  flyToPlayer(): void {
    if (!this.player) return
    this.following = true
    const to = this.followCam()
    const dist = Math.hypot(to.x - this.cam.x, to.y - this.cam.y)
    if (dist * this.cam.scale > this.w * 1.5) {
      // Too far to glide: cut, like a fast-travel screen.
      this.anim = null
      this.cam = to
      this.requestDraw()
    } else this.animateTo(to, Math.min(700, 300 + dist * 8))
  }

  setPanel(panel: PanelMode): void {
    if (panel === this.panel) return
    this.panel = panel
    this.requestDraw()
  }

  setNear(t: Target | null, keyHints: boolean): void {
    if (sameTarget(t, this.near) && keyHints === this.keyHints) return
    this.near = t
    this.keyHints = keyHints
    this.requestDraw()
  }

  setHallHover(r: number | null): void {
    if (r === this.hallHover) return
    this.hallHover = r
    this.requestDraw()
  }

  // ---- camera -------------------------------------------------------------

  info(): CameraInfo {
    const t = this.xf()
    const p = this.player
    return { ...this.cam, base: this.base, cols: this.w / t.s, rows: this.h / t.s, px: p?.x, py: p?.y }
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

  /** Jump to a cell at a zoom relative to the default view (free look). */
  jump(x: number, y: number, zoom = 1): void {
    this.anim = null
    this.cam = this.clampCam({ x, y, scale: this.base * zoom })
    this.requestDraw()
  }

  /** Set the zoom relative to the default view, keeping the player in view. */
  setZoom(zoom: number): void {
    this.cam = this.clampCam({ ...this.cam, scale: this.base * zoom })
    if (this.following && this.player) this.cam = this.followCam()
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

  /** Drag the map: look around without moving the player. */
  panBy(dx: number, dy: number): void {
    this.anim = null
    this.following = false
    this.cam = this.clampCam({ ...this.cam, x: this.cam.x - dx / this.cam.scale, y: this.cam.y - dy / this.cam.scale })
    this.requestDraw()
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.anim = null
    if (this.following && this.player) {
      // Zoom around the player so they stay put on screen.
      ;[sx, sy] = this.worldToScreen(this.player.x, this.player.y)
    }
    const [wx, wy] = this.screenToWorld(sx, sy)
    const scale = Math.min(this.base * ZOOM_MAX, Math.max(this.base * ZOOM_MIN, this.cam.scale * factor))
    this.cam = this.clampCam({ x: wx - (sx - this.w / 2) / scale, y: wy - (sy - this.h / 2) / scale, scale })
    if (this.following && this.player) this.cam = this.followCam()
    this.requestDraw()
  }

  zoomBy(factor: number): void {
    const scale = this.cam.scale * factor
    if (this.following && this.player) this.animateTo(this.followCam(scale), 250)
    else this.animateTo({ ...this.cam, scale }, 250)
  }

  /** Screen area not covered by the top bar and the open panel. */
  private freeRect(): { l: number; r: number; t: number; b: number } {
    const wide = this.w > 700
    const top = wide ? 64 : 104
    if (this.panel === 'details') {
      if (wide) return { l: 0, r: this.w - 414, t: top, b: this.h }
      return { l: 0, r: this.w, t: top, b: this.h * 0.38 }
    }
    if (this.panel === 'popover') return { l: 0, r: this.w, t: top, b: this.h - (wide ? 190 : Math.min(this.h * 0.45, 250)) }
    return { l: 0, r: this.w, t: top, b: this.h }
  }

  /** Camera that puts the player in the middle of the free part of the screen. */
  private followCam(scale = this.cam.scale): Camera {
    const p = this.player!
    const s = Math.min(this.base * ZOOM_MAX, Math.max(this.base * ZOOM_MIN, scale))
    const f = this.freeRect()
    const dx = ((f.l + f.r) / 2 - this.w / 2) / s
    const dy = ((f.t + f.b) / 2 - this.h / 2) / s
    return this.clampCam({ x: p.x - dx, y: p.y - 0.3 - dy, scale: s })
  }

  /** Look at a cell without moving the player. */
  flyTo(x: number, y: number, opts: { resetZoom?: boolean } = {}): void {
    this.following = false
    const s = opts.resetZoom ? this.base : this.cam.scale
    const f = this.freeRect()
    const dx = ((f.l + f.r) / 2 - this.w / 2) / s
    const dy = ((f.t + f.b) / 2 - this.h / 2) / s
    const dist = Math.hypot(x - dx - this.cam.x, y - dy - this.cam.y)
    this.animateTo({ x: x - dx, y: y - dy, scale: s }, Math.min(900, 380 + dist * 6))
  }

  private animateTo(to: Camera, dur = 650): void {
    this.anim = { from: { ...this.cam }, to: this.clampCam(to), t0: performance.now(), dur }
    this.requestDraw()
  }

  private step(now: number): boolean {
    const dt = this.lastStep ? Math.min(0.1, Math.max(0, (now - this.lastStep) / 1000)) : 1 / 60
    this.lastStep = now
    const a = this.anim
    if (a) {
      // rAF timestamps can predate the performance.now() taken in animateTo, so clamp at 0 too.
      const t = Math.max(0, Math.min(1, (now - a.t0) / a.dur))
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const ls = Math.log(a.from.scale) + (Math.log(a.to.scale) - Math.log(a.from.scale)) * e
      this.cam = { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e, scale: Math.exp(ls) }
      if (t >= 1) this.anim = null
      return true
    }
    if (this.following && this.player) {
      const to = this.followCam()
      const dx = to.x - this.cam.x
      const dy = to.y - this.cam.y
      if (Math.hypot(dx, dy) * this.cam.scale < 0.5) {
        this.cam = to
        this.lastStep = 0
        return false
      }
      const k = 1 - Math.exp(-dt * 8)
      this.cam = { ...this.cam, x: this.cam.x + dx * k, y: this.cam.y + dy * k }
      return true
    }
    this.lastStep = 0
    return false
  }

  get animating(): boolean {
    return this.anim !== null
  }

  // ---- hit testing --------------------------------------------------------

  private drawable(i: number): boolean {
    const st = this.state!
    return st.settings.fogMode !== 'hidden' || st.view.vis[i] >= Vis.Frontier
  }

  hitTest(sx: number, sy: number): Target | null {
    const st = this.state
    if (!st) return null
    const [wx, wy] = this.screenToWorld(sx, sy)
    const { world, wordAt, hallAt } = st.pack
    let best: Target | null = null
    let bestD = Infinity
    const cx = Math.round(wx)
    const cy = Math.round(wy)
    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx
        const y = cy + dy
        const gx = x - world.x0
        const gy = y - world.y0
        if (gx < 0 || gy < 0 || gx >= world.w || gy >= world.h) continue
        const k = gy * world.w + gx
        const j = wordAt[k]
        if (j >= 0 && (this.drawable(j) || j === st.selected)) {
          const half = Math.max(0.5, this.wordW[j] / 2)
          const top = LANDMARK_TOP[this.wordKind[j]] + 0.1
          if (Math.abs(wx - x) < half && wy >= y - top && wy <= y + 0.6) {
            const d = Math.abs(wx - x) + Math.abs(wy - y)
            if (d < bestD) {
              bestD = d
              best = { word: j }
            }
          }
        }
        const r = hallAt[k]
        if (r >= 0 && Math.abs(wx - x) < 1.2 && wy >= y - 1.7 && wy <= y + 1.3) {
          const d = Math.abs(wx - x) + Math.abs(wy - y)
          if (d < bestD) {
            bestD = d
            best = { hall: r }
          }
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
    const drawn = this.drawScene(t)
    this.drawBadges(t, drawn)
    this.onCamera?.(this.info())
  }

  // ---- terrain ------------------------------------------------------------

  private ensureTerrain(t: Transform) {
    const [x0, y0, x1, y1] = this.visibleCells(t)
    const k = this.bufKey
    if (k.cellPx === t.cellPx && x0 >= k.x0 && y0 >= k.y0 && x1 < k.x0 + k.cols && y1 < k.y0 + k.rows) return
    let margin = 6
    const area = (m: number) => (x1 - x0 + 1 + 2 * m) * (y1 - y0 + 1 + 2 * m) * t.cellPx * t.cellPx
    while (margin > 1 && area(margin) > 16e6) margin--
    this.renderTerrain(x0 - margin, y0 - margin, x1 - x0 + 1 + 2 * margin, y1 - y0 + 1 + 2 * margin, t.cellPx)
  }

  private renderTerrain(bx0: number, by0: number, cols: number, rows: number, u: number) {
    const pack = this.pack!
    const { world } = pack
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
    const groundOf = (k: number) => (k < 0 ? this.oceanIdx : this.baseGround[k])
    const isWater = (k: number) => this.waterIdx.has(groundOf(k))
    const road = (x: number, y: number) => {
      const k = at(x, y)
      return k < 0 ? 0 : this.roadClass[k]
    }
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

    // Roads and trails: strokes between the centers of neighbouring road cells. Diagonal links only where the
    // road really turns diagonally (no orthogonal road cell shared by both ends).
    const roads = new Path2D()
    const trails = new Path2D()
    const bridges = new Path2D()
    // 2×2 blocks of road would leave a hole between the four strokes; they get filled in afterwards.
    const roadBlocks = new Path2D()
    const trailBlocks = new Path2D()
    const link = (q: number, r: number, a: number, q2: number, r2: number, b: number) => {
      const path = a === 3 || b === 3 ? bridges : a === 1 && b === 1 ? roads : trails
      path.moveTo(q * u + u / 2, r * u + u / 2)
      path.lineTo(q2 * u + u / 2, r2 * u + u / 2)
    }
    for (let r = -1; r <= rows; r++) {
      for (let q = -1; q <= cols; q++) {
        const x = bx0 + q
        const y = by0 + r
        const a = road(x, y)
        if (!a) continue
        const cx = q * u + u / 2
        const cy = r * u + u / 2
        const own = a === 3 ? bridges : a === 1 ? roads : trails
        own.moveTo(cx, cy)
        own.lineTo(cx + 0.01, cy)
        const e = road(x + 1, y)
        const s = road(x, y + 1)
        if (e) link(q, r, a, q + 1, r, e)
        if (s) link(q, r, a, q, r + 1, s)
        const se = road(x + 1, y + 1)
        if (se && !e && !s) link(q, r, a, q + 1, r + 1, se)
        const sw = road(x - 1, y + 1)
        if (sw && !road(x - 1, y) && !s) link(q, r, a, q - 1, r + 1, sw)
        if (e && s && se && a !== 3 && e !== 3 && s !== 3 && se !== 3)
          (a === 1 && e === 1 && s === 1 && se === 1 ? roadBlocks : trailBlocks).rect(cx, cy, u, u)
      }
    }
    const roadRgb = this.groundRgb[codes.indexOf('+')] ?? [217, 197, 156]
    const trailRgb = this.groundRgb[codes.indexOf(',')] ?? [201, 177, 137]
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.strokeStyle = rgb(shade(trailRgb, -0.3), 0.55)
    g.lineWidth = u * 0.44
    g.stroke(trails)
    g.strokeStyle = rgb(shade(roadRgb, -0.32), 0.75)
    g.lineWidth = u * 0.66
    g.stroke(roads)
    g.strokeStyle = rgb(trailRgb)
    g.lineWidth = u * 0.34
    g.stroke(trails)
    g.strokeStyle = rgb(roadRgb)
    g.lineWidth = u * 0.54
    g.stroke(roads)
    g.fillStyle = rgb(trailRgb)
    g.fill(trailBlocks)
    g.fillStyle = rgb(roadRgb)
    g.fill(roadBlocks)

    // Decorations on empty cells (not on roads, or under landmarks and halls).
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const x = bx0 + q
        const y = by0 + r
        const k = at(x, y)
        if (k >= 0 && (this.noDecor[k] || this.roadClass[k])) continue
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

    // Bridges over everything else on the ground, with planks across.
    g.lineCap = 'butt'
    g.strokeStyle = 'rgb(96, 66, 40)'
    g.lineWidth = u * 0.72
    g.stroke(bridges)
    g.strokeStyle = 'rgb(168, 124, 82)'
    g.lineWidth = u * 0.58
    g.stroke(bridges)
    g.strokeStyle = 'rgba(96, 66, 40, 0.7)'
    g.lineWidth = Math.max(1, u * 0.03)
    g.beginPath()
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const x = bx0 + q
        const y = by0 + r
        if (road(x, y) !== 3) continue
        const across = road(x - 1, y) || road(x + 1, y)
        for (let s = -1.5; s <= 1.5; s++) {
          const o = s * u * 0.22
          const cx = q * u + u / 2
          const cy = r * u + u / 2
          if (across) {
            g.moveTo(cx + o, cy - u * 0.27)
            g.lineTo(cx + o, cy + u * 0.27)
          } else {
            g.moveTo(cx - u * 0.27, cy + o)
            g.lineTo(cx + u * 0.27, cy + o)
          }
        }
      }
    }
    g.stroke()

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

  // ---- scene: landmarks, halls, the fountain and the player, back to front ----

  private zhPx(u: number): number {
    return Math.min(26, Math.max(10, u * 0.36))
  }

  private drawScene(t: Transform): Drawn[] {
    const st = this.state!
    const { pack } = st
    const { world, wordAt, hallAt } = pack
    const u = t.s
    const [x0, y0, x1, y1] = this.visibleCells(t, 2)
    // [base y in cells, kind (0 word, 1 hall, 2 fountain, 3 player), id]
    const items: [number, number, number][] = []
    for (let y = Math.max(y0, world.y0); y <= Math.min(y1, world.y0 + world.h - 1); y++) {
      const row = (y - world.y0) * world.w
      for (let x = Math.max(x0, world.x0); x <= Math.min(x1, world.x0 + world.w - 1); x++) {
        const k = row + x - world.x0
        const j = wordAt[k]
        if (j >= 0 && (this.drawable(j) || j === st.selected)) items.push([y + 0.38, 0, j])
        const r = hallAt[k]
        if (r >= 0) items.push([y + 0.4, 1, r])
      }
    }
    const [fx, fy] = world.spawn
    if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) items.push([fy + 0.3, 2, 0])
    const p = this.player
    if (p) items.push([p.y + PLAYER_FEET, 3, 0])
    items.sort((a, b) => a[0] - b[0] || a[1] - b[1])

    const drawn: Drawn[] = []
    const ctx = this.ctx
    for (const [, kind, id] of items) {
      if (kind === 0) {
        const d = this.drawWord(t, id)
        if (d) drawn.push(d)
      } else if (kind === 1) {
        const r = world.regions[id]
        const sx = t.ox + r.x * u
        const sy = t.oy + r.y * u
        if (id === st.hall || id === this.hallHover || this.isNear({ hall: id })) {
          this.drawRing(sx, sy + u * 0.02, u * 2, id === st.hall ? 2 : this.isNear({ hall: id }) ? 1 : 0)
        }
        drawHall(ctx, sx, sy, u, this.regionRgb[id], st.view.regionLearned[id] >= r.count)
      } else if (kind === 2) {
        drawFountain(ctx, t.ox + fx * u, t.oy + fy * u, u)
      } else if (p) {
        drawPlayer(ctx, t.ox + p.x * u, t.oy + (p.y + PLAYER_FEET) * u, u, p.facing, p.step, p.moving)
      }
    }
    return drawn
  }

  private isNear(t: Target): boolean {
    const n = this.near
    return !!n && sameTarget(n, t)
  }

  private drawWord(t: Transform, i: number): Drawn | null {
    const st = this.state!
    const w = st.pack.words[i]
    const v = st.view.vis[i]
    const { fogMode } = st.settings
    const ctx = this.ctx
    const u = t.s
    const sx = t.ox + w.x * u
    const sy = t.oy + w.y * u
    const unexplored = v <= Vis.Frontier
    const mystery = unexplored && fogMode === 'hidden'
    const dimmed = unexplored && fogMode === 'dim'
    const W = this.wordW[i] * u
    const sel = i === st.selected
    const near = this.isNear({ word: i })
    if (sel || near || i === st.hovered) this.drawRing(sx, sy, W, sel ? 2 : near ? 1 : 0)
    const muted = mystery ? 0.9 : dimmed ? (v === Vis.Frontier ? 0.4 : 0.62) : 0
    const spot = drawLandmark(ctx, this.wordKind[i], sx, sy, {
      u,
      w: W,
      tint: this.regionRgb[w.region] ?? [180, 180, 180],
      h: this.wordHash[i],
      muted,
      snow: this.wordSnow[i] === 1,
    })
    const zhPx = this.zhPx(u)
    const text = mystery ? '?' : w.hanzi
    const tw = textWidth(text) * zhPx
    const half = tw / 2 + zhPx * 0.3
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    if (v === Vis.Active || v === Vis.Learned) {
      const learned = v === Vis.Learned
      roundRect(ctx, spot.x - half, spot.y - zhPx * 0.68, half * 2, zhPx * 1.36, zhPx * 0.3)
      ctx.fillStyle = learned ? 'rgb(255, 236, 170)' : 'rgba(228, 239, 255, 0.96)'
      ctx.fill()
      ctx.lineWidth = Math.max(1.2, u * 0.03)
      ctx.strokeStyle = learned ? 'rgb(176, 124, 20)' : STATUS_COLORS.active
      ctx.stroke()
      ctx.font = `700 ${zhPx}px ${FONT_ZH}`
      ctx.fillStyle = learned ? '#5a3800' : '#17305e'
      ctx.fillText(text, spot.x, spot.y + zhPx * 0.04)
    } else {
      ctx.globalAlpha = dimmed ? (v === Vis.Frontier ? 0.85 : 0.62) : 1
      ctx.font = `${mystery ? 800 : 600} ${zhPx}px ${mystery ? FONT_UI : FONT_ZH}`
      ctx.lineWidth = Math.max(2.5, zhPx * 0.2)
      ctx.strokeStyle = spot.halo
      ctx.strokeText(text, spot.x, spot.y + zhPx * 0.04)
      ctx.fillStyle = spot.ink
      ctx.fillText(text, spot.x, spot.y + zhPx * 0.04)
      ctx.globalAlpha = 1
    }
    return { i, sx, sy, spot, half }
  }

  /** Ring on the ground: 2 = selected, 1 = in reach of the player, 0 = hovered. */
  private drawRing(sx: number, sy: number, W: number, level: number) {
    const ctx = this.ctx
    const u = this.cam.scale
    ctx.beginPath()
    ctx.ellipse(sx, sy + u * 0.38, Math.max(u * 0.5, W * 0.56), u * 0.2, 0, 0, Math.PI * 2)
    ctx.fillStyle = level === 2 ? 'rgba(255, 255, 255, 0.55)' : level === 1 ? 'rgba(255, 236, 160, 0.45)' : 'rgba(255, 255, 255, 0.3)'
    ctx.fill()
    ctx.lineWidth = level === 2 ? 3 : 2
    ctx.strokeStyle = level === 2 ? '#16120c' : level === 1 ? '#c98a00' : 'rgba(30, 30, 30, 0.45)'
    ctx.stroke()
  }

  // ---- badges and labels, on top of everything ---------------------------

  private drawBadges(t: Transform, drawn: Drawn[]) {
    const st = this.state!
    const { pack, view, settings } = st
    const { world, words } = pack
    const ctx = this.ctx
    const u = t.s
    const zhPx = this.zhPx(u)

    // Fountain label.
    const [fx, fy] = world.spawn
    {
      const sx = t.ox + fx * u
      const sy = t.oy + fy * u
      if (sx > -3 * u && sy > -3 * u && sx < this.w + 3 * u && sy < this.h + 3 * u) {
        this.banner(sx, sy + u * 0.62, ['Start'], [92, 64, 30], Math.max(10, Math.min(15, u * 0.26)))
      }
    }

    // Hall banners: the region's name and progress.
    const [x0, y0, x1, y1] = this.visibleCells(t, 3)
    for (const r of world.regions) {
      if (r.x < x0 || r.x > x1 || r.y < y0 || r.y > y1) continue
      const sx = t.ox + r.x * u
      const sy = t.oy + r.y * u
      const learned = view.regionLearned[r.id]
      const label = `${r.zh} · ${r.en}`
      const sub = `${this.levelLabel(r.level)} · ★ ${learned}/${r.count}`
      this.banner(sx, sy + u * 0.56, [label, sub], shade(this.regionRgb[r.id], -0.55), Math.max(11, Math.min(17, u * 0.3)))
    }

    for (const d of drawn) {
      const { i, sx, sy, spot, half } = d
      const v = view.vis[i]
      const w = words[i]
      const kind = this.wordKind[i]
      if (v >= Vis.Revealed && view.due[i]) this.drawQuestMark(sx, sy - LANDMARK_TOP[kind] * u - Math.max(9, u * 0.22), u)
      if (v === Vis.Learned) this.drawStar(spot.x + half, spot.y - zhPx * 0.62, Math.max(5, zhPx * 0.36))
      if (v === Vis.Active) this.drawPips(spot.x, spot.y + zhPx * 0.68, zhPx, view.stages[i], view.stageCount)
      const explored = v >= Vis.Revealed
      if (settings.mapPinyin && u >= 30 && (explored || settings.fogMode === 'off')) {
        const pyPx = Math.max(9, Math.min(14, u * 0.22))
        ctx.font = `600 ${pyPx}px ${FONT_UI}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(255, 252, 244, 0.9)'
        ctx.strokeText(w.pinyin, sx, sy + u * 0.48)
        ctx.fillStyle = '#3d342a'
        ctx.fillText(w.pinyin, sx, sy + u * 0.48)
      }
    }

    // Key hint next to whatever the player can talk to.
    if (this.keyHints && this.near) {
      let hx = 0
      let hy = 0
      if ('word' in this.near) {
        const w = words[this.near.word]
        hx = t.ox + w.x * u + (this.wordW[this.near.word] / 2) * u + u * 0.12
        hy = t.oy + w.y * u - u * 0.1
      } else {
        const r = world.regions[this.near.hall]
        hx = t.ox + r.x * u + u * 1.15
        hy = t.oy + r.y * u - u * 0.2
      }
      this.keyCap(hx, hy, 'E', Math.max(10, Math.min(15, u * 0.26)))
    }
  }

  /** A small sign with one or two lines of text, centered at (x, top). */
  private banner(x: number, top: number, lines: string[], ink: RGB, px: number) {
    const ctx = this.ctx
    const sub = px * 0.72
    ctx.font = `800 ${px}px ${FONT_ZH}`
    let bw = ctx.measureText(lines[0]).width
    if (lines[1]) {
      ctx.font = `700 ${sub}px ${FONT_UI}`
      bw = Math.max(bw, ctx.measureText(lines[1]).width)
    }
    bw += px * 1.1
    const bh = px * 1.35 + (lines[1] ? sub * 1.25 : 0)
    roundRect(ctx, x - bw / 2, top, bw, bh, Math.min(8, px * 0.5))
    ctx.fillStyle = 'rgba(255, 252, 244, 0.92)'
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = rgb(ink, 0.7)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = rgb(ink)
    ctx.font = `800 ${px}px ${FONT_ZH}`
    ctx.fillText(lines[0], x, top + px * 0.2)
    if (lines[1]) {
      ctx.font = `700 ${sub}px ${FONT_UI}`
      ctx.fillStyle = rgb(mix(ink, [120, 110, 100], 0.3))
      ctx.fillText(lines[1], x, top + px * 1.3)
    }
  }

  private keyCap(x: number, y: number, key: string, px: number) {
    const ctx = this.ctx
    const s = px * 1.5
    roundRect(ctx, x, y - s / 2, s, s, px * 0.3)
    ctx.fillStyle = 'rgba(30, 26, 20, 0.85)'
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `800 ${px}px ${FONT_UI}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(key, x + s / 2, y + px * 0.05)
  }

  private levelLabel(level: number): string {
    return this.state!.pack.manifest.levels[level - 1]?.label ?? `L${level}`
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

  /** Stage progress as a row of dots under an active word. */
  private drawPips(x: number, y: number, zhPx: number, done: number, count: number) {
    const ctx = this.ctx
    const r = Math.max(2.2, zhPx * 0.13)
    const gap = r * 2.7
    const left = x - ((count - 1) * gap) / 2
    for (let k = 0; k < count; k++) {
      ctx.beginPath()
      ctx.arc(left + k * gap, y, r, 0, Math.PI * 2)
      ctx.fillStyle = k < done ? STATUS_COLORS.learned : '#ffffff'
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = STATUS_COLORS.active
      ctx.stroke()
    }
  }
}

export function sameTarget(a: Target | null, b: Target | null): boolean {
  if (!a || !b) return a === b
  if ('word' in a) return 'word' in b && a.word === b.word
  return 'hall' in b && a.hall === b.hall
}

function textWidth(s: string): number {
  let n = 0
  for (const ch of s) n += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.6
  return n
}
