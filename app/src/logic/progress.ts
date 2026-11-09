export const STAGE_COUNT = 4

export interface StageInfo {
  key: 'listen-sentence' | 'listen-word' | 'read-sentence' | 'read-word'
  icon: string
  title: string
  short: string
  goal: string
  usesSentence: boolean
}

export const STAGES: readonly StageInfo[] = [
  {
    key: 'listen-sentence',
    icon: '👂',
    title: 'Hear it in a sentence',
    short: 'Hear · sentence',
    goal: 'Listen to a sentence and understand what the word means in it.',
    usesSentence: true,
  },
  {
    key: 'listen-word',
    icon: '🗣️',
    title: 'Hear it alone',
    short: 'Hear · word',
    goal: 'Hear the word (or read its pinyin) and recall the meaning.',
    usesSentence: false,
  },
  {
    key: 'read-sentence',
    icon: '📖',
    title: 'Read it in a sentence',
    short: 'Read · sentence',
    goal: 'Read a sentence in characters and understand the word in it.',
    usesSentence: true,
  },
  {
    key: 'read-word',
    icon: '字',
    title: 'Read it alone',
    short: 'Read · word',
    goal: 'See just the characters and recall the sound and meaning.',
    usesSentence: false,
  },
]

export interface StageProgress {
  /** Distinct learning days (YYYY-MM-DD) with a successful practice. */
  days: string[]
  /** Day the stage was finished through practice; it stays done if days-per-stage is raised later. */
  completed?: string
  /** Self-marked as done (honor system). */
  marked?: boolean
}

export interface WordProgress {
  /** Day the word was revealed on the map. */
  revealed?: string
  /** Day the quest was accepted. */
  started?: string
  stages: StageProgress[]
}

/** Keyed by stable word id. */
export type Progress = Record<string, WordProgress>

export type WordStatus = 'hidden' | 'revealed' | 'active' | 'learned'

export function emptyWordProgress(): WordProgress {
  return { stages: Array.from({ length: STAGE_COUNT }, () => ({ days: [] })) }
}

export function stageDone(sp: StageProgress | undefined, need: number): boolean {
  return !!sp && (!!sp.marked || !!sp.completed || sp.days.length >= need)
}

/**
 * Quest mode: how many stages count, starting from the first. Listening-only play counts the two listening
 * stages; full play counts all four. Practice on other stages is still recorded either way.
 */
export type QuestMode = 'full' | 'listening'

export function activeStages(mode: QuestMode): number {
  return mode === 'listening' ? 2 : STAGE_COUNT
}

export function stagesDone(wp: WordProgress | undefined, need: number, count = STAGE_COUNT): number {
  if (!wp) return 0
  let n = 0
  for (let s = 0; s < count; s++) if (stageDone(wp.stages[s], need)) n++
  return n
}

export function isLearned(wp: WordProgress | undefined, need: number, count = STAGE_COUNT): boolean {
  return !!wp && stagesDone(wp, need, count) === count
}

/** First counted stage that is not done yet, or -1 when the word is learned. */
export function currentStage(wp: WordProgress | undefined, need: number, count = STAGE_COUNT): number {
  if (!wp) return 0
  for (let s = 0; s < count; s++) if (!stageDone(wp.stages[s], need)) return s
  return -1
}

export function wordStatus(wp: WordProgress | undefined, need: number, count = STAGE_COUNT): WordStatus {
  if (!wp) return 'hidden'
  if (isLearned(wp, need, count)) return 'learned'
  if (wp.started) return 'active'
  if (wp.revealed) return 'revealed'
  return 'hidden'
}

/** Active word whose current stage has not had a success today. */
export function isDue(wp: WordProgress | undefined, need: number, today: string, count = STAGE_COUNT): boolean {
  if (!wp?.started) return false
  const cur = currentStage(wp, need, count)
  return cur >= 0 && !wp.stages[cur].days.includes(today)
}

function edit(progress: Progress, id: string, fn: (wp: WordProgress) => WordProgress): Progress {
  const prev = progress[id] ?? emptyWordProgress()
  return { ...progress, [id]: fn(prev) }
}

export function reveal(progress: Progress, id: string, today: string): Progress {
  if (progress[id]?.revealed) return progress
  return edit(progress, id, (wp) => ({ ...wp, revealed: today }))
}

export function startQuest(progress: Progress, id: string, today: string): Progress {
  if (progress[id]?.started) return progress
  return edit(progress, id, (wp) => ({ ...wp, revealed: wp.revealed ?? today, started: today }))
}

export function stopQuest(progress: Progress, id: string): Progress {
  if (!progress[id]?.started) return progress
  return edit(progress, id, (wp) => {
    const next = { ...wp }
    delete next.started
    return next
  })
}

/** Record a successful practice. Only one success per stage per day counts. */
export function recordSuccess(
  progress: Progress,
  id: string,
  stage: number,
  today: string,
  need: number,
): { progress: Progress; counted: boolean } {
  const wp = progress[id]
  if (wp?.stages[stage]?.days.includes(today)) return { progress, counted: false }
  const next = edit(progress, id, (w) => ({
    ...w,
    revealed: w.revealed ?? today,
    started: w.started ?? today,
    stages: w.stages.map((sp, s) => {
      if (s !== stage) return sp
      const days = [...sp.days, today]
      return !sp.completed && days.length >= need ? { ...sp, days, completed: today } : { ...sp, days }
    }),
  }))
  return { progress: next, counted: true }
}

/** Lock in stages already finished under `need`, so raising days-per-stage never undoes progress. */
export function lockCompleted(progress: Progress, need: number): Progress {
  let out: Progress | null = null
  for (const [id, wp] of Object.entries(progress)) {
    if (!wp.stages.some((sp) => !sp.completed && sp.days.length >= need)) continue
    out ??= { ...progress }
    out[id] = {
      ...wp,
      stages: wp.stages.map((sp) =>
        !sp.completed && sp.days.length >= need ? { ...sp, completed: [...sp.days].sort()[need - 1] } : sp,
      ),
    }
  }
  return out ?? progress
}

export function setStageMarked(
  progress: Progress,
  id: string,
  stage: number,
  marked: boolean,
  today: string,
): Progress {
  return edit(progress, id, (w) => ({
    ...w,
    revealed: w.revealed ?? today,
    stages: w.stages.map((sp, s) => {
      if (s !== stage) return sp
      const copy = { ...sp }
      if (marked) copy.marked = true
      else delete copy.marked
      return copy
    }),
  }))
}

/** Mark every stage done ("I already know this word"). */
export function markKnown(progress: Progress, id: string, today: string): Progress {
  return edit(progress, id, (w) => ({
    ...w,
    revealed: w.revealed ?? today,
    stages: w.stages.map((sp) => ({ ...sp, marked: true })),
  }))
}

/** Forget all practice for a word but keep it on the map. */
export function resetWord(progress: Progress, id: string, today: string): Progress {
  const wp = progress[id]
  return { ...progress, [id]: { ...emptyWordProgress(), revealed: wp?.revealed ?? today } }
}
