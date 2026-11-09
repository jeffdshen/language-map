import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { emitCamera, loadCamera, saveCamera } from './camera'
import { Minimap } from './Minimap'
import { MapRenderer } from './renderer'

const MOVE_KEYS: Record<string, [number, number]> = {
  w: [0, -1],
  a: [-1, 0],
  s: [0, 1],
  d: [1, 0],
  arrowup: [0, -1],
  arrowleft: [-1, 0],
  arrowdown: [0, 1],
  arrowright: [1, 0],
}

/** Cells per second when walking with the keyboard. */
const WALK_SPEED = 14

function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  const tag = el?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable
}

export function MapView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<MapRenderer | null>(null)
  const panelOpen = useStore((s) => s.selected !== null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const renderer = new MapRenderer(canvas)
    rendererRef.current = renderer
    const packName = useStore.getState().pack!.manifest.pack

    const sync = () => {
      const s = useStore.getState()
      if (!s.pack || !s.view) return
      renderer.setState({
        pack: s.pack,
        view: s.view,
        settings: s.save.settings,
        selected: s.selected,
        hovered: s.hovered,
      })
    }

    // Report the camera to overlays every frame, and remember it once it settles.
    let saveTimer = 0
    renderer.onCamera = (cam) => {
      emitCamera(cam)
      useStore.getState().setFocus(cam.x, cam.y)
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => saveCamera(packName, { x: cam.x, y: cam.y, zoom: cam.scale / cam.base }), 400)
    }

    const unsub = useStore.subscribe((s, prev) => {
      if (
        s.pack !== prev.pack ||
        s.view !== prev.view ||
        s.save.settings !== prev.save.settings ||
        s.selected !== prev.selected ||
        s.hovered !== prev.hovered
      ) {
        sync()
      }
      if (s.selected !== null && s.selected !== prev.selected && s.selectedFrom === 'map' && s.pack) {
        const w = s.pack.words[s.selected]
        renderer.keepVisible(w.x, w.y, true)
      }
      if (s.camera && s.camera !== prev.camera) {
        renderer.flyTo(s.camera.x, s.camera.y, { resetZoom: s.camera.resetZoom, panelOpen: s.selected !== null })
      }
    })

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1)
      const s = useStore.getState()
      if (s.selected !== null && s.pack) {
        const w = s.pack.words[s.selected]
        renderer.keepVisible(w.x, w.y, true)
      }
    }
    sync()
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    {
      const s = useStore.getState()
      const saved = loadCamera(packName)
      const [sx, sy] = s.pack!.world.spawn
      if (saved) renderer.jump(saved.x, saved.y, saved.zoom)
      else renderer.jump(sx, sy)
      if (s.camera) renderer.flyTo(s.camera.x, s.camera.y, { resetZoom: s.camera.resetZoom, panelOpen: s.selected !== null })
    }

    // ---- pointer interaction: pan, pinch, click, hover
    const pointers = new Map<number, { x: number; y: number }>()
    let dragged = false
    let downAt = { x: 0, y: 0 }
    let pinchDist = 0

    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const onDown = (e: PointerEvent) => {
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // Synthetic or already-released pointers can't be captured; panning still works without it.
      }
      const p = local(e)
      pointers.set(e.pointerId, p)
      if (pointers.size === 1) {
        dragged = false
        downAt = p
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
        dragged = true
      }
    }

    const onMove = (e: PointerEvent) => {
      const p = local(e)
      const prev = pointers.get(e.pointerId)
      if (!prev) {
        const hit = renderer.hitTest(p.x, p.y)
        useStore.getState().hover(hit)
        canvas.style.cursor = hit !== null ? 'pointer' : 'grab'
        return
      }
      if (pointers.size === 1) {
        if (!dragged && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 4) dragged = true
        if (dragged) {
          renderer.panBy(p.x - prev.x, p.y - prev.y)
          canvas.style.cursor = 'grabbing'
        }
      } else if (pointers.size === 2) {
        const others = [...pointers.entries()].filter(([id]) => id !== e.pointerId)
        const o = others[0][1]
        const d = Math.hypot(p.x - o.x, p.y - o.y)
        const midPrev = { x: (prev.x + o.x) / 2, y: (prev.y + o.y) / 2 }
        const mid = { x: (p.x + o.x) / 2, y: (p.y + o.y) / 2 }
        renderer.panBy(mid.x - midPrev.x, mid.y - midPrev.y)
        if (pinchDist > 0) renderer.zoomAt(mid.x, mid.y, d / pinchDist)
        pinchDist = d
      }
      pointers.set(e.pointerId, p)
    }

    const onUp = (e: PointerEvent) => {
      const p = local(e)
      const had = pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchDist = 0
      if (had && pointers.size === 0 && !dragged) {
        const hit = renderer.hitTest(p.x, p.y)
        useStore.getState().select(hit, 'map')
      }
      canvas.style.cursor = 'grab'
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      renderer.zoomAt(p.x, p.y, Math.exp(-delta * 0.0015))
    }

    const onDbl = (e: MouseEvent) => {
      const p = local(e)
      renderer.zoomAt(p.x, p.y, 1.4)
    }

    const onLeave = () => useStore.getState().hover(null)

    // ---- keyboard: walk with WASD / arrow keys, zoom with + and -
    const held = new Set<string>()
    let walkRaf = 0
    let last = 0
    const walk = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60
      last = now
      let dx = 0
      let dy = 0
      for (const key of held) {
        dx += MOVE_KEYS[key][0]
        dy += MOVE_KEYS[key][1]
      }
      const len = Math.hypot(dx, dy)
      if (len > 0) renderer.panCells((dx / len) * WALK_SPEED * dt, (dy / len) * WALK_SPEED * dt)
      if (held.size) walkRaf = requestAnimationFrame(walk)
      else {
        walkRaf = 0
        last = 0
      }
    }
    const blocked = () => {
      const s = useStore.getState()
      return s.quest !== null || s.modal !== null
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || blocked()) return
      const key = e.key.toLowerCase()
      if (key in MOVE_KEYS) {
        e.preventDefault()
        held.add(key)
        if (!walkRaf) walkRaf = requestAnimationFrame(walk)
      } else if (key === '+' || key === '=') renderer.zoomBy(1.25)
      else if (key === '-' || key === '_') renderer.zoomBy(1 / 1.25)
    }
    const onKeyUp = (e: KeyboardEvent) => held.delete(e.key.toLowerCase())
    const onBlur = () => held.clear()

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDbl)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      unsub()
      ro.disconnect()
      renderer.destroy()
      window.clearTimeout(saveTimer)
      if (walkRaf) cancelAnimationFrame(walkRaf)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dblclick', onDbl)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className="map-canvas" aria-label="Vocabulary map" />
      <div className={`map-hud ${panelOpen ? 'panel-open' : ''}`}>
        <div className="zoom-controls">
          <button type="button" title="Zoom in (+)" aria-label="Zoom in" onClick={() => rendererRef.current?.zoomBy(1.25)}>
            +
          </button>
          <button type="button" title="Zoom out (−)" aria-label="Zoom out" onClick={() => rendererRef.current?.zoomBy(1 / 1.25)}>
            −
          </button>
          <button type="button" title="Back to the start (H)" aria-label="Back to the start" onClick={() => useStore.getState().flyHome()}>
            ⌂
          </button>
        </div>
        <Minimap />
      </div>
    </>
  )
}
