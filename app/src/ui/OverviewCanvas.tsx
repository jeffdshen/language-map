import { useEffect, useRef } from 'react'
import { landBounds, fillRegion, type Bounds } from '../map/overview'
import { useStore } from '../store'

export interface Mark {
  x: number
  y: number
  fill: string
  stroke: string
}

/**
 * The simplified world map scaled to fit its container. Reports the hovered/clicked cell; can highlight a region,
 * show "you are here", and draw word markers. `crop` shows only part of the world (in cells).
 */
export function OverviewCanvas({
  image,
  highlight = -1,
  here,
  marks,
  labels = true,
  crop,
  onHover,
  onPick,
}: {
  image: HTMLCanvasElement
  highlight?: number
  here?: [number, number] | null
  marks?: Mark[]
  labels?: boolean
  crop?: Bounds
  onHover?: (cell: [number, number] | null) => void
  onPick?: (cell: [number, number]) => void
}) {
  const pack = useStore((s) => s.pack!)
  const view = useStore((s) => s.view!)
  const ref = useRef<HTMLCanvasElement>(null)
  const land = landBounds(pack.world)
  const b = crop ?? land

  useEffect(() => {
    const c = ref.current!
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const W = c.clientWidth
      const H = c.clientHeight
      if (!W || !H) return
      c.width = Math.round(W * dpr)
      c.height = Math.round(H * dpr)
      const s = Math.min(W / b.w, H / b.h)
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, W, H)
      g.imageSmoothingEnabled = true
      const k = image.width / land.w
      g.drawImage(image, (b.x0 - land.x0) * k, (b.y0 - land.y0) * k, b.w * k, b.h * k, 0, 0, b.w * s, b.h * s)
      g.setTransform(dpr * s, 0, 0, dpr * s, 0, 0)
      if (highlight >= 0) fillRegion(g, pack.world, highlight, b, 'rgba(255, 255, 255, 0.42)')
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const px = (x: number) => (x - b.x0 + 0.5) * s
      const py = (y: number) => (y - b.y0 + 0.5) * s
      if (labels && s >= 1.6) {
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.lineJoin = 'round'
        const font = Math.max(9, Math.min(13, s * 4.2))
        g.font = `700 ${font}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`
        for (const r of pack.world.regions) {
          // Only label regions big enough to hold their name.
          if (r.cells * s * s < font * font * r.zh.length * 3.2) continue
          const seen = view.regionSeen[r.id] > 0
          g.lineWidth = 3
          g.strokeStyle = 'rgba(255, 252, 244, 0.8)'
          g.fillStyle = seen ? 'rgba(40, 28, 12, 0.92)' : 'rgba(90, 80, 64, 0.6)'
          g.strokeText(r.zh, px(r.x), py(r.y))
          g.fillText(r.zh, px(r.x), py(r.y))
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
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(c)
    return () => ro.disconnect()
  }, [image, highlight, here, marks, labels, pack, view, b, land])

  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] | null => {
    const c = ref.current!
    const rect = c.getBoundingClientRect()
    const s = Math.min(rect.width / b.w, rect.height / b.h)
    const x = Math.floor((e.clientX - rect.left) / s) + b.x0
    const y = Math.floor((e.clientY - rect.top) / s) + b.y0
    if (x < b.x0 || y < b.y0 || x >= b.x0 + b.w || y >= b.y0 + b.h) return null
    return [x, y]
  }

  return (
    <canvas
      ref={ref}
      className="overview-canvas"
      style={{ aspectRatio: `${b.w} / ${b.h}` }}
      onMouseMove={onHover ? (e) => onHover(cellAt(e)) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      onClick={
        onPick
          ? (e) => {
              const cell = cellAt(e)
              if (cell) onPick(cell)
            }
          : undefined
      }
    />
  )
}
