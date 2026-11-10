import { useEffect, useRef, useState } from 'react'
import { drawLandmark, LANDMARK_LABEL, LANDMARK_TOP, landmarkWidth, type LandmarkKind } from '../map/landmarks'
import type { FogMode } from '../logic/save'
import { useStore } from '../store'

/** Landmarks by where they appear. */
const BIOMES: [string, LandmarkKind[]][] = [
  ['Towns', ['cottage', 'shop', 'tower', 'dome', 'barn', 'cabin']],
  ['Countryside', ['tree', 'blossom', 'fruit', 'pine', 'haystack', 'lily']],
  ['Wilds', ['rock', 'mountain', 'dune', 'mesa', 'crystal', 'cloud']],
]

function LandmarkIcon({ kind }: { kind: LandmarkKind }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    const dpr = window.devicePixelRatio || 1
    const size = 36
    const u = 19
    c.width = size * dpr
    c.height = size * dpr
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cy = Math.max(size - u * 0.5, u * LANDMARK_TOP[kind] + 2)
    drawLandmark(g, kind, size / 2, Math.min(cy, size - u * 0.42), {
      u,
      w: Math.min(size - 2, landmarkWidth(kind, 0.72) * u),
      tint: [150, 170, 140],
      h: 0.37,
      muted: 0,
    })
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
              <span className="sw learned">★</span> learned — gold plaque
            </li>
            <li>
              <span className="sw active" /> quest in progress — blue plaque, dots show stages done
            </li>
            <li>
              <span className="sw revealed" /> discovered — the word, no plaque
            </li>
            <li>
              <span className="sw frontier">?</span> faded: not discovered yet
            </li>
            <li>
              <span className="sw due">!</span> quest waiting: discovered, no points yet
            </li>
            <li>
              <span className="sw hall">⚑</span> region hall — sentences and challenge
            </li>
          </ul>
          {BIOMES.map(([name, kinds]) => (
            <div key={name}>
              <div className="legend-head">{name}</div>
              <ul className="shapes">
                {kinds.map((k) => (
                  <li key={k}>
                    <LandmarkIcon kind={k} /> {LANDMARK_LABEL[k]}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="muted">
            Each word lives in a landmark that fits the ground around it. The fountain is the start: HSK 1 towns
            surround it, each level is a ring of towns farther out (split by bold borders), and HSK 7–9 is the
            wilderness at the edge.
          </p>
        </div>
      ) : null}
    </div>
  )
}
