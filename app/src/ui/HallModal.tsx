import { useEffect, useMemo, useState } from 'react'
import { loadSentences } from '../data/pack'
import type { SentenceData } from '../data/types'
import { bossQueue, bossQuestion, rng, sentenceQueue, shortGloss, type BossQuestion } from '../logic/boss'
import { Vis } from '../logic/explore'
import { useStore } from '../store'
import { speak } from '../audio'
import { Modal, SentenceView, SpeakButton, WordChip } from './common'
import { QuestCard } from './QuestCard'
import { levelLabel, sentenceText } from './text'

/** Questions per challenge round (the hall master's hit points). */
export const ROUND = 8

/** A region's hall: progress, random sentences from the town, and a challenge that can clear several words at once. */
export function HallModal() {
  const region = useStore((s) => s.hall)
  if (region === null) return null
  return <HallInner key={region} region={region} />
}

type Phase =
  | { kind: 'menu' }
  | { kind: 'boss'; queue: number[]; seed: number }
  | { kind: 'done'; cleared: number[]; missed: number[]; found: number[] }
  | { kind: 'sentences'; queue: number[]; k: number }

function HallInner({ region }: { region: number }) {
  const pack = useStore((s) => s.pack!)
  const view = useStore((s) => s.view!)
  const { closeHall } = useStore.getState()
  const r = pack.world.regions[region]
  const [phase, setPhase] = useState<Phase>({ kind: 'menu' })
  const [showList, setShowList] = useState(false)

  const words = pack.regionWords[region] ?? []
  const learned = view.regionLearned[region]
  const seen = view.regionSeen[region]
  const queue = bossQueue(pack, view, region)
  const withSentences = words.filter((i) => pack.words[i].ex > 0)
  const openWithSentences = withSentences.filter((i) => view.vis[i] !== Vis.Learned).length
  const cleared = learned >= r.count
  const startSentences = () => setPhase({ kind: 'sentences', queue: sentenceQueue(pack, view, region, rng(Date.now())), k: 0 })

  const title = (
    <span className="hall-title" style={{ ['--region' as string]: r.color }}>
      <span lang="zh-Hans">{r.zh}</span> · {r.en}
    </span>
  )

  if (phase.kind === 'boss')
    return (
      <Modal title={title} onClose={closeHall} className="hall-modal">
        <BossRound queue={phase.queue} seed={phase.seed} onDone={(c, m, f) => setPhase({ kind: 'done', cleared: c, missed: m, found: f })} />
      </Modal>
    )

  if (phase.kind === 'sentences') {
    const { queue: q, k } = phase
    return (
      <Modal title={title} onClose={closeHall} className="hall-modal" wide>
        <div className="hall-sentences">
          <div className="hall-sentences-head">
            <button type="button" className="link" onClick={() => setPhase({ kind: 'menu' })}>
              ◂ Hall
            </button>
            <span className="muted">
              💬 Sentences from {r.en} · {k + 1}/{q.length}
            </span>
          </div>
          {k < q.length ? (
            <QuestCard
              key={`${q[k]}:${k}`}
              i={q[k]}
              where="hall"
              nextAfterCollect
              onNextWord={() => setPhase(k + 1 < q.length ? { ...phase, k: k + 1 } : { kind: 'menu' })}
            />
          ) : null}
        </div>
      </Modal>
    )
  }

  if (phase.kind === 'done')
    return (
      <Modal title={title} onClose={closeHall} className="hall-modal">
        <div className="boss-summary">
          <h3>{phase.missed.length === 0 ? '🏆 Flawless!' : phase.cleared.length >= phase.missed.length ? '⚔️ Well fought' : '🛡️ Good practice'}</h3>
          <p>
            Cleared <b>{phase.cleared.length}</b> {phase.cleared.length === 1 ? 'word' : 'words'}
            {phase.missed.length ? (
              <>
                {' '}
                · <b>{phase.missed.length}</b> to learn
              </>
            ) : null}
          </p>
          {phase.cleared.length ? (
            <div className="chips">
              {phase.cleared.map((i) => (
                <WordChip key={i} i={i} />
              ))}
            </div>
          ) : null}
          {phase.missed.length ? (
            <>
              <h4>Missed — now on your map</h4>
              <div className="chips">
                {phase.missed.map((i) => (
                  <WordChip key={i} i={i} showGloss />
                ))}
              </div>
            </>
          ) : null}
          {phase.found.length ? <p className="muted">Also discovered {phase.found.length} nearby.</p> : null}
          <div className="row">
            {queue.length ? (
              <button type="button" className="primary" onClick={() => setPhase({ kind: 'boss', queue: queue.slice(0, ROUND), seed: Date.now() })}>
                Another round
              </button>
            ) : null}
            <button type="button" onClick={() => setPhase({ kind: 'menu' })}>
              Back to hall
            </button>
          </div>
        </div>
      </Modal>
    )

  return (
    <Modal title={title} onClose={closeHall} className="hall-modal">
      <div className="hall-info">
        <span className={`badge level level-${r.level}`}>{levelLabel(r.level)}</span>
        <span className="badge">{r.kind === 'wild' ? 'Wilderness' : 'Town'}</span>
        <span className="muted">
          {r.count} words · {seen} discovered
        </span>
      </div>
      <div className="hall-progress" title={`${learned} of ${r.count} learned`}>
        <div className="bar">
          <span style={{ width: `${(100 * learned) / Math.max(1, r.count)}%`, background: 'var(--gold)' }} />
        </div>
        <span>
          ★ {learned}/{r.count}
        </span>
      </div>
      {cleared ? <div className="callout gold">🏆 Hall cleared — every word here is learned.</div> : null}
      <div className="hall-actions">
        <button
          type="button"
          className="primary big"
          disabled={!queue.length}
          onClick={() => setPhase({ kind: 'boss', queue: queue.slice(0, ROUND), seed: Date.now() })}
        >
          <span className="ic">⚔️</span>
          <span>
            <b>Challenge</b>
            <small>
              {queue.length
                ? `${Math.min(ROUND, queue.length)} questions · words you get right are cleared`
                : 'Nothing left to challenge here'}
            </small>
          </span>
        </button>
        <button type="button" className="big" disabled={!withSentences.length} onClick={startSentences}>
          <span className="ic">💬</span>
          <span>
            <b>Sentences</b>
            <small>
              {openWithSentences
                ? `Random sentences from this ${r.kind === 'wild' ? 'land' : 'town'} · each one you collect counts for every word in it`
                : withSentences.length
                  ? 'Everything here is learned — practice with its sentences'
                  : 'No example sentences here'}
            </small>
          </span>
        </button>
      </div>
      <button type="button" className="link" onClick={() => setShowList((v) => !v)}>
        {showList ? '▾' : '▸'} Words of this {r.kind === 'wild' ? 'land' : 'town'}
      </button>
      {showList ? (
        <div className="chips hall-words">
          {words.map((i) => (
            <WordChip key={i} i={i} />
          ))}
        </div>
      ) : null}
    </Modal>
  )
}

