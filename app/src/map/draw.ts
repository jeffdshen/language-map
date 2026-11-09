import type { PosCategory, RegionKind } from '../data/types'

export type RGB = [number, number, number]

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function rgb(c: RGB, alpha = 1): string {
  const r = Math.round(Math.max(0, Math.min(255, c[0])))
  const g = Math.round(Math.max(0, Math.min(255, c[1])))
  const b = Math.round(Math.max(0, Math.min(255, c[2])))
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`
}

const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]
export const GOLD: RGB = [232, 178, 38]

/** Lighten (f > 0) toward white or darken (f < 0) toward black. */
export function shade(c: RGB, f: number): RGB {
  return f >= 0 ? mix(c, WHITE, f) : mix(c, BLACK, -f)
}

/** Deterministic hash of an integer cell, in [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619)
  return (h >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1). */
export function valueNoise(x: number, y: number, seed = 1): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ---- terrain decorations ---------------------------------------------------------------------------------

/** Chance that an empty cell of each ground type gets a decoration. */
export const DECOR_DENSITY: Record<string, number> = {
  '~': 0.05,
  '=': 0.14,
  '.': 0.22,
  p: 1,
  g: 0.3,
  m: 0.42,
  w: 0.62,
  o: 0.42,
  d: 0.24,
  r: 0.36,
  c: 0.32,
  f: 0.72,
  h: 0.42,
  k: 0.56,
  s: 0.3,
  x: 0.45,
  y: 0.42,
}

const FLOWER: RGB[] = [
  [255, 255, 255],
  [255, 214, 92],
  [240, 128, 160],
  [190, 150, 240],
]

/**
 * Draw the decoration for one empty cell. (cx, cy) is the cell center and u the cell size, both in device pixels.
 * `h` is a per-cell hash in [0, 1) used for variation.
 */
export function drawDecor(ctx: CanvasRenderingContext2D, code: string, cx: number, cy: number, u: number, h: number, base: RGB): void {
  const jx = (((h * 7.31) % 1) - 0.5) * u * 0.3
  const jy = (((h * 13.7) % 1) - 0.5) * u * 0.3
  const x = cx + jx
  const y = cy + jy
  const lw = Math.max(1, u * 0.035)
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  switch (code) {
    case '~':
    case '=': {
      ctx.strokeStyle = rgb(shade(base, 0.35), 0.8)
      ctx.beginPath()
      ctx.moveTo(x - u * 0.22, y)
      ctx.quadraticCurveTo(x - u * 0.11, y - u * 0.08, x, y)
      ctx.quadraticCurveTo(x + u * 0.11, y + u * 0.08, x + u * 0.22, y)
      ctx.stroke()
      break
    }
    case '.':
    case 'd': {
      ctx.fillStyle = rgb(shade(base, -0.22))
      for (let k = 0; k < 3; k++) {
        const a = h * 40 + k * 2.1
        ctx.beginPath()
        ctx.ellipse(x + Math.cos(a) * u * 0.18, y + Math.sin(a) * u * 0.14, u * 0.05, u * 0.035, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case 'p': {
      // Paving stones.
      ctx.strokeStyle = rgb(shade(base, -0.12), 0.7)
      ctx.lineWidth = Math.max(1, u * 0.02)
      const s = u / 2
      const x0 = cx - u / 2
      const y0 = cy - u / 2
      ctx.beginPath()
      ctx.moveTo(x0, y0 + s)
      ctx.lineTo(x0 + u, y0 + s)
      const off = h < 0.5 ? s * 0.5 : s
      ctx.moveTo(x0 + off, y0)
      ctx.lineTo(x0 + off, y0 + s)
      ctx.moveTo(x0 + ((off + s) % u), y0 + s)
      ctx.lineTo(x0 + ((off + s) % u), y0 + u)
      ctx.stroke()
      break
    }
    case 'g': {
      ctx.strokeStyle = rgb(shade(base, -0.28))
      ctx.beginPath()
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(x + k * u * 0.07, y + u * 0.08)
        ctx.lineTo(x + k * u * 0.11, y - u * 0.06)
      }
      ctx.stroke()
      break
    }
    case 'm': {
      for (let k = 0; k < 3; k++) {
        const a = h * 50 + k * 2.4
        ctx.fillStyle = rgb(FLOWER[(Math.floor(h * 97) + k) % FLOWER.length])
        ctx.beginPath()
        ctx.arc(x + Math.cos(a) * u * 0.2, y + Math.sin(a) * u * 0.16, u * 0.045, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case 'w': {
      ctx.strokeStyle = rgb(shade(base, -0.2))
      ctx.beginPath()
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(cx - u * 0.36, cy + k * u * 0.25)
        ctx.lineTo(cx + u * 0.36, cy + k * u * 0.25)
      }
      ctx.stroke()
      break
    }
    case 'o':
    case 'f': {
      const leaf = shade(base, code === 'f' ? -0.35 : -0.2)
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.beginPath()
      ctx.ellipse(x, y + u * 0.2, u * 0.2, u * 0.07, 0, 0, Math.PI * 2)
      ctx.fill()
      if (code === 'f' && h < 0.55) {
        // Conifer.
        ctx.fillStyle = rgb(shade(leaf, -0.1))
        ctx.beginPath()
        ctx.moveTo(x, y - u * 0.34)
        ctx.lineTo(x + u * 0.2, y + u * 0.16)
        ctx.lineTo(x - u * 0.2, y + u * 0.16)
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.fillStyle = rgb(shade(base, -0.5))
        ctx.fillRect(x - u * 0.025, y, u * 0.05, u * 0.18)
        ctx.fillStyle = rgb(leaf)
        ctx.beginPath()
        ctx.arc(x, y - u * 0.06, u * 0.17, 0, Math.PI * 2)
        ctx.fill()
        if (code === 'o') {
          ctx.fillStyle = rgb(h < 0.5 ? [214, 70, 52] : [240, 170, 40])
          for (let k = 0; k < 3; k++) {
            ctx.beginPath()
            ctx.arc(x + Math.cos(k * 2.1 + h * 9) * u * 0.09, y - u * 0.06 + Math.sin(k * 2.1 + h * 9) * u * 0.08, u * 0.03, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      break
    }
    case 'h': {
      ctx.fillStyle = rgb(shade(base, -0.12))
      ctx.beginPath()
      ctx.moveTo(x - u * 0.34, y + u * 0.12)
      ctx.quadraticCurveTo(x, y - u * 0.3, x + u * 0.34, y + u * 0.12)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'k':
    case 's': {
      const rock = code === 'k' ? shade(base, -0.25) : [176, 186, 196]
      ctx.fillStyle = rgb(rock as RGB)
      ctx.beginPath()
      ctx.moveTo(x - u * 0.34, y + u * 0.2)
      ctx.lineTo(x - u * 0.02, y - u * 0.34)
      ctx.lineTo(x + u * 0.32, y + u * 0.2)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.beginPath()
      ctx.moveTo(x - u * 0.12, y - u * 0.15)
      ctx.lineTo(x - u * 0.02, y - u * 0.34)
      ctx.lineTo(x + u * 0.1, y - u * 0.14)
      ctx.lineTo(x, y - u * 0.18)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'r': {
      ctx.fillStyle = rgb(shade(base, -0.28))
      ctx.beginPath()
      ctx.moveTo(x - u * 0.22, y + u * 0.14)
      ctx.lineTo(x - u * 0.16, y - u * 0.08)
      ctx.lineTo(x + u * 0.02, y - u * 0.16)
      ctx.lineTo(x + u * 0.2, y - u * 0.04)
      ctx.lineTo(x + u * 0.24, y + u * 0.14)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = rgb(shade(base, 0.2))
      ctx.beginPath()
      ctx.moveTo(x - u * 0.14, y - u * 0.06)
      ctx.lineTo(x + u * 0.02, y - u * 0.13)
      ctx.lineTo(x + u * 0.04, y - u * 0.02)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'c': {
      for (const [dx, hgt, w] of [
        [-0.1, 0.32, 0.08],
        [0.08, 0.22, 0.07],
      ]) {
        ctx.fillStyle = rgb(shade(base, dx < 0 ? -0.18 : 0.25))
        ctx.beginPath()
        ctx.moveTo(x + dx * u, y - hgt * u)
        ctx.lineTo(x + (dx + w) * u, y + u * 0.1)
        ctx.lineTo(x + dx * u, y + u * 0.18)
        ctx.lineTo(x + (dx - w) * u, y + u * 0.1)
        ctx.closePath()
        ctx.fill()
      }
      break
    }
    case 'x': {
      ctx.fillStyle = rgb(shade(base, -0.15), 0.8)
      ctx.beginPath()
      ctx.ellipse(x, y + u * 0.12, u * 0.24, u * 0.07, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = rgb(shade(base, -0.45))
      ctx.beginPath()
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(x + k * u * 0.08, y + u * 0.1)
        ctx.lineTo(x + k * u * 0.1, y - u * 0.18 + Math.abs(k) * u * 0.06)
      }
      ctx.stroke()
      break
    }
    case 'y': {
      ctx.strokeStyle = rgb(shade(base, -0.18))
      ctx.beginPath()
      ctx.moveTo(x - u * 0.3, y + u * 0.05)
      ctx.quadraticCurveTo(x - u * 0.05, y - u * 0.18, x + u * 0.3, y)
      ctx.moveTo(x - u * 0.2, y + u * 0.2)
      ctx.quadraticCurveTo(x + u * 0.05, y + u * 0.02, x + u * 0.3, y + u * 0.16)
      ctx.stroke()
      break
    }
  }
}

// ---- landmarks -------------------------------------------------------------------------------------------

export type LandmarkKind = 'house' | 'hut' | 'person' | 'elder' | 'tree' | 'flag' | 'tower' | 'sign' | 'bell' | 'tent'

export function landmarkKind(pos: PosCategory, region: RegionKind): LandmarkKind {
  switch (pos) {
    case 'noun':
      return region === 'wild' ? 'hut' : 'house'
    case 'verb':
      return 'person'
    case 'pron':
      return 'elder'
    case 'adj':
      return 'tree'
    case 'adv':
      return 'flag'
    case 'num':
    case 'measure':
      return 'tower'
    case 'interj':
    case 'onomat':
      return 'bell'
    case 'phrase':
      return 'tent'
    default:
      return 'sign'
  }
}

export const LANDMARK_LABEL: Record<LandmarkKind, string> = {
  house: 'noun (building)',
  hut: 'noun, in the wilds',
  person: 'verb (person)',
  elder: 'pronoun (traveller)',
  tree: 'adjective (tree)',
  flag: 'adverb (banner)',
  tower: 'number / measure (tower)',
  sign: 'function word (signpost)',
  bell: 'interjection / sound (bell)',
  tent: 'phrase (tent)',
}

const SKIN: RGB[] = [
  [247, 214, 184],
  [232, 190, 150],
  [205, 152, 110],
  [160, 110, 76],
]
const HAIR: RGB[] = [
  [40, 32, 28],
  [70, 50, 36],
  [26, 26, 30],
  [120, 116, 110],
]
const GRAY: RGB = [150, 150, 146]

export interface LandmarkStyle {
  /** Main color (region/theme). */
  color: RGB
  /** Per-word variation hash in [0, 1). */
  h: number
  /** 0 = full color, 1 = fully grayed (fog). */
  muted: number
}

/**
 * Draw a word's landmark centered on (cx, cy); u is the cell size in pixels. The drawing sits roughly within
 * [cy - 0.45u, cy + 0.38u] vertically.
 */
export function drawLandmark(ctx: CanvasRenderingContext2D, kind: LandmarkKind, cx: number, cy: number, u: number, style: LandmarkStyle): void {
  const { h, muted } = style
  const tone = (c: RGB) => rgb(muted > 0 ? mix(c, GRAY, muted) : c)
  const main = style.color
  const ink = tone(mix(main, BLACK, 0.62))
  const lw = Math.max(1, u * 0.032)
  ctx.lineWidth = lw
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = ink

  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  ctx.beginPath()
  ctx.ellipse(cx, cy + u * 0.36, u * 0.32, u * 0.09, 0, 0, Math.PI * 2)
  ctx.fill()

  const fillStroke = (c: RGB) => {
    ctx.fillStyle = tone(c)
    ctx.fill()
    ctx.stroke()
  }

  switch (kind) {
    case 'house': {
      const wall = mix(main, WHITE, 0.62)
      const roof = shade(main, -0.12 - h * 0.15)
      ctx.beginPath()
      ctx.rect(cx - u * 0.27, cy - u * 0.06, u * 0.54, u * 0.42)
      fillStroke(wall)
      ctx.beginPath()
      if (h < 0.5) {
        // Upturned eaves.
        ctx.moveTo(cx - u * 0.42, cy - u * 0.02)
        ctx.quadraticCurveTo(cx - u * 0.3, cy - u * 0.08, cx - u * 0.2, cy - u * 0.36)
        ctx.lineTo(cx + u * 0.2, cy - u * 0.36)
        ctx.quadraticCurveTo(cx + u * 0.3, cy - u * 0.08, cx + u * 0.42, cy - u * 0.02)
      } else {
        ctx.moveTo(cx - u * 0.38, cy - u * 0.04)
        ctx.lineTo(cx, cy - u * 0.42)
        ctx.lineTo(cx + u * 0.38, cy - u * 0.04)
      }
      ctx.closePath()
      fillStroke(roof)
      ctx.beginPath()
      ctx.rect(cx - u * 0.07, cy + u * 0.12, u * 0.14, u * 0.24)
      fillStroke(shade(main, -0.45))
      ctx.fillStyle = tone([255, 236, 160])
      ctx.fillRect(cx + u * 0.12, cy + u * 0.03, u * 0.09, u * 0.09)
      ctx.fillRect(cx - u * 0.21, cy + u * 0.03, u * 0.09, u * 0.09)
      break
    }
    case 'hut': {
      ctx.beginPath()
      ctx.moveTo(cx - u * 0.32, cy + u * 0.36)
      ctx.quadraticCurveTo(cx - u * 0.32, cy - u * 0.34, cx, cy - u * 0.34)
      ctx.quadraticCurveTo(cx + u * 0.32, cy - u * 0.34, cx + u * 0.32, cy + u * 0.36)
      ctx.closePath()
      fillStroke(mix(main, [196, 160, 98], 0.55))
      ctx.beginPath()
      ctx.moveTo(cx - u * 0.24, cy - u * 0.05)
      ctx.quadraticCurveTo(cx, cy - u * 0.12, cx + u * 0.24, cy - u * 0.05)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx - u * 0.08, cy + u * 0.36)
      ctx.lineTo(cx - u * 0.08, cy + u * 0.12)
      ctx.quadraticCurveTo(cx, cy + u * 0.04, cx + u * 0.08, cy + u * 0.12)
      ctx.lineTo(cx + u * 0.08, cy + u * 0.36)
      ctx.closePath()
      fillStroke(shade(main, -0.5))
      break
    }
    case 'person':
    case 'elder': {
      const skin = SKIN[Math.floor(h * 97) % SKIN.length]
      const hair = HAIR[Math.floor(h * 31) % HAIR.length]
      // Body (robe).
      ctx.beginPath()
      ctx.moveTo(cx - u * 0.24, cy + u * 0.36)
      ctx.quadraticCurveTo(cx - u * 0.22, cy - u * 0.04, cx, cy - u * 0.04)
      ctx.quadraticCurveTo(cx + u * 0.22, cy - u * 0.04, cx + u * 0.24, cy + u * 0.36)
      ctx.closePath()
      fillStroke(kind === 'elder' ? shade(main, -0.2) : main)
      // Belt.
      ctx.strokeStyle = tone(shade(main, -0.5))
      ctx.beginPath()
      ctx.moveTo(cx - u * 0.2, cy + u * 0.17)
      ctx.lineTo(cx + u * 0.2, cy + u * 0.17)
      ctx.stroke()
      ctx.strokeStyle = ink
      // Head.
      ctx.beginPath()
      ctx.arc(cx, cy - u * 0.18, u * 0.14, 0, Math.PI * 2)
      fillStroke(skin)
      if (kind === 'elder') {
        // Straw hat.
        ctx.beginPath()
        ctx.moveTo(cx - u * 0.28, cy - u * 0.2)
        ctx.lineTo(cx, cy - u * 0.42)
        ctx.lineTo(cx + u * 0.28, cy - u * 0.2)
        ctx.closePath()
        fillStroke([222, 190, 120])
      } else {
        ctx.beginPath()
        ctx.arc(cx, cy - u * 0.2, u * 0.14, Math.PI * 1.05, Math.PI * 1.95)
        ctx.closePath()
        ctx.fillStyle = tone(hair)
        ctx.fill()
        if (h > 0.6) {
          ctx.beginPath()
          ctx.arc(cx, cy - u * 0.35, u * 0.05, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      break
    }
    case 'tree': {
      ctx.beginPath()
      ctx.rect(cx - u * 0.05, cy + u * 0.02, u * 0.1, u * 0.34)
      fillStroke([122, 86, 54])
      const leaf = mix(main, [96, 160, 80], 0.45)
      if (h < 0.4) {
        for (const [dy, r] of [
          [0.02, 0.3],
          [-0.18, 0.24],
          [-0.34, 0.16],
        ]) {
          ctx.beginPath()
          ctx.moveTo(cx - u * r, cy + u * (dy + 0.08))
          ctx.lineTo(cx, cy + u * (dy - 0.22))
          ctx.lineTo(cx + u * r, cy + u * (dy + 0.08))
          ctx.closePath()
          fillStroke(leaf)
        }
      } else {
        ctx.beginPath()
        ctx.arc(cx - u * 0.12, cy - u * 0.08, u * 0.17, 0, Math.PI * 2)
        ctx.arc(cx + u * 0.12, cy - u * 0.08, u * 0.17, 0, Math.PI * 2)
        ctx.moveTo(cx + u * 0.2, cy - u * 0.24)
        ctx.arc(cx, cy - u * 0.24, u * 0.2, 0, Math.PI * 2)
        fillStroke(leaf)
        ctx.fillStyle = tone(shade(main, 0.15))
        for (let k = 0; k < 4; k++) {
          ctx.beginPath()
          ctx.arc(cx + Math.cos(k * 1.7 + h * 6) * u * 0.17, cy - u * 0.15 + Math.sin(k * 1.7 + h * 6) * u * 0.11, u * 0.04, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      break
    }
    case 'flag': {
      ctx.beginPath()
      ctx.ellipse(cx - u * 0.1, cy + u * 0.33, u * 0.12, u * 0.05, 0, 0, Math.PI * 2)
      fillStroke([150, 140, 128])
      ctx.strokeStyle = tone([110, 80, 50])
      ctx.lineWidth = Math.max(1.5, u * 0.05)
      ctx.beginPath()
      ctx.moveTo(cx - u * 0.1, cy + u * 0.33)
      ctx.lineTo(cx - u * 0.1, cy - u * 0.42)
      ctx.stroke()
      ctx.lineWidth = lw
      ctx.strokeStyle = ink
      ctx.beginPath()
      ctx.moveTo(cx - u * 0.1, cy - u * 0.4)
      ctx.quadraticCurveTo(cx + u * 0.08, cy - u * 0.46, cx + u * 0.32, cy - u * 0.36)
      ctx.lineTo(cx + u * 0.22, cy - u * 0.25)
      ctx.lineTo(cx + u * 0.32, cy - u * 0.12)
      ctx.quadraticCurveTo(cx + u * 0.08, cy - u * 0.2, cx - u * 0.1, cy - u * 0.14)
      ctx.closePath()
      fillStroke(main)
      break
    }
    case 'tower': {
      const wall = mix(main, [226, 220, 208], 0.6)
      const tiers = 3
      for (let t = 0; t < tiers; t++) {
        const w = u * (0.24 - t * 0.05)
        const y1 = cy + u * (0.36 - t * 0.24)
        const y0 = y1 - u * 0.2
        ctx.beginPath()
        ctx.rect(cx - w, y0, w * 2, y1 - y0)
        fillStroke(wall)
        ctx.beginPath()
        ctx.moveTo(cx - w - u * 0.08, y0 + u * 0.02)
        ctx.lineTo(cx - w + u * 0.02, y0 - u * 0.05)
        ctx.lineTo(cx + w - u * 0.02, y0 - u * 0.05)
        ctx.lineTo(cx + w + u * 0.08, y0 + u * 0.02)
        ctx.closePath()
        fillStroke(shade(main, -0.15))
      }
      ctx.beginPath()
      ctx.moveTo(cx, cy - u * 0.46)
      ctx.lineTo(cx, cy - u * 0.36)
      ctx.stroke()
      break
    }
    case 'sign': {
      ctx.beginPath()
      ctx.rect(cx - u * 0.035, cy - u * 0.2, u * 0.07, u * 0.56)
      fillStroke([140, 100, 62])
      const wood = mix(main, [206, 168, 112], 0.5)
      const dir = h < 0.5 ? 1 : -1
      ctx.beginPath()
      ctx.moveTo(cx - dir * u * 0.28, cy - u * 0.36)
      ctx.lineTo(cx + dir * u * 0.2, cy - u * 0.36)
      ctx.lineTo(cx + dir * u * 0.32, cy - u * 0.255)
      ctx.lineTo(cx + dir * u * 0.2, cy - u * 0.15)
      ctx.lineTo(cx - dir * u * 0.28, cy - u * 0.15)
      ctx.closePath()
      fillStroke(wood)
      ctx.strokeStyle = tone(shade(wood, -0.4))
      ctx.beginPath()
      ctx.moveTo(cx - dir * u * 0.18, cy - u * 0.255)
      ctx.lineTo(cx + dir * u * 0.12, cy - u * 0.255)
      ctx.stroke()
      ctx.strokeStyle = ink
      break
    }
    case 'bell': {
      ctx.strokeStyle = tone([120, 78, 46])
      ctx.lineWidth = Math.max(1.5, u * 0.05)
      ctx.beginPath()
      ctx.moveTo(cx - u * 0.26, cy + u * 0.36)
      ctx.lineTo(cx - u * 0.26, cy - u * 0.36)
      ctx.moveTo(cx + u * 0.26, cy + u * 0.36)
      ctx.lineTo(cx + u * 0.26, cy - u * 0.36)
      ctx.moveTo(cx - u * 0.34, cy - u * 0.36)
      ctx.lineTo(cx + u * 0.34, cy - u * 0.36)
      ctx.stroke()
      ctx.lineWidth = lw
      ctx.strokeStyle = ink
      ctx.beginPath()
      ctx.moveTo(cx - u * 0.17, cy + u * 0.14)
      ctx.quadraticCurveTo(cx - u * 0.16, cy - u * 0.3, cx, cy - u * 0.3)
      ctx.quadraticCurveTo(cx + u * 0.16, cy - u * 0.3, cx + u * 0.17, cy + u * 0.14)
      ctx.closePath()
      fillStroke(mix(main, [210, 160, 60], 0.6))
      ctx.beginPath()
      ctx.arc(cx, cy + u * 0.18, u * 0.045, 0, Math.PI * 2)
      fillStroke([90, 70, 40])
      break
    }
    case 'tent': {
      ctx.beginPath()
      ctx.moveTo(cx - u * 0.36, cy + u * 0.36)
      ctx.lineTo(cx, cy - u * 0.32)
      ctx.lineTo(cx + u * 0.36, cy + u * 0.36)
      ctx.closePath()
      fillStroke(main)
      ctx.beginPath()
      ctx.moveTo(cx - u * 0.1, cy + u * 0.36)
      ctx.lineTo(cx, cy + u * 0.05)
      ctx.lineTo(cx + u * 0.1, cy + u * 0.36)
      ctx.closePath()
      fillStroke(shade(main, -0.45))
      ctx.beginPath()
      ctx.moveTo(cx, cy - u * 0.32)
      ctx.lineTo(cx, cy - u * 0.46)
      ctx.lineTo(cx + u * 0.12, cy - u * 0.42)
      ctx.lineTo(cx, cy - u * 0.38)
      ctx.stroke()
      break
    }
  }
}

/** The plaza fountain at the spawn point. */
export function drawFountain(ctx: CanvasRenderingContext2D, cx: number, cy: number, u: number): void {
  ctx.lineWidth = Math.max(1, u * 0.04)
  ctx.strokeStyle = 'rgb(110, 100, 86)'
  ctx.fillStyle = 'rgb(214, 206, 190)'
  ctx.beginPath()
  ctx.ellipse(cx, cy + u * 0.1, u * 0.78, u * 0.42, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = 'rgb(120, 176, 214)'
  ctx.beginPath()
  ctx.ellipse(cx, cy + u * 0.1, u * 0.62, u * 0.31, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgb(214, 206, 190)'
  ctx.beginPath()
  ctx.rect(cx - u * 0.08, cy - u * 0.42, u * 0.16, u * 0.5)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  for (const dx of [-0.2, 0, 0.2]) {
    ctx.beginPath()
    ctx.arc(cx + dx * u, cy - u * 0.48 + Math.abs(dx) * u * 0.5, u * 0.07, 0, Math.PI * 2)
    ctx.fill()
  }
}
