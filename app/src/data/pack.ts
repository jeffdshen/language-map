import type { Manifest, PosCategory, Region, SegToken, Sentence, SentenceData, Word, World } from './types'

const HAN = /[\u3400-\u9fff\u3007]/

export interface Pack {
  manifest: Manifest
  world: World
  words: Word[]
  byId: Map<string, number>
  /** Words that build on each word (inverse of `anchor`). */
  children: number[][]
  /** Han character -> indices of words containing it (sorted by level, then frequency). */
  charIndex: Map<string, number[]>
  /** Word indices per region (sorted by level, then frequency). */
  regionWords: number[][]
  /** Word index per grid cell (row-major, same shape as `world.terrain`), -1 where empty. */
  wordAt: Int32Array
  /** Region id whose hall stands on each grid cell, -1 elsewhere. */
  hallAt: Int16Array
  baseUrl: string
}

interface RowFile<T> {
  fields: string[]
  rows: T[]
  byWord?: number[][]
}

type WordRow = [
  string,
  string,
  string,
  number,
  PosCategory,
  number,
  number,
  number,
  number,
  number,
  number,
  string[],
  number[],
  string,
  string[],
  number,
]

const WORD_FIELDS = [
  'id',
  'hanzi',
  'pinyin',
  'level',
  'pos',
  'theme',
  'region',
  'x',
  'y',
  'anchor',
  'freq',
  'glosses',
  'neighbors',
  'trad',
  'alts',
  'ex',
]

const REGION_FIELDS = ['id', 'level', 'kind', 'theme', 'zh', 'en', 'count', 'cells', 'x', 'y', 'color']

export interface WorldFile {
  grid: { x0: number; y0: number; w: number; h: number }
  spawn: [number, number]
  ground: Record<string, { name: string; color: string }>
  themes: World['themes']
  regionFields: string[]
  regions: unknown[][]
  terrain: string[]
  regionRuns: number[][]
}

export function hanChars(s: string): string[] {
  const out: string[] = []
  for (const ch of s) if (HAN.test(ch) && !out.includes(ch)) out.push(ch)
  return out
}

export function decodeWords(file: RowFile<WordRow>): Word[] {
  if (file.fields.join() !== WORD_FIELDS.join()) {
    throw new Error(`Unexpected word fields: ${file.fields.join(',')}`)
  }
  return file.rows.map((r, i) => ({
    i,
    id: r[0],
    hanzi: r[1],
    pinyin: r[2],
    level: r[3],
    pos: r[4],
    theme: r[5],
    region: r[6],
    x: r[7],
    y: r[8],
    anchor: r[9],
    freq: r[10],
    glosses: r[11],
    neighbors: r[12],
    trad: r[13],
    alts: r[14],
    ex: r[15],
  }))
}

export function decodeWorld(file: WorldFile): World {
  if (file.regionFields.join() !== REGION_FIELDS.join()) {
    throw new Error(`Unexpected region fields: ${file.regionFields.join(',')}`)
  }
  const { x0, y0, w, h } = file.grid
  const groundCodes = Object.keys(file.ground)
  const ground = groundCodes.map((c) => file.ground[c])
  const codeIndex = new Map(groundCodes.map((c, k) => [c, k]))
  const terrain = new Uint8Array(w * h)
  file.terrain.forEach((row, y) => {
    for (let x = 0; x < w; x++) terrain[y * w + x] = codeIndex.get(row[x]) ?? 0
  })
  const regionGrid = new Int16Array(w * h).fill(-1)
  file.regionRuns.forEach((runs, y) => {
    let x = 0
    for (let k = 0; k < runs.length; k += 2) {
      const [id, len] = [runs[k], runs[k + 1]]
      if (id >= 0) regionGrid.fill(id, y * w + x, y * w + x + len)
      x += len
    }
  })
  const regions: Region[] = file.regions.map((r) => ({
    id: r[0] as number,
    level: r[1] as number,
    kind: r[2] as Region['kind'],
    theme: r[3] as number,
    zh: r[4] as string,
    en: r[5] as string,
    count: r[6] as number,
    cells: r[7] as number,
    x: r[8] as number,
    y: r[9] as number,
    color: r[10] as string,
  }))
  return { x0, y0, w, h, spawn: file.spawn, groundCodes, ground, themes: file.themes, regions, terrain, regionGrid }
}

/** Row-major cell index, or -1 outside the grid. */
export function cellIndex(world: World, x: number, y: number): number {
  const cx = Math.round(x) - world.x0
  const cy = Math.round(y) - world.y0
  if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) return -1
  return cy * world.w + cx
}

/** Region id at a world position (-1 for sea or outside the map). */
export function regionAt(world: World, x: number, y: number): number {
  const k = cellIndex(world, x, y)
  return k < 0 ? -1 : world.regionGrid[k]
}

