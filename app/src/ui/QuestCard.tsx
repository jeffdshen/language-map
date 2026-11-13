import { useEffect, useReducer, useRef, useState } from 'react'
import { loadedSentences, loadSentences } from '../data/pack'
import type { Sentence, SentenceData } from '../data/types'
import { shortGloss } from '../logic/boss'
import { Vis } from '../logic/explore'
import { currentStage, KIND_STAGE, STAGES, stageDone, stageNeeds, type SentenceKind } from '../logic/progress'
import { isCollected, useStore, type Reward } from '../store'
import { canSpeak, onAudioChange, speak, stopSpeaking, wordClip } from '../audio'
import { SentenceView, SpeakButton } from './common'
import { levelLabel, sentencePinyin, sentenceText } from './text'

/**
 * What the card asks for. `sentence`: collect a sentence (credits every word in it). `check`: the word on its own
 * (word-alone stages, and sentence stages of words without example sentences). `done`: learned, nothing to show.
 */
type Task =
  | { mode: 'sentence'; kind: SentenceKind; stage: number; s: Sentence }
  | { mode: 'check'; kind: SentenceKind; stage: number }
  | { mode: 'done' }

type Phase = 'prompt' | 'answered' | 'collected'

const EMPTY: Reward = { credited: [], finished: [], learned: [], revealed: [] }

function merge(a: Reward, b: Reward): Reward {
  return {
    credited: [...a.credited, ...b.credited],
    finished: [...a.finished, ...b.finished],
    learned: [...a.learned, ...b.learned],
    revealed: [...a.revealed, ...b.revealed],
  }
}

/** Whether there is any way to say things (recordings or a browser voice); updates as clips and voices load. */
function useVoice(lang: string): boolean {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => onAudioChange(rerender), [])
  return canSpeak(lang)
}

/** Sentences for word `i`, rotated by its points so far, uncollected ones first. */
function sentenceOrder(data: SentenceData, i: number, collected: number[], points: number): number[] {
  const list = data.byWord[i] ?? []
  if (!list.length) return []
  const start = points % list.length
  const rotated = [...list.slice(start), ...list.slice(0, start)]
  const fresh = rotated.filter((k) => !isCollected(collected, data.sentences[k].id))
  return [...fresh, ...rotated.filter((k) => !fresh.includes(k))]
}

function planTask(i: number, data: SentenceData | null, skip: number): Task | 'loading' {
  const s = useStore.getState()
  const w = s.pack!.words[i]
  const wp = s.save.progress[w.id]
  const needs = stageNeeds(w.ex, s.save.settings.sentencesPerStage)
  const count = s.view!.stageCount
  const listening = s.save.settings.questMode === 'listening'
  const cur = currentStage(wp, needs, count)
  // Learned words still show sentences (collecting one credits the other words in it).
  const kind: SentenceKind = cur < 0 ? (listening ? 'listen' : 'read') : cur < 2 ? 'listen' : 'read'
  const stage = cur < 0 ? KIND_STAGE[kind] : cur
  if (STAGES[stage].usesSentence && w.ex > 0) {
    if (!data) return 'loading'
    const order = sentenceOrder(data, i, s.save.collected[kind], wp?.stages[stage]?.n ?? 0)
    if (order.length) return { mode: 'sentence', kind, stage, s: data.sentences[order[skip % order.length]] }
  }
  return cur < 0 ? { mode: 'done' } : { mode: 'check', kind, stage }
}

/**
 * The quest dialog body for word `i`: plays or shows a sentence right away, then E collects it (a point for
 * every word in it), Space shows the answer (a point for this word only), K marks the word known, X skips to
 * another sentence, I opens the details, N moves on to the next word.
 */
