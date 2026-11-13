import { activeStages, STAGE_COUNT, type Progress, type QuestMode, type Rules, type SentenceKind, type WordProgress } from './progress'

/** Where speech comes from (see app/src/audio.ts). */
export type AudioSource = 'recorded' | 'browser'

export type FogMode = 'off' | 'dim' | 'hidden'
export type FogScope = 'words' | 'terrain'
/** Pinyin under words on the map: auto = until a region's listening quests are done (always in listening mode). */
export type MapPinyin = 'auto' | 'always' | 'never'

export interface Settings {
  /** off: all words bright · dim: unexplored words faded · hidden: unexplored words invisible ("?" at the frontier). */
  fogMode: FogMode
  /** Which quest stages count: listening only, or listening and reading characters. */
  questMode: QuestMode
  /** Whether fog also covers terrain far from explored words. */
  fogScope: FogScope
  /** Sentences to collect for each sentence stage of a word. */
  sentencesPerStage: number
  /** Reveal linked words automatically when you finish stages. */
  autoReveal: boolean
  mapPinyin: MapPinyin
  /** Text-to-speech rate (0.5–1.5). */
  ttsRate: number
  /** voiceURI of the browser's text-to-speech voice ('' = pick the best installed voice). */
  ttsVoice: string
  /** recorded: the pre-generated clips (browser speech only for text without one) · browser: browser speech. */
  audioSource: AudioSource
}

export const DEFAULT_SETTINGS: Settings = {
  fogMode: 'dim',
  questMode: 'full',
  fogScope: 'words',
  sentencesPerStage: 10,
  autoReveal: true,
  mapPinyin: 'auto',
  ttsRate: 0.85,
  ttsVoice: '',
  audioSource: 'recorded',
}

export function rulesOf(settings: Settings): Rules {
  return { sentences: settings.sentencesPerStage, count: activeStages(settings.questMode) }
}

/** Tatoeba ids of sentences already collected, per kind (a repeat collect only credits the quest word). */
export type Collected = Record<SentenceKind, number[]>

export interface SaveData {
  format: 'language-map-save'
  version: 1
  pack: string
  /** Layout version of the pack the player last saw (for "the map changed" notices). */
  layoutVersion: number
  welcomed: boolean
  settings: Settings
  progress: Progress
  collected: Collected
  updatedAt: string
}

export function newSave(pack: string, layoutVersion: number): SaveData {
  return {
    format: 'language-map-save',
    version: 1,
    pack,
    layoutVersion,
    welcomed: false,
    settings: { ...DEFAULT_SETTINGS },
    progress: {},
    collected: { listen: [], read: [] },
    updatedAt: new Date(0).toISOString(),
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate a word record. Older saves counted good days per stage (`days`); each day becomes one point, and
 * stages that had reached `oldDays` (the save's days-per-stage setting) stay done.
 */
function cleanWord(raw: unknown, oldDays: number): WordProgress | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const stagesRaw = Array.isArray(r.stages) ? r.stages : []
  const stages = Array.from({ length: STAGE_COUNT }, (_, s) => {
    const sp = (stagesRaw[s] ?? {}) as Record<string, unknown>
    const days = Array.isArray(sp.days)
      ? [...new Set(sp.days.filter((d): d is string => typeof d === 'string' && DAY.test(d)))].sort()
      : []
    const n = typeof sp.n === 'number' && Number.isFinite(sp.n) ? Math.max(0, Math.floor(sp.n)) : days.length
    const out: WordProgress['stages'][number] = { n }
    if (typeof sp.completed === 'string' && DAY.test(sp.completed)) out.completed = sp.completed
    else if (typeof sp.n !== 'number' && days.length >= oldDays) out.completed = days[oldDays - 1]
    if (sp.marked === true) out.marked = true
    return out
  })
  const wp: WordProgress = { stages }
  if (typeof r.revealed === 'string' && DAY.test(r.revealed)) wp.revealed = r.revealed
  if (typeof r.started === 'string' && DAY.test(r.started)) wp.started = r.started
  return wp
}

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

export function cleanSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  return {
    fogMode: r.fogMode === 'off' || r.fogMode === 'dim' || r.fogMode === 'hidden' ? r.fogMode : d.fogMode,
    questMode: r.questMode === 'listening' || r.questMode === 'full' ? r.questMode : d.questMode,
    fogScope: r.fogScope === 'terrain' || r.fogScope === 'words' ? r.fogScope : d.fogScope,
    sentencesPerStage: Math.round(clamp(r.sentencesPerStage, 1, 30, d.sentencesPerStage)),
    autoReveal: typeof r.autoReveal === 'boolean' ? r.autoReveal : d.autoReveal,
    mapPinyin:
      r.mapPinyin === 'auto' || r.mapPinyin === 'always' || r.mapPinyin === 'never'
        ? r.mapPinyin
        : r.mapPinyin === false
          ? 'never'
          : d.mapPinyin,
    ttsRate: clamp(r.ttsRate, 0.5, 1.5, d.ttsRate),
    ttsVoice: typeof r.ttsVoice === 'string' ? r.ttsVoice : d.ttsVoice,
    audioSource: r.audioSource === 'browser' || r.audioSource === 'recorded' ? r.audioSource : d.audioSource,
  }
}

function cleanIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((v): v is number => Number.isInteger(v) && v > 0))]
}

