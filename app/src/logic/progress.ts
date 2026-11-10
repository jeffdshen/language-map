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
    title: 'Hear it in sentences',
    short: 'Hear · sentences',
    goal: 'Collect sentences you understand by ear.',
    usesSentence: true,
  },
  {
    key: 'listen-word',
    icon: '🗣️',
    title: 'Hear it alone',
    short: 'Hear · word',
    goal: 'Hear just the word and recall the meaning.',
    usesSentence: false,
  },
  {
    key: 'read-sentence',
    icon: '📖',
    title: 'Read it in sentences',
    short: 'Read · sentences',
    goal: 'Collect sentences you can read in characters.',
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

/** Sentence stages credited by collecting a sentence: by ear, or by reading. */
export type SentenceKind = 'listen' | 'read'
export const KIND_STAGE: Record<SentenceKind, number> = { listen: 0, read: 2 }

export interface StageProgress {
  /** Points earned: sentences collected (sentence stages) or checks passed (word-alone stages). */
  n: number
  /** Day the stage was finished; it stays done if the requirement is raised later. */
  completed?: string
  /** Self-marked as done (honor system). */
  marked?: boolean
}

export interface WordProgress {
  /** Day the word was revealed on the map. */
  revealed?: string
  /** Day the word earned its first point. */
  started?: string
  stages: StageProgress[]
}

/** Keyed by stable word id. */
export type Progress = Record<string, WordProgress>

export type WordStatus = 'hidden' | 'revealed' | 'active' | 'learned'

/**
 * Quest mode: how many stages count, starting from the first. Listening-only play counts the two listening
 * stages; full play counts all four. Progress on other stages is still recorded either way.
 */
export type QuestMode = 'full' | 'listening'

export interface Rules {
  /** Sentences to collect per sentence stage. */
  sentences: number
  /** Stages that count (2 in listening mode, 4 in full mode). */
  count: number
}

export function activeStages(mode: QuestMode): number {
  return mode === 'listening' ? 2 : STAGE_COUNT
}

/**
 * Points needed per stage for a word with `ex` example sentences. Word-alone stages take one check; sentence
 * stages take `sentences` collects (a word's own sentences loop when it has fewer), or a single word-alone
 * check when it has no example sentences at all.
 */
export function stageNeeds(ex: number, sentences: number): number[] {
  const s = ex > 0 ? sentences : 1
  return [s, 1, s, 1]
}

export function emptyWordProgress(): WordProgress {
  return { stages: Array.from({ length: STAGE_COUNT }, () => ({ n: 0 })) }
}

export function stageDone(sp: StageProgress | undefined, need: number): boolean {
  return !!sp && (!!sp.marked || !!sp.completed || sp.n >= need)
}

export function stagesDone(wp: WordProgress | undefined, needs: readonly number[], count = STAGE_COUNT): number {
  if (!wp) return 0
  let n = 0
  for (let s = 0; s < count; s++) if (stageDone(wp.stages[s], needs[s])) n++
  return n
}

export function isLearned(wp: WordProgress | undefined, needs: readonly number[], count = STAGE_COUNT): boolean {
  return !!wp && stagesDone(wp, needs, count) === count
}

/** First counted stage that is not done yet, or -1 when the word is learned. */
export function currentStage(wp: WordProgress | undefined, needs: readonly number[], count = STAGE_COUNT): number {
  if (!wp) return 0
  for (let s = 0; s < count; s++) if (!stageDone(wp.stages[s], needs[s])) return s
  return -1
}

/** Listening stages (the first two) are done. */
export function heard(wp: WordProgress | undefined, needs: readonly number[]): boolean {
  return stagesDone(wp, needs, 2) === 2
}

export function wordStatus(wp: WordProgress | undefined, needs: readonly number[], count = STAGE_COUNT): WordStatus {
  if (!wp) return 'hidden'
  if (isLearned(wp, needs, count)) return 'learned'
  if (wp.started) return 'active'
  if (wp.revealed) return 'revealed'
  return 'hidden'
}

function edit(progress: Progress, id: string, fn: (wp: WordProgress) => WordProgress): Progress {
  const prev = progress[id] ?? emptyWordProgress()
  return { ...progress, [id]: fn(prev) }
}

export function reveal(progress: Progress, id: string, today: string): Progress {
  if (progress[id]?.revealed) return progress
  return edit(progress, id, (wp) => ({ ...wp, revealed: today }))
}

/** Add one point to a stage (revealing and starting the word). The stage locks in as done once it reaches `need`. */
export function credit(progress: Progress, id: string, stage: number, today: string, need: number): Progress {
  return edit(progress, id, (w) => ({
    ...w,
    revealed: w.revealed ?? today,
    started: w.started ?? today,
    stages: w.stages.map((sp, s) => {
      if (s !== stage) return sp
      const n = sp.n + 1
      return !sp.completed && n >= need ? { ...sp, n, completed: today } : { ...sp, n }
    }),
  }))
}

/**
 * Lock in stages already finished under the old requirements, so raising sentences-per-stage never undoes
 * progress. `needsOf` gives a word's per-stage needs under the old rules.
 */
export function lockCompleted(progress: Progress, needsOf: (id: string) => readonly number[] | null, today: string): Progress {
  let out: Progress | null = null
  for (const [id, wp] of Object.entries(progress)) {
    const needs = needsOf(id)
    if (!needs || !wp.stages.some((sp, s) => !sp.completed && sp.n >= needs[s])) continue
    out ??= { ...progress }
    out[id] = {
      ...wp,
      stages: wp.stages.map((sp, s) => (!sp.completed && sp.n >= needs[s] ? { ...sp, completed: today } : sp)),
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
