import type { Manifest, Regions, SentenceData, Word, PosCategory, Sentence, SegToken } from './types'

const HAN = /[\u3400-\u9fff\u3007]/

export interface Pack {
  manifest: Manifest
  regions: Regions
  words: Word[]
  byId: Map<string, number>
  /** Words that branch from each word (inverse of `anchor`). */
  children: number[][]
  /** Han character -> indices of words containing it (sorted by level, then frequency). */
  charIndex: Map<string, number[]>
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
  string[],
  number[],
  string,
  string[],
]

const WORD_FIELDS = [
  'id',
  'hanzi',
  'pinyin',
  'level',
  'pos',
  'theme',
  'x',
  'y',
  'anchor',
  'freq',
  'glosses',
  'neighbors',
  'trad',
  'alts',
]

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
    x: r[6],
    y: r[7],
    anchor: r[8],
    freq: r[9],
    glosses: r[10],
    neighbors: r[11],
    trad: r[12],
    alts: r[13],
  }))
}

export function buildPack(manifest: Manifest, regions: Regions, words: Word[], baseUrl = ''): Pack {
  const byId = new Map<string, number>()
  const children: number[][] = words.map(() => [])
  const charIndex = new Map<string, number[]>()
  for (const w of words) {
    byId.set(w.id, w.i)
    if (w.anchor >= 0) children[w.anchor].push(w.i)
    for (const ch of hanChars(w.hanzi)) {
      let list = charIndex.get(ch)
      if (!list) charIndex.set(ch, (list = []))
      list.push(w.i)
    }
  }
  const order = (a: number, b: number) =>
    words[a].level - words[b].level || words[b].freq - words[a].freq || a - b
  for (const list of charIndex.values()) list.sort(order)
  for (const list of children) list.sort(order)
  return { manifest, regions, words, byId, children, charIndex, baseUrl }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  return (await res.json()) as T
}

export async function loadPack(baseUrl: string): Promise<Pack> {
  const manifest = await getJson<Manifest>(`${baseUrl}manifest.json`)
  if (manifest.schema !== 1) throw new Error(`Unsupported pack schema ${manifest.schema}`)
  const [regions, wordFile] = await Promise.all([
    getJson<Regions>(`${baseUrl}${manifest.files.regions}`),
    getJson<RowFile<WordRow>>(`${baseUrl}${manifest.files.words}`),
  ])
  return buildPack(manifest, regions, decodeWords(wordFile), baseUrl)
}

let sentencePromise: Promise<SentenceData> | null = null

export function loadSentences(pack: Pack): Promise<SentenceData> {
  if (!sentencePromise) {
    sentencePromise = getJson<RowFile<[number, number, string, SegToken[]]>>(
      `${pack.baseUrl}${pack.manifest.files.sentences}`,
    )
      .then((file) => ({
        sentences: file.rows.map(
          ([id, enId, en, seg]): Sentence => ({ id, enId, en, seg }),
        ),
        byWord: file.byWord ?? [],
      }))
      .catch((err) => {
        sentencePromise = null
        throw err
      })
  }
  return sentencePromise
}