type Answer = { picked: number | null }

function BossRound({ queue, seed, onDone }: { queue: number[]; seed: number; onDone: (cleared: number[], missed: number[], found: number[]) => void }) {
  const pack = useStore((s) => s.pack!)
  const settings = useStore((s) => s.save.settings)
  const listening = settings.questMode === 'listening'
  const lang = pack.manifest.target.tts
  const questions = useMemo<BossQuestion[]>(() => {
    const rand = rng(seed)
    return queue.map((i) => bossQuestion(pack, i, rand))
  }, [pack, queue, seed])
  const [k, setK] = useState(0)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [cleared, setCleared] = useState<number[]>([])
  const [missed, setMissed] = useState<number[]>([])
  const [found, setFound] = useState<number[]>([])
  const [data, setData] = useState<SentenceData | null>(null)

  useEffect(() => {
    loadSentences(pack).then(setData, () => setData({ sentences: [], byWord: [] }))
  }, [pack])

  const q = questions[k]
  const w = pack.words[q.word]
  const hp = questions.length - cleared.length - missed.length

  useEffect(() => {
    if (listening) speak(w.say, lang, settings.ttsRate)
  }, [k, listening, w.say, lang, settings.ttsRate])

  const pick = (p: number | null) => {
    if (answer) return
    setAnswer({ picked: p })
    const { markKnown, revealWord } = useStore.getState()
    if (p === q.answer) {
      const got = markKnown(q.word, true)
      setCleared((c) => [...c, q.word])
      setFound((f) => [...f, ...got.filter((j) => !queue.includes(j))])
    } else {
      if (useStore.getState().view!.vis[q.word] < Vis.Revealed) revealWord(q.word)
      setMissed((m) => [...m, q.word])
      if (!listening) speak(w.say, lang, settings.ttsRate)
    }
  }

  const next = () => {
    if (k + 1 >= questions.length) {
      onDone(cleared, missed, [...new Set(found)])
      return
    }
    setAnswer(null)
    setK(k + 1)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (answer) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
          e.preventDefault()
          next()
        }
        return
      }
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= q.options.length + 1) {
        e.preventDefault()
        pick(n <= q.options.length ? n - 1 : null)
      } else if (e.key === 'r' && listening) speak(w.say, lang, settings.ttsRate)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const ex = data?.byWord[q.word]?.[0]
  const sentence = ex !== undefined ? data!.sentences[ex] : null
  const right = answer !== null && answer.picked === q.answer

  return (
    <div className="boss">
      <div className="boss-hp" aria-label={`${hp} of ${questions.length} left`}>
        <span className="boss-name">👹 Hall master</span>
        <div className="bar">
          <span style={{ width: `${(100 * (questions.length - cleared.length)) / questions.length}%` }} />
        </div>
        <span className="muted">
          {k + 1}/{questions.length}
        </span>
      </div>
      <div className="boss-prompt">
        {listening && !answer ? (
          <button type="button" className="boss-listen" onClick={() => speak(w.say, lang, settings.ttsRate)} title="Play again (R)">
            🔊
          </button>
        ) : (
          <>
            <div className="boss-hanzi" lang="zh-Hans">
              {w.hanzi}
            </div>
            {answer ? (
              <div className="boss-pinyin">
                {w.pinyin} <SpeakButton text={w.say} />
              </div>
            ) : null}
          </>
        )}
        <div className="muted small">{listening ? 'What did you hear?' : 'What does it mean?'}</div>
      </div>
      <div className="boss-options">
        {q.options.map((j, n) => {
          const cls = answer ? (n === q.answer ? 'right' : n === answer.picked ? 'wrong' : 'dim') : ''
          return (
            <button type="button" key={j} className={cls} disabled={!!answer} onClick={() => pick(n)}>
              <kbd>{n + 1}</kbd>
              {shortGloss(pack.words[j].glosses[0] ?? '')}
            </button>
          )
        })}
        <button type="button" className={`unsure ${answer && answer.picked === null ? 'wrong' : answer ? 'dim' : ''}`} disabled={!!answer} onClick={() => pick(null)}>
          <kbd>{q.options.length + 1}</kbd>🤔 Not sure
        </button>
      </div>
      {answer ? (
        <div className={`boss-feedback ${right ? 'right' : 'wrong'}`}>
          <b>{right ? '💥 Hit! Cleared.' : 'Missed — it’s on your map to learn now.'}</b>
          {!right ? <div>{w.glosses.slice(0, 2).join('; ')}</div> : null}
          {!right && sentence ? (
            <div className="boss-sentence" lang="zh-Hans">
              <SentenceView sentence={sentence} target={q.word} pinyin /> <SpeakButton text={sentenceText(sentence)} />
              <div className="en">{sentence.en}</div>
            </div>
          ) : null}
          <button type="button" className="primary" onClick={next}>
            {k + 1 >= questions.length ? 'Finish' : 'Next'} ➜
          </button>
        </div>
      ) : null}
    </div>
  )
}
