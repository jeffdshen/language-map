import { STAGE_COUNT, type Progress, type QuestMode, type WordProgress } from './progress'

export type FogMode = 'off' | 'dim' | 'hidden'
export type FogScope = 'words' | 'terrain'

export interface Settings {
  /** off: all words bright · dim: unexplored words faded · hidden: unexplored words invisible ("?" at the frontier). */
  fogMode: FogMode
  /** Which quest stages count: listening only, or listening and reading characters. */
  questMode: QuestMode
  /** Whether fog also covers terrain far from explored words. */
  fogScope: FogScope
  /** Successful days needed to finish a stage. */
  daysPerStage: number
  /** Soft cap on open (revealed but not learned) words; auto-reveal pauses at the cap. */
  openCap: number
  /** Reveal linked words automatically when you finish stages. */
  autoReveal: boolean
  /** Show pinyin under characters on the map. */
  mapPinyin: boolean
  /** Text-to-speech rate (0.5–1.5). */
  ttsRate: number
  /** Learning day starts at this local hour. */
  rolloverHour: number
}

export const DEFAULT_SETTINGS: Settings = {
  fogMode: 'dim',
  questMode: 'full',
  fogScope: 'words',
  daysPerStage: 3,
  openCap: 25,
  autoReveal: true,
  mapPinyin: true,
  ttsRate: 0.85,
  rolloverHour: 4,
}

export interface SaveData {
  format: 'language-map-save'
  version: 1
  pack: string
  /** Layout version of the pack the player last saw (for "the map changed" notices). */
  layoutVersion: number
  welcomed: boolean
  settings: Settings
  progress: Progress
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
    updatedAt: new Date(0).toISOString(),
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

function cleanWord(raw: unknown): WordProgress | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const stagesRaw = Array.isArray(r.stages) ? r.stages : []
  const stages = Array.from({ length: STAGE_COUNT }, (_, s) => {
    const sp = (stagesRaw[s] ?? {}) as Record<string, unknown>
    const days = Array.isArray(sp.days)
      ? [...new Set(sp.days.filter((d): d is string => typeof d === 'string' && DAY.test(d)))].sort()
      : []
    const out: WordProgress['stages'][number] = { days }
    if (typeof sp.completed === 'string' && DAY.test(sp.completed)) out.completed = sp.completed
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
    daysPerStage: Math.round(clamp(r.daysPerStage, 1, 10, d.daysPerStage)),
    openCap: Math.round(clamp(r.openCap, 3, 500, d.openCap)),
    autoReveal: typeof r.autoReveal === 'boolean' ? r.autoReveal : d.autoReveal,
    mapPinyin: typeof r.mapPinyin === 'boolean' ? r.mapPinyin : d.mapPinyin,
    ttsRate: clamp(r.ttsRate, 0.5, 1.5, d.ttsRate),
    rolloverHour: Math.round(clamp(r.rolloverHour, 0, 12, d.rolloverHour)),
  }
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
  for (const [id, wp] of Object.entries(rawProgress)) {
    if (knownIds && !knownIds.has(id)) continue
    const clean = cleanWord(wp)
    if (clean) progress[id] = clean
  }
  return {
    format: 'language-map-save',
    version: 1,
    pack,
    layoutVersion: typeof r.layoutVersion === 'number' ? r.layoutVersion : 0,
    welcomed: r.welcomed === true,
    settings: cleanSettings(r.settings),
    progress,
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

/** Merge two raw word records that map to the same new id (union of practice days). */
function mergeRaw(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const sa = Array.isArray(a.stages) ? (a.stages as Record<string, unknown>[]) : []
  const sb = Array.isArray(b.stages) ? (b.stages as Record<string, unknown>[]) : []
  const stages = Array.from({ length: STAGE_COUNT }, (_, s) => {
    const x = sa[s] ?? {}
    const y = sb[s] ?? {}
    const days = [...(Array.isArray(x.days) ? x.days : []), ...(Array.isArray(y.days) ? y.days : [])]
    const out: Record<string, unknown> = { days }
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
