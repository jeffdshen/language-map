import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadSentences } from '../data/pack'
import type { SentenceData } from '../data/types'
import { STAGES, stageDone } from '../logic/progress'
import { useStore } from '../store'
import { hasVoice, onVoicesChanged, speak, stopSpeaking, ttsSupported } from '../tts'
import { Dots, LevelBadge, Modal, SentenceView, SpeakButton, WordChip } from './common'
import { sentencePinyin, sentenceText } from './text'

type Phase = 'prompt' | 'answer' | 'result'

interface Result {
  counted: boolean
  stageFinished: boolean
  learned: boolean
  revealed: number[]
}

export function QuestModal() {
  const quest = useStore((s) => s.quest)
  if (!quest) return null
  return <QuestInner key={`${quest.word}:${quest.stage}`} i={quest.word} stage={quest.stage} />
}

function useVoice(lang: string): boolean {
  const [ok, setOk] = useState(() => hasVoice(lang))
  useEffect(() => onVoicesChanged(() => setOk(hasVoice(lang))), [lang])
  return ok
}

function QuestInner({ i, stage }: { i: number; stage: number }) {
  const pack = useStore((s) => s.pack!)
  const w = pack.words[i]
  const wp = useStore((s) => s.save.progress[w.id])
  const need = useStore((s) => s.save.settings.daysPerStage)
  const rate = useStore((s) => s.save.settings.ttsRate)
  const today = useStore((s) => s.today)
  const view = useStore((s) => s.view!)
  const { closeQuest, practiceSuccess, openQuest, select, toast } = useStore.getState()
  const lang = pack.manifest.target.tts
  const info = STAGES[stage]
  const voice = useVoice(lang)

  const [phase, setPhase] = useState<Phase>('prompt')
  const [result, setResult] = useState<Result | null>(null)
  const [data, setData] = useState<SentenceData | null>(null)
  const [shift, setShift] = useState(0)
  const [showPinyin, setShowPinyin] = useState(false)

  useEffect(() => {
    if (!info.usesSentence) return
    loadSentences(pack).then(setData, () => setData({ sentences: [], byWord: [] }))
  }, [info.usesSentence, pack])

  const list = useMemo(() => data?.byWord[i] ?? [], [data, i])
  const daysSoFar = wp?.stages[stage].days.length ?? 0
  const thisStageDone = stageDone(wp?.stages[stage], need)
  const sentence = list.length ? data!.sentences[list[(daysSoFar + shift) % list.length]] : null
  const loading = info.usesSentence && !data
  // Sentence stages fall back to the word-only variant when no example exists.
  const mode: 'listen-sentence' | 'listen-word' | 'read-sentence' | 'read-word' =
    info.usesSentence && !loading && !sentence ? (stage === 0 ? 'listen-word' : 'read-word') : info.key
  const countedToday = wp?.stages[stage].days.includes(today) ?? false

  const play = useCallback(
    (slow = false) => {
      const text = mode === 'listen-sentence' && sentence ? sentenceText(sentence) : w.hanzi
      speak(text, lang, slow ? rate * 0.65 : rate)
    },
    [mode, sentence, w.hanzi, lang, rate],
  )

  // Auto-play the prompt for listening stages.
  useEffect(() => {
    if (phase !== 'prompt' || loading) return
    if (mode === 'listen-sentence' || mode === 'listen-word') play()
  }, [mode, loading, phase, play])

  useEffect(() => () => stopSpeaking(), [])

  const grade = (ok: boolean) => {
    if (!ok) {
      closeQuest()
      toast('No problem — come back to it later. Only good days count.', 'info')
      return
    }
    const r = practiceSuccess(i, stage)
    setResult(r)
    setPhase('result')
  }

  const nextDue = useMemo(() => {
    for (let j = 0; j < view.due.length; j++) if (view.due[j] && j !== i) return j
    return null
  }, [view, i])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === ' ' && (mode === 'listen-sentence' || mode === 'listen-word')) {
        e.preventDefault()
        play()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (phase === 'prompt') setPhase('answer')
        else if (phase === 'answer') grade(true)
        else if (phase === 'result') {
          if (nextDue !== null) openQuest(nextDue)
          else closeQuest()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const stagesHeader = (
    <div className="quest-stages">
      {STAGES.slice(0, Math.max(view.stageCount, stage + 1)).map((st, s) => (
        <button
          type="button"
          key={st.key}
          className={`stage-tab ${s === stage ? 'on' : ''}`}
          onClick={() => openQuest(i, s)}
          title={st.title}
        >
          {st.icon}
        </button>
      ))}
    </div>
  )

  const noVoice = !ttsSupported() || !voice
  const listening = mode === 'listen-sentence' || mode === 'listen-word'

  return (
    <Modal
      className="quest"
      onClose={closeQuest}
      title={
        <span className="quest-title">
          <span>
            {info.icon} {info.title}
          </span>
          <LevelBadge level={w.level} />
        </span>
      }
    >
      {stagesHeader}
      <div className="quest-progress">
        <Dots have={daysSoFar} need={need} marked={wp?.stages[stage].marked} done={thisStageDone} />
        <span className="muted">
          {thisStageDone ? 'Stage done' : `${daysSoFar}/${need} days`}
          {countedToday ? ' · already counted today' : ''}
        </span>
      </div>

      {phase !== 'result' ? (
        <div className="quest-card">
          {loading ? (
            <p className="muted">Loading sentences…</p>
          ) : (
            <>
              <p className="goal">
                {mode === 'listen-sentence' &&
                  'Listen to the sentence. Do you understand it — especially the quest word?'}
                {mode === 'listen-word' && 'Listen to the word. What does it mean?'}
                {mode === 'read-sentence' && 'Read the sentence. What does the highlighted word mean here?'}
                {mode === 'read-word' && 'Read the word. How is it pronounced, and what does it mean?'}
              </p>
              {info.usesSentence && !sentence ? (
                <p className="hint">No example sentence for this word yet — practicing the word on its own.</p>
              ) : null}

              {listening ? (
                <div className="listen">
                  <button type="button" className="play" onClick={() => play()}>
                    ▶ Play
                  </button>
                  <button type="button" className="play slow" onClick={() => play(true)}>
                    🐢 Slow
                  </button>
                  {mode === 'listen-sentence' ? (
                    <button type="button" className="small" onClick={() => speak(w.hanzi, lang, rate)}>
                      🔊 Quest word
                    </button>
                  ) : null}
                </div>
              ) : null}

              {listening && (noVoice || showPinyin) ? (
                <div className="pinyin-prompt">
                  {noVoice ? <p className="hint warn">No Chinese voice on this device — read the pinyin aloud instead.</p> : null}
                  <div className="big-pinyin">
                    {mode === 'listen-sentence' && sentence ? sentencePinyin(sentence) : w.pinyin}
                  </div>
                </div>
              ) : null}
              {listening && !noVoice ? (
                <label className="toggle">
                  <input type="checkbox" checked={showPinyin} onChange={(e) => setShowPinyin(e.target.checked)} /> Show
                  pinyin
                </label>
              ) : null}

              {mode === 'read-sentence' && sentence ? (
                <div className="read-sentence" lang="zh-Hans">
                  <SentenceView sentence={sentence} target={i} />
                </div>
              ) : null}
              {mode === 'read-word' ? (
                <div className="read-word" lang="zh-Hans">
                  {w.hanzi}
                </div>
              ) : null}
            </>
          )}

          {phase === 'answer' ? (
            <div className="answer">
              <div className="answer-word">
                <span className="zh" lang="zh-Hans">
                  {w.hanzi}
                </span>
                <span className="py">{w.pinyin}</span>
                <SpeakButton text={w.hanzi} />
              </div>
              <ol className="glosses">
                {w.glosses.slice(0, 4).map((g, k) => (
                  <li key={k}>{g}</li>
                ))}
              </ol>
              {info.usesSentence && sentence ? (
                <div className="answer-sentence">
                  <div lang="zh-Hans">
                    <SentenceView sentence={sentence} target={i} pinyin />
                  </div>
                  <div className="en">{sentence.en}</div>
                  <div className="row">
                    <SpeakButton text={sentenceText(sentence)} label="Sentence" />
                    <SpeakButton text={sentenceText(sentence)} slow />
                    <a
                      className="src"
                      href={`https://tatoeba.org/sentences/show/${sentence.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Tatoeba #{sentence.id}
                    </a>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="quest-actions">
            {phase === 'prompt' ? (
              <>
                {info.usesSentence && list.length > 1 ? (
                  <button type="button" onClick={() => setShift(shift + 1)} title="Use a different example">
                    ↻ Another sentence
                  </button>
                ) : (
                  <span />
                )}
                <button type="button" className="primary" onClick={() => setPhase('answer')} disabled={loading}>
                  Show answer ⏎
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => grade(false)}>
                  ✗ Not yet
                </button>
                <button type="button" className="primary" onClick={() => grade(true)}>
                  ✓ Got it ⏎
                </button>
              </>
            )}
          </div>
          {phase === 'answer' && countedToday ? (
            <p className="hint">Already counted today — extra practice is great, but it won't add another day.</p>
          ) : null}
        </div>
      ) : (
        <div className="quest-card result">
          {result?.learned ? (
            <h3 className="celebrate">⭐ You learned {w.hanzi}!</h3>
          ) : result?.stageFinished ? (
            <h3 className="celebrate">🎉 Stage complete: {info.title}</h3>
          ) : result?.counted ? (
            <>
              <h3 className="celebrate">✓ Good day logged</h3>
              <Dots have={daysSoFar} need={need} />
              <p className="muted">
                Day {Math.min(daysSoFar, need)} of {need} for “{info.title}”. Come back tomorrow for the next one.
              </p>
            </>
          ) : (
            <>
              <h3 className="celebrate">✓ Nice practice</h3>
              <p className="muted">Today was already counted for this stage.</p>
            </>
          )}
          {result && result.revealed.length ? (
            <div className="revealed-list">
              <p>New words appeared on your map:</p>
              <div className="chips">
                {result.revealed.map((j) => (
                  <WordChip key={j} i={j} showGloss />
                ))}
              </div>
            </div>
          ) : null}
          {result && (result.stageFinished || result.learned) && !result.revealed.length ? (
            <p className="muted">
              You're at your open-word cap, so nothing new was revealed. Finish a few words or raise the cap in
              settings.
            </p>
          ) : null}
          <div className="quest-actions">
            <button
              type="button"
              onClick={() => {
                closeQuest()
                select(i, 'link', true)
              }}
            >
              View on map
            </button>
            {nextDue !== null ? (
              <button type="button" className="primary" onClick={() => openQuest(nextDue)}>
                Next quest ▸
              </button>
            ) : (
              <button type="button" className="primary" onClick={closeQuest}>
                Done
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
