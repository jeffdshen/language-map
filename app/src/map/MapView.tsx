import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { MapRenderer } from './renderer'

export function MapView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<MapRenderer | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const renderer = new MapRenderer(canvas)
    rendererRef.current = renderer

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
    let first = true
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
        renderer.flyTo(s.camera.x, s.camera.y, s.camera.scale, s.camera.minScale, s.selected !== null)
      }
      if (first && s.pack && s.view) {
        first = false
        renderer.home()
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
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    sync()
    if (useStore.getState().pack) {
      first = false
      renderer.home()
      const cam = useStore.getState().camera
      if (cam) renderer.flyTo(cam.x, cam.y, cam.scale, cam.minScale, useStore.getState().selected !== null)
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
      renderer.zoomAt(p.x, p.y, Math.exp(-delta * 0.0018))
    }

    const onDbl = (e: MouseEvent) => {
      const p = local(e)
      renderer.zoomAt(p.x, p.y, 2)
    }

    const onLeave = () => useStore.getState().hover(null)

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDbl)

    return () => {
      unsub()
      ro.disconnect()
      renderer.destroy()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dblclick', onDbl)
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className="map-canvas" aria-label="Vocabulary map" />
      <div className="zoom-controls">
        <button title="Zoom in (+)" onClick={() => rendererRef.current?.zoomBy(1.6)}>
          +
        </button>
        <button title="Zoom out (−)" onClick={() => rendererRef.current?.zoomBy(1 / 1.6)}>
          −
        </button>
        <button title="Back to the center (H)" onClick={() => useStore.getState().flyHome()}>
          ⌂
        </button>
      </div>
    </>
  )
}
