import { mix, rgb, roundRect, shade, type RGB } from './draw'

/**
 * Landmarks that hold a word, picked from the biome under it: buildings in towns, nature in the wilds. The word is
 * written on the landmark itself (wall, canopy, mountain face, cloud, …).
 */
export type LandmarkKind =
  | 'cottage'
  | 'shop'
  | 'dome'
  | 'tower'
  | 'barn'
  | 'cabin'
  | 'tree'
  | 'pine'
  | 'fruit'
  | 'blossom'
  | 'rock'
  | 'mountain'
  | 'cloud'
  | 'dune'
  | 'mesa'
  | 'crystal'
  | 'lily'
  | 'haystack'

export const LANDMARK_LABEL: Record<LandmarkKind, string> = {
  cottage: 'cottage',
  shop: 'shop',
  dome: 'domed house',
  tower: 'tower',
  barn: 'barn',
  cabin: 'log cabin',
  tree: 'tree',
  pine: 'pine',
  fruit: 'fruit tree',
  blossom: 'blossom tree',
  rock: 'boulder',
  mountain: 'mountain',
  cloud: 'cloud',
  dune: 'sand dune',
  mesa: 'mesa',
  crystal: 'crystal',
  lily: 'lily pad',
  haystack: 'haystack',
}

/** Landmark for a word on ground `code`; `h` in [0, 1) varies it. */
export function landmarkFor(code: string, wild: boolean, h: number): LandmarkKind {
  if (!wild) {
    switch (code) {
      case 'w':
        return h < 0.55 ? 'barn' : h < 0.8 ? 'haystack' : 'cottage'
      case 'o':
        return h < 0.5 ? 'fruit' : 'cottage'
      case 'f':
        return h < 0.45 ? 'pine' : 'cabin'
      case 'm':
        return h < 0.3 ? 'blossom' : h < 0.75 ? 'cottage' : 'shop'
      case 'g':
        return h < 0.2 ? 'tree' : h < 0.65 ? 'cottage' : 'shop'
      case 'p':
        return h < 0.5 ? 'shop' : h < 0.8 ? 'cottage' : 'tower'
      case 'd':
      case 'r':
      case 'y':
      case '.':
        return h < 0.55 ? 'dome' : h < 0.85 ? 'shop' : 'tower'
      case 'c':
        return h < 0.5 ? 'tower' : h < 0.8 ? 'dome' : 'crystal'
      case 'k':
      case 's':
      case 'h':
        return h < 0.6 ? 'cabin' : 'cottage'
      case 'x':
        return h < 0.5 ? 'lily' : 'cottage'
      default:
        return 'cottage'
    }
  }
  switch (code) {
    case 'f':
      return h < 0.55 ? 'pine' : 'tree'
    case 'o':
      return 'fruit'
    case 'm':
      return h < 0.5 ? 'blossom' : 'tree'
    case 'g':
      return h < 0.45 ? 'tree' : h < 0.7 ? 'rock' : 'blossom'
    case 'h':
      return h < 0.45 ? 'rock' : h < 0.75 ? 'tree' : 'mountain'
    case 'k':
      return h < 0.75 ? 'mountain' : 'rock'
    case 's':
      return h < 0.5 ? 'mountain' : 'cloud'
    case 'y':
    case '.':
      return h < 0.8 ? 'dune' : 'rock'
    case 'r':
      return h < 0.6 ? 'mesa' : 'rock'
    case 'c':
      return 'crystal'
    case 'x':
      return h < 0.7 ? 'lily' : 'tree'
    case 'w':
      return 'haystack'
    case 'd':
      return 'rock'
    default:
      return 'tree'
  }
}

/** Horizontal room around the text, and the minimum body width, in cells. */
const PAD: Record<LandmarkKind, [number, number]> = {
  cottage: [0.62, 1.05],
  shop: [0.42, 1.0],
  dome: [0.6, 1.05],
  tower: [0.3, 0.8],
  barn: [0.5, 1.05],
  cabin: [0.5, 1.05],
  tree: [0.5, 1.05],
  pine: [0.45, 1.0],
  fruit: [0.5, 1.05],
  blossom: [0.5, 1.05],
  rock: [0.45, 0.95],
  mountain: [0.6, 1.1],
  cloud: [0.45, 1.0],
  dune: [0.7, 1.1],
  mesa: [0.42, 0.95],
  crystal: [0.3, 0.8],
  lily: [0.5, 1.0],
  haystack: [0.5, 1.0],
}

