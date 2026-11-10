import { useState } from 'react'
import { Vis } from '../logic/explore'
import { currentStage, STAGES, stageNeeds } from '../logic/progress'
import { useStore, type LogTab } from '../store'
import { useSwipeDismiss } from './useSwipeDismiss'
import { levelLabel } from './text'

/** Rows shown per list before "show more". */
const PAGE = 60

export function QuestLog() {
  const open = useStore((s) => s.questLogOpen)
  const tab = useStore((s) => s.logTab)
  const { setQuestLog } = useStore.getState()
  const swipe = useSwipeDismiss(() => setQuestLog(false))
  if (!open) return null
  const tabs: [LogTab, string][] = [
    ['open', '🧭 Open'],
    ['learned', '⭐ Learned'],
  ]
  return (
    <aside className="panel quest-log" aria-label="Quest log" data-sheet>
      <div className="panel-head grip" {...swipe}>
        <h2>Quest log</h2>
        <button type="button" className="icon close" onClick={() => setQuestLog(false)} aria-label="Close">
          ×
        </button>
      </div>
      <div className="log-tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'on' : ''}
            onClick={() => setQuestLog(true, key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'open' ? <OpenTab /> : <LearnedTab />}
    </aside>
  )
}

function WordRow({ i, children }: { i: number; children?: React.ReactNode }) {
  const w = useStore((s) => s.pack!.words[i])
  const select = useStore((s) => s.select)
  return (
    <li>
      <button type="button" className="log-word" onClick={() => select(i, 'link', true)}>
        <span className="zh" lang="zh-Hans">
          {w.hanzi}
        </span>
        <span className="py">{w.pinyin}</span>
        <span className="lv">{levelLabel(w.level)}</span>
      </button>
      {children}
    </li>
  )
}

function More({ total, shown, onMore }: { total: number; shown: number; onMore: () => void }) {
  if (total <= shown) return null
  return (
    <button type="button" className="link" onClick={onMore}>
      Show more ({total - shown} more)
    </button>
  )
}

function OpenTab() {
  const pack = useStore((s) => s.pack!)
  const view = useStore((s) => s.view!)
  const save = useStore((s) => s.save)
  const [limit, setLimit] = useState(PAGE)
  const active: number[] = []
  const waiting: number[] = []
  for (const w of pack.words) {
    const v = view.vis[w.i]
    if (v === Vis.Active) active.push(w.i)
    else if (v === Vis.Revealed) waiting.push(w.i)
  }
  const sentences = save.settings.sentencesPerStage
  /** [current stage, points, needed] per active word; closest to finishing a stage first. */
  const info = new Map(
    active.map((i) => {
      const w = pack.words[i]
      const needs = stageNeeds(w.ex, sentences)
      const wp = save.progress[w.id]
      const cur = currentStage(wp, needs, view.stageCount)
      return [i, [cur, Math.min(wp?.stages[cur]?.n ?? 0, needs[cur] ?? 1), needs[cur] ?? 1]] as const
    }),
  )
  const left = (i: number) => {
    const [, have, need] = info.get(i)!
    return need - have
  }
  active.sort((a, b) => view.stages[b] - view.stages[a] || left(a) - left(b) || pack.words[a].level - pack.words[b].level || a - b)
  waiting.sort((a, b) => pack.words[a].level - pack.words[b].level || a - b)

  return (
    <>
      <section>
        <h3>⚔️ In progress ({active.length})</h3>
        {active.length ? (
          <ul className="log-list">
            {active.slice(0, limit).map((i) => {
              const [cur, have, need] = info.get(i)!
              const st = STAGES[cur]
              return (
                <WordRow key={i} i={i}>
                  {st ? (
                    <span className="log-stage" title={st.title}>
                      {st.icon}{' '}
                      <span className="mini-bar">
                        <span style={{ width: `${(100 * have) / need}%` }} />
                      </span>{' '}
                      {have}/{need}
                    </span>
                  ) : null}
                </WordRow>
              )
            })}
          </ul>
        ) : (
          <p className="muted">Nothing in progress. Walk up to a word and collect a sentence to start.</p>
        )}
        <More total={active.length} shown={limit} onMore={() => setLimit(limit + PAGE)} />
      </section>
      <section>
        <h3>❗ Discovered, not started ({waiting.length})</h3>
        {waiting.length ? (
          <ul className="log-list">
            {waiting.slice(0, limit).map((i) => (
              <WordRow key={i} i={i} />
            ))}
          </ul>
        ) : (
          <p className="muted">Use 🔭 Discover or explore the faded words on the map to find new ones.</p>
        )}
        <More total={waiting.length} shown={limit} onMore={() => setLimit(limit + PAGE)} />
      </section>
    </>
  )
}

function LearnedTab() {
  const pack = useStore((s) => s.pack!)
  const view = useStore((s) => s.view!)
  const [level, setLevel] = useState<number | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const learned = pack.words.filter((w) => view.vis[w.i] === Vis.Learned && (level === null || w.level === level)).map((w) => w.i)
  return (
    <>
      <section>
        <h3>⭐ Learned by level</h3>
        <ul className="level-bars">
          {pack.manifest.levels.map((l) => {
            const n = view.learnedByLevel[l.level]
            return (
              <li key={l.level}>
                <button
                  type="button"
                  className={`lv-btn ${level === l.level ? 'on' : ''}`}
                  onClick={() => {
                    setLevel(level === l.level ? null : l.level)
                    setLimit(PAGE)
                  }}
                  title={`Show learned ${l.label} words`}
                >
                  <span className="lv">{l.label}</span>
                  <span className="bar">
                    <span style={{ width: `${(100 * n) / l.count}%` }} />
                  </span>
                  <span className="num">
                    {n}/{l.count}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
      <section>
        <h3>
          {level === null ? 'All learned words' : `Learned ${levelLabel(level)} words`} ({learned.length})
        </h3>
        {learned.length ? (
          <ul className="log-list">
            {learned.slice(0, limit).map((i) => (
              <WordRow key={i} i={i} />
            ))}
          </ul>
        ) : (
          <p className="muted">No learned words yet{level === null ? '' : ' at this level'}.</p>
        )}
        <More total={learned.length} shown={limit} onMore={() => setLimit(limit + PAGE)} />
      </section>
    </>
  )
}
