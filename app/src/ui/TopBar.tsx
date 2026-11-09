import { useEffect, useMemo, useRef, useState } from 'react'
import { Vis } from '../logic/explore'
import { search } from '../logic/search'
import { useStore } from '../store'
import { levelLabel } from './text'

export function TopBar() {
  const view = useStore((s) => s.view!)
  const cap = useStore((s) => s.save.settings.openCap)
  const total = useStore((s) => s.pack!.words.length)
  const { setModal, setQuestLog, discover } = useStore.getState()
  const questLogOpen = useStore((s) => s.questLogOpen)
  const over = view.openCount >= cap

  return (
    <header className="topbar">
      <div className="brand" title="Language Map">
        <span className="brand-zh">语言地图</span>
        <span className="brand-en">Language Map</span>
      </div>
      <SearchBox />
      <div className="stats">
        <button
          type="button"
          className={`stat ${view.dueCount ? 'due' : ''}`}
          onClick={() => setQuestLog(!questLogOpen)}
          title="Quest log (Q)"
        >
          <span className="stat-icon">❗</span>
          <span>
            <b>{view.dueCount}</b>
            <span className="stat-label"> due</span>
          </span>
        </button>
        <span className={`stat ${over ? 'warn' : ''}`} title="Open words: discovered but not learned yet (soft cap)">
          <span className="stat-icon">🧭</span>
          <span>
            <b>{view.openCount}</b>/{cap}
            <span className="stat-label"> open</span>
          </span>
        </span>
        <span className="stat" title={`Learned ${view.learnedCount} of ${total} words`}>
          <span className="stat-icon">⭐</span>
          <span>
            <b>{view.learnedCount}</b>
            <span className="stat-label"> learned</span>
          </span>
        </span>
        <button
          type="button"
          className={`explore-btn ${over ? 'over' : ''}`}
          onClick={discover}
          title={over ? 'You are at the soft cap — you can still discover more.' : 'Reveal the best next word to learn'}
          aria-label="Discover a new word"
        >
          🔭<span className="btn-label"> Discover</span>
        </button>
        <button type="button" className="icon" onClick={() => setModal('settings')} title="Settings" aria-label="Settings">
          ⚙️
        </button>
        <button type="button" className="icon" onClick={() => setModal('about')} title="About & help" aria-label="About">
          ?
        </button>
      </div>
    </header>
  )
}

function SearchBox() {
  const index = useStore((s) => s.searchIndex)
  const pack = useStore((s) => s.pack!)
  const view = useStore((s) => s.view!)
  const select = useStore((s) => s.select)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => (index ? search(index, q, 40) : []), [index, q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const choose = (i: number) => {
    select(i, 'search', true)
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="search">
      <input
        ref={inputRef}
        type="search"
        placeholder="Search 汉字, pinyin or English  ( / )"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive(Math.min(active + 1, hits.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive(Math.max(active - 1, 0))
          } else if (e.key === 'Enter' && hits[active]) {
            choose(hits[active].i)
          } else if (e.key === 'Escape') {
            setOpen(false)
            inputRef.current?.blur()
          }
        }}
        aria-label="Search words"
      />
      {open && q.trim() ? (
        <ul className="search-results" role="listbox">
          {hits.length === 0 ? <li className="empty">No matches</li> : null}
          {hits.map((h, k) => {
            const w = pack.words[h.i]
            const v = view.vis[h.i]
            const status = v === Vis.Learned ? '⭐' : v === Vis.Active ? '⚔️' : v >= Vis.Revealed ? '' : '🌫️'
            return (
              <li
                key={h.i}
                role="option"
                aria-selected={k === active}
                className={k === active ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(h.i)
                }}
                onMouseEnter={() => setActive(k)}
              >
                <span className="zh" lang="zh-Hans">
                  {w.hanzi}
                </span>
                <span className="py">{w.pinyin}</span>
                <span className="gl">{w.glosses[0]}</span>
                <span className="lv">{levelLabel(w.level)}</span>
                <span className="st" title={v >= Vis.Revealed ? '' : 'Not on your map yet'}>
                  {status}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
