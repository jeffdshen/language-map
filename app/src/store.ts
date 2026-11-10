import { create } from 'zustand'
import { loadLegacyIds, loadPack, regionAt, type Pack } from './data/pack'
import type { Sentence } from './data/types'
import { dayKey } from './logic/dates'
import {
  autoRevealPicks,
  computeView,
  nearestExplored,
  nextHiddenWithChar,
  revealCandidates,
  Vis,
  type MapView,
} from './logic/explore'
import * as P from './logic/progress'
import {
  cleanSettings,
  hasLegacyIds,
  migrateLegacyIds,
  newSave,
  parseSave,
  rulesOf,
  type SaveData,
  type Settings,
} from './logic/save'
import { buildSearchIndex, type SearchIndex } from './logic/search'
import { cancelPendingWrite, disableWrites, enableWrites, flushWrites, onExternalSave, readSave, scheduleWrite } from './persist'

export type Modal = 'settings' | 'about' | 'welcome' | 'map' | 'char' | null
export type SelectSource = 'map' | 'search' | 'link' | 'url'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'success' | 'warn'
}

export interface CameraRequest {
  /** Target cell. */
  x: number
  y: number
  /** Reset the zoom to the default game view. */
  resetZoom?: boolean
  /** Move the player there too (fast travel), instead of only looking. */
  travel?: boolean
  seq: number
}

export type LogTab = 'open' | 'learned'

/** What a collect or check earned. */
export interface Reward {
  /** Words that gained a point. */
  credited: number[]
  /** Words whose stage was finished by it. */
  finished: number[]
  /** Words learned by it. */
  learned: number[]
  /** Words newly revealed nearby (auto-reveal after the quest word finishes a stage). */
  revealed: number[]
}

interface State {
  pack: Pack | null
  searchIndex: SearchIndex | null
  loadError: string | null
  /** Set when the existing save couldn't be read; writes are disabled so it is never overwritten. */
  saveError: string | null
  save: SaveData
  view: MapView | null
  today: string
  selected: number | null
  selectedFrom: SelectSource
  /** Show the full details panel for the selected word (otherwise the small dialog). */
  details: boolean
  hovered: number | null
  /** Region whose hall dialog is open. */
  hall: number | null
  /** Bumped to ask the map to walk to the next unexplored word nearby. */
  nextSeq: number
  modal: Modal
  questLogOpen: boolean
  logTab: LogTab
  toasts: Toast[]
  camera: CameraRequest | null
  /** Region the player is in (-1 at sea). */
  here: number
  /** Character shown in the character-links view. */
  charFocus: string | null
}

interface Actions {
  init(baseUrl: string, packName: string): Promise<void>
  tick(): void
  select(i: number | null, from?: SelectSource, fly?: boolean): void
  hover(i: number | null): void
  /** Show word `i`; with `travel`, the player goes there too. */
  flyTo(i: number, travel?: boolean): void
  flyToCell(x: number, y: number, travel?: boolean): void
  /** Travel back to the fountain. */
  flyHome(): void
  /** Called by the map as the player moves. */
  setFocus(x: number, y: number): void
  setDetails(open: boolean): void
  openHall(region: number): void
  closeHall(): void
  /** Walk to the next word to work on in the current region. */
  nextWord(): void
  openChar(ch: string): void
  setModal(m: Modal): void
  setQuestLog(open: boolean, tab?: LogTab): void
  revealWord(i: number): void
  revealNextWithChar(ch: string, exclude?: number): void
  discover(): void
  /**
   * Collect a sentence for quest word `focus`: +1 on the sentence stage of `kind` for every HSK word in it the
   * first time the sentence is collected (only `focus` on repeats). Words in `skip` (already credited) are left out.
   */
  collect(focus: number, sentence: Sentence, kind: P.SentenceKind, skip?: number[]): Reward
  /** +1 on one stage of one word (show answer, or a word-alone check). */
  creditWord(i: number, stage: number): Reward
  markStage(i: number, stage: number, marked: boolean): void
  /** Mark a word as known; `quiet` skips the toast (and returns the words it uncovered). */
  markKnown(i: number, quiet?: boolean): number[]
  resetWord(i: number): void
  bulkKnown(maxLevel: number): number
  updateSettings(patch: Partial<Settings>): void
  dismissWelcome(): void
  importSave(raw: unknown): Promise<void>
  exportSave(): SaveData
  resetAll(): void
  toast(text: string, kind?: Toast['kind']): void
  dismissToast(id: number): void
}

