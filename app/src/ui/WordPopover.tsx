import { useEffect, useState } from 'react'
import { loadSentences } from '../data/pack'
import type { SentenceData } from '../data/types'
import { shortGloss } from '../logic/boss'
import { Vis } from '../logic/explore'
import { currentStage, isDue, STAGES, stageDone } from '../logic/progress'
import { useStore } from '../store'
import { speak } from '../tts'
import { SentenceView, SpeakButton } from './common'
import { levelLabel, sentenceText } from './text'

interface Action {
  icon: string
  label: string
  title: string
  run: () => void
  primary?: boolean
}

/** The small dialog for the selected landmark: a couple of quick choices, with the full page one tap away. */
export function WordPopover() {
  const i = useStore((s) => s.selected)
  const details = useStore((s) => s.details)
  if (i === null || details) return null
  return <PopoverInner key={i} i={i} />
}

function PopoverInner({ i }: { i: number }) {
  const pack = useStore((s) => s.pack!)
  const vis = useStore((s) => s.view!.vis[i])
  const count = useStore((s) => s.view!.stageCount)
  const settings = useStore((s) => s.save.settings)
  const today = useStore((s) => s.today)
  const w = pack.words[i]
  const wp = useStore((s) => s.save.progress[w.id])
  const { select, revealWord, markKnown, startQuest, openQuest, setDetails, nextWord } = useStore.getState()
  const need = settings.daysPerStage
  const listening = settings.questMode === 'listening'
  const explored = vis >= Vis.Revealed
  const mystery = !explored && settings.fogMode === 'hidden'
  const due = vis === Vis.Active && isDue(wp, need, today, count)
  const lang = pack.manifest.target.tts

  const [data, setData] = useState<SentenceData | null>(null)
  const [sent, setSent] = useState(-1)
  const [showEn, setShowEn] = useState(false)
  const list = data?.byWord[i] ?? []
  const sentence = sent >= 0 && list.length ? data!.sentences[list[sent % list.length]] : null

  const nextSentence = () => {
    setShowEn(false)
    if (!data) {
      loadSentences(pack).then(
        (d) => {
          setData(d)
          setSent(0)
          const k = d.byWord[i]?.[0]
          if (k !== undefined && listening) speak(sentenceText(d.sentences[k]), lang, settings.ttsRate)
        },
        () => setData({ sentences: [], byWord: [] }),
      )
      return
    }
    const n = sent + 1
    setSent(n)
    const k = list[n % Math.max(1, list.length)]
    if (k !== undefined && listening) speak(sentenceText(data.sentences[k]), lang, settings.ttsRate)
  }

  const example: Action = { icon: '💬', label: 'Example', title: 'Show an example sentence (again for the next one)', run: nextSentence }
  const more: Action = { icon: '📖', label: 'Details', title: 'Everything about this word', run: () => setDetails(true) }
  const know: Action = { icon: '✓', label: 'Know it', title: 'I already know this word', run: () => markKnown(i, true) }
  const actions: Action[] = []
  if (!explored) {
    actions.push({
      icon: '👁',
      label: 'Reveal',
      title: 'Discover this word',
      primary: true,
      run: () => {
        revealWord(i)
        speak(w.hanzi, lang, settings.ttsRate)
      },
    })
    if (!mystery) actions.push(know)
  } else if (vis === Vis.Revealed) {
    actions.push({ icon: '⚔️', label: 'Learn', title: 'Start a quest for this word', primary: true, run: () => startQuest(i) })
    actions.push(know, example, more)
  } else if (vis === Vis.Active) {
    if (due) actions.push({ icon: '▶', label: 'Practice', title: "Today's quest", primary: true, run: () => openQuest(i) })
    actions.push(know, example, more)
  } else {
    actions.push(example, more)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (s.quest || s.modal || s.hall !== null || e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= actions.length) {
        e.preventDefault()
        actions[n - 1].run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const cur = currentStage(wp, need, count)
  const color = pack.world.regions[w.region]?.color ?? '#999'

  return (
    <section className="popover" aria-label="Word" style={{ ['--region' as string]: color }}>
      <button type="button" className="icon close" onClick={() => select(null)} aria-label="Close" title="Close (Esc)">
        ×
      </button>
      <div className="pop-head">
        <span className={`pop-hanzi ${vis === Vis.Learned ? 'learned' : vis === Vis.Active ? 'active' : ''}`} lang="zh-Hans">
          {mystery ? '?' : w.hanzi}
        </span>
        <div className="pop-sub">
          {explored ? (
            <>
              <span className="pop-pinyin">
                {w.pinyin} <SpeakButton text={w.hanzi} />
              </span>
              <span className="pop-gloss">
                {vis === Vis.Learned ? '★ ' : ''}
                {shortGloss(w.glosses[0] ?? '', 70)}
              </span>
            </>
          ) : (
            <span className="muted">
              {mystery ? `An undiscovered ${levelLabel(w.level)} word` : `Undiscovered · ${levelLabel(w.level)}`}
            </span>
          )}
        </div>
      </div>
      {vis === Vis.Active ? (
        <div className="pop-stages" title="Quest stages">
          {STAGES.slice(0, count).map((st, s) => (
            <span key={st.key} className={`pip ${stageDone(wp?.stages[s], need) ? 'done' : ''} ${s === cur ? 'cur' : ''}`} title={st.title}>
              {st.icon}
            </span>
          ))}
          <span className="muted">{due ? `Today: ${STAGES[cur]?.title ?? ''}` : '✓ done for today'}</span>
        </div>
      ) : null}
      {sentence ? (
        <div className="pop-sentence">
          <div lang="zh-Hans">
            <SentenceView sentence={sentence} target={i} pinyin={listening} onWord={(j) => select(j, 'link', true)} />{' '}
            <SpeakButton text={sentenceText(sentence)} />
          </div>
          {showEn ? (
            <div className="en">{sentence.en}</div>
          ) : (
            <button type="button" className="link" onClick={() => setShowEn(true)}>
              Show English
            </button>
          )}
        </div>
      ) : sent >= 0 && data ? (
        <p className="muted pop-sentence">No example sentences for this word yet.</p>
      ) : null}
      <div className="pop-actions">
        {actions.map((a, k) => (
          <button type="button" key={a.label} className={a.primary ? 'primary' : ''} onClick={a.run} title={`${a.title} (${k + 1})`}>
            <span className="ic" aria-hidden="true">
              {a.icon}
            </span>
            {a.label}
            <kbd>{k + 1}</kbd>
          </button>
        ))}
        <button
          type="button"
          className="ghost next"
          onClick={nextWord}
          title="Walk to the next undiscovered word in this region (N)"
          aria-label="Next word"
        >
          ➜<kbd>N</kbd>
        </button>
      </div>
    </section>
  )
}