/** Top of each landmark above the cell center, in cells (for "!" markers and hit testing). */
export const LANDMARK_TOP: Record<LandmarkKind, number> = {
  cottage: 0.8,
  shop: 0.62,
  dome: 0.8,
  tower: 1.3,
  barn: 0.9,
  cabin: 0.85,
  tree: 0.9,
  pine: 1.08,
  fruit: 0.9,
  blossom: 0.9,
  rock: 0.4,
  mountain: 1.12,
  cloud: 0.7,
  dune: 0.45,
  mesa: 0.66,
  crystal: 0.88,
  lily: 0.25,
  haystack: 0.6,
}

/** Body width in cells for text `textW` cells wide. */
export function landmarkWidth(kind: LandmarkKind, textW: number): number {
  const [pad, min] = PAD[kind]
  return Math.min(2.7, Math.max(min, textW + pad))
}

export interface LandmarkOpts {
  /** Cell size in pixels. */
  u: number
  /** Body width in pixels (from `landmarkWidth`). */
  w: number
  /** Region color, tinting the landmark a little. */
  tint: RGB
  /** Per-word variation in [0, 1). */
  h: number
  /** 0 = full color, 1 = gray (fog). */
  muted: number
  /** Snow on roofs (mountain towns). */
  snow?: boolean
}

/** Where (and how) to write the word on a landmark. */
export interface TextSpot {
  x: number
  y: number
  ink: string
  halo: string
}

const GRAY: RGB = [152, 152, 148]
const LIGHT_TEXT = ['#ffffff', 'rgba(24, 28, 22, 0.85)'] as const
const DARK_TEXT = ['#23190f', 'rgba(255, 250, 238, 0.75)'] as const

const ROOFS: RGB[] = [
  [184, 84, 62],
  [92, 110, 140],
  [98, 128, 84],
  [150, 96, 60],
  [120, 84, 120],
]
const LEAVES: RGB[] = [
  [92, 150, 74],
  [78, 136, 84],
  [112, 158, 70],
]

/**
 * Draw a landmark whose base sits on the bottom of cell (cx, cy) and return where its word goes. Coordinates are
 * pixels; the body spans `o.w` horizontally and up to `LANDMARK_TOP[kind]` cells above the cell center.
 */
