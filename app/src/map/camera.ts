import type { CameraInfo } from './renderer'

/** Per-frame camera updates for overlays (the minimap), kept out of React state. */
type Listener = (cam: CameraInfo) => void

const listeners = new Set<Listener>()
let last: CameraInfo | null = null

export function emitCamera(cam: CameraInfo): void {
  last = cam
  for (const fn of listeners) fn(cam)
}

export function onCamera(fn: Listener): () => void {
  listeners.add(fn)
  if (last) fn(last)
  return () => listeners.delete(fn)
}

export interface SavedCamera {
  x: number
  y: number
  zoom: number
}

const key = (pack: string) => `language-map:camera:${pack}`

export function loadCamera(pack: string): SavedCamera | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key(pack)) ?? 'null') as Partial<SavedCamera> | null
    if (!raw || ![raw.x, raw.y, raw.zoom].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
    return raw as SavedCamera
  } catch {
    return null
  }
}

export function saveCamera(pack: string, cam: SavedCamera): void {
  try {
    localStorage.setItem(key(pack), JSON.stringify({ x: +cam.x.toFixed(2), y: +cam.y.toFixed(2), zoom: +cam.zoom.toFixed(3) }))
  } catch {
    // Storage full or blocked; the camera simply starts at the spawn point next time.
  }
}

/** Last camera reported by the map, if any. */
export function currentCamera(): CameraInfo | null {
  return last
}
