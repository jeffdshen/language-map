import { useMemo } from 'react'
import { Vis } from '../logic/explore'
import { landBounds, renderOverview, type Bounds } from '../map/overview'
import { STATUS_COLORS } from '../map/renderer'
import { useStore } from '../store'
import { Modal, WordChip } from './common'
import { RegionRow } from './MapModal'
import type { Mark } from './OverviewCanvas'
import { OverviewCanvas } from './OverviewCanvas'
import { levelLabel } from './text'

export function CharModal() {
  const modal = useStore((s) => s.modal)
  const ch = useStore((s) => s.charFocus)
  if (modal !== 'char' || !ch) return null
  return <CharModalInner ch={ch} />
}

/** Where a character shows up across the map, and how many of its words you know in each region. */
function CharModalInner({ ch }: { ch: string }) {
  const pack = useStore((s) => s.pack!)
  const view = useStore((s) => s.view!)
  const fog = useStore((s) => s.save.settings.fogMode)
  const { setModal, select, revealNextWithChar } = useStore.getState()
  const list = useMemo(() => pack.charIndex.get(ch) ?? [], [pack, ch])
  const image = useMemo(() => renderOverview(pack, view, { k: 2, muted: true }), [pack, view])
  const self = list.find((j) => pack.words[j].hanzi === ch)
  const learned = list.filter((j) => view.vis[j] === Vis.Learned).length
  const seen = list.filter((j) => view.vis[j] >= Vis.Revealed).length

  const marks = useMemo(
    (): Mark[] =>
      list.map((j) => {
        const w = pack.words[j]
        const v = view.vis[j]
        if (v === Vis.Learned) return { x: w.x, y: w.y, fill: STATUS_COLORS.learned, stroke: STATUS_COLORS.learnedStroke }
        if (v === Vis.Active) return { x: w.x, y: w.y, fill: STATUS_COLORS.active, stroke: '#ffffff' }
        if (v >= Vis.Revealed) return { x: w.x, y: w.y, fill: '#ffffff', stroke: '#333333' }
        return { x: w.x, y: w.y, fill: 'rgba(52, 58, 70, 0.85)', stroke: 'rgba(255, 255, 255, 0.9)' }
      }),
    [list, pack, view],
  )

  // Frame the part of the world where the character's words are (at least ~a fifth of the map).
  const crop = useMemo((): Bounds => {
    const land = landBounds(pack.world)
    if (!list.length) return land
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const j of list) {
      const w = pack.words[j]
      x0 = Math.min(x0, w.x)
      y0 = Math.min(y0, w.y)
      x1 = Math.max(x1, w.x)
      y1 = Math.max(y1, w.y)
    }
    const side = Math.min(Math.max(x1 - x0, y1 - y0) + 24, Math.max(land.w, land.h))
    const size = Math.max(side, Math.round(Math.max(land.w, land.h) / 5))
    const w = Math.min(size, land.w)
    const h = Math.min(size, land.h)
    const clamp = (v: number, lo: number, len: number, sz: number) => Math.max(lo, Math.min(v, lo + len - sz))
    return {
      x0: Math.round(clamp((x0 + x1) / 2 - w / 2, land.x0, land.w, w)),
      y0: Math.round(clamp((y0 + y1) / 2 - h / 2, land.y0, land.h, h)),
      w,
      h,
    }
  }, [list, pack])

  const regions = useMemo(() => {
    const by = new Map<number, number[]>()
    for (const j of list) {
      const r = pack.words[j].region
      if (!by.has(r)) by.set(r, [])
      by.get(r)!.push(j)
    }
    return [...by.entries()]
      .filter(([r]) => r >= 0)
      .map(([r, words]) => ({
        r: pack.world.regions[r],
        words,
        learned: words.filter((j) => view.vis[j] === Vis.Learned).length,
        seen: words.filter((j) => view.vis[j] >= Vis.Revealed).length,
      }))
      .sort((a, b) => a.r.level - b.r.level || b.words.length - a.words.length || a.r.id - b.r.id)
  }, [list, pack, view])

  const hidden = list.length - seen
  const goTo = (j: number) => {
    setModal(null)
    select(j, 'link', true)
  }

  return (
    <Modal
      title={
        <>
          <span className="char-title" lang="zh-Hans">
            {ch}
          </span>{' '}
          {self !== undefined && (view.vis[self] >= Vis.Revealed || fog !== 'hidden') ? (
            <span className="muted">
              {pack.words[self].pinyin} · {pack.words[self].glosses[0]}
            </span>
          ) : null}
        </>
      }
      onClose={() => setModal(null)}
      className="char-modal"
      wide
    >
      <p>
        <b>{list.length}</b> word{list.length === 1 ? '' : 's'} use <span lang="zh-Hans">{ch}</span>: ⭐ {learned}{' '}
        learned · 🧭 {seen} found · 🌫️ {hidden} still hidden, across {regions.length} region
        {regions.length === 1 ? '' : 's'}.
      </p>
      <div className="char-layout">
        <div className="char-map">
          <OverviewCanvas image={image} marks={marks} labels={false} crop={crop} />
          {hidden ? (
            <button
              type="button"
              className="small hint-btn"
              onClick={() => {
                revealNextWithChar(ch)
                setModal(null)
              }}
            >
              🔭 Reveal the next word with {ch}
            </button>
          ) : null}
        </div>
        <ul className="region-list compact">
          {regions.map(({ r, words, learned, seen }) => (
            <RegionRow
              key={r.id}
              r={r}
              learned={learned}
              seen={seen}
              total={words.length}
              note={levelLabel(r.level)}
              onClick={() => goTo(words.find((j) => view.vis[j] !== Vis.Learned) ?? words[0])}
            />
          ))}
        </ul>
      </div>
      <h3>Words</h3>
      <div
        className="chips"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.chip')) setModal(null)
        }}
      >
        {list.map((j) => (
          <WordChip key={j} i={j} showGloss />
        ))}
      </div>
    </Modal>
  )
}
