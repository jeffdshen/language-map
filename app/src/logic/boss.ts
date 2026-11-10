import type { Pack } from '../data/pack'
import { Vis, type MapView } from './explore'

/**
 * Words a region's hall can still challenge you on: everything not yet learned, easiest and most common first,
 * with words already on a quest at the end.
 */
export function bossQueue(pack: Pack, view: MapView, region: number): number[] {
  const list = (pack.regionWords[region] ?? []).filter((i) => view.vis[i] !== Vis.Learned)
  return [...list.filter((i) => view.vis[i] !== Vis.Active), ...list.filter((i) => view.vis[i] === Vis.Active)]
}

/** First sense of a gloss, without notes in parentheses, for compact answer buttons. */
export function shortGloss(gloss: string, max = 44): string {
  let s = gloss.split(';')[0].replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  if (!s) s = gloss.trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

function senses(glosses: string[]): Set<string> {
  const out = new Set<string>()
  for (const g of glosses)
    for (const part of g.split(/[;,]/)) {
      const s = part
        .replace(/\([^)]*\)/g, '')
        .trim()
        .toLowerCase()
        .replace(/^(to|a|an|the) /, '')
      if (s) out.add(s)
    }
  return out
}

/** Small seeded PRNG (mulberry32), so a challenge can be replayed in tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Words for a hall's random sentences: the region's unlearned words that have example sentences, shuffled (all of
 * its words with sentences once everything is learned, for practice).
 */
export function sentenceQueue(pack: Pack, view: MapView, region: number, rand: () => number): number[] {
  const withEx = (pack.regionWords[region] ?? []).filter((i) => pack.words[i].ex > 0)
  const open = withEx.filter((i) => view.vis[i] !== Vis.Learned)
  const out = open.length ? open : withEx
  for (let k = out.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1))
    ;[out[k], out[j]] = [out[j], out[k]]
  }
  return out
}

export interface BossQuestion {
  word: number
  /** Word indices whose (short) glosses are the choices, in display order. */
  options: number[]
  /** Position of `word` in `options`. */
  answer: number
}

const levelCache = new WeakMap<Pack, number[][]>()

function wordsByLevel(pack: Pack): number[][] {
  let out = levelCache.get(pack)
  if (!out) {
    out = []
    for (const w of pack.words) (out[w.level] ??= []).push(w.i)
    levelCache.set(pack, out)
  }
  return out
}

/**
 * A multiple-choice question for `word`: its meaning among `choices - 1` distractors. Distractors come from the same
 * region and level (same part of speech preferred), never share a sense with the answer and are never its closest
 * neighbors in meaning, so there is exactly one right answer.
 */
export function bossQuestion(pack: Pack, word: number, rand: () => number, choices = 4): BossQuestion {
  const w = pack.words[word]
  const mine = senses(w.glosses)
  const banned = new Set([word, ...w.neighbors.slice(0, 4)])
  const pool = new Set<number>(pack.regionWords[w.region] ?? [])
  const same = wordsByLevel(pack)[w.level] ?? []
  for (let k = 0; k < Math.min(80, same.length); k++) pool.add(same[Math.floor(rand() * same.length)])
  const scored = [...pool]
    .filter((j) => !banned.has(j) && pack.words[j].hanzi !== w.hanzi)
    .map((j): [number, number] => {
      const o = pack.words[j]
      return [j, (o.pos === w.pos ? 2 : 0) + (o.region === w.region ? 1 : 0) + rand() * 1.5]
    })
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
  const picked: number[] = []
  const shown = new Set([shortGloss(w.glosses[0]).toLowerCase()])
  for (const [j] of scored) {
    if (picked.length >= choices - 1) break
    const o = pack.words[j]
    const label = shortGloss(o.glosses[0]).toLowerCase()
    if (shown.has(label)) continue
    let clash = false
    for (const s of senses(o.glosses)) if (mine.has(s)) clash = true
    if (clash) continue
    shown.add(label)
    picked.push(j)
  }
  const answer = Math.floor(rand() * (picked.length + 1))
  const options = [...picked]
  options.splice(answer, 0, word)
  return { word, options, answer }
}
