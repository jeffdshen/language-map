import type { Pack } from '../data/pack'
import { hanChars } from '../data/pack'
import type { PosCategory } from '../data/types'
import { Vis, type MapView } from '../logic/explore'
import type { Settings } from '../logic/save'
import {
  boundaryPath,
  coastRadius,
  hexToRgb,
  mix,
  OCEAN_FAR,
  renderTerrain,
  rgb,
  terrainExtent,
} from './terrain'

export interface RenderState {
  pack: Pack
  view: MapView
  settings: Settings
  selected: number | null
  hovered: number | null
}

interface Camera {
  x: number
  y: number
  scale: number
}

interface Anim {
  from: Camera
  to: Camera
  t0: number
  dur: number
}

const BIOME_ICON: Record<string, string> = {
  plaza: '🏛️',
  village: '🏘️',
  meadow: '🌸',
  harbor: '⚓',
  scholar: '📜',
  citadel: '🏰',
  market: '🪙',
  foundry: '⚙️',
  forest: '🌲',
  plains: '🌾',
  homestead: '🏡',
  orchard: '🍎',
  springs: '♨️',
  festival: '🎪',
  canyon: '🏜️',
  crystal: '💎',
  clocktower: '🕰️',
}

export const POS_SHAPE: Record<PosCategory, Shape> = {
  noun: 'circle',
  verb: 'diamond',
  adj: 'hexagon',
  adv: 'triangle',
  pron: 'person',
  num: 'square',
  measure: 'square',
  prep: 'pill',
  conj: 'pill',
  particle: 'pill',
  affix: 'pill',
  interj: 'star',
  onomat: 'star',
  phrase: 'scroll',
}

export type Shape = 'circle' | 'diamond' | 'hexagon' | 'triangle' | 'person' | 'square' | 'pill' | 'star' | 'scroll'

const FONT_ZH = '"Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Zen Hei", sans-serif'
const FONT_UI = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export const STATUS_COLORS = {
  learned: '#e0a526',
  learnedStroke: '#8a5a00',
  active: '#2f6fd6',
  revealed: '#ffffff',
  frontier: '#8f9aa6',
  due: '#ffd23f',
}

const CELL = 3
/** Longest dotted "trail" (world units) drawn from explored words to undiscovered ones. */
const MAX_DOTTED = 12

export class MapRenderer {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private dpr = 1
  private w = 1
  private h = 1
  cam: Camera = { x: 0, y: 0, scale: 12 }
  private anim: Anim | null = null
  private raf = 0
  private state: RenderState | null = null
  private terrain: HTMLCanvasElement | null = null
  private extent = 100
  private fog: HTMLCanvasElement | null = null
  private fogKey = ''
  private grid = new Map<number, number[]>()
  private prio: Float64Array = new Float64Array(0)
  private prioKey = ''
  private regionStroke: string[] = []
  private regionFill: string[] = []
  private boundaries: [number, number][][] = []
  private coast: [number, number][] = []
  private gridPack: Pack | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  setState(state: RenderState): void {
    const packChanged = state.pack !== this.state?.pack
    this.state = state
    if (packChanged) this.preparePack(state.pack)
    this.requestDraw()
  }

  private preparePack(pack: Pack) {
    if (this.gridPack === pack) return
    this.gridPack = pack
    this.terrain = renderTerrain(pack.regions)
    this.extent = terrainExtent(pack.regions)
    this.grid.clear()
    for (const w of pack.words) {
      const key = this.cellKey(Math.floor(w.x / CELL), Math.floor(w.y / CELL))
      let list = this.grid.get(key)
      if (!list) this.grid.set(key, (list = []))
      list.push(w.i)
    }
    const colors = pack.regions.themes.map((t) => hexToRgb(t.color))
    this.regionStroke = colors.map((c) => rgb(mix(c, [40, 30, 20], 0.55)))
    this.regionFill = colors.map((c) => rgb(mix(c, [40, 30, 20], 0.2)))
    const geo = pack.regions.geometry
    const k = pack.regions.themes.length
    this.boundaries = Array.from({ length: k }, (_, t) => boundaryPath(geo, t))
    const R = geo.radii[geo.radii.length - 1]
    this.coast = Array.from({ length: 721 }, (_, s) => {
      const a = (s / 720) * Math.PI * 2 - Math.PI
      const r = coastRadius(R, a)
      return [r * Math.cos(a), r * Math.sin(a)] as [number, number]
    })
  }