export function QuestCard({
  i,
  where,
  onNextWord,
  nextAfterCollect,
}: {
  i: number
  /** Which overlay hosts the card (keys are ignored while another overlay is on top). */
  where: 'popover' | 'hall'
  onNextWord: () => void
  /** Go straight to the next word after collecting (the hall's random sentences). */
  nextAfterCollect?: boolean
}) {
  const pack = useStore((s) => s.pack!)
  const vis = useStore((s) => s.view!.vis[i])
  const count = useStore((s) => s.view!.stageCount)
  const settings = useStore((s) => s.save.settings)
  const w = pack.words[i]
  const wp = useStore((s) => s.save.progress[w.id])
  const { collect, creditWord, markKnown, setDetails, select } = useStore.getState()
  const lang = pack.manifest.target.tts
  const voice = useVoice(lang)
  const listeningMode = settings.questMode === 'listening'
  const needs = stageNeeds(w.ex, settings.sentencesPerStage)

  const [data, setData] = useState<SentenceData | null>(loadedSentences)
  const [skip, setSkip] = useState(0)
  /** Bumped to plan a fresh task (after collecting). */
  const [round, setRound] = useState(0)
  const planKey = `${i}:${data ? 1 : 0}:${skip}:${round}`
  const [plan, setPlan] = useState<{ key: string; task: Task | 'loading' }>(() => ({ key: planKey, task: planTask(i, data, skip) }))
  const [phase, setPhase] = useState<Phase>('prompt')
  /** Everything earned in this round (show answer + collect add up). */
  const [reward, setReward] = useState<Reward>(EMPTY)
  const [showPinyin, setShowPinyin] = useState(false)

  // Plan a fresh task when sentences arrive, after "another sentence", and after moving on from a collected one
  // (but not when progress changes mid-round).
  if (plan.key !== planKey) {
    setPlan({ key: planKey, task: planTask(i, data, skip) })
    setPhase('prompt')
    setReward(EMPTY)
    setShowPinyin(false)
  }
  const task = plan.task

  useEffect(() => {
    if (data) return
    let live = true
    loadSentences(pack).then(
      (d) => live && setData(d),
      () => live && setData({ sentences: [], byWord: [] }),
    )
    return () => {
      live = false
    }
  }, [data, pack])

  const spoken = typeof task === 'object' && task.mode !== 'done' ? (task.mode === 'sentence' ? sentenceText(task.s) : w.say) : null
  const clip = typeof task === 'object' && task.mode === 'sentence' ? spoken : wordClip(w)
  const rate = settings.ttsRate
  const play = (slow = false) => {
    if (spoken) speak(spoken, lang, slow ? rate * 0.65 : rate, clip ?? undefined)
  }

  // Listening tasks start by playing the sentence (or the word), once per planned task.
  const autoplay = typeof task === 'object' && task.mode !== 'done' && task.kind === 'listen' ? spoken : null
  useEffect(() => {
    if (autoplay) speak(autoplay, lang, rate, clip ?? undefined)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- replay only for a new task, not on a rate change
  }, [autoplay, lang, plan])

  useEffect(() => () => stopSpeaking(), [])

  const learned = vis === Vis.Learned
  const ready = typeof task === 'object'
  const t = ready ? task : null

  const nextTask = () => setRound((r) => r + 1)

  const doCollect = () => {
    if (!t || t.mode === 'done') return
    const r = t.mode === 'sentence' ? collect(i, t.s, t.kind, reward.credited) : creditWord(i, t.stage)
    setReward(merge(reward, r))
    setPhase('collected')
  }

  const doAnswer = () => {
    if (!t || t.mode === 'done' || phase !== 'prompt') return
    // Show answer on a sentence earns this word's point right away; a word-alone check is graded after.
    if (t.mode === 'sentence') setReward(creditWord(i, t.stage))
    setPhase('answered')
  }

  const openDetails = () => {
    if (where === 'hall') select(i, 'link', true)
    setDetails(true)
  }

  const doKnow = () => {
    const revealed = markKnown(i, true)
    setReward(merge(reward, { ...EMPTY, learned: [i], revealed }))
    setPhase('collected')
  }

  const primary: { label: string; run: () => void; title: string } | null = !t
    ? null
    : t.mode === 'done'
      ? { label: 'Next word ➜', run: onNextWord, title: 'Walk to the next word' }
      : phase === 'collected'
        ? nextAfterCollect
          ? { label: 'Next sentence ➜', run: onNextWord, title: 'Another sentence from here' }
          : learned
          ? { label: 'Next word ➜', run: onNextWord, title: 'On to the next word' }
          : { label: t.mode === 'sentence' ? 'Next sentence ➜' : 'Continue ➜', run: nextTask, title: 'Keep going with this word' }
        : t.mode === 'sentence'
          ? phase === 'answered'
            ? { label: '✓ Collect all', run: doCollect, title: 'Collect the sentence for the other words in it too' }
            : { label: '✓ Collect', run: doCollect, title: 'I understood it: a point for every word in the sentence' }
          : phase === 'answered'
            ? { label: '✓ I was right', run: doCollect, title: 'A point for this stage' }
            : { label: '✓ Got it', run: doCollect, title: 'I knew it: a point for this stage' }

  const canAnswer = !!t && t.mode !== 'done' && phase === 'prompt'
  const canSkip = !!t && t.mode === 'sentence' && (data?.byWord[i]?.length ?? 0) > 1 && phase !== 'collected'
  const canKnow = !learned

  const keymap: Record<string, () => void> = { i: openDetails, n: onNextWord }
  if (primary) keymap.e = keymap.enter = primary.run
  if (canAnswer) keymap[' '] = doAnswer
  if (canKnow) keymap.k = doKnow
  if (canSkip) keymap.x = () => setSkip((n) => n + 1)
  if (spoken) keymap.r = () => play()
  const keys = useRef(keymap)
  useEffect(() => {
    keys.current = keymap
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (s.modal || (where === 'popover' && (s.hall !== null || s.details)) || e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const fn = keys.current[e.key.toLowerCase()]
      if (!fn || e.repeat) return
      e.preventDefault()
      fn()
    }
    // A focused button would also "click" on Space/Enter; the shortcut already ran.
    const onKeyUp = (e: KeyboardEvent) => {
      if ((e.key === ' ' || e.key === 'Enter') && (e.target as HTMLElement | null)?.tagName === 'BUTTON') e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [where])

  const mystery = vis < Vis.Revealed && settings.fogMode === 'hidden' && phase === 'prompt'
  const showGloss = learned || phase !== 'prompt'
  // Reading a word on its own: the sound is part of the answer.
  const hidePinyin = !!t && t.mode === 'check' && t.kind === 'read' && phase === 'prompt'
  const cur = currentStage(wp, needs, count)
  const stageInfo = cur >= 0 ? STAGES[cur] : null
  const have = cur >= 0 ? Math.min(wp?.stages[cur]?.n ?? 0, needs[cur]) : 0
  const noVoice = !voice
  const isNew = vis < Vis.Revealed

  return (
    <div className="qc">
      <div className="pop-head">
        {/* Listening mode leads with the sound (as on the map); the characters come second. */}
        <span
          className={`pop-hanzi ${listeningMode && !mystery ? 'pinyin' : ''} ${learned ? 'learned' : vis === Vis.Active ? 'active' : ''}`}
          lang={listeningMode ? undefined : 'zh-Hans'}
        >
          {mystery ? '?' : listeningMode ? w.pinyin : w.hanzi}
        </span>
        <div className="pop-sub">
          <span className="pop-pinyin">
            {mystery ? null : listeningMode ? <span lang="zh-Hans">{w.hanzi}</span> : hidePinyin ? <span className="muted">?</span> : w.pinyin}
            {mystery ? null : <SpeakButton text={w.say} clip={wordClip(w)} />}
            <span className="pop-level">{levelLabel(w.level)}</span>
          </span>
          {showGloss ? (
            <span className="pop-gloss">
              {learned ? '★ ' : ''}
              {shortGloss(w.glosses[0] ?? '', 70)}
            </span>
          ) : (
            <span className="muted pop-gloss">{isNew ? 'New word' : 'Meaning hidden'}</span>
          )}
        </div>
      </div>

      <div className="pop-stages" title="Quest stages">
        {STAGES.slice(0, count).map((st, s) => (
          <span key={st.key} className={`pip ${stageDone(wp?.stages[s], needs[s]) ? 'done' : ''} ${s === cur ? 'cur' : ''}`} title={st.title}>
            {st.icon}
          </span>
        ))}
        <span className="muted">
          {stageInfo ? (
            <>
              {stageInfo.title}
              {needs[cur] > 1 ? (
                <>
                  {' '}
                  · <b>{have}</b>/{needs[cur]}
                </>
              ) : null}
            </>
          ) : (
            '★ Learned'
          )}
        </span>
      </div>

      {!t ? (
        <div className="qc-body muted">Loading sentences…</div>
      ) : t.mode === 'done' ? null : (
        <div className={`qc-body ${phase}`}>
          {t.mode === 'sentence' ? (
            t.kind === 'listen' ? (
              phase === 'prompt' ? (
                <div className="qc-listen">
                  <button type="button" className="play" onClick={() => play()} title="Play again (R)">
                    ▶ Play
                  </button>
                  <button type="button" className="play slow" onClick={() => play(true)} title="Play slowly">
                    🐢
                  </button>
                  {noVoice || showPinyin ? (
                    <div className="qc-pinyin">{sentencePinyin(t.s)}</div>
                  ) : (
                    <button type="button" className="link" onClick={() => setShowPinyin(true)}>
                      pinyin
                    </button>
                  )}
                  {noVoice ? <p className="hint warn">No Chinese voice on this device — read the pinyin instead.</p> : null}
                </div>
              ) : null
            ) : (
              <div className="qc-sentence" lang="zh-Hans">
                <SentenceView
                  sentence={t.s}
                  target={i}
                  pinyin={phase !== 'prompt' || listeningMode}
                  onWord={phase !== 'prompt' ? (j) => select(j, 'link', true) : undefined}
                />{' '}
                <SpeakButton text={sentenceText(t.s)} />
              </div>
            )
          ) : phase === 'prompt' ? (
            <p className="qc-goal">
              {t.kind === 'listen' ? (
                <>
                  <button type="button" className="play" onClick={() => play()} title="Play again (R)">
                    🔊
                  </button>{' '}
                  {w.ex > 0 || t.stage % 2 ? 'Hear the word on its own:' : 'No example sentences — just the word:'} do you know what it means?
                </>
              ) : (
                <>{w.ex > 0 || t.stage % 2 ? 'Just the characters:' : 'No example sentences — just the word:'} can you say it and recall the meaning?</>
              )}
            </p>
          ) : null}
          {t.mode === 'sentence' && phase !== 'prompt' ? (
            t.kind === 'listen' ? (
              <div className="qc-sentence" lang="zh-Hans">
                <SentenceView sentence={t.s} target={i} pinyin onWord={(j) => select(j, 'link', true)} />{' '}
                <SpeakButton text={sentenceText(t.s)} />
                <div className="en">{t.s.en}</div>
              </div>
            ) : (
              <div className="en">{t.s.en}</div>
            )
          ) : null}
          {phase !== 'prompt' && t.mode === 'check' ? (
            <div className="qc-answer">
              <b lang="zh-Hans">{w.hanzi}</b> {w.pinyin} — {w.glosses.slice(0, 3).join('; ')}
            </div>
          ) : null}
          {reward.credited.length || reward.learned.length ? (
            <RewardLine reward={reward} icon={t.mode === 'sentence' ? (t.kind === 'listen' ? '👂' : '📖') : STAGES[t.stage].icon} />
          ) : null}
          {phase === 'collected' && reward.revealed.length ? (
            <div className="qc-reward muted">
              🧭 Discovered{' '}
              {reward.revealed.map((j) => (
                <button key={j} type="button" className="reward-chip" onClick={() => select(j, 'link', true)} lang="zh-Hans">
                  {pack.words[j].hanzi}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <div className="pop-actions">
        {primary ? (
          <button type="button" className="primary" onClick={primary.run} title={`${primary.title} (E)`}>
            {primary.label}
            <kbd>E</kbd>
          </button>
        ) : null}
        {canAnswer ? (
          <button type="button" onClick={doAnswer} title={t?.mode === 'sentence' ? 'Show the answer: a point for this word only (Space)' : 'Show the meaning (Space)'}>
            Show answer<kbd>Space</kbd>
          </button>
        ) : null}
        {canKnow ? (
          <button type="button" onClick={doKnow} title="I already know this word — mark it learned (K)">
            Know it<kbd>K</kbd>
          </button>
        ) : null}
        {canSkip ? (
          <button type="button" onClick={() => setSkip((n) => n + 1)} title="A different example sentence (X)">
            Another<kbd>X</kbd>
          </button>
        ) : null}
        <button type="button" onClick={openDetails} title="Everything about this word (I)">
          Details<kbd>I</kbd>
        </button>
        <button type="button" className="ghost next" onClick={onNextWord} title="Next word (N)" aria-label="Next word">
          ➜<kbd>N</kbd>
        </button>
      </div>
    </div>
  )
}

/** "+1 👂 学生 老师 …" after a collect: which words gained a point, and which finished a stage. */
function RewardLine({ reward, icon }: { reward: Reward; icon: string }) {
  const pack = useStore((s) => s.pack!)
  const select = useStore((s) => s.select)
  const words = [...new Set([...reward.credited, ...reward.learned])]
  return (
    <div className="qc-reward">
      <span className="plus">{reward.credited.length ? `+1 ${icon}` : '★'}</span>
      {words.map((j) => {
        const w = pack.words[j]
        const cls = reward.learned.includes(j) ? 'learned' : reward.finished.includes(j) ? 'finished' : ''
        return (
          <button
            key={j}
            type="button"
            className={`reward-chip ${cls}`}
            onClick={() => select(j, 'link', true)}
            title={`${w.pinyin} — ${w.glosses[0] ?? ''}${cls === 'learned' ? ' (learned!)' : cls === 'finished' ? ' (stage done)' : ''}`}
          >
            <span lang="zh-Hans">{w.hanzi}</span>
            {cls === 'learned' ? ' ★' : cls === 'finished' ? ' ✓' : ''}
          </button>
        )
      })}
    </div>
  )
}
