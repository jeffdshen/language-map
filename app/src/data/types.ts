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
  /** Official HSK id, e.g. "L1-0001". Stable across builds. */
  id: string
  hanzi: string
  pinyin: string
  level: number
  pos: PosCategory
  theme: number
  x: number
  y: number
  /** Index of the lower-level word this one branches from, or -1. */
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
  inner: number
  outer: number
  count: number
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
  files: { words: string; regions: string; sentences: string }
  levels: LevelInfo[]
  worldRadius: number
  coreRadius: number
  starters: number[]
  counts: { words: number; sentences: number }
  sources: SourceInfo[]
}

export interface RegionLabel {
  x: number
  y: number
  angle: number
  arc: number
  size: number
}

export interface Region {
  key: string
  zh: string
  en: string
  biome: string
  color: string
  count: number
  labels: RegionLabel[]
}

export interface Geometry {
  theta0: number
  /** Ring edges: radii[0] = core, radii[L] = outer edge of level L. */
  radii: number[]
  /** Mid radius of each level ring. */
  mids: number[]
  /** Per ring: K+1 cumulative sector boundary angles (unwrapped, starting at theta0). */
  bounds: number[][]
}

export interface Regions {
  themes: Region[]
  geometry: Geometry
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