  private cellKey(cx: number, cy: number) {
    return (cx + 512) * 1024 + (cy + 512)
  }

  resize(width: number, height: number, dpr: number): void {
    this.w = Math.max(1, width)
    this.h = Math.max(1, height)
    this.dpr = dpr
    this.canvas.width = Math.round(this.w * dpr)
    this.canvas.height = Math.round(this.h * dpr)
    this.cam.scale = this.clampScale(this.cam.scale)
    this.requestDraw()
  }

  // ---- camera -------------------------------------------------------------

  minScale(): number {
    return Math.min(this.w, this.h) / (2 * this.extent * 1.02)
  }

  homeScale(): number {
    return Math.min(this.w, this.h - 70) / (2 * 25)
  }

  private clampScale(s: number): number {
    return Math.min(140, Math.max(this.minScale(), s))
  }

  private clampCam(c: Camera): Camera {
    const lim = this.extent
    const r = Math.hypot(c.x, c.y)
    const f = r > lim ? lim / r : 1
    return { x: c.x * f, y: c.y * f, scale: this.clampScale(c.scale) }
  }

  home(): void {
    this.cam = this.clampCam({ x: 0, y: 0, scale: this.homeScale() })
    this.requestDraw()
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / this.cam.scale + this.cam.x, (sy - this.h / 2) / this.cam.scale + this.cam.y]
  }

  worldToScreen(x: number, y: number): [number, number] {
    return [(x - this.cam.x) * this.cam.scale + this.w / 2, (y - this.cam.y) * this.cam.scale + this.h / 2]
  }

  panBy(dx: number, dy: number): void {
    this.anim = null
    this.cam = this.clampCam({ ...this.cam, x: this.cam.x - dx / this.cam.scale, y: this.cam.y - dy / this.cam.scale })
    this.requestDraw()
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.anim = null
    const [wx, wy] = this.screenToWorld(sx, sy)
    const scale = this.clampScale(this.cam.scale * factor)
    this.cam = this.clampCam({
      x: wx - (sx - this.w / 2) / scale,
      y: wy - (sy - this.h / 2) / scale,
      scale,
    })
    this.requestDraw()
  }

  zoomBy(factor: number): void {
    this.animateTo({ ...this.cam, scale: this.clampScale(this.cam.scale * factor) }, 250)
  }

  /** Screen area not covered by the word panel (side panel on desktop, bottom sheet on mobile). */
  private freeRect(panelOpen: boolean): { l: number; r: number; t: number; b: number } {
    if (!panelOpen) return { l: 0, r: this.w, t: 0, b: this.h }
    const top = this.w > 700 ? 70 : 110
    if (this.w > 700) return { l: 0, r: this.w - 414, t: top, b: this.h }
    return { l: 0, r: this.w, t: top, b: this.h * 0.38 }
  }

  flyTo(x: number, y: number, scale?: number, minScale?: number, panelOpen = false): void {
    let s = scale && scale > 0 ? scale : scale === 0 ? this.homeScale() : this.cam.scale
    if (minScale) s = Math.max(s, minScale)
    const f = this.freeRect(panelOpen)
    const dx = ((f.l + f.r) / 2 - this.w / 2) / s
    const dy = ((f.t + f.b) / 2 - this.h / 2) / s
    this.animateTo({ x: x - dx, y: y - dy, scale: s })
  }

  /** Pan just enough that (x, y) is not hidden behind the word panel. */
  keepVisible(x: number, y: number, panelOpen: boolean): void {
    if (this.anim) return
    const f = this.freeRect(panelOpen)
    const m = 56
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

  // ---- hit testing --------------------------------------------------------

  private drawable(i: number): boolean {
    const st = this.state!
    return st.settings.fogMode !== 'hidden' || st.view.vis[i] >= Vis.Frontier
  }

  hitTest(sx: number, sy: number): number | null {
    if (!this.state) return null
    const [wx, wy] = this.screenToWorld(sx, sy)
    const rad = Math.max(0.6, 13 / this.cam.scale)
    let best: number | null = null
    let bestD = rad
    const E = this.extent
    const c0x = Math.floor(Math.max(wx - rad, -E) / CELL)
    const c1x = Math.floor(Math.min(wx + rad, E) / CELL)
    const c0y = Math.floor(Math.max(wy - rad, -E) / CELL)
    const c1y = Math.floor(Math.min(wy + rad, E) / CELL)
    const words = this.state.pack.words
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        for (const i of this.grid.get(this.cellKey(cx, cy)) ?? []) {
          if (!this.drawable(i)) continue
          const d = Math.hypot(words[i].x - wx, words[i].y - wy)
          if (d < bestD) {
            bestD = d
            best = i
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
  }

  private updatePriority() {
    const st = this.state!
    const key = `${st.view.version}`
    if (key === this.prioKey) return
    this.prioKey = key
    const { words } = st.pack
    const { vis, due } = st.view
    this.prio = new Float64Array(words.length)
    for (const w of words) {
      const v = vis[w.i]
      const rank = due[w.i] ? 6 : v === Vis.Active ? 5 : v === Vis.Learned ? 4 : v === Vis.Revealed ? 3.5 : v === Vis.Frontier ? 2 : 1
      this.prio[w.i] = rank * 1e4 + (8 - w.level) * 100 + w.freq
    }
  }

  private updateFog() {
    const st = this.state!
    if (st.settings.fogScope !== 'terrain' || st.settings.fogMode === 'off') {
      this.fog = null
      this.fogKey = ''
      return
    }
    const key = `${st.view.version}`
    if (key === this.fogKey && this.fog) return
    this.fogKey = key
    const size = 768
    const E = this.extent
    const c = this.fog ?? document.createElement('canvas')
    c.width = size
    c.height = size
    const g = c.getContext('2d')!
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, size, size)
    g.fillStyle = 'rgba(44, 52, 66, 0.82)'
    g.fillRect(0, 0, size, size)
    g.globalCompositeOperation = 'destination-out'
    const k = size / (2 * E)
    const hole = (x: number, y: number, r: number, a: number) => {
      const cx = (x + E) * k
      const cy = (y + E) * k
      const rr = r * k
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rr)
      grad.addColorStop(0, `rgba(0,0,0,${a})`)
      grad.addColorStop(0.55, `rgba(0,0,0,${a * 0.85})`)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = grad
      g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2)
    }
    hole(0, 0, st.pack.manifest.coreRadius + 3, 1)
    for (const w of st.pack.words) {
      const v = st.view.vis[w.i]
      if (v >= Vis.Revealed) hole(w.x, w.y, 5.5, 1)
      else if (v === Vis.Frontier) hole(w.x, w.y, 2.6, 0.6)
    }
    this.fog = c
  }

  private draw() {
    const st = this.state
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.fillStyle = rgb(OCEAN_FAR)
    ctx.fillRect(0, 0, this.w, this.h)
    if (!st || !this.terrain) return
    this.updatePriority()
    this.updateFog()

    const s = this.cam.scale
    const { pack, view, settings } = st
    const geo = pack.regions.geometry
    const E = this.extent

    // ---- world-space layers
    ctx.save()
    ctx.translate(this.w / 2, this.h / 2)
    ctx.scale(s, s)
    ctx.translate(-this.cam.x, -this.cam.y)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(this.terrain, -E, -E, 2 * E, 2 * E)

    // coastline
    ctx.beginPath()
    this.coast.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.lineWidth = 1.6 / s
    ctx.strokeStyle = 'rgba(92, 120, 140, 0.55)'
    ctx.stroke()

    // region boundaries
    ctx.lineWidth = 1.2 / s
    ctx.strokeStyle = 'rgba(70, 55, 40, 0.28)'
    for (const path of this.boundaries) {
      ctx.beginPath()
      path.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
    }

    // level rings
    ctx.setLineDash([6 / s, 5 / s])
    ctx.lineWidth = 1.3 / s
    ctx.strokeStyle = 'rgba(70, 55, 40, 0.35)'
    for (let l = 1; l < geo.radii.length - 1; l++) {
      ctx.beginPath()
      ctx.arc(0, 0, geo.radii[l], 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.setLineDash([])

    // core plaza
    ctx.beginPath()
    ctx.arc(0, 0, geo.radii[0], 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 252, 242, 0.9)'
    ctx.fill()
    ctx.lineWidth = 2 / s
    ctx.strokeStyle = 'rgba(120, 90, 50, 0.6)'
    ctx.stroke()

    if (this.fog) ctx.drawImage(this.fog, -E, -E, 2 * E, 2 * E)

    this.drawPaths(s)
    this.drawSelectionLinks(s)
    ctx.restore()

    // ---- screen-space layers
    this.drawCenter(s)
    this.drawRingLabels(s)
    this.drawRegionLabels(s, settings.fogScope === 'terrain' && settings.fogMode !== 'off')
    this.drawWords(s)
    void view
  }

  private visibleRange(margin = 2): [number, number, number, number] {
    const [x0, y0] = this.screenToWorld(0, 0)
    const [x1, y1] = this.screenToWorld(this.w, this.h)
    return [x0 - margin, y0 - margin, x1 + margin, y1 + margin]
  }

  private forEachVisible(fn: (i: number) => void, margin = 2) {
    const [x0, y0, x1, y1] = this.visibleRange(margin)
    const E = this.extent + margin
    const cx0 = Math.floor(Math.max(x0, -E) / CELL)
    const cx1 = Math.floor(Math.min(x1, E) / CELL)
    const cy0 = Math.floor(Math.max(y0, -E) / CELL)
    const cy1 = Math.floor(Math.min(y1, E) / CELL)
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const list = this.grid.get(this.cellKey(cx, cy))
        if (list) for (const i of list) fn(i)
      }
    }
  }

  /** Skill-tree paths between explored words and their anchors. */
  private drawPaths(s: number) {
    const st = this.state!
    const { words } = st.pack
    const { vis } = st.view
    const ctx = this.ctx
    const gold = new Path2D()
    const plain = new Path2D()
    const dotted = new Path2D()
    this.forEachVisible((i) => {
      const a = words[i].anchor
      if (a < 0) return
      const vi = vis[i]
      const va = vis[a]
      const w = words[i]
      const p = words[a]
      if (vi >= Vis.Revealed && va >= Vis.Revealed) {
        const path = vi === Vis.Learned && va === Vis.Learned ? gold : plain
        path.moveTo(p.x, p.y)
        path.lineTo(w.x, w.y)
      } else if (
        ((vi === Vis.Frontier && va >= Vis.Revealed) || (va === Vis.Frontier && vi >= Vis.Revealed)) &&
        Math.hypot(w.x - p.x, w.y - p.y) <= MAX_DOTTED
      ) {
        dotted.moveTo(p.x, p.y)
        dotted.lineTo(w.x, w.y)
      }
    }, 30)
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(1.2 / s, 0.07)
    ctx.strokeStyle = 'rgba(80, 64, 48, 0.45)'
    ctx.stroke(plain)
    ctx.lineWidth = Math.max(2 / s, 0.1)
    ctx.strokeStyle = 'rgba(190, 130, 20, 0.75)'
    ctx.stroke(gold)
    ctx.setLineDash([2 / s, 4 / s])
    ctx.lineWidth = Math.max(1.2 / s, 0.05)
    ctx.strokeStyle = 'rgba(80, 64, 48, 0.45)'
    ctx.stroke(dotted)
    ctx.setLineDash([])
  }

  private drawSelectionLinks(s: number) {
    const st = this.state!
    const i = st.selected
    if (i === null) return
    const { words, children, charIndex } = st.pack
    const w = words[i]
    const ctx = this.ctx
    const line = (j: number, color: string, width: number, dash: number[] = []) => {
      if (!this.drawable(j) && st.view.vis[j] < Vis.Frontier) return
      ctx.beginPath()
      ctx.moveTo(w.x, w.y)
      ctx.lineTo(words[j].x, words[j].y)
      ctx.setLineDash(dash.map((d) => d / s))
      ctx.lineWidth = width / s
      ctx.strokeStyle = color
      ctx.stroke()
    }
    for (const ch of hanChars(w.hanzi)) {
      for (const j of charIndex.get(ch) ?? []) {
        if (j !== i && st.view.vis[j] >= Vis.Revealed) line(j, 'rgba(214, 120, 40, 0.55)', 1.5, [1, 3])
      }
    }
    for (const j of w.neighbors.slice(0, 6)) line(j, 'rgba(60, 110, 200, 0.6)', 1.6, [5, 4])
    for (const j of children[i]) line(j, 'rgba(40, 30, 20, 0.75)', 2.2)
    if (w.anchor >= 0) line(w.anchor, 'rgba(40, 30, 20, 0.9)', 3)
    ctx.setLineDash([])
  }

  private drawCenter(s: number) {
    const ctx = this.ctx
    const [cx, cy] = this.worldToScreen(0, 0)
    const size = Math.max(12, Math.min(48, s * 2.2))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${size}px ${FONT_ZH}`
    ctx.fillStyle = 'rgba(110, 80, 40, 0.75)'
    ctx.fillText('中文', cx, cy - size * 0.1)
    if (s > 6) {
      ctx.font = `600 ${Math.max(9, size * 0.28)}px ${FONT_UI}`
      ctx.fillText('START', cx, cy + size * 0.62)
    }
  }

  private drawRingLabels(s: number) {
    const st = this.state!
    const ctx = this.ctx
    const geo = st.pack.regions.geometry
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const px = Math.max(10, Math.min(15, s * 0.9))
    ctx.font = `700 ${px}px ${FONT_UI}`
    for (const lvl of st.pack.manifest.levels) {
      const r = geo.radii[lvl.level - 1]
      const a = Math.PI * 0.75
      const [x, y] = this.worldToScreen(Math.cos(a) * (r + 0.1), Math.sin(a) * (r + 0.1))
      const text = lvl.label
      const tw = ctx.measureText(text).width + 10
      ctx.fillStyle = 'rgba(255, 250, 238, 0.88)'
      ctx.strokeStyle = 'rgba(110, 80, 40, 0.6)'
      ctx.lineWidth = 1
      roundRect(ctx, x - tw / 2, y - px * 0.8, tw, px * 1.6, px * 0.8)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgba(90, 64, 30, 0.95)'
      ctx.fillText(text, x, y + 0.5)
    }
  }

  private drawRegionLabels(s: number, fogged: boolean) {
    if (s > 26) return
    const st = this.state!
    const ctx = this.ctx
    const alpha = s < 12 ? 1 : (26 - s) / 14
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    st.pack.regions.themes.forEach((t, k) => {
      t.labels.forEach((lab, n) => {
        if (n === 0 && s < 5) return
        if (n === 1 && s > 14) return
        const [x, y] = this.worldToScreen(lab.x, lab.y)
        if (x < -200 || y < -60 || x > this.w + 200 || y > this.h + 60) return
        const px = Math.max(13, Math.min(30, s * 1.5 * lab.size))
        const icon = BIOME_ICON[t.biome] ?? ''
        ctx.globalAlpha = alpha * (fogged ? 0.85 : 1)
        ctx.font = `800 ${px}px ${FONT_ZH}`
        ctx.lineJoin = 'round'
        ctx.lineWidth = Math.max(3, px * 0.22)
        ctx.strokeStyle = 'rgba(255, 252, 244, 0.9)'
        ctx.fillStyle = this.regionStroke[k]
        const zh = `${icon} ${t.zh}`
        ctx.strokeText(zh, x, y)
        ctx.fillText(zh, x, y)
        ctx.font = `700 ${Math.max(10, px * 0.42)}px ${FONT_UI}`
        ctx.lineWidth = 3
        ctx.strokeText(t.en.toUpperCase(), x, y + px * 0.85)
        ctx.fillText(t.en.toUpperCase(), x, y + px * 0.85)
        ctx.globalAlpha = 1
      })
    })
  }

  private drawWords(s: number) {
    const st = this.state!
    const { words } = st.pack
    const { vis, due, stages } = st.view
    const { fogMode, mapPinyin } = st.settings
    const ctx = this.ctx
    const idx: number[] = []
    this.forEachVisible((i) => {
      if (this.drawable(i) || i === st.selected) idx.push(i)
    }, 1.5)
    idx.sort((a, b) => this.prio[a] - this.prio[b])

    const rm = Math.max(1.6, Math.min(11, s * 0.27))
    const rk = Math.max(2.6, Math.min(14, s * 0.5))
    const radius = (v: number) => (v >= Vis.Frontier ? rk : rm)
    const shapes = s >= 9
    const unexploredAlpha = fogMode === 'off' ? 0.9 : 0.28

    // markers (low priority first so important ones end on top)
    for (const i of idx) {
      const w = words[i]
      const [x, y] = this.worldToScreen(w.x, w.y)
      const v = vis[i]
      const t = w.theme
      if (v === Vis.Frontier && fogMode === 'hidden') {
        this.drawFrontier(x, y, rk, shapes)
        continue
      }
      let fill: string
      let stroke: string
      let alpha = 1
      if (v === Vis.Learned) {
        fill = STATUS_COLORS.learned
        stroke = STATUS_COLORS.learnedStroke
      } else if (v === Vis.Active) {
        fill = STATUS_COLORS.active
        stroke = '#ffffff'
      } else if (v === Vis.Revealed) {
        fill = STATUS_COLORS.revealed
        stroke = this.regionStroke[t]
      } else {
        fill = this.regionFill[t]
        stroke = this.regionStroke[t]
        alpha = unexploredAlpha
      }
      ctx.globalAlpha = alpha
      const r = radius(v)
      if (!shapes) {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = fill
        ctx.fill()
        if (v >= Vis.Revealed) {
          ctx.lineWidth = 1
          ctx.strokeStyle = stroke
          ctx.stroke()
        }
      } else {
        drawShape(ctx, POS_SHAPE[w.pos], x, y, r)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.lineWidth = v >= Vis.Revealed ? Math.max(1.5, r * 0.2) : 1
        ctx.strokeStyle = stroke
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // labels in priority order, culled by overlap
    const labelsOn = s >= 9
    const occ = new Occupancy(this.w, this.h)
    const zhPx = Math.max(11, Math.min(24, 7 + s * 0.52))
    const pyPx = Math.max(9, Math.min(13, 4 + s * 0.25))
    const withPinyin = mapPinyin && s >= 18
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    const forced = new Set<number>()
    if (st.selected !== null) forced.add(st.selected)
    if (st.hovered !== null) forced.add(st.hovered)
    for (let n = idx.length - 1; n >= 0; n--) {
      const i = idx[n]
      const v = vis[i]
      const isForced = forced.has(i)
      if (!labelsOn && !isForced) continue
      const showText = v >= Vis.Revealed || fogMode === 'off' || (fogMode === 'dim' && s >= 22)
      if (!showText && !isForced) continue
      if (!showText && isForced && fogMode === 'hidden' && v < Vis.Revealed) continue
      const w = words[i]
      const [x, y] = this.worldToScreen(w.x, w.y)
      const zhW = textWidth(w.hanzi) * zhPx
      const pyW = withPinyin ? w.pinyin.length * pyPx * 0.56 : 0
      const plate = v >= Vis.Revealed
      const padX = plate ? 5 : 3
      const bw = Math.max(zhW, pyW) + padX * 2
      const bh = zhPx * 1.2 + (withPinyin ? pyPx * 1.2 : 0) + (plate ? 2 : 0)
      const top = y + radius(v) + 3
      if (!isForced && !occ.tryPlace(x - bw / 2, top, bw, bh)) continue
      if (isForced) occ.place(x - bw / 2, top, bw, bh)
      const faded = v < Vis.Revealed && fogMode !== 'off'
      ctx.globalAlpha = faded ? 0.5 : 1
      if (plate) {
        // Name plate, like a character's name tag in a game.
        roundRect(ctx, x - bw / 2, top, bw, bh, Math.min(6, bh / 2))
        ctx.fillStyle = v === Vis.Learned ? 'rgba(255, 244, 214, 0.95)' : v === Vis.Active ? 'rgba(232, 240, 255, 0.95)' : 'rgba(255, 253, 247, 0.93)'
        ctx.fill()
        ctx.lineWidth = 1.2
        ctx.strokeStyle = v === Vis.Learned ? STATUS_COLORS.learnedStroke : v === Vis.Active ? STATUS_COLORS.active : this.regionStroke[w.theme]
        ctx.stroke()
      }
      const ty = top + (plate ? 2 : 0)
      ctx.font = `${v === Vis.Learned ? 700 : 600} ${zhPx}px ${FONT_ZH}`
      ctx.fillStyle = v === Vis.Learned ? '#6b4300' : '#1f1a14'
      if (!plate) {
        ctx.lineWidth = Math.max(2.5, zhPx * 0.2)
        ctx.strokeStyle = 'rgba(255, 253, 247, 0.92)'
        ctx.strokeText(w.hanzi, x, ty)
      }
      ctx.fillText(w.hanzi, x, ty)
      if (withPinyin) {
        ctx.font = `500 ${pyPx}px ${FONT_UI}`
        ctx.fillStyle = '#4a4036'
        if (!plate) {
          ctx.lineWidth = 3
          ctx.strokeText(w.pinyin, x, ty + zhPx * 1.12)
        }
        ctx.fillText(w.pinyin, x, ty + zhPx * 1.12)
      }
      ctx.globalAlpha = 1
    }

    // quest badges and stage pips
    for (const i of idx) {
      const w = words[i]
      const [x, y] = this.worldToScreen(w.x, w.y)
      if (due[i]) this.drawBadge(x + rk * 0.95, y - rk * 0.95, Math.max(4, Math.min(9, rk * 0.75)))
      if (vis[i] === Vis.Active && s >= 16) this.drawPips(x, y, rk, stages[i])
    }

    // hover + selection rings
    for (const [i, color, width] of [
      [st.hovered, 'rgba(30, 30, 30, 0.5)', 2],
      [st.selected, '#111', 3],
    ] as [number | null, string, number][]) {
      if (i === null) continue
      const [x, y] = this.worldToScreen(words[i].x, words[i].y)
      const r = radius(vis[i])
      ctx.beginPath()
      ctx.arc(x, y, r + 5, 0, Math.PI * 2)
      ctx.lineWidth = width
      ctx.strokeStyle = color
      ctx.stroke()
      if (i === st.selected) {
        ctx.beginPath()
        ctx.arc(x, y, r + 9, 0, Math.PI * 2)
        ctx.lineWidth = 2
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
        ctx.stroke()
      }
    }
  }

  private drawFrontier(x: number, y: number, rm: number, big: boolean) {
    const ctx = this.ctx
    const r = big ? rm * 0.95 : rm * 0.8
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(70, 78, 90, 0.6)'
    ctx.fill()
    ctx.setLineDash(big ? [3, 2] : [])
    ctx.lineWidth = 1.4
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.stroke()
    ctx.setLineDash([])
    if (big && r >= 4) {
      ctx.fillStyle = '#ffffff'
      ctx.font = `800 ${r * 1.45}px ${FONT_UI}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('?', x, y + rm * 0.06)
    }
  }

  private drawBadge(x: number, y: number, r: number) {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = STATUS_COLORS.due
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#5c4200'
    ctx.stroke()
    if (r >= 5) {
      ctx.fillStyle = '#3d2c00'
      ctx.font = `900 ${r * 1.45}px ${FONT_UI}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('!', x, y + r * 0.05)
    }
  }

  private drawPips(x: number, y: number, rm: number, done: number) {
    const ctx = this.ctx
    const r = 2.2
    const gap = 6
    const x0 = x - rm - 6
    for (let k = 0; k < 4; k++) {
      ctx.beginPath()
      ctx.arc(x0, y - 1.5 * gap + k * gap, r, 0, Math.PI * 2)
      ctx.fillStyle = k < done ? STATUS_COLORS.learned : 'rgba(255,255,255,0.9)'
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Build a marker path; the shape hints at the part of speech. */
export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, r: number): void {
  ctx.beginPath()
  switch (shape) {
    case 'circle':
      ctx.arc(x, y, r, 0, Math.PI * 2)
      break
    case 'diamond':
      ctx.moveTo(x, y - r * 1.2)
      ctx.lineTo(x + r * 1.05, y)
      ctx.lineTo(x, y + r * 1.2)
      ctx.lineTo(x - r * 1.05, y)
      ctx.closePath()
      break
    case 'hexagon':
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6
        const px = x + Math.cos(a) * r * 1.08
        const py = y + Math.sin(a) * r * 1.08
        if (k) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      }
      ctx.closePath()
      break
    case 'triangle':
      ctx.moveTo(x, y - r * 1.2)
      ctx.lineTo(x + r * 1.1, y + r * 0.8)
      ctx.lineTo(x - r * 1.1, y + r * 0.8)
      ctx.closePath()
      break
    case 'square':
      ctx.rect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76)
      break
    case 'pill':
      roundRectPath(ctx, x - r * 1.25, y - r * 0.6, r * 2.5, r * 1.2, r * 0.6)
      break
    case 'person':
      ctx.arc(x, y - r * 0.45, r * 0.5, 0, Math.PI * 2)
      ctx.moveTo(x + r * 0.95, y + r * 0.95)
      ctx.arc(x, y + r * 0.95, r * 0.95, 0, Math.PI, true)
      ctx.closePath()
      break
    case 'star':
      for (let k = 0; k < 10; k++) {
        const a = (Math.PI / 5) * k - Math.PI / 2
        const rr = k % 2 ? r * 0.55 : r * 1.25
        const px = x + Math.cos(a) * rr
        const py = y + Math.sin(a) * rr
        if (k) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      }
      ctx.closePath()
      break
    case 'scroll':
      roundRectPath(ctx, x - r * 1.2, y - r * 0.85, r * 2.4, r * 1.7, r * 0.25)
      break
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
