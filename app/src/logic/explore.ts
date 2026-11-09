import type { Pack } from '../data/pack'
import { hanChars } from '../data/pack'
import { isDue, stagesDone, wordStatus, type Progress, type WordStatus } from './progress'

export const Vis = { Hidden: 0, Frontier: 1, Revealed: 2, Active: 3, Learned: 4 } as const
export type Vis = (typeof Vis)[keyof typeof Vis]

export interface MapView {
  vis: Uint8Array
  stages: Uint8Array
  due: Uint8Array
  openCount: number
  learnedCount: number
  activeCount: number
  dueCount: number
  learnedByLevel: number[]
  /** Monotonic counter so renderers can cheaply detect changes. */
  version: number
}

export type LinkKind = 'anchor' | 'child' | 'neighbor' | 'char'

export interface Link {
  j: number
  kind: LinkKind
  weight: number
}

const STATUS_VIS: Record<WordStatus, number> = {
  hidden: Vis.Hidden,
  revealed: Vis.Revealed,
  active: Vis.Active,
  learned: Vis.Learned,
}

/**
 * Direct links that make a hidden word discoverable ("?" on the map). Only words at most one level
 * above `i` count, so the frontier grows outward ring by ring.
 */
export function frontierLinks(pack: Pack, i: number): number[] {
  const w = pack.words[i]
  const out: number[] = []
  if (w.anchor >= 0) out.push(w.anchor)
  for (const j of pack.children[i]) if (pack.words[j].level <= w.level + 1) out.push(j)
  for (const j of w.neighbors.slice(0, 4)) if (pack.words[j].level <= w.level + 1) out.push(j)
  return out
}

/** All links of a word, strongest first, de-duplicated. */
export function linksOf(pack: Pack, i: number, charLimit = 6): Link[] {
  const w = pack.words[i]
  const seen = new Map<number, Link>()
  const add = (j: number, kind: LinkKind, weight: number) => {
    if (j === i || j < 0) return
    const prev = seen.get(j)
    if (!prev) seen.set(j, { j, kind, weight })
    else prev.weight += weight * 0.5
  }
  if (w.anchor >= 0) add(w.anchor, 'anchor', 3)
  for (const c of pack.children[i]) add(c, 'child', 3)
  w.neighbors.forEach((j, k) => add(j, 'neighbor', k < 4 ? 2 : 1))
  for (const ch of hanChars(w.hanzi)) {
    let n = 0
    for (const j of pack.charIndex.get(ch) ?? []) {
      if (j === i || pack.words[j].level > w.level + 1) continue
      add(j, 'char', 1.5)
      if (++n >= charLimit) break
    }
  }
  return [...seen.values()].sort((a, b) => b.weight - a.weight || a.j - b.j)
}

let version = 0

export function computeView(pack: Pack, progress: Progress, need: number, today: string): MapView {
  const n = pack.words.length
  const vis = new Uint8Array(n)
  const stages = new Uint8Array(n)
  const due = new Uint8Array(n)
  let openCount = 0
  let learnedCount = 0
  let activeCount = 0
  let dueCount = 0
  const learnedByLevel = new Array<number>(8).fill(0)
  for (const w of pack.words) {
    const wp = progress[w.id]
    if (!wp) continue
    const v = STATUS_VIS[wordStatus(wp, need)]
    vis[w.i] = v
    stages[w.i] = stagesDone(wp, need)
    if (v === Vis.Revealed || v === Vis.Active) openCount++
    if (v === Vis.Active) activeCount++
    if (v === Vis.Learned) {
      learnedCount++
      learnedByLevel[w.level]++
    }
    if (isDue(wp, need, today)) {
      due[w.i] = 1
      dueCount++
    }
  }
  for (let i = 0; i < n; i++) {
    if (vis[i] < Vis.Revealed) continue
    for (const j of frontierLinks(pack, i)) if (vis[j] === Vis.Hidden) vis[j] = Vis.Frontier
  }
  return {
    vis,
    stages,
    due,
    openCount,
    learnedCount,
    activeCount,
    dueCount,
    learnedByLevel,
    version: ++version,
  }
}

/** Ranked hidden words linked from `from` (or from the whole explored map when `from` is null). */
export function revealCandidates(pack: Pack, view: MapView, from: number | null, limit = 8): number[] {
  const score = new Map<number, number>()
  const consider = (i: number) => {
    const boost = view.vis[i] === Vis.Learned ? 2 : 1
    for (const l of linksOf(pack, i)) {
      if (view.vis[l.j] > Vis.Frontier) continue
      score.set(l.j, (score.get(l.j) ?? 0) + l.weight * boost)
    }
  }
  if (from !== null) consider(from)
  else for (let i = 0; i < view.vis.length; i++) if (view.vis[i] >= Vis.Revealed) consider(i)
  const words = pack.words
  return [...score.keys()]
    .sort(
      (a, b) =>
        words[a].level - words[b].level ||
        score.get(b)! - score.get(a)! ||
        words[b].freq - words[a].freq ||
        a - b,
    )
    .slice(0, limit)
}

/** Words to reveal after progress on `from`, respecting the soft cap on open words. */
export function autoRevealPicks(
  pack: Pack,
  view: MapView,
  from: number,
  count: number,
  cap: number,
): number[] {
  const room = Math.max(0, cap - view.openCount)
  const n = Math.min(count, room)
  if (n <= 0) return []
  let picks = revealCandidates(pack, view, from, n)
  if (picks.length < n) {
    const more = revealCandidates(pack, view, null, n * 2).filter((j) => !picks.includes(j))
    picks = [...picks, ...more].slice(0, n)
  }
  return picks
}

/** Lowest-level hidden word containing the character (other than `exclude`), for "explore this character" hints. */
export function nextHiddenWithChar(pack: Pack, view: MapView, ch: string, exclude?: number): number | null {
  for (const j of pack.charIndex.get(ch) ?? []) if (j !== exclude && view.vis[j] <= Vis.Frontier) return j
  return null
}
