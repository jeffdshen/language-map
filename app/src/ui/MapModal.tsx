import { useMemo, useState } from 'react'
import { regionAt } from '../data/pack'
import type { Region } from '../data/types'
import { currentCamera } from '../map/camera'
import { renderOverview } from '../map/overview'
import { useStore } from '../store'
import { Modal } from './common'
import { OverviewCanvas } from './OverviewCanvas'
import { levelLabel } from './text'

export function MapModal() {
  const modal = useStore((s) => s.modal)
  if (modal !== 'map') return null
  return <MapModalInner />
}

function MapModalInner() {
  const pack = useStore((s) => s.pack!)
  const view = useStore((s) => s.view!)
  const here = useStore((s) => s.here)
  const { setModal, flyToCell } = useStore.getState()
  const { world } = pack
  const image = useMemo(() => renderOverview(pack, view, { k: 3, words: true }), [pack, view])
  const [hover, setHover] = useState(-1)
  const herePos = useMemo((): [number, number] | null => {
    const cam = currentCamera()
    return cam ? [cam.x, cam.y] : null
  }, [])
  const travel = (x: number, y: number) => {
    flyToCell(x, y)
    setModal(null)
  }
  const byLevel = useMemo(() => {
    const out = new Map<number, Region[]>()
    for (const r of world.regions) {
      if (!out.has(r.level)) out.set(r.level, [])
      out.get(r.level)!.push(r)
    }
    return [...out.entries()].sort((a, b) => a[0] - b[0])
  }, [world])
  const focus = hover >= 0 ? hover : here
  const info = focus >= 0 ? world.regions[focus] : null

  return (
    <Modal title="🗺️ World map" onClose={() => setModal(null)} className="map-modal">
      <div className="map-layout">
        <div className="map-main">
          <OverviewCanvas
            image={image}
            highlight={focus}
            here={herePos}
            onHover={(cell) => setHover(cell ? regionAt(world, cell[0], cell[1]) : -1)}
            onPick={([x, y]) => {
              if (regionAt(world, x, y) >= 0) travel(x, y)
            }}
          />
          <div className="map-info">
            {info ? (
              <>
                <b lang="zh-Hans">{info.zh}</b> {info.en}
                <span className="muted">
                  {' '}
                  · {levelLabel(info.level)} {info.kind === 'wild' ? 'wilderness' : 'town'} · ⭐ {view.regionLearned[info.id]}/
                  {info.count} learned · 🧭 {view.regionSeen[info.id]} found
                  {info.id === here ? ' · 📍 you are here' : ''}
                </span>
              </>
            ) : (
              <span className="muted">Hover a region to see its progress; click to travel there.</span>
            )}
          </div>
          <p className="muted map-key">
            <span className="key-sw parchment" /> unexplored <span className="key-sw explored" /> explored{' '}
            <span className="key-sw gold" /> learned · white squares are discovered words, gold ones learned. Thick borders
            separate HSK levels; the center is HSK 1.
          </p>
        </div>
        <div className="region-list">
          {byLevel.map(([level, regions]) => {
            const total = regions.reduce((n, r) => n + r.count, 0)
            const learned = regions.reduce((n, r) => n + view.regionLearned[r.id], 0)
            return (
              <section key={level}>
                <h4>
                  {levelLabel(level)}
                  <span className="muted">
                    {' '}
                    {regions.length} {level >= 7 ? 'wilds' : 'towns'} · {learned}/{total}
                  </span>
                </h4>
                <ul>
                  {regions.map((r) => (
                    <RegionRow
                      key={r.id}
                      r={r}
                      learned={view.regionLearned[r.id]}
                      seen={view.regionSeen[r.id]}
                      here={r.id === here}
                      onHover={(on) => setHover(on ? r.id : -1)}
                      onClick={() => travel(r.x, r.y)}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

export function RegionRow({
  r,
  learned,
  seen,
  total = r.count,
  here,
  onHover,
  onClick,
  note,
}: {
  r: Region
  learned: number
  seen: number
  total?: number
  here?: boolean
  onHover?: (on: boolean) => void
  onClick: () => void
  note?: string
}) {
  return (
    <li>
      <button
        type="button"
        className={`region-row ${here ? 'here' : ''}`}
        style={{ ['--region' as string]: r.color }}
        onMouseEnter={onHover ? () => onHover(true) : undefined}
        onMouseLeave={onHover ? () => onHover(false) : undefined}
        onFocus={onHover ? () => onHover(true) : undefined}
        onBlur={onHover ? () => onHover(false) : undefined}
        onClick={onClick}
        title={`${r.en} — ${learned}/${total} learned, ${seen} found`}
      >
        <span className="swatch" />
        <span className="name">
          <span className="zh" lang="zh-Hans">
            {r.zh}
          </span>
          <span className="en">
            {here ? '📍 ' : ''}
            {r.en}
            {note ? ` · ${note}` : ''}
          </span>
        </span>
        <span className="progress">
          <span className="seen" style={{ width: `${(100 * seen) / total}%` }} />
          <span className="learned" style={{ width: `${(100 * learned) / total}%` }} />
        </span>
        <span className="count">
          {learned}/{total}
        </span>
      </button>
    </li>
  )
}
