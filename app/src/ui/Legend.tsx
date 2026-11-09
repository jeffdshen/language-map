import { useState } from 'react'
import type { FogMode } from '../logic/save'
import { useStore } from '../store'

const SHAPES: [string, string][] = [
  ['●', 'noun'],
  ['◆', 'verb'],
  ['⬢', 'adjective'],
  ['▲', 'adverb'],
  ['■', 'number / measure'],
  ['⬭', 'function word'],
  ['👤', 'pronoun'],
  ['▭', 'phrase'],
]

export function Legend() {
  const [open, setOpen] = useState(false)
  const fogMode = useStore((s) => s.save.settings.fogMode)
  const updateSettings = useStore((s) => s.updateSettings)
  return (
    <div className={`legend ${open ? 'open' : ''}`}>
      <div className="fog-toggle" role="radiogroup" aria-label="Fog of war">
        <span className="label">Fog</span>
        {(['off', 'dim', 'hidden'] as FogMode[]).map((m) => (
          <button
            type="button"
            key={m}
            role="radio"
            aria-checked={fogMode === m}
            className={fogMode === m ? 'on' : ''}
            onClick={() => updateSettings({ fogMode: m })}
            title={
              m === 'off' ? 'Show every word' : m === 'dim' ? 'Show unexplored words faded' : 'Hide unexplored words'
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
              <span className="sw learned" /> learned
            </li>
            <li>
              <span className="sw active" /> quest in progress
            </li>
            <li>
              <span className="sw revealed" /> discovered
            </li>
            <li>
              <span className="sw frontier">?</span> undiscovered, next to explored words
            </li>
            <li>
              <span className="sw due">!</span> quest due today
            </li>
          </ul>
          <ul className="shapes">
            {SHAPES.map(([s, label]) => (
              <li key={label}>
                <span className="shape">{s}</span> {label}
              </li>
            ))}
          </ul>
          <p className="muted">
            Center = HSK 1, outward = harder. Regions group words by topic; lines show which simpler word a word branches
            from.
          </p>
        </div>
      ) : null}
    </div>
  )
}