export function buildPack(manifest: Manifest, world: World, words: Word[], baseUrl = ''): Pack {
  const byId = new Map<string, number>()
  const children: number[][] = words.map(() => [])
  const charIndex = new Map<string, number[]>()
  const regionWords: number[][] = world.regions.map(() => [])
  const wordAt = new Int32Array(world.w * world.h).fill(-1)
  for (const w of words) {
    byId.set(w.id, w.i)
    if (w.anchor >= 0) children[w.anchor].push(w.i)
    for (const ch of hanChars(w.hanzi)) {
      let list = charIndex.get(ch)
      if (!list) charIndex.set(ch, (list = []))
      list.push(w.i)
    }
    if (w.region >= 0 && w.region < regionWords.length) regionWords[w.region].push(w.i)
    const k = cellIndex(world, w.x, w.y)
    if (k >= 0) wordAt[k] = w.i
  }
  const hallAt = new Int16Array(world.w * world.h).fill(-1)
  for (const r of world.regions) {
    const k = cellIndex(world, r.x, r.y)
    if (k >= 0 && wordAt[k] < 0) hallAt[k] = r.id
  }
  const order = (a: number, b: number) =>
    words[a].level - words[b].level || words[b].freq - words[a].freq || a - b
  for (const list of charIndex.values()) list.sort(order)
  for (const list of children) list.sort(order)
  for (const list of regionWords) list.sort(order)
  return { manifest, world, words, byId, children, charIndex, regionWords, wordAt, hallAt, baseUrl }
}

/** Indices of words within `radius` cells of (x, y), nearest first. */
export function wordsNear(pack: Pack, x: number, y: number, radius: number): number[] {
  const { world, wordAt } = pack
  const r = Math.ceil(radius)
  const out: [number, number][] = []
  const cx = Math.round(x)
  const cy = Math.round(y)
  for (let dy = -r; dy <= r; dy++) {
    const gy = cy + dy - world.y0
    if (gy < 0 || gy >= world.h) continue
    for (let dx = -r; dx <= r; dx++) {
      const gx = cx + dx - world.x0
      if (gx < 0 || gx >= world.w) continue
      const j = wordAt[gy * world.w + gx]
      if (j < 0) continue
      const d = Math.hypot(pack.words[j].x - x, pack.words[j].y - y)
      if (d <= radius) out.push([d, j])
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((p) => p[1])
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  return (await res.json()) as T
}

/**
 * The manifest is always revalidated, and the other files are requested as `file?v=<contentHash>`,
 * so after a deploy the HTTP cache can never mix files from two different builds.
 */
function dataUrl(baseUrl: string, manifest: Manifest, file: string): string {
  return `${baseUrl}${file}?v=${encodeURIComponent(manifest.contentHash)}`
}

export async function loadPack(baseUrl: string): Promise<Pack> {
  const manifest = await getJson<Manifest>(`${baseUrl}manifest.json`, { cache: 'no-cache' })
  if (manifest.schema !== 4) throw new Error(`Unsupported pack schema ${manifest.schema}`)
  const [worldFile, wordFile] = await Promise.all([
    getJson<WorldFile>(dataUrl(baseUrl, manifest, manifest.files.world)),
    getJson<RowFile<WordRow>>(dataUrl(baseUrl, manifest, manifest.files.words)),
  ])
  return buildPack(manifest, decodeWorld(worldFile), decodeWords(wordFile), baseUrl)
}

export interface LegacyIds {
  bands: [string, number[]][]
}

/** Old (schema 1) word id -> new id map, used to migrate saves made before the 2025 word list. */
export async function loadLegacyIds(pack: Pack): Promise<Map<string, string>> {
  const file = pack.manifest.files.legacy
  if (!file) return new Map()
  const data = await getJson<LegacyIds>(dataUrl(pack.baseUrl, pack.manifest, file))
  return legacyMap(data)
}

export function legacyMap(data: LegacyIds): Map<string, string> {
  const out = new Map<string, string>()
  for (const [band, nums] of data.bands) {
    nums.forEach((n, k) => {
      if (n > 0) out.set(`${band}-${String(k + 1).padStart(4, '0')}`, `w${String(n).padStart(5, '0')}`)
    })
  }
  return out
}

let sentencePromise: Promise<SentenceData> | null = null
let sentenceData: SentenceData | null = null

/** The example sentences, if already loaded. */
export function loadedSentences(): SentenceData | null {
  return sentenceData
}

export function loadSentences(pack: Pack): Promise<SentenceData> {
  if (!sentencePromise) {
    sentencePromise = getJson<RowFile<[number, number, string, SegToken[]]>>(
      dataUrl(pack.baseUrl, pack.manifest, pack.manifest.files.sentences),
    )
      .then((file) => ({
        sentences: file.rows.map(
          ([id, enId, en, seg]): Sentence => ({ id, enId, en, seg }),
        ),
        byWord: file.byWord ?? [],
      }))
      .then((d) => (sentenceData = d))
      .catch((err) => {
        sentencePromise = null
        throw err
      })
  }
  return sentencePromise
}
