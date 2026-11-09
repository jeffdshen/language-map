import { useEffect, useState } from 'react'
import { hanChars, loadSentences } from '../data/pack'
import type { SentenceData } from '../data/types'
import { nextHiddenWithChar, Vis } from '../logic/explore'
import { currentStage, isDue, STAGES, stageDone, wordStatus } from '../logic/progress'
import { useStore } from '../store'
import { Dots, LevelBadge, RegionTag, SentenceView, SpeakButton, WordChip } from './common'
import { levelLabel, POS_LABEL } from './text'

export function WordPanel() {
  const i = useStore((s) => s.selected)
  if (i === null) return null
  return <WordPanelInner key={i} i={i} />
}

function WordPanelInner({ i }: { i: number }) {
  const pack = useStore((s) => s.pack!)
  const vis = useStore((s) => s.view!.vis[i])
  const openCount = useStore((s) => s.view!.openCount)
  const settings = useStore((s) => s.save.settings)
  const from = useStore((s) => s.selectedFrom)
  const { select, revealWord, markKnown } = useStore.getState()
  const w = pack.words[i]
  const fog = settings.fogMode
  const discovered = vis >= Vis.Revealed
  const showForm = discovered || fog !== 'hidden' || from === 'search'
  const showMeaning = discovered || fog === 'off' || from === 'search'

  return (
    <aside className="panel word-panel" aria-label="Word details">
      <button type="button" className="icon close" onClick={() => select(null)} aria-label="Close">
        ×
      </button>
      <header className="word-head" style={{ ['--region' as string]: pack.regions.themes[w.theme].color }}>
        <div className="hanzi-big" lang="zh-Hans">
          {showForm ? w.hanzi : '?'}
        </div>
        {showForm ? (
          <div className="pinyin-big">
            {w.pinyin} <SpeakButton text={w.hanzi} />
          </div>
        ) : null}
        {showForm && w.trad && w.trad !== w.hanzi ? <div className="trad">Traditional: {w.trad}</div> : null}
        <div className="tags">
          <LevelBadge level={w.level} />
          <span className="badge">{POS_LABEL[w.pos]}</span>
          <RegionTag theme={w.theme} />
        </div>
      </header>

      {!discovered ? (
        <section className="fogbox">
          <p>
            🌫️ This word is still in the fog
            {vis === Vis.Frontier ? ' — it borders the part of the map you have explored.' : '.'}
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={() => revealWord(i)}>
              Reveal it
            </button>
            <button type="button" onClick={() => markKnown(i)}>
              I already know it
            </button>
          </div>
          {openCount >= settings.openCap ? (
            <p className="hint warn">
              You already have {openCount} open words (soft cap {settings.openCap}). You can still reveal more.
            </p>
          ) : null}
        </section>
      ) : null}

      {showMeaning ? (
        <section>
          <h3>Meaning</h3>
          <ol className="glosses">
            {w.glosses.map((g, k) => (
              <li key={k}>{g}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {discovered ? <QuestSection i={i} /> : null}
      <ExploreSection i={i} showForm={showForm} />
      {showMeaning ? <Examples i={i} /> : null}
      <footer className="meta">
        <span>{w.id}</span>
        {w.alts.length ? <span title="Other forms / readings">also: {w.alts.join(', ')}</span> : null}
      </footer>
    </aside>
  )
}

function QuestSection({ i }: { i: number }) {
  const pack = useStore((s) => s.pack!)
  const wp = useStore((s) => s.save.progress[pack.words[i].id])
  const need = useStore((s) => s.save.settings.daysPerStage)
  const today = useStore((s) => s.today)
  const { startQuest, stopQuest, openQuest, markStage, markKnown, resetWord } = useStore.getState()
  const status = wordStatus(wp, need)
  const cur = currentStage(wp, need)
  const due = isDue(wp, need, today)

  return (
    <section className="quest-section">
      <h3>Quest</h3>
      {status === 'learned' ? (
        <div className="callout gold">⭐ Learned! This word is yours. Practice any stage again whenever you like.</div>
      ) : status === 'revealed' ? (
        <div className="callout">
          <p>
            Learn <b>{pack.words[i].hanzi}</b> in four stages, from hearing it to reading it. Each stage needs {need}{' '}
            good day{need > 1 ? 's' : ''}.
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={() => startQuest(i)}>
              ⚔️ Accept quest
            </button>
            <button type="button" onClick={() => markKnown(i)}>
              ✓ I know it
            </button>
          </div>
        </div>
      ) : due ? (
        <div className="callout due">
          <p>
            ❗ Today: <b>{STAGES[cur].title}</b>
          </p>
          <button type="button" className="primary" onClick={() => openQuest(i)}>
            Start today's quest
          </button>
        </div>
      ) : (
        <div className="callout done">✓ Done for today. Come back tomorrow for the next day of practice.</div>
      )}
      <ol className="stages">
        {STAGES.map((st, s) => {
          const sp = wp?.stages[s]
          const done = stageDone(sp, need)
          return (
            <li key={st.key} className={`${done ? 'done' : ''} ${s === cur && status === 'active' ? 'current' : ''}`}>
              <span className="stage-icon">{st.icon}</span>
              <span className="stage-title">
                {st.title}
                <small>{st.goal}</small>
              </span>
              <Dots have={sp?.days.length ?? 0} need={need} marked={sp?.marked} done={done} />
              <span className="stage-actions">
                <button type="button" className="small" onClick={() => openQuest(i, s)} title="Practice this stage">
                  Practice
                </button>
                <button
                  type="button"
                  className="small ghost"
                  onClick={() => markStage(i, s, !sp?.marked)}
                  title={sp?.marked ? 'Undo self-mark' : 'I can already do this'}
                >
                  {sp?.marked ? 'Unmark' : 'Mark done'}
                </button>
              </span>
            </li>
          )
        })}
      </ol>
      <div className="row subtle">
        {status === 'active' ? (
          <button type="button" className="link" onClick={() => stopQuest(i)}>
            Pause quest
          </button>
        ) : null}
        {status !== 'revealed' ? (
          <button
            type="button"
            className="link"
            onClick={() => {
              if (confirm('Forget all practice for this word?')) resetWord(i)
            }}
          >
            Reset progress
          </button>
        ) : null}
      </div>
    </section>
  )
}

function ExploreSection({ i, showForm }: { i: number; showForm: boolean }) {
  const pack = useStore((s) => s.pack!)
  const view = useStore((s) => s.view!)
  const revealNextWithChar = useStore((s) => s.revealNextWithChar)
  const w = pack.words[i]
  const chain: number[] = []
  for (let a = w.anchor; a >= 0 && chain.length < 8; a = pack.words[a].anchor) chain.unshift(a)
  const kids = pack.children[i]

  return (
    <section className="explore">
      <h3>Explore</h3>
      {chain.length ? (
        <div className="explore-row">
          <span className="label">Branches from</span>
          <div className="chips path">
            {chain.map((j, k) => (
              <span key={j} className="path-step">
                {k ? <span className="sep">›</span> : null}
                <WordChip i={j} />
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="explore-row">
          <span className="label">Branches from</span>
          <span className="muted">the center — a root word ({levelLabel(w.level)})</span>
        </div>
      )}
      {kids.length ? (
        <div className="explore-row">
          <span className="label">Leads to ({kids.length})</span>
          <div className="chips">
            {kids.slice(0, 14).map((j) => (
              <WordChip key={j} i={j} />
            ))}
            {kids.length > 14 ? <span className="muted">+{kids.length - 14} more</span> : null}
          </div>
        </div>
      ) : null}
      {showForm
        ? hanChars(w.hanzi).map((ch) => {
            const all = (pack.charIndex.get(ch) ?? []).filter((j) => j !== i)
            if (!all.length) return null
            const explored = all.filter((j) => view.vis[j] >= Vis.Revealed)
            const hidden = all.length - explored.length
            const nextHidden = nextHiddenWithChar(pack, view, ch, i)
            return (
              <div className="explore-row" key={ch}>
                <span className="label">
                  <span className="char" lang="zh-Hans">
                    {ch}
                  </span>{' '}
                  in {all.length} other word{all.length > 1 ? 's' : ''}
                </span>
                <div className="chips">
                  {explored.slice(0, 10).map((j) => (
                    <WordChip key={j} i={j} />
                  ))}
                  {explored.length > 10 ? <span className="muted">+{explored.length - 10}</span> : null}
                  {hidden ? (
                    <button type="button" className="small hint-btn" onClick={() => revealNextWithChar(ch, i)}>
                      🔭 {hidden} hidden · reveal next
                      {nextHidden !== null ? ` (${levelLabel(pack.words[nextHidden].level)})` : ''}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })
        : null}
      <div className="explore-row">
        <span className="label">Similar meaning</span>
        <div className="chips">
          {w.neighbors.slice(0, 8).map((j) => (
            <WordChip key={j} i={j} />
          ))}
        </div>
      </div>
    </section>
  )
}

function Examples({ i }: { i: number }) {
  const pack = useStore((s) => s.pack!)
  const select = useStore((s) => s.select)
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<SentenceData | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (!open || data) return
    loadSentences(pack).then(setData, () => setErr(true))
  }, [open, data, pack])
  const list = data?.byWord[i] ?? []
  return (
    <section className="examples">
      <button type="button" className="link" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Example sentences
      </button>
      {open ? (
        err ? (
          <p className="muted">Could not load sentences.</p>
        ) : !data ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="muted">No example sentences for this word yet.</p>
        ) : (
          <ul className="sentence-list">
            {list.map((k) => {
              const s = data.sentences[k]
              return (
                <li key={s.id}>
                  <div lang="zh-Hans">
                    <SentenceView sentence={s} target={i} onWord={(j) => select(j, 'link', true)} />{' '}
                    <SpeakButton text={s.seg.map((t) => t[0]).join('')} />
                  </div>
                  <div className="en">
                    {s.en}{' '}
                    <a href={`https://tatoeba.org/sentences/show/${s.id}`} target="_blank" rel="noreferrer" className="src">
                      Tatoeba #{s.id}
                    </a>
                  </div>
                </li>
              )
            })}
          </ul>
        )
      ) : null}
    </section>
  )
}
