import type { Geometry, Regions } from '../data/types'

const TAU = Math.PI * 2

/** numpy.interp semantics: piecewise linear, clamped at the ends. */
export function interp(x: number, xs: number[], ys: number[]): number {
  const n = xs.length
  if (x <= xs[0]) return ys[0]
  if (x >= xs[n - 1]) return ys[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo])
  return ys[lo] + f * (ys[hi] - ys[lo])
}

export function unwrapAngle(theta: number, theta0: number): number {
  return theta0 + ((((theta - theta0) % TAU) + TAU) % TAU)
}

/** Boundary angle of sector edge `t` (0..K) at radius r. */
export function boundaryAngle(geo: Geometry, r: number, t: number): number {
  return interp(
    r,
    geo.mids,
    geo.bounds.map((row) => row[t]),
  )
}

/** Theme (sector) index at world point. */
export function themeAt(geo: Geometry, x: number, y: number): number {
  const r = Math.hypot(x, y)
  const th = unwrapAngle(Math.atan2(y, x), geo.theta0)
  const k = geo.bounds[0].length - 1
  for (let t = 0; t < k; t++) if (th < boundaryAngle(geo, r, t + 1)) return t
  return k - 1
}

export function levelAt(geo: Geometry, r: number): number {
  for (let l = 1; l < geo.radii.length; l++) if (r < geo.radii[l]) return l
  return geo.radii.length - 1
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1). Deterministic. */
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

/** Wobbly coastline radius as a function of angle (periodic, deterministic). */
export function coastRadius(worldRadius: number, theta: number): number {
  let n = 0
  for (let k = 3; k <= 13; k++) {
    const phase = hash2(k, 7, 3) * TAU
    n += Math.sin(k * theta + phase) / Math.sqrt(k)
  }
  return worldRadius + 3.2 + 1.3 * n
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

export function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function rgb(c: [number, number, number], alpha = 1): string {
  const [r, g, b] = c.map((v) => Math.round(Math.max(0, Math.min(255, v))))
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`
}

export const PARCHMENT: [number, number, number] = [246, 239, 222]
export const OCEAN: [number, number, number] = [158, 199, 217]
const OCEAN_DEEP: [number, number, number] = [120, 168, 196]
/** Open-sea color; the terrain bitmap fades to exactly this at its edges so it meets the canvas background seamlessly. */
export const OCEAN_FAR = mix(OCEAN, OCEAN_DEEP, 0.8)
const SAND: [number, number, number] = [236, 222, 186]
const PLAZA: [number, number, number] = [250, 245, 232]

/** Half-width of the square world area covered by the terrain bitmap. */
export function terrainExtent(regions: Regions): number {
  return regions.geometry.radii[regions.geometry.radii.length - 1] + 9
}

/** Rasterize land (regions × level rings), shore and ocean into a bitmap covering [-E, E]². */
export function renderTerrain(regions: Regions, size = 1600): HTMLCanvasElement {
  const geo = regions.geometry
  const E = terrainExtent(regions)
  const R = geo.radii[geo.radii.length - 1]
  const core = geo.radii[0]
  const k = regions.themes.length
  const colors = regions.themes.map((t) => hexToRgb(t.color))
  const levels = geo.radii.length - 1

  // Land color per (theme, level): inner rings lighter (settled), outer rings richer (wild).
  const land: [number, number, number][][] = colors.map((c) =>
    Array.from({ length: levels + 1 }, (_, l) => mix(c, PARCHMENT, Math.max(0.12, 0.62 - 0.07 * l))),
  )

  const oceanRamp = Array.from({ length: 64 }, (_, i) => mix(OCEAN, OCEAN_DEEP, i / 63))
  const plazaRamp = Array.from({ length: 64 }, (_, i) => mix(PLAZA, PARCHMENT, (i / 63) * 0.6))

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const data = img.data
  const px = (2 * E) / size
  const boundsT = Array.from({ length: k + 1 }, (_, t) => geo.bounds.map((row) => row[t]))
  // Sector edge angles sampled along the radius (finer than a pixel), so the pixel loop avoids interp().
  const rStep = px / 4
  const rSteps = Math.ceil((E * Math.SQRT2) / rStep) + 2
  const edgeLut = new Float64Array(rSteps * (k + 1))
  for (let i = 0; i < rSteps; i++) {
    for (let t = 0; t <= k; t++) edgeLut[i * (k + 1) + t] = interp(i * rStep, geo.mids, boundsT[t])
  }
  const COAST_STEPS = 2048
  const coast = new Float64Array(COAST_STEPS + 1)
  for (let s = 0; s <= COAST_STEPS; s++) coast[s] = coastRadius(R, (s / COAST_STEPS) * TAU - Math.PI)

  for (let py = 0; py < size; py++) {
    const y = -E + (py + 0.5) * px
    for (let pxi = 0; pxi < size; pxi++) {
      const x = -E + (pxi + 0.5) * px
      const r = Math.sqrt(x * x + y * y)
      const theta = Math.atan2(y, x)
      const cr = coast[Math.round(((theta + Math.PI) / TAU) * COAST_STEPS)]
      const n1 = valueNoise(x * 0.32, y * 0.32, 11)
      const n2 = valueNoise(x * 1.4, y * 1.4, 12)
      let tex = 1 + (n1 - 0.5) * 0.09 + (n2 - 0.5) * 0.05
      let c: [number, number, number]
      if (r > cr) {
        const edge = (Math.max(Math.abs(x), Math.abs(y)) - (E - 3)) / 3
        const depth = Math.min(1, Math.max((r - cr) / 6, edge))
        const m = depth * 0.8 + (n1 - 0.5) * 0.15 * (1 - depth)
        c = depth >= 1 ? OCEAN_FAR : oceanRamp[Math.max(0, Math.round(m * 63))]
        tex = 1 + (tex - 1) * (1 - depth)
      } else if (r > cr - 0.9) {
        c = SAND
      } else if (r < core) {
        c = plazaRamp[Math.round(n1 * 63)]
      } else {
        const base = Math.round(r / rStep) * (k + 1)
        const th = unwrapAngle(theta, geo.theta0)
        let t = 0
        while (t < k - 1 && th >= edgeLut[base + t + 1]) t++
        c = land[t][Math.min(levels, levelAt(geo, r))]
        // Gentle darkening toward the frontier.
        tex *= 1 - 0.07 * Math.max(0, (r - geo.radii[1]) / (R - geo.radii[1]))
      }
      const o = (py * size + pxi) * 4
      data[o] = c[0] * tex
      data[o + 1] = c[1] * tex
      data[o + 2] = c[2] * tex
      data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/** Polyline (world coords) of a sector boundary from the core to the coast. */
export function boundaryPath(geo: Geometry, t: number, step = 0.75): [number, number][] {
  const r0 = geo.radii[0]
  const r1 = geo.radii[geo.radii.length - 1] + 1.5
  const pts: [number, number][] = []
  const col = geo.bounds.map((row) => row[t])
  for (let r = r0; r <= r1 + 1e-9; r += step) {
    const a = interp(r, geo.mids, col)
    pts.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return pts
}