export type Store = State & Actions

let toastSeq = 0
let cameraSeq = 0
/** Last player position reported by the map (not reactive; used to discover words "near you"). */
let focus: [number, number] = [0, 0]

function view(pack: Pack, progress: P.Progress, settings: Settings): MapView {
  return computeView(pack, progress, rulesOf(settings))
}

const collectedSets = new WeakMap<number[], Set<number>>()

/** Whether sentence `id` is in a collected-ids list (cached as a set per list). */
export function isCollected(list: number[], id: number): boolean {
  let set = collectedSets.get(list)
  if (!set) {
    set = new Set(list)
    collectedSets.set(list, set)
  }
  return set.has(id)
}

/** Rename word ids from the pre-2025 word list, if the save has any. */
async function migrateRaw(raw: unknown, pack: Pack): Promise<{ raw: unknown; moved: number; lost: number }> {
  if (!hasLegacyIds(raw)) return { raw, moved: 0, lost: 0 }
  const map = await loadLegacyIds(pack)
  const r = migrateLegacyIds(raw, map)
  return { raw: r.save, moved: r.moved, lost: r.lost }
}

function migrationNote(moved: number, lost: number): string | null {
  if (!moved && !lost) return null
  return (
    `The word list was updated to the official 2025 HSK syllabus. Progress on ${moved} word${moved === 1 ? '' : 's'} carried over` +
    (lost ? `; ${lost} word${lost === 1 ? ' is' : 's are'} no longer on the list.` : '.')
  )
}

