import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '../store'
import { levelLabel } from '../ui/text'
import { onCamera } from './camera'
import { landBounds, OVERVIEW_COLORS, renderOverview } from './overview'
import type { CameraInfo } from './renderer'

/** Overview pixels per cell (also the minimap's on-screen scale, in CSS px). */
const K = 3

/** Local map around the player, plus the current region and its progress. Click to open the world map. */
export function Minimap() {
  const pack = useStore((s) => s.pack!)
  const view = useStore((s) => s.view!)
  const here = useStore((s) => s.here)
  const setModal = useStore((s) => s.setModal)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const image = useMemo(() => renderOverview(pack, view, { k: K, words: true }), [pack, view])
  const camRef = useRef<CameraInfo | null>(null)

  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = 0
      const c = canvasRef.current
      const cam = camRef.current
      if (!c || !cam) return
      const dpr = window.devicePixelRatio || 1
      const W = c.clientWidth
      const H = c.clientHeight
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr)
        c.height = Math.round(H * dpr)
      }
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = OVERVIEW_COLORS.sea
      g.fillRect(0, 0, W, H)
      const b = landBounds(pack.world)
      const ox = Math.round(W / 2 - (cam.x - b.x0 + 0.5) * K)
      const oy = Math.round(H / 2 - (cam.y - b.y0 + 0.5) * K)
      g.imageSmoothingEnabled = false
      g.drawImage(image, ox, oy)
      const [sx, sy] = pack.world.spawn
      g.fillStyle = '#ffffff'
      g.strokeStyle = '#2b4c6f'
      g.lineWidth = 1.5
      g.beginPath()
      g.arc(ox + (sx - b.x0 + 0.5) * K, oy + (sy - b.y0 + 0.5) * K, 3.5, 0, Math.PI * 2)
      g.fill()
      g.stroke()
      const vw = cam.cols * K
      const vh = cam.rows * K
      g.lineWidth = 2
      g.strokeStyle = 'rgba(20, 16, 10, 0.55)'
      g.strokeRect(W / 2 - vw / 2, H / 2 - vh / 2, vw, vh)
      g.lineWidth = 1.2
      g.strokeStyle = '#ffffff'
      g.strokeRect(W / 2 - vw / 2, H / 2 - vh / 2, vw, vh)
    }
    const off = onCamera((cam) => {
      camRef.current = cam
      if (!raf) raf = requestAnimationFrame(draw)
    })
    if (!raf) raf = requestAnimationFrame(draw)
    return () => {
      off()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [pack, image])

  const r = here >= 0 ? pack.world.regions[here] : null
  const learned = r ? view.regionLearned[r.id] : 0
  const seen = r ? view.regionSeen[r.id] : 0
  return (
    <div className="minimap">
      {r ? (
        <div className="region-hud" style={{ ['--region' as string]: r.color }}>
          <div className="region-name">
            <span className="zh" lang="zh-Hans">
              {r.zh}
            </span>
            <span className="en">{r.en}</span>
          </div>
          <div className="region-meta">
            {levelLabel(r.level)} · {r.kind === 'wild' ? 'wilderness' : 'town'} · {r.count} words
          </div>
          <div className="progress" title={`${learned} of ${r.count} learned, ${seen} discovered`}>
            <span className="seen" style={{ width: `${(100 * seen) / r.count}%` }} />
            <span className="learned" style={{ width: `${(100 * learned) / r.count}%` }} />
          </div>
          <div className="region-meta">
            ⭐ {learned}/{r.count} learned · 🧭 {seen} found
          </div>
        </div>
      ) : null}
      <button type="button" className="minimap-btn" onClick={() => setModal('map')} title="World map (M)" aria-label="Open the world map">
        <canvas ref={canvasRef} />
        <span className="minimap-label">🗺️ Map</span>
      </button>
    </div>
  )
}
