export type PosCategory =
  | 'noun'
  | 'verb'
  | 'adj'
  | 'adv'
  | 'pron'
  | 'num'
  | 'measure'
  | 'prep'
  | 'conj'
  | 'particle'
  | 'interj'
  | 'affix'
  | 'onomat'
  | 'phrase'

export interface Word {
  /** Row index in the pack (stable within a pack build; use `id` for persistence). */
  i: number
  /** Stable id from the official syllabus order, e.g. "w00001". */
  id: string
  hanzi: string
  pinyin: string
  level: number
  pos: PosCategory
  theme: number
  /** Index into `world.regions`. */
  region: number
  /** Grid cell (integer world coordinates; the plaza at the center is near 0,0). */
  x: number
  y: number
  /** Index of the easier word this one builds on (shared characters / meaning), or -1. */
  anchor: number
  freq: number
  glosses: string[]
  neighbors: number[]
  trad: string
  alts: string[]
}

export interface LevelInfo {
  level: number
  label: string
  count: number
  regions: number
}

export interface SourceInfo {
  key: string
  name: string
  url: string
  homepage: string
  license: string
  sha256: string
}

export interface Manifest {
  schema: number
  pack: string
  title: string
  target: { lang: string; name: string; tts: string }
  source: { lang: string; name: string }
  layoutVersion: number
  contentHash: string
  files: { words: string; world: string; sentences: string; legacy?: string }
  levels: LevelInfo[]
  /** Word indices revealed on a fresh save (HSK 1 words around the spawn point). */
  starters: number[]
  counts: { words: number; sentences: number; regions: number }
  sources: SourceInfo[]
}

export interface Theme {
  key: string
  zh: string
  en: string
  biome: string
  color: string
  /** Kind of place a town of this theme is (e.g. 港 Harbor). */
  place: { zh: string; en: string }
  count: number
}

export type RegionKind = 'town' | 'wild'

export interface Region {
  id: number
  level: number
  kind: RegionKind
  theme: number
  zh: string
  en: string
  count: number
  cells: number
  /** Label cell (inside the region). */
  x: number
  y: number
  color: string
}

export interface GroundInfo {
  name: string
  color: string
}

export interface World {
  /** Grid origin: cell (x0, y0) is the top-left of the arrays below. */
  x0: number
  y0: number
  w: number
  h: number
  spawn: [number, number]
  /** Ground codes in legend order; `terrain` stores indices into this list. */
  groundCodes: string[]
  ground: GroundInfo[]
  themes: Theme[]
  regions: Region[]
  /** Ground index per cell, row-major (h × w). */
  terrain: Uint8Array
  /** Region id per cell, -1 for sea. */
  regionGrid: Int16Array
}

/** A segment token: [text] | [text, wordIndex] | [text, wordIndex, pinyin]. wordIndex -1 = not an HSK word. */
export type SegToken = [string] | [string, number] | [string, number, string]

export interface Sentence {
  id: number
  enId: number
  en: string
  seg: SegToken[]
}

export interface SentenceData {
  sentences: Sentence[]
  byWord: number[][]
}
