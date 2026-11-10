import { useEffect, useRef } from 'react'
import {
  clampView,
  fillRegion,
  landBounds,
  MAX_OVERVIEW_ZOOM,
  regionOutline,
  viewCellAt,
  viewScale,
  zoomViewAt,
  type Bounds,
  type OverviewView,
} from '../map/overview'
import { useStore } from '../store'

export interface Mark {
  x: number
  y: number
  fill: string
  stroke: string
}

const FIT: OverviewView = { z: 1, ox: 0, oy: 0 }
const ZOOM_STEP = 1.6
/** Pointer travel (px) before a press counts as a drag rather than a click. */
const DRAG_SLOP = 6
const LABEL_FONT = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const d = i % 2 ? r * 0.45 : r
    g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d)
  }
  g.closePath()
}

/**
 * The simplified world map scaled to fit its container. Reports the hovered/clicked cell; can highlight a region,
 * show "you are here", and draw word markers. `crop` shows only part of the world (in cells). `zoomable` adds
 * wheel/pinch/keyboard zoom, drag to pan, and zoom buttons.
 */
export function OverviewCanvas({
  image,
  highlight = -1,
  here,
  marks,
  labels = true,
  crop,
  zoomable = false,
  onHover,
  onPick,
}: {
  image: HTMLCanvasElement
  highlight?: number
  here?: [number, number] | null
  marks?: Mark[]
  labels?: boolean
  crop?: Bounds
  zoomable?: boolean
  onHover?: (cell: [number, number] | null) => void
  onPick?: (cell: [number, number]) => void
}) {
  const pack = useStore((s) => s.pack!)
  const view = useStore((s) => s.view!)
  const ref = useRef<HTMLCanvasElement>(null)
  const vref = useRef<OverviewView>(FIT)
  const drawRef = useRef<() => void>(() => {})
  const frame = useRef(0)
  const land = landBounds(pack.world)
  const b = crop ?? land

  const redraw = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      drawRef.current()
    })
  }

  useEffect(() => {
    const c = ref.current!
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const W = c.clientWidth
      const H = c.clientHeight
      if (!W || !H) return
      const cw = Math.round(W * dpr)
      const ch = Math.round(H * dpr)
      if (c.width !== cw) c.width = cw
      if (c.height !== ch) c.height = ch
      const v = (vref.current = clampView(vref.current, b, W, H))
      const s = viewScale(b, W, H, v.z)
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, W, H)
      const k = image.width / land.w
      // Keep cells crisp once they are drawn bigger than in the source image.
      g.imageSmoothingEnabled = s * dpr < k
      g.drawImage(image, (b.x0 - land.x0) * k, (b.y0 - land.y0) * k, b.w * k, b.h * k, v.ox, v.oy, b.w * s, b.h * s)
      const px = (x: number) => (x - b.x0 + 0.5) * s + v.ox
      const py = (y: number) => (y - b.y0 + 0.5) * s + v.oy
      const hl = highlight >= 0 ? pack.world.regions[highlight] : undefined
      if (hl) {
        g.setTransform(dpr * s, 0, 0, dpr * s, dpr * v.ox, dpr * v.oy)
        fillRegion(g, pack.world, hl.id, b, 'rgba(255, 255, 255, 0.3)')
        const seg = regionOutline(pack.world, hl.id)
        g.beginPath()
        for (let n = 0; n < seg.length; n += 4) {
          g.moveTo(seg[n] - b.x0, seg[n + 1] - b.y0)
          g.lineTo(seg[n + 2] - b.x0, seg[n + 3] - b.y0)
        }
        g.lineCap = 'square'
        g.lineJoin = 'miter'
        g.lineWidth = 5 / s
        g.strokeStyle = 'rgba(24, 18, 10, 0.9)'
        g.stroke()
        g.lineWidth = 2.25 / s
        g.strokeStyle = '#ffffff'
        g.stroke()
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.lineJoin = 'round'
      if (labels && s >= 1.6) {
        const font = Math.max(9, Math.min(13, s * 4.2))
        g.font = `700 ${font}px ${LABEL_FONT}`
        for (const r of pack.world.regions) {
          // Only label regions big enough to hold their name; the highlighted one gets its own label below.
          if (r === hl || r.cells * s * s < font * font * r.zh.length * 3.2) continue
          const x = px(r.x)
          const y = py(r.y)
          if (x < -40 || y < -20 || x > W + 40 || y > H + 20) continue
          const seen = view.regionSeen[r.id] > 0
          g.lineWidth = 3
          g.strokeStyle = 'rgba(255, 252, 244, 0.8)'
          g.fillStyle = seen ? 'rgba(40, 28, 12, 0.92)' : 'rgba(90, 80, 64, 0.6)'
          g.strokeText(r.zh, x, y)
          g.fillText(r.zh, x, y)
        }
      }
      for (const m of marks ?? []) {
        g.beginPath()
        g.arc(px(m.x), py(m.y), Math.max(3.5, s * 0.9), 0, Math.PI * 2)
        g.fillStyle = m.fill
        g.fill()
        g.lineWidth = 1
        g.strokeStyle = m.stroke
        g.stroke()
      }
      const [sx, sy] = pack.world.spawn
      g.beginPath()
      g.arc(px(sx), py(sy), 4, 0, Math.PI * 2)
      g.fillStyle = '#ffffff'
      g.fill()
      g.lineWidth = 1.5
      g.strokeStyle = '#2b4c6f'
      g.stroke()
      if (hl) {
        // A star on the region's hall plus its name, so even tiny regions stand out.
        const x = px(hl.x)
        const y = py(hl.y)
        const r = 8
        star(g, x, y, r)
        g.lineJoin = 'round'
        g.lineWidth = 3
        g.strokeStyle = 'rgba(24, 18, 10, 0.9)'
        g.stroke()
        g.fillStyle = '#ffd23f'
        g.fill()
        if (labels) {
          const font = 15
          g.font = `800 ${font}px ${LABEL_FONT}`
          const ly = y + r + font / 2 + 3
          g.lineWidth = 4.5
          g.strokeStyle = 'rgba(24, 18, 10, 0.9)'
          g.strokeText(hl.zh, x, ly)
          g.fillStyle = '#ffffff'
          g.fillText(hl.zh, x, ly)
        }
      }
      if (here) {
        const x = px(here[0])
        const y = py(here[1])
        g.beginPath()
        g.moveTo(x, y)
        g.bezierCurveTo(x - 9, y - 11, x - 8, y - 22, x, y - 22)
        g.bezierCurveTo(x + 8, y - 22, x + 9, y - 11, x, y)
        g.fillStyle = '#d63a2f'
        g.fill()
        g.lineWidth = 1.5
        g.strokeStyle = '#ffffff'
        g.stroke()
        g.beginPath()
        g.arc(x, y - 15, 3, 0, Math.PI * 2)
        g.fillStyle = '#ffffff'
        g.fill()
      }
    }
    drawRef.current = draw
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(c)
    return () => ro.disconnect()
  }, [image, highlight, here, marks, labels, pack, view, b, land])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const box = () => {
    const c = ref.current!
    return { W: c.clientWidth, H: c.clientHeight, rect: c.getBoundingClientRect() }
  }
  const zoomBy = (factor: number, at?: [number, number]) => {
    const { W, H } = box()
    if (!W || !H) return
    const [x, y] = at ?? [W / 2, H / 2]
    vref.current = zoomViewAt(vref.current, b, W, H, x, y, factor)
    redraw()
  }
  const panBy = (dx: number, dy: number) => {
    const { W, H } = box()
    const v = vref.current
    vref.current = clampView({ z: v.z, ox: v.ox + dx, oy: v.oy + dy }, b, W, H)
    redraw()
  }
  const cellAt = (clientX: number, clientY: number): [number, number] | null => {
    const { W, H, rect } = box()
    return viewCellAt(vref.current, b, W, H, clientX - rect.left, clientY - rect.top)
  }

  // Wheel zoom needs a non-passive listener so it can stop the modal from scrolling.
  useEffect(() => {
    if (!zoomable) return
    const c = ref.current!
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? c.clientHeight : 1
      const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015))
      e.preventDefault()
      const rect = c.getBoundingClientRect()
      zoomBy(factor, [e.clientX - rect.left, e.clientY - rect.top])
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  })

  useEffect(() => {
    if (!zoomable) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP)
      else if (e.key === '-' || e.key === '_') zoomBy(1 / ZOOM_STEP)
      else if (e.key === '0') zoomBy(1 / MAX_OVERVIEW_ZOOM)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Active pointers (canvas-local positions) and whether the current press has turned into a drag or pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef({ x: 0, y: 0, dragged: false })

  const local = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const pair = () => {
    const [p, q] = [...pointers.current.values()]
    return { mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2, d: Math.hypot(p.x - q.x, p.y - q.y) }
  }

  const canvas = (
    <canvas
      ref={ref}
      className={`overview-canvas${zoomable ? ' zoomable' : ''}`}
      style={{ aspectRatio: `${b.w} / ${b.h}` }}
      onPointerDown={
        zoomable
          ? (e) => {
              if (e.pointerType === 'mouse' && e.button !== 0) return
              try {
                ref.current!.setPointerCapture(e.pointerId)
              } catch {
                // The pointer may already be gone; dragging still works while it stays over the canvas.
              }
              const p = local(e)
              pointers.current.set(e.pointerId, p)
              if (pointers.current.size === 1) gesture.current = { ...p, dragged: false }
              else gesture.current.dragged = true
            }
          : undefined
      }
      onPointerMove={(e) => {
        const ps = pointers.current
        const prev = ps.get(e.pointerId)
        if (!zoomable || !prev) {
          if (onHover) onHover(cellAt(e.clientX, e.clientY))
          return
        }
        const p = local(e)
        if (ps.size >= 2) {
          const before = pair()
          ps.set(e.pointerId, p)
          const after = pair()
          const { W, H } = box()
          const v = zoomViewAt(vref.current, b, W, H, after.mx, after.my, before.d > 0 ? after.d / before.d : 1)
          vref.current = clampView({ z: v.z, ox: v.ox + after.mx - before.mx, oy: v.oy + after.my - before.my }, b, W, H)
          redraw()
          return
        }
        ps.set(e.pointerId, p)
        const gs = gesture.current
        if (!gs.dragged && Math.hypot(p.x - gs.x, p.y - gs.y) > DRAG_SLOP) {
          gs.dragged = true
          panBy(p.x - gs.x, p.y - gs.y)
        } else if (gs.dragged) panBy(p.x - prev.x, p.y - prev.y)
        ref.current!.classList.toggle('dragging', gs.dragged)
      }}
      onPointerUp={
        zoomable
          ? (e) => {
              pointers.current.delete(e.pointerId)
              if (!pointers.current.size) ref.current!.classList.remove('dragging')
            }
          : undefined
      }
      onPointerCancel={
        zoomable
          ? (e) => {
              pointers.current.delete(e.pointerId)
              gesture.current.dragged = true
              if (!pointers.current.size) ref.current!.classList.remove('dragging')
            }
          : undefined
      }
      onPointerLeave={onHover ? (e) => !pointers.current.has(e.pointerId) && onHover(null) : undefined}
      onClick={
        onPick
          ? (e) => {
              if (zoomable && gesture.current.dragged) return
              const cell = cellAt(e.clientX, e.clientY)
              if (cell) onPick(cell)
            }
          : undefined
      }
    />
  )
  if (!zoomable) return canvas
  return (
    <div className="overview-zoom">
      {canvas}
      <div className="overview-zoom-btns" role="group" aria-label="Map zoom">
        <button type="button" title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
          +
        </button>
        <button type="button" title="Zoom out (−)" aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
          −
        </button>
        <button type="button" title="Fit whole map (0)" aria-label="Fit whole map" onClick={() => zoomBy(1 / MAX_OVERVIEW_ZOOM)}>
          ⤢
        </button>
      </div>
    </div>
  )
}