export const useStore = create<Store>()((set, get) => {
  /** Apply a new progress map: recompute the view and persist. */
  function commit(progress: P.Progress, extra: Partial<SaveData> = {}) {
    const { pack, save } = get()
    if (!pack) return
    // Strictly increasing stamps, even if the clock steps back, so newer progress always wins across tabs.
    const now = Math.max(Date.now(), Date.parse(save.updatedAt) + 1 || 0)
    const next: SaveData = { ...save, ...extra, progress, updatedAt: new Date(now).toISOString() }
    set({ save: next, view: view(pack, progress, next.settings), today: dayKey() })
    scheduleWrite(pack.manifest.pack, next)
  }

  function word(i: number) {
    return get().pack!.words[i]
  }

  /** Adopt newer progress saved by another tab, so a stale tab never overwrites it. */
  let syncInstalled = false
  function installSync(ids: Set<string>) {
    if (syncInstalled) return
    syncInstalled = true
    const refresh = async () => {
      const { pack, saveError } = get()
      if (!pack || saveError) return
      const read = await readSave(pack.manifest.pack)
      if (read.status !== 'ok') return
      let next: SaveData
      try {
        next = parseSave(read.data, pack.manifest.pack, ids)
      } catch {
        return
      }
      if (next.updatedAt <= get().save.updatedAt) return
      cancelPendingWrite()
      set({ save: next, view: view(pack, next.progress, next.settings) })
    }
    onExternalSave((p, updatedAt) => {
      const { pack, save, saveError } = get()
      if (!pack || p !== pack.manifest.pack || saveError) return
      if (updatedAt > save.updatedAt) void refresh()
      // Another tab stored older progress than ours (e.g. it flushed just before hearing from us): restore ours.
      else if (updatedAt < save.updatedAt) scheduleWrite(p, save)
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refresh()
    })
  }

  /** Reveal up to `count` words linked to `from`. */
  function autoReveal(progress: P.Progress, from: number, count: number): { progress: P.Progress; revealed: number[] } {
    const { pack, save, today } = get()
    if (!pack || !save.settings.autoReveal) return { progress, revealed: [] }
    const picks = autoRevealPicks(pack, view(pack, progress, save.settings), from, count)
    let p = progress
    for (const j of picks) p = P.reveal(p, pack.words[j].id, today)
    return { progress: p, revealed: picks }
  }

  function needs(i: number, settings: Settings): number[] {
    return P.stageNeeds(word(i).ex, settings.sentencesPerStage)
  }

  /** Add a point on `stage` to each word in `targets` that still needs it; auto-reveal after the focus word's progress. */
  function award(targets: number[], stage: number, focus: number, extra: Partial<SaveData> = {}): Reward {
    const { save, today } = get()
    const { count } = rulesOf(save.settings)
    let progress = save.progress
    const reward: Reward = { credited: [], finished: [], learned: [], revealed: [] }
    for (const j of targets) {
      const id = word(j).id
      const nd = needs(j, save.settings)
      const before = progress[id]
      if (P.stageDone(before?.stages[stage], nd[stage]) || P.isLearned(before, nd, count)) continue
      progress = P.credit(progress, id, stage, today, nd[stage])
      reward.credited.push(j)
      if (P.stageDone(progress[id].stages[stage], nd[stage])) reward.finished.push(j)
      if (P.isLearned(progress[id], nd, count)) reward.learned.push(j)
    }
    if (reward.learned.includes(focus) || reward.finished.includes(focus)) {
      const r = autoReveal(progress, focus, reward.learned.includes(focus) ? 2 : 1)
      progress = r.progress
      reward.revealed = r.revealed
    }
    if (reward.credited.length || Object.keys(extra).length) commit(progress, extra)
    return reward
  }

  return {
    pack: null,
    searchIndex: null,
    loadError: null,
    saveError: null,
    save: newSave('', 0),
    view: null,
    today: dayKey(),
    selected: null,
    selectedFrom: 'map',
    details: false,
    hovered: null,
    hall: null,
    nextSeq: 0,
    modal: null,
    questLogOpen: false,
    logTab: 'open',
    toasts: [],
    camera: null,
    here: -1,
    charFocus: null,

    async init(baseUrl, packName) {
      try {
        const pack = await loadPack(`${baseUrl}${packName}/`)
        const ids = new Set(pack.words.map((w) => w.id))
        let save = newSave(pack.manifest.pack, pack.manifest.layoutVersion)
        let saveError: string | null = null
        let note: string | null = null
        const read = await readSave(pack.manifest.pack)
        if (read.status === 'ok') {
          try {
            const m = await migrateRaw(read.data, pack)
            note = migrationNote(m.moved, m.lost)
            save = parseSave(m.raw, pack.manifest.pack, ids)
          } catch (err) {
            saveError = `Your saved progress couldn't be loaded (${err instanceof Error ? err.message : String(err)}).`
          }
        } else if (read.status === 'error') {
          saveError = "Couldn't read your saved progress from browser storage. Reload to try again."
        }
        if (saveError) {
          saveError += ' Changes in this session will not be saved.'
          disableWrites()
        }
        const today = dayKey()
        if (Object.keys(save.progress).length === 0) {
          for (const i of pack.manifest.starters) save.progress = P.reveal(save.progress, pack.words[i].id, today)
        }
        const layoutChanged = read.status === 'ok' && !saveError && save.layoutVersion !== pack.manifest.layoutVersion
        // "Dim" became the default with the grid map (v2); saves from the old map still had "hidden" by default.
        if (layoutChanged && save.layoutVersion < 2 && save.settings.fogMode === 'hidden') {
          save = { ...save, settings: { ...save.settings, fogMode: 'dim' } }
        }
        save = { ...save, layoutVersion: pack.manifest.layoutVersion }
        focus = [...pack.world.spawn]
        set({
          pack,
          save,
          view: view(pack, save.progress, save.settings),
          today,
          here: regionAt(pack.world, focus[0], focus[1]),
          searchIndex: buildSearchIndex(pack.words),
          saveError,
          modal: save.welcomed || saveError ? null : 'welcome',
        })
        scheduleWrite(pack.manifest.pack, save)
        installSync(ids)
        if (note) get().toast(note, 'info')
        else if (layoutChanged) get().toast('The map was redrawn. Your progress is kept.', 'info')
      } catch (err) {
        set({ loadError: err instanceof Error ? err.message : String(err) })
      }
    },

    tick() {
      const now = dayKey()
      if (now !== get().today) set({ today: now })
    },

    select(i, from = 'map', fly = false) {
      // On narrow screens the word panel and quest log share the bottom sheet slot.
      const narrow = i !== null && typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches
      // Links followed from the details panel keep it open; anything else starts with the small dialog.
      const details = i !== null && from === 'link' && get().details
      const hall = i !== null ? null : get().hall
      set(
        narrow
          ? { selected: i, selectedFrom: from, details, hall, questLogOpen: false }
          : { selected: i, selectedFrom: from, details, hall },
      )
      if (i !== null && fly) get().flyTo(i, from === 'search' || from === 'url')
    },

    hover(i) {
      if (get().hovered !== i) set({ hovered: i })
    },

    flyTo(i, travel = false) {
      const w = word(i)
      set({ camera: { x: w.x, y: w.y, travel, seq: ++cameraSeq } })
    },

    flyToCell(x, y, travel = false) {
      set({ camera: { x, y, travel, seq: ++cameraSeq } })
    },

    flyHome() {
      const [x, y] = get().pack?.world.spawn ?? [0, 0]
      set({ camera: { x, y, travel: true, seq: ++cameraSeq } })
    },

    setFocus(x, y) {
      focus = [x, y]
      const { pack, here } = get()
      if (!pack) return
      const r = regionAt(pack.world, x, y)
      if (r >= 0 && r !== here) set({ here: r })
    },

    setDetails(open) {
      set({ details: open })
    },

    openHall(region) {
      set({ hall: region, selected: null, details: false })
    },

    closeHall() {
      set({ hall: null })
    },

    nextWord() {
      set({ nextSeq: get().nextSeq + 1 })
    },

    openChar(ch) {
      set({ charFocus: ch, modal: 'char' })
    },

    setModal(modal) {
      set({ modal })
    },

    setQuestLog(open, tab) {
      set(tab ? { questLogOpen: open, logTab: tab } : { questLogOpen: open })
    },

    revealWord(i) {
      const { save, today } = get()
      commit(P.reveal(save.progress, word(i).id, today))
    },

    revealNextWithChar(ch, exclude) {
      const { pack, view } = get()
      if (!pack || !view) return
      const j = nextHiddenWithChar(pack, view, ch, exclude)
      if (j === null) {
        get().toast(`Every word with ${ch} is already on your map.`)
        return
      }
      get().revealWord(j)
      get().select(j, 'link', true)
    },

    discover() {
      const { pack, view } = get()
      if (!pack || !view) return
      let from = get().selected
      if (from === null || view.vis[from] < Vis.Revealed) from = nearestExplored(pack, view, focus[0], focus[1], 14)
      let picks = from !== null ? revealCandidates(pack, view, from, 1) : []
      if (!picks.length) picks = revealCandidates(pack, view, null, 1)
      if (!picks.length) {
        get().toast('Nothing left to discover nearby. Search for a word to place it on your map.')
        return
      }
      get().revealWord(picks[0])
      get().select(picks[0], 'link', true)
    },

    collect(focus, sentence, kind, skip = []) {
      const { save } = get()
      const repeat = isCollected(save.collected[kind], sentence.id)
      const targets = [focus]
      if (!repeat) for (const tok of sentence.seg) if (tok.length >= 2 && (tok[1] as number) >= 0) targets.push(tok[1] as number)
      const uniq = [...new Set(targets)].filter((j) => !skip.includes(j))
      const extra: Partial<SaveData> = repeat
        ? {}
        : { collected: { ...save.collected, [kind]: [...save.collected[kind], sentence.id] } }
      return award(uniq, P.KIND_STAGE[kind], focus, extra)
    },

    creditWord(i, stage) {
      return award([i], stage, i)
    },

    markStage(i, stage, marked) {
      const { save, today } = get()
      const { count } = rulesOf(save.settings)
      const nd = needs(i, save.settings)
      const id = word(i).id
      const learnedBefore = P.isLearned(save.progress[id], nd, count)
      let progress = P.setStageMarked(save.progress, id, stage, marked, today)
      if (!learnedBefore && P.isLearned(progress[id], nd, count)) {
        progress = autoReveal(progress, i, 2).progress
      }
      commit(progress)
    },

    markKnown(i, quiet = false) {
      const { save, today } = get()
      const id = word(i).id
      const wasLearned = P.isLearned(save.progress[id], needs(i, save.settings), rulesOf(save.settings).count)
      let progress = P.markKnown(save.progress, id, today)
      let revealed: number[] = []
      if (!wasLearned) ({ progress, revealed } = autoReveal(progress, i, 2))
      commit(progress)
      if (!quiet) {
        const names = revealed.map((j) => word(j).hanzi).join('、')
        get().toast(`Marked ${word(i).hanzi} as known.${names ? ` Discovered ${names}.` : ''}`, 'success')
      }
      return revealed
    },

    resetWord(i) {
      const { save, today } = get()
      commit(P.resetWord(save.progress, word(i).id, today))
    },

    bulkKnown(maxLevel) {
      const { pack, save, today } = get()
      if (!pack) return 0
      let progress = save.progress
      let n = 0
      const { count } = rulesOf(save.settings)
      for (const w of pack.words) {
        if (w.level > maxLevel || P.isLearned(progress[w.id], needs(w.i, save.settings), count)) continue
        progress = P.markKnown(progress, w.id, today)
        n++
      }
      // Open a few fresh threads just beyond what is known.
      const v = view(pack, progress, save.settings)
      for (const j of revealCandidates(pack, v, null, 10)) progress = P.reveal(progress, pack.words[j].id, today)
      commit(progress)
      return n
    },

    updateSettings(patch) {
      const { pack, save, today } = get()
      const settings = cleanSettings({ ...save.settings, ...patch })
      if (!pack) return
      // Stages finished under the old requirement stay finished.
      let progress = save.progress
      if (settings.sentencesPerStage !== save.settings.sentencesPerStage) {
        const byId = new Map(pack.words.map((w) => [w.id, w]))
        progress = P.lockCompleted(
          progress,
          (id) => {
            const w = byId.get(id)
            return w ? P.stageNeeds(w.ex, save.settings.sentencesPerStage) : null
          },
          today,
        )
      }
      commit(progress, { settings })
    },

    dismissWelcome() {
      commit(get().save.progress, { welcomed: true })
      set({ modal: null })
    },

    async importSave(raw) {
      const { pack } = get()
      if (!pack) return
      const ids = new Set(pack.words.map((w) => w.id))
      const m = await migrateRaw(raw, pack)
      const save = parseSave(m.raw, pack.manifest.pack, ids)
      const note = migrationNote(m.moved, m.lost)
      if (note) get().toast(note, 'info')
      enableWrites()
      set({ save, saveError: null })
      commit(save.progress, { welcomed: true, layoutVersion: pack.manifest.layoutVersion })
      flushWrites()
    },

    exportSave() {
      return get().save
    },

    resetAll() {
      const { pack, today } = get()
      if (!pack) return
      let progress: P.Progress = {}
      for (const i of pack.manifest.starters) progress = P.reveal(progress, pack.words[i].id, today)
      const fresh = newSave(pack.manifest.pack, pack.manifest.layoutVersion)
      enableWrites()
      set({ save: { ...fresh, settings: get().save.settings }, saveError: null, selected: null, hall: null })
      commit(progress, { welcomed: false })
      flushWrites()
      set({ modal: 'welcome' })
    },

    toast(text, kind = 'info') {
      const id = ++toastSeq
      set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] })
      setTimeout(() => get().dismissToast(id), kind === 'warn' ? 7000 : 4500)
    },

    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) })
    },
  }
})
