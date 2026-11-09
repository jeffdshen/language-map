import { Vis } from '../logic/explore'
import { currentStage, STAGES } from '../logic/progress'
import { useStore } from '../store'
import { Dots } from './common'
import { levelLabel } from './text'

export function QuestLog() {
  const open = useStore((s) => s.questLogOpen)
  const pack = useStore((s) => s.pack!)
  const view = useStore((s) => s.view!)
  const save = useStore((s) => s.save)
  const { setQuestLog, openQuest, select, startQuest } = useStore.getState()
  if (!open) return null
  const need = save.settings.daysPerStage
  const due: number[] = []
  const doneToday: number[] = []
  const waiting: number[] = []
  for (const w of pack.words) {
    const v = view.vis[w.i]
    if (v === Vis.Active) (view.due[w.i] ? due : doneToday).push(w.i)
    else if (v === Vis.Revealed) waiting.push(w.i)
  }
  const byLevel = (a: number, b: number) => pack.words[a].level - pack.words[b].level || a - b
  due.sort(byLevel)
  doneToday.sort(byLevel)
  waiting.sort(byLevel)

  const row = (i: number, action: 'quest' | 'accept' | 'view') => {
    const w = pack.words[i]
    const wp = save.progress[w.id]
    const cur = currentStage(wp, need, view.stageCount)
    return (
      <li key={i}>
        <button
          type="button"
          className="log-word"
          onClick={() => {
            select(i, 'link', true)
            if (action === 'quest') openQuest(i)
          }}
        >
          <span className="zh" lang="zh-Hans">
            {w.hanzi}
          </span>
          <span className="py">{w.pinyin}</span>
          <span className="lv">{levelLabel(w.level)}</span>
        </button>
        {cur >= 0 && action !== 'accept' ? (
          <span className="log-stage" title={STAGES[cur].title}>
            {STAGES[cur].icon} <Dots have={wp?.stages[cur].days.length ?? 0} need={need} />
          </span>
        ) : null}
        {action === 'accept' ? (
          <button type="button" className="small" onClick={() => startQuest(i)}>
            Accept
          </button>
        ) : null}
      </li>
    )
  }

  return (
    <aside className="panel quest-log" aria-label="Quest log">
      <div className="panel-head">
        <h2>Quest log</h2>
        <button type="button" className="icon close" onClick={() => setQuestLog(false)} aria-label="Close">
          ×
        </button>
      </div>
      <section>
        <h3>❗ Due today ({due.length})</h3>
        {due.length ? (
          <ul className="log-list">{due.map((i) => row(i, 'quest'))}</ul>
        ) : (
          <p className="muted">
            {doneToday.length ? 'All caught up for today. 🎉' : 'No active quests. Accept a quest from a word on the map.'}
          </p>
        )}
      </section>
      {doneToday.length ? (
        <section>
          <h3>✓ Done for today ({doneToday.length})</h3>
          <ul className="log-list">{doneToday.map((i) => row(i, 'view'))}</ul>
        </section>
      ) : null}
      <section>
        <h3>🧭 Discovered, not started ({waiting.length})</h3>
        {waiting.length ? (
          <ul className="log-list">{waiting.map((i) => row(i, 'accept'))}</ul>
        ) : (
          <p className="muted">Use 🔭 Discover or explore “?” spots on the map to find new words.</p>
        )}
      </section>
      <section>
        <h3>⭐ Learned by level</h3>
        <ul className="level-bars">
          {pack.manifest.levels.map((l) => {
            const n = view.learnedByLevel[l.level]
            return (
              <li key={l.level}>
                <span className="lv">{l.label}</span>
                <span className="bar">
                  <span style={{ width: `${(100 * n) / l.count}%` }} />
                </span>
                <span className="num">
                  {n}/{l.count}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </aside>
  )
}
