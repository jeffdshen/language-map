import { useEffect, useRef, useState } from 'react'
import { drawLandmark, LANDMARK_LABEL, type LandmarkKind } from '../map/draw'
import type { FogMode } from '../logic/save'
import { useStore } from '../store'

const KINDS = Object.keys(LANDMARK_LABEL) as LandmarkKind[]

function LandmarkIcon({ kind }: { kind: LandmarkKind }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    const dpr = window.devicePixelRatio || 1
    const size = 26
    c.width = size * dpr
    c.height = size * dpr
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawLandmark(g, kind, size / 2, size * 0.52, size, { color: [196, 120, 86], h: 0.37, muted: 0 })
  }, [kind])
  return <canvas ref={ref} className="landmark-icon" aria-hidden="true" />
}

export function Legend() {
  const [open, setOpen] = useState(false)
  const fogMode = useStore((s) => s.save.settings.fogMode)
  const updateSettings = useStore((s) => s.updateSettings)
  return (
    <div className={`legend ${open ? 'open' : ''}`}>
      <div className="fog-toggle" role="radiogroup" aria-label="Fog of war">
        <span className="label">Fog</span>
        {(['dim', 'hidden', 'off'] as FogMode[]).map((m) => (
          <button
            type="button"
            key={m}
            role="radio"
            aria-checked={fogMode === m}
            className={fogMode === m ? 'on' : ''}
            onClick={() => updateSettings({ fogMode: m })}
            title={
              m === 'off' ? 'Show every word' : m === 'dim' ? 'Show unexplored landmarks faded' : 'Hide unexplored words'
            }
          >
            {m === 'off' ? 'Off' : m === 'dim' ? 'Dim' : 'Hidden'}
          </button>
        ))}
        <button type="button" className="legend-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide legend' : 'Legend'}
        </button>
      </div>
      {open ? (
        <div className="legend-body">
          <ul>
            <li>
              <span className="sw learned">★</span> learned — gold name plate
            </li>
            <li>
              <span className="sw active" /> quest in progress — blue plate, pips show stages done
            </li>
            <li>
              <span className="sw revealed" /> discovered — white plate
            </li>
            <li>
              <span className="sw frontier">?</span> faded: not discovered yet
            </li>
            <li>
              <span className="sw due">!</span> quest due today
            </li>
          </ul>
          <ul className="shapes">
            {KINDS.map((k) => (
              <li key={k}>
                <LandmarkIcon kind={k} /> {LANDMARK_LABEL[k]}
              </li>
            ))}
          </ul>
          <p className="muted">
            The fountain is the start. HSK 1 towns surround it; each level is a ring of towns farther out, split by
            bold borders, and HSK 7–9 is the wilderness at the edge. Towns group words by topic.
          </p>
        </div>
      ) : null}
    </div>
  )
}
