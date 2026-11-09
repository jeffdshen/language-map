import type { PosCategory, Sentence } from '../data/types'
import { useStore } from '../store'

export const POS_LABEL: Record<PosCategory, string> = {
  noun: 'noun',
  verb: 'verb',
  adj: 'adjective',
  adv: 'adverb',
  pron: 'pronoun',
  num: 'number',
  measure: 'measure word',
  prep: 'preposition',
  conj: 'conjunction',
  particle: 'particle',
  affix: 'affix',
  interj: 'interjection',
  onomat: 'sound word',
  phrase: 'phrase',
}

export function levelLabel(level: number): string {
  return useStore.getState().pack?.manifest.levels[level - 1]?.label ?? `L${level}`
}

export function tokenPinyin(tok: Sentence['seg'][number]): string {
  if (tok.length === 3) return tok[2]
  if (tok.length === 2 && tok[1] >= 0) return useStore.getState().pack!.words[tok[1]].pinyin
  return ''
}

export function sentenceText(s: Sentence): string {
  return s.seg.map((t) => t[0]).join('')
}

export function sentencePinyin(s: Sentence): string {
  return s.seg
    .map((t) => tokenPinyin(t) || t[0])
    .join(' ')
    .replace(/\s+([，。！？、；：,.!?;:])/g, '$1')
}
