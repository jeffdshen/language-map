import type { Word } from '../data/types'
import { looksLikePinyin, pinyinKey } from './pinyin'

const HAN = /[\u3400-\u9fff]/

interface Entry {
  forms: string[]
  py: string[]
  senses: string[]
}

export interface SearchIndex {
  words: Word[]
  entries: Entry[]
}

export interface SearchHit {
  i: number
  score: number
  match: 'hanzi' | 'pinyin' | 'english'
}

function senseKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*(to|a|an|the)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildSearchIndex(words: Word[]): SearchIndex {
  const entries = words.map((w) => {
    const forms = [w.hanzi, w.trad, ...w.alts.filter((a) => HAN.test(a))]
    const py = [pinyinKey(w.pinyin), ...w.alts.filter((a) => !HAN.test(a)).map(pinyinKey)]
    const senses = w.glosses.flatMap((g) => g.split(/[;,]/)).map(senseKey).filter(Boolean)
    return { forms: [...new Set(forms)], py: [...new Set(py)].filter(Boolean), senses }
  })
  return { words, entries }
}

function hanziScore(e: Entry, q: string): number {
  let best = 0
  for (const f of e.forms) {
    if (f === q) best = Math.max(best, 100)
    else if (f.startsWith(q)) best = Math.max(best, 80 - (f.length - q.length))
    else if (f.includes(q)) best = Math.max(best, 60 - (f.length - q.length))
  }
  return best
}

function pinyinScore(e: Entry, key: string): number {
  if (!key) return 0
  let best = 0
  for (const p of e.py) {
    if (p === key) best = Math.max(best, 90)
    else if (p.startsWith(key)) best = Math.max(best, 70 - Math.min(20, p.length - key.length))
  }
  return best
}

function englishScore(e: Entry, q: string, re: RegExp): number {
  let best = 0
  for (const s of e.senses) {
    if (s === q) return 85
    if (s.startsWith(q) && re.test(s)) best = Math.max(best, 65 - Math.min(15, s.length / 4))
    else if (re.test(s)) best = Math.max(best, 50 - Math.min(15, s.length / 4))
    else if (q.length >= 4 && s.includes(q)) best = Math.max(best, 25)
  }
  return best
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function search(index: SearchIndex, query: string, limit = 30): SearchHit[] {
  const q = query.trim()
  if (!q) return []
  const hits: SearchHit[] = []
  if (HAN.test(q)) {
    index.entries.forEach((e, i) => {
      const s = hanziScore(e, q)
      if (s > 0) hits.push({ i, score: s, match: 'hanzi' })
    })
  } else {
    const key = looksLikePinyin(q) ? pinyinKey(q) : ''
    const eq = senseKey(q)
    const re = new RegExp(`\\b${escapeRe(eq)}\\b`)
    index.entries.forEach((e, i) => {
      const p = pinyinScore(e, key)
      const en = eq ? englishScore(e, eq, re) : 0
      if (p > 0 || en > 0) {
        hits.push(p >= en ? { i, score: p, match: 'pinyin' } : { i, score: en, match: 'english' })
      }
    })
  }
  const w = index.words
  hits.sort((a, b) => b.score - a.score || w[a.i].level - w[b.i].level || w[b.i].freq - w[a.i].freq || a.i - b.i)
  return hits.slice(0, limit)
}