export function drawLandmark(ctx: CanvasRenderingContext2D, kind: LandmarkKind, cx: number, cy: number, o: LandmarkOpts): TextSpot {
  const { u, w: W, h } = o
  const tone = (c: RGB) => rgb(o.muted > 0 ? mix(c, GRAY, o.muted) : c)
  const tinted = (c: RGB, t = 0.14) => mix(c, o.tint, t)
  const gy = cy + u * 0.38
  const x0 = cx - W / 2
  const x1 = cx + W / 2
  const lw = Math.max(1, u * 0.03)
  ctx.lineWidth = lw
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const fill = (c: RGB, outline = true) => {
    ctx.fillStyle = tone(c)
    ctx.fill()
    if (outline) {
      ctx.strokeStyle = tone(shade(c, -0.55))
      ctx.stroke()
    }
  }
  /** Fill a union of shapes with one clean outline: stroke wide first, then fill over the inner strokes. */
  const blob = (c: RGB) => {
    ctx.strokeStyle = tone(shade(c, -0.5))
    ctx.lineWidth = lw * 2
    ctx.stroke()
    ctx.fillStyle = tone(c)
    ctx.fill()
    ctx.lineWidth = lw
  }
  const shadow = (rx: number, ry = u * 0.1) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'
    ctx.beginPath()
    ctx.ellipse(cx, gy, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  const window_ = (x: number, y: number, s: number, arch = false) => {
    ctx.beginPath()
    if (arch) {
      ctx.moveTo(x - s / 2, y + s * 0.6)
      ctx.lineTo(x - s / 2, y)
      ctx.arc(x, y, s / 2, Math.PI, 0)
      ctx.lineTo(x + s / 2, y + s * 0.6)
      ctx.closePath()
    } else ctx.rect(x - s / 2, y - s / 2, s, s)
    fill([255, 226, 140])
  }
  const sideWindows = (y: number, textHalf: number, arch = false) => {
    const m = W / 2 - textHalf
    if (m < u * 0.26) return
    const s = Math.min(u * 0.15, m * 0.5)
    window_(x0 + m / 2, y, s, arch)
    window_(x1 - m / 2, y, s, arch)
  }
  const board = (y: number, bw: number, bh: number, c: RGB) => {
    roundRect(ctx, cx - bw / 2, y - bh / 2, bw, bh, Math.min(u * 0.08, bh / 3))
    fill(c)
  }
  const roof = (top: number, base: number, c: RGB, overhang: number) => {
    ctx.beginPath()
    if (W < u * 1.35) {
      ctx.moveTo(x0 - overhang, base)
      ctx.lineTo(cx, top)
      ctx.lineTo(x1 + overhang, base)
    } else {
      const inset = Math.min(u * 0.3, (base - top) * 0.7)
      ctx.moveTo(x0 - overhang, base)
      ctx.lineTo(x0 + inset, top)
      ctx.lineTo(x1 - inset, top)
      ctx.lineTo(x1 + overhang, base)
    }
    ctx.closePath()
    fill(c)
    if (o.snow) {
      ctx.save()
      ctx.clip()
      ctx.fillStyle = tone([246, 248, 250])
      ctx.fillRect(x0 - overhang, top - 1, W + overhang * 2, (base - top) * 0.38)
      ctx.restore()
    }
  }
  const textHalf = Math.max(0, W / 2 - PAD[kind][0] * u * 0.5)
  const spot = (y: number, [ink, halo]: readonly [string, string]): TextSpot => ({ x: cx, y, ink, halo })

  switch (kind) {
    case 'cottage': {
      shadow(W * 0.58)
      const top = cy - u * 0.26
      const roofC = ROOFS[Math.floor(h * 97) % ROOFS.length]
      if (h > 0.5) {
        ctx.beginPath()
        ctx.rect(x1 - u * 0.34, top - u * 0.5, u * 0.12, u * 0.36)
        fill([150, 120, 104])
      }
      ctx.beginPath()
      ctx.rect(x0, top, W, gy - top)
      fill(tinted([244, 234, 214], 0.12))
      roof(top - u * 0.5, top + u * 0.05, roofC, u * 0.1)
      sideWindows(cy + u * 0.06, textHalf)
      return spot(cy + u * 0.07, DARK_TEXT)
    }
    case 'shop': {
      shadow(W * 0.58)
      const top = cy - u * 0.5
      const wall = tinted([236, 226, 208], 0.18)
      ctx.beginPath()
      ctx.rect(x0, top, W, gy - top)
      fill(wall)
      ctx.beginPath()
      ctx.rect(x0 - u * 0.05, top - u * 0.1, W + u * 0.1, u * 0.12)
      fill(shade(wall, -0.25))
      // Striped awning with a scalloped edge.
      const ay = top + u * 0.06
      const ah = u * 0.2
      const stripe = u * 0.17
      const n = Math.max(3, Math.round((W + u * 0.12) / stripe))
      const sw = (W + u * 0.12) / n
      const ax = x0 - u * 0.06
      const awning = h < 0.5 ? mix(o.tint, [200, 70, 60], 0.5) : mix(o.tint, [60, 110, 170], 0.5)
      for (let k = 0; k < n; k++) {
        ctx.beginPath()
        ctx.moveTo(ax + k * sw, ay)
        ctx.lineTo(ax + (k + 1) * sw, ay)
        ctx.lineTo(ax + (k + 1) * sw, ay + ah)
        ctx.arc(ax + (k + 0.5) * sw, ay + ah, sw / 2, 0, Math.PI)
        ctx.closePath()
        ctx.fillStyle = tone(k % 2 ? [250, 246, 236] : awning)
        ctx.fill()
      }
      ctx.strokeStyle = tone(shade(awning, -0.5))
      ctx.strokeRect(ax, ay, W + u * 0.12, ah)
      return spot(cy + u * 0.13, DARK_TEXT)
    }
    case 'dome': {
      shadow(W * 0.58)
      const top = cy - u * 0.28
      const rd = Math.min(u * 0.4, W * 0.3)
      const domeC: RGB = h < 0.5 ? [80, 158, 168] : [242, 238, 228]
      ctx.beginPath()
      ctx.moveTo(cx, top - rd - u * 0.16)
      ctx.lineTo(cx, top - rd)
      ctx.strokeStyle = tone([120, 100, 80])
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, top + u * 0.02, rd, Math.PI, 0)
      ctx.closePath()
      fill(domeC)
      ctx.beginPath()
      ctx.arc(cx, top - rd - u * 0.17, u * 0.045, 0, Math.PI * 2)
      fill([226, 180, 60])
      roundRect(ctx, x0, top, W, gy - top, u * 0.08)
      fill(tinted([228, 198, 152], 0.14))
      sideWindows(cy + u * 0.02, textHalf, true)
      return spot(cy + u * 0.08, DARK_TEXT)
    }
    case 'tower': {
      shadow(W * 0.62)
      const top = cy - u * 0.62
      ctx.beginPath()
      ctx.rect(x0, top, W, gy - top)
      fill(tinted([206, 202, 214], 0.22))
      ctx.beginPath()
      ctx.moveTo(x0 - u * 0.1, top + u * 0.03)
      ctx.lineTo(cx, cy - u * 1.22)
      ctx.lineTo(x1 + u * 0.1, top + u * 0.03)
      ctx.closePath()
      fill(h < 0.5 ? [86, 92, 150] : shade(o.tint, -0.3))
      ctx.beginPath()
      ctx.moveTo(cx, cy - u * 1.22)
      ctx.lineTo(cx, cy - u * 1.36)
      ctx.lineTo(cx + u * 0.18, cy - u * 1.31)
      ctx.lineTo(cx, cy - u * 1.26)
      ctx.fillStyle = tone(mix(o.tint, [220, 70, 60], 0.5))
      ctx.fill()
      ctx.strokeStyle = tone([60, 50, 40])
      ctx.stroke()
      window_(cx, top + u * 0.16, u * 0.13, true)
      return spot(cy - u * 0.02, DARK_TEXT)
    }
    case 'barn': {
      shadow(W * 0.58)
      const top = cy - u * 0.3
      const red = tinted([172, 62, 50], 0.08)
      ctx.beginPath()
      ctx.rect(x0, top, W, gy - top)
      fill(red)
      ctx.beginPath()
      ctx.moveTo(x0 - u * 0.08, top + u * 0.03)
      ctx.lineTo(x0 + u * 0.06, top - u * 0.28)
      ctx.lineTo(cx, top - u * 0.56)
      ctx.lineTo(x1 - u * 0.06, top - u * 0.28)
      ctx.lineTo(x1 + u * 0.08, top + u * 0.03)
      ctx.closePath()
      fill([86, 58, 50])
      ctx.strokeStyle = tone([250, 244, 232])
      ctx.lineWidth = Math.max(1, u * 0.04)
      ctx.strokeRect(x0 + u * 0.04, top + u * 0.04, W - u * 0.08, gy - top - u * 0.04)
      ctx.lineWidth = lw
      board(cy + u * 0.07, Math.max(u * 0.5, textHalf * 2 + u * 0.16), u * 0.44, [250, 244, 228])
      return spot(cy + u * 0.08, DARK_TEXT)
    }
    case 'cabin': {
      shadow(W * 0.58)
      const top = cy - u * 0.24
      const log: RGB = tinted([150, 104, 66], 0.06)
      ctx.beginPath()
      ctx.rect(x0, top, W, gy - top)
      fill(log)
      ctx.strokeStyle = tone(shade(log, -0.35))
      ctx.beginPath()
      for (let y = top + u * 0.14; y < gy - u * 0.04; y += u * 0.14) {
        ctx.moveTo(x0 + lw, y)
        ctx.lineTo(x1 - lw, y)
      }
      ctx.stroke()
      roof(top - u * 0.58, top + u * 0.06, h < 0.5 ? [72, 100, 74] : [110, 72, 52], u * 0.12)
      board(cy + u * 0.08, Math.max(u * 0.5, textHalf * 2 + u * 0.16), u * 0.42, [236, 212, 166])
      return spot(cy + u * 0.09, DARK_TEXT)
    }
    case 'tree':
    case 'fruit':
    case 'blossom': {
      shadow(W * 0.5)
      ctx.beginPath()
      ctx.rect(cx - u * 0.07, cy - u * 0.1, u * 0.14, gy - cy + u * 0.1)
      fill([122, 86, 56])
      const yc = cy - u * 0.36
      const r = Math.min(u * 0.34, W * 0.3)
      ctx.beginPath()
      roundRect(ctx, x0, yc - u * 0.3, W, u * 0.62, u * 0.3)
      const bumps = Math.max(2, Math.round(W / (u * 0.5)))
      for (let k = 0; k < bumps; k++) {
        const bx = x0 + r * 0.8 + ((W - r * 1.6) * k) / Math.max(1, bumps - 1)
        const by = yc - u * 0.2 - (k % 2 ? u * 0.08 : 0)
        ctx.moveTo(bx + r, by)
        ctx.arc(bx, by, r, 0, Math.PI * 2)
      }
      const leaf: RGB =
        kind === 'blossom'
          ? h < 0.5
            ? [240, 178, 200]
            : [246, 226, 236]
          : tinted(LEAVES[Math.floor(h * 31) % LEAVES.length], 0.12)
      blob(leaf)
      if (kind === 'fruit') {
        ctx.fillStyle = tone(h < 0.5 ? [214, 64, 48] : [242, 164, 36])
        for (let k = 0; k < bumps; k++) {
          const bx = x0 + r * 0.8 + ((W - r * 1.6) * k) / Math.max(1, bumps - 1)
          ctx.beginPath()
          ctx.arc(bx + r * 0.3, yc - u * 0.36 - (k % 2 ? u * 0.08 : 0), u * 0.05, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.beginPath()
        ctx.arc(x0 + u * 0.12, yc + u * 0.16, u * 0.05, 0, Math.PI * 2)
        ctx.arc(x1 - u * 0.12, yc + u * 0.14, u * 0.05, 0, Math.PI * 2)
        ctx.fill()
      }
      return spot(yc + u * 0.04, kind === 'blossom' ? DARK_TEXT : LIGHT_TEXT)
    }
    case 'pine': {
      shadow(W * 0.5)
      ctx.beginPath()
      ctx.rect(cx - u * 0.07, cy + u * 0.1, u * 0.14, gy - cy - u * 0.1)
      fill([112, 80, 52])
      const green = tinted([58, 112, 74], 0.1)
      const tiers: [number, number, number, number][] = [
        [cy - u * 0.62, cy - u * 1.08, W * 0.55, 0],
        [cy - u * 0.24, cy - u * 0.74, W * 0.82, W * 0.24],
        [cy + u * 0.16, cy - u * 0.38, W + u * 0.2, W * 0.5],
      ]
      for (const [yb, yt, wb, wt] of tiers) {
        ctx.beginPath()
        ctx.moveTo(cx - wb / 2, yb)
        ctx.lineTo(cx - wt / 2, yt)
        ctx.lineTo(cx + wt / 2, yt)
        ctx.lineTo(cx + wb / 2, yb)
        ctx.closePath()
        fill(green)
      }
      return spot(cy - u * 0.1, LIGHT_TEXT)
    }
    case 'rock': {
      shadow(W * 0.55)
      const yc = cy + u * 0.02
      const rx = W / 2
      const ry = u * 0.36
      ctx.beginPath()
      for (let k = 0; k <= 10; k++) {
        const a = Math.PI + (k / 10) * Math.PI
        const j = 1 + (Math.sin(k * 2.3 + h * 20) * 0.08)
        const px = cx + Math.cos(a) * rx * j
        const py = yc + Math.sin(a) * ry * j
        if (k) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      }
      ctx.lineTo(x1, gy)
      ctx.lineTo(x0, gy)
      ctx.closePath()
      const stone = tinted([150, 146, 138], 0.1)
      fill(stone)
      ctx.fillStyle = tone(h < 0.5 ? [112, 150, 82] : shade(stone, 0.2))
      ctx.beginPath()
      ctx.ellipse(cx - rx * 0.3, yc - ry * 0.78, rx * 0.4, ry * 0.18, -0.1, 0, Math.PI * 2)
      ctx.fill()
      return spot(yc + u * 0.06, LIGHT_TEXT)
    }
    case 'mountain': {
      const base = W / 2 + u * 0.3
      const peak = cx + (h - 0.5) * u * 0.25
      const top = cy - u * 1.1
      // A smaller peak behind.
      const side = h < 0.5 ? -1 : 1
      ctx.beginPath()
      ctx.moveTo(cx + side * base * 0.1, gy)
      ctx.lineTo(cx + side * base * 0.75, cy - u * 0.62)
      ctx.lineTo(cx + side * (base + u * 0.25), gy)
      ctx.closePath()
      fill(tinted([118, 120, 134], 0.1))
      ctx.beginPath()
      ctx.moveTo(cx - base, gy)
      ctx.lineTo(peak, top)
      ctx.lineTo(cx + base, gy)
      ctx.closePath()
      const rock = tinted([132, 132, 146], 0.12)
      fill(rock)
      ctx.beginPath()
      ctx.moveTo(peak, top)
      ctx.lineTo(cx + base, gy)
      ctx.lineTo(peak + u * 0.1, gy)
      ctx.closePath()
      ctx.fillStyle = tone(shade(rock, -0.14))
      ctx.fill()
      const sc = 0.32
      ctx.beginPath()
      ctx.moveTo(peak, top)
      ctx.lineTo(peak + (cx + base - peak) * sc, top + (gy - top) * sc)
      ctx.lineTo(peak + u * 0.08, top + (gy - top) * sc * 0.8)
      ctx.lineTo(peak - u * 0.08, top + (gy - top) * sc * 1.05)
      ctx.lineTo(peak + (cx - base - peak) * sc, top + (gy - top) * sc)
      ctx.closePath()
      ctx.fillStyle = tone([248, 250, 252])
      ctx.fill()
      return spot(cy + u * 0.02, LIGHT_TEXT)
    }
    case 'cloud': {
      ctx.fillStyle = 'rgba(70, 90, 120, 0.14)'
      ctx.beginPath()
      ctx.ellipse(cx, gy, W * 0.5, u * 0.1, 0, 0, Math.PI * 2)
      ctx.fill()
      const yc = cy - u * 0.28
      ctx.beginPath()
      roundRect(ctx, x0 - u * 0.05, yc - u * 0.16, W + u * 0.1, u * 0.46, u * 0.23)
      const r = Math.min(u * 0.28, W * 0.25)
      ctx.moveTo(cx - W * 0.2 + r, yc - u * 0.16)
      ctx.arc(cx - W * 0.2, yc - u * 0.16, r, 0, Math.PI * 2)
      ctx.moveTo(cx + W * 0.16 + r * 1.2, yc - u * 0.2)
      ctx.arc(cx + W * 0.16, yc - u * 0.2, r * 1.2, 0, Math.PI * 2)
      blob([250, 252, 255])
      return spot(yc + u * 0.06, ['#2c3e50', 'rgba(255,255,255,0.6)'])
    }
    case 'dune': {
      const L = x0 - u * 0.35
      const R = x1 + u * 0.35
      const crestX = cx + (h - 0.5) * u * 0.3
      const crestY = cy - u * 0.42
      ctx.beginPath()
      ctx.moveTo(L, gy)
      ctx.quadraticCurveTo(x0 + u * 0.05, crestY - u * 0.02, crestX, crestY)
      ctx.quadraticCurveTo(x1 + u * 0.05, crestY + u * 0.1, R, gy)
      ctx.closePath()
      const sand = tinted([228, 196, 128], 0.08)
      fill(sand)
      ctx.beginPath()
      ctx.moveTo(crestX, crestY)
      ctx.quadraticCurveTo(x1 + u * 0.05, crestY + u * 0.1, R, gy)
      ctx.lineTo(crestX + u * 0.35, gy)
      ctx.quadraticCurveTo(crestX + u * 0.1, cy, crestX, crestY)
      ctx.fillStyle = tone(shade(sand, -0.12))
      ctx.fill()
      ctx.strokeStyle = tone(shade(sand, -0.25))
      ctx.beginPath()
      ctx.moveTo(L + u * 0.3, gy - u * 0.08)
      ctx.quadraticCurveTo(cx - u * 0.1, gy - u * 0.2, R - u * 0.4, gy - u * 0.06)
      ctx.stroke()
      return spot(cy + u * 0.02, ['#4d3416', 'rgba(255, 244, 214, 0.75)'])
    }
    case 'mesa': {
      shadow(W * 0.62)
      const top = cy - u * 0.62
      const red = tinted([188, 102, 70], 0.08)
      ctx.beginPath()
      ctx.moveTo(x0 - u * 0.2, gy)
      ctx.lineTo(x0, top)
      ctx.lineTo(x1, top)
      ctx.lineTo(x1 + u * 0.2, gy)
      ctx.closePath()
      fill(red)
      ctx.save()
      ctx.clip()
      ctx.fillStyle = tone(shade(red, 0.18))
      ctx.fillRect(x0 - u * 0.2, top, W + u * 0.4, u * 0.1)
      ctx.fillStyle = tone(shade(red, -0.12))
      ctx.fillRect(x0 - u * 0.2, cy + u * 0.2, W + u * 0.4, u * 0.08)
      ctx.restore()
      return spot(cy - u * 0.12, LIGHT_TEXT)
    }
    case 'crystal': {
      shadow(W * 0.6)
      const ice = tinted([166, 212, 236], 0.12)
      for (const [side, c] of [
        [-1, [150, 130, 210]],
        [1, [120, 180, 220]],
      ] as [number, RGB][]) {
        const bx = cx + side * (W / 2 + u * 0.02)
        ctx.beginPath()
        ctx.moveTo(bx - u * 0.12, gy)
        ctx.lineTo(bx - u * 0.12 - side * u * 0.04, cy - u * 0.1)
        ctx.lineTo(bx + side * u * 0.08, cy - u * 0.36)
        ctx.lineTo(bx + u * 0.14, cy - u * 0.04)
        ctx.lineTo(bx + u * 0.12, gy)
        ctx.closePath()
        fill(c)
      }
      ctx.beginPath()
      ctx.moveTo(x0, gy - u * 0.06)
      ctx.lineTo(x0, cy - u * 0.4)
      ctx.lineTo(cx, cy - u * 0.88)
      ctx.lineTo(x1, cy - u * 0.4)
      ctx.lineTo(x1, gy - u * 0.06)
      ctx.lineTo(cx, gy + u * 0.04)
      ctx.closePath()
      fill(ice)
      ctx.beginPath()
      ctx.moveTo(cx, cy - u * 0.88)
      ctx.lineTo(x1, cy - u * 0.4)
      ctx.lineTo(x1, gy - u * 0.06)
      ctx.lineTo(cx + W * 0.3, gy - u * 0.02)
      ctx.closePath()
      ctx.fillStyle = tone(shade(ice, -0.12))
      ctx.fill()
      return spot(cy - u * 0.04, ['#14304a', 'rgba(240, 250, 255, 0.8)'])
    }
    case 'lily': {
      const yc = cy + u * 0.08
      ctx.beginPath()
      ctx.ellipse(cx, yc, W / 2 + u * 0.22, u * 0.36, 0, 0, Math.PI * 2)
      fill([96, 150, 194], false)
      ctx.beginPath()
      const a = 0.32
      ctx.ellipse(cx, yc, W / 2, u * 0.27, 0, a, Math.PI * 2 - a)
      ctx.lineTo(cx, yc)
      ctx.closePath()
      fill(tinted([100, 164, 88], 0.08))
      ctx.beginPath()
      ctx.arc(x0 + u * 0.1, yc - u * 0.18, u * 0.09, 0, Math.PI * 2)
      fill(h < 0.5 ? [246, 170, 200] : [252, 246, 250])
      return spot(yc + u * 0.02, LIGHT_TEXT)
    }
    case 'haystack': {
      shadow(W * 0.55)
      const straw = tinted([226, 186, 90], 0.06)
      ctx.beginPath()
      ctx.moveTo(x0, gy)
      ctx.bezierCurveTo(x0, cy - u * 0.25, cx - W * 0.25, cy - u * 0.58, cx, cy - u * 0.58)
      ctx.bezierCurveTo(cx + W * 0.25, cy - u * 0.58, x1, cy - u * 0.25, x1, gy)
      ctx.closePath()
      fill(straw)
      ctx.strokeStyle = tone(shade(straw, -0.28))
      ctx.beginPath()
      ctx.moveTo(x0 + u * 0.12, cy - u * 0.2)
      ctx.quadraticCurveTo(cx, cy - u * 0.32, x1 - u * 0.12, cy - u * 0.2)
      ctx.stroke()
      return spot(cy + u * 0.08, DARK_TEXT)
    }
  }
}

/** A region's hall: a guild hall with a flag in the region's color (gold once every word is learned). */
export function drawHall(ctx: CanvasRenderingContext2D, cx: number, cy: number, u: number, tint: RGB, cleared: boolean): void {
  const gy = cy + u * 0.4
  const W = u * 2
  const x0 = cx - W / 2
  const lw = Math.max(1, u * 0.035)
  ctx.lineWidth = lw
  ctx.lineJoin = 'round'
  const fill = (c: RGB) => {
    ctx.fillStyle = rgb(c)
    ctx.fill()
    ctx.strokeStyle = rgb(shade(c, -0.55))
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
  ctx.beginPath()
  ctx.ellipse(cx, gy, W * 0.58, u * 0.13, 0, 0, Math.PI * 2)
  ctx.fill()
  const stone: RGB = mix([226, 218, 200], tint, 0.12)
  const roofC = shade(mix(tint, [90, 70, 60], 0.4), -0.2)
  const top = cy - u * 0.32
  // Central tower behind the roof.
  ctx.beginPath()
  ctx.rect(cx - u * 0.3, cy - u * 1.02, u * 0.6, u * 0.8)
  fill(stone)
  ctx.beginPath()
  ctx.moveTo(cx - u * 0.4, cy - u * 0.98)
  ctx.lineTo(cx, cy - u * 1.42)
  ctx.lineTo(cx + u * 0.4, cy - u * 0.98)
  ctx.closePath()
  fill(roofC)
  ctx.beginPath()
  ctx.moveTo(cx, cy - u * 1.42)
  ctx.lineTo(cx, cy - u * 1.78)
  ctx.strokeStyle = 'rgb(70, 56, 40)'
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, cy - u * 1.78)
  ctx.quadraticCurveTo(cx + u * 0.25, cy - u * 1.82, cx + u * 0.48, cy - u * 1.72)
  ctx.lineTo(cx + u * 0.4, cy - u * 1.62)
  ctx.lineTo(cx + u * 0.48, cy - u * 1.52)
  ctx.quadraticCurveTo(cx + u * 0.25, cy - u * 1.6, cx, cy - u * 1.56)
  ctx.closePath()
  fill(cleared ? [240, 190, 50] : tint)
  ctx.beginPath()
  ctx.arc(cx, cy - u * 0.74, u * 0.13, 0, Math.PI * 2)
  fill(cleared ? [255, 214, 90] : [255, 230, 160])
  // Hall body and roof.
  ctx.beginPath()
  ctx.rect(x0, top, W, gy - top)
  fill(stone)
  ctx.beginPath()
  ctx.moveTo(x0 - u * 0.12, top + u * 0.04)
  ctx.lineTo(x0 + u * 0.22, top - u * 0.3)
  ctx.lineTo(x0 + W - u * 0.22, top - u * 0.3)
  ctx.lineTo(x0 + W + u * 0.12, top + u * 0.04)
  ctx.closePath()
  fill(roofC)
  // Arched door and windows.
  const arch = (x: number, y: number, w: number, h: number, c: RGB) => {
    ctx.beginPath()
    ctx.moveTo(x - w / 2, y + h)
    ctx.lineTo(x - w / 2, y + w / 2)
    ctx.arc(x, y + w / 2, w / 2, Math.PI, 0)
    ctx.lineTo(x + w / 2, y + h)
    ctx.closePath()
    fill(c)
  }
  arch(cx, cy - u * 0.12, u * 0.38, u * 0.52, [110, 74, 46])
  arch(x0 + u * 0.36, cy - u * 0.16, u * 0.2, u * 0.3, [255, 226, 140])
  arch(x0 + W - u * 0.36, cy - u * 0.16, u * 0.2, u * 0.3, [255, 226, 140])
}

/** The player: a small traveller with a backpack. (x, y) is the feet position in pixels. */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  u: number,
  facing: 'up' | 'down' | 'left' | 'right',
  step: number,
  moving: boolean,
): void {
  const s = u * 0.9
  const bob = moving ? Math.abs(Math.sin(step * Math.PI)) * s * 0.05 : 0
  const swing = moving ? Math.sin(step * Math.PI) * s * 0.08 : 0
  const lw = Math.max(1, s * 0.035)
  const ink = 'rgb(40, 32, 28)'
  ctx.lineWidth = lw
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
  ctx.beginPath()
  ctx.ellipse(x, y, s * 0.24, s * 0.08, 0, 0, Math.PI * 2)
  ctx.fill()
  const by = y - bob
  // Legs.
  ctx.fillStyle = 'rgb(60, 66, 92)'
  ctx.strokeStyle = ink
  for (const [dx, sw] of [
    [-0.08, swing],
    [0.08, -swing],
  ]) {
    ctx.beginPath()
    roundRect(ctx, x + dx * s - s * 0.055, by - s * 0.24 + Math.min(0, sw), s * 0.11, s * 0.24 + Math.abs(sw) * 0.3, s * 0.04)
    ctx.fill()
    ctx.stroke()
  }
  const side = facing === 'left' ? -1 : facing === 'right' ? 1 : 0
  // Backpack (behind unless facing away).
  const pack = () => {
    ctx.beginPath()
    roundRect(ctx, x - s * 0.17 - side * s * 0.12, by - s * 0.58, s * 0.34, s * 0.34, s * 0.07)
    ctx.fillStyle = 'rgb(168, 96, 52)'
    ctx.fill()
    ctx.stroke()
  }
  if (facing !== 'up') pack()
  // Tunic.
  ctx.beginPath()
  roundRect(ctx, x - s * 0.19, by - s * 0.6, s * 0.38, s * 0.4, s * 0.1)
  ctx.fillStyle = 'rgb(38, 146, 156)'
  ctx.fill()
  ctx.stroke()
  if (facing === 'up') pack()
  // Scarf.
  ctx.beginPath()
  ctx.rect(x - s * 0.16, by - s * 0.6, s * 0.32, s * 0.07)
  ctx.fillStyle = 'rgb(222, 72, 64)'
  ctx.fill()
  // Head.
  const hy = by - s * 0.76
  ctx.beginPath()
  ctx.arc(x, hy, s * 0.17, 0, Math.PI * 2)
  ctx.fillStyle = 'rgb(246, 210, 176)'
  ctx.fill()
  ctx.stroke()
  // Hair / cap.
  ctx.beginPath()
  if (facing === 'up') ctx.arc(x, hy, s * 0.17, 0, Math.PI * 2)
  else ctx.arc(x, hy - s * 0.02, s * 0.17, Math.PI * 1.02 + side * 0.25, Math.PI * 1.98 + side * 0.25)
  ctx.closePath()
  ctx.fillStyle = 'rgb(92, 60, 36)'
  ctx.fill()
  if (facing !== 'up') {
    ctx.fillStyle = ink
    for (const ex of side ? [side * 0.08] : [-0.06, 0.06]) {
      ctx.beginPath()
      ctx.arc(x + ex * s, hy + s * 0.03, s * 0.022, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