/** Validate and normalize a save (from storage or an imported file). Throws on foreign files. */
export function parseSave(raw: unknown, pack: string, knownIds?: Set<string>): SaveData {
  if (!raw || typeof raw !== 'object') throw new Error('Not a save file')
  const r = raw as Record<string, unknown>
  if (r.format !== 'language-map-save') throw new Error('Not a Language Map save file')
  if (r.version !== 1) throw new Error(`Unsupported save version ${String(r.version)}`)
  if (r.pack !== pack) throw new Error(`Save is for pack "${String(r.pack)}", expected "${pack}"`)
  const progress: Progress = {}
  const rawProgress = (r.progress && typeof r.progress === 'object' ? r.progress : {}) as Record<string, unknown>
  const rawSettings = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>
  const oldDays = Math.round(clamp(rawSettings.daysPerStage, 1, 10, 3))
  for (const [id, wp] of Object.entries(rawProgress)) {
    if (knownIds && !knownIds.has(id)) continue
    const clean = cleanWord(wp, oldDays)
    if (clean) progress[id] = clean
  }
  const rawCollected = (r.collected && typeof r.collected === 'object' ? r.collected : {}) as Record<string, unknown>
  return {
    format: 'language-map-save',
    version: 1,
    pack,
    layoutVersion: typeof r.layoutVersion === 'number' ? r.layoutVersion : 0,
    welcomed: r.welcomed === true,
    settings: cleanSettings(r.settings),
    progress,
    collected: { listen: cleanIds(rawCollected.listen), read: cleanIds(rawCollected.read) },
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date(0).toISOString(),
  }
}

const LEGACY_ID = /^L\d-\d{4}$/

/** True when a raw save still uses word ids from the old (pre-2025) word list. */
export function hasLegacyIds(raw: unknown): boolean {
  const progress = raw && typeof raw === 'object' ? (raw as { progress?: unknown }).progress : undefined
  return !!progress && typeof progress === 'object' && Object.keys(progress).some((id) => LEGACY_ID.test(id))
}

function earliest(a: unknown, b: unknown): string | undefined {
  const xs = [a, b].filter((v): v is string => typeof v === 'string' && DAY.test(v)).sort()
  return xs[0]
}

/** Merge two raw word records that map to the same new id (union of practice days / sum of points). */
function mergeRaw(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const sa = Array.isArray(a.stages) ? (a.stages as Record<string, unknown>[]) : []
  const sb = Array.isArray(b.stages) ? (b.stages as Record<string, unknown>[]) : []
  const stages = Array.from({ length: STAGE_COUNT }, (_, s) => {
    const x = sa[s] ?? {}
    const y = sb[s] ?? {}
    const days = [...(Array.isArray(x.days) ? x.days : []), ...(Array.isArray(y.days) ? y.days : [])]
    const out: Record<string, unknown> = { days }
    if (typeof x.n === 'number' || typeof y.n === 'number') out.n = (Number(x.n) || 0) + (Number(y.n) || 0)
    const completed = earliest(x.completed, y.completed)
    if (completed) out.completed = completed
    if (x.marked === true || y.marked === true) out.marked = true
    return out
  })
  const out: Record<string, unknown> = { stages }
  const revealed = earliest(a.revealed, b.revealed)
  const started = earliest(a.started, b.started)
  if (revealed) out.revealed = revealed
  if (started) out.started = started
  return out
}

/** Rename old word ids in a raw save using `map`; ids without a match are dropped. Returns a new object. */
export function migrateLegacyIds(raw: unknown, map: Map<string, string>): { save: unknown; moved: number; lost: number } {
  if (!raw || typeof raw !== 'object') return { save: raw, moved: 0, lost: 0 }
  const r = raw as Record<string, unknown>
  const progress = (r.progress && typeof r.progress === 'object' ? r.progress : {}) as Record<string, unknown>
  const out: Record<string, Record<string, unknown>> = {}
  let moved = 0
  let lost = 0
  for (const [id, wp] of Object.entries(progress)) {
    if (!wp || typeof wp !== 'object') continue
    let target = id
    if (LEGACY_ID.test(id)) {
      const to = map.get(id)
      if (!to) {
        lost++
        continue
      }
      target = to
      moved++
    }
    const rec = wp as Record<string, unknown>
    out[target] = out[target] ? mergeRaw(out[target], rec) : rec
  }
  return { save: { ...r, progress: out }, moved, lost }
}
