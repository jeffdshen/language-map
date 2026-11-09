import { create } from 'zustand'
import { loadLegacyIds, loadPack, regionAt, type Pack } from './data/pack'
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
  seq: number
}

export interface QuestState {
  word: number
  stage: number
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
  hovered: number | null
  modal: Modal
  quest: QuestState | null
  questLogOpen: boolean
  toasts: Toast[]
  camera: CameraRequest | null
  /** Region at the center of the screen (-1 at sea). */
  here: number
  /** Character shown in the character-links view. */
  charFocus: string | null
}

interface Actions {
  init(baseUrl: string, packName: string): Promise<void>
  tick(): void
  select(i: number | null, from?: SelectSource, fly?: boolean): void
  hover(i: number | null): void
  flyTo(i: number): void
  flyToCell(x: number, y: number): void
  flyHome(): void
  /** Called by the map as the camera moves. */
  setFocus(x: number, y: number): void
  openChar(ch: string): void
  setModal(m: Modal): void
  setQuestLog(open: boolean): void
  openQuest(i: number, stage?: number): void
  closeQuest(): void
  revealWord(i: number): void
  revealNextWithChar(ch: string, exclude?: number): void
  discover(): void
  startQuest(i: number): void
  stopQuest(i: number): void
  practiceSuccess(i: number, stage: number): { counted: boolean; stageFinished: boolean; learned: boolean; revealed: number[] }
  markStage(i: number, stage: number, marked: boolean): void
  markKnown(i: number): void
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
/** Last camera center reported by the map (not reactive; used to discover words "near you"). */
let focus: [number, number] = [0, 0]

/** [days per stage, counted stages] for the current settings. */
function rules(settings: Settings): [number, number] {
  return [settings.daysPerStage, P.activeStages(settings.questMode)]
}

function view(pack: Pack, progress: P.Progress, settings: Settings, today: string): MapView {
  const [need, count] = rules(settings)
  return computeView(pack, progress, need, today, count)
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
    const { pack, save, today } = get()
    if (!pack) return
    // Strictly increasing stamps, even if the clock steps back, so newer progress always wins across tabs.
    const now = Math.max(Date.now(), Date.parse(save.updatedAt) + 1 || 0)
    const next: SaveData = { ...save, ...extra, progress, updatedAt: new Date(now).toISOString() }
    set({ save: next, view: view(pack, progress, next.settings, today) })
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
      const today = dayKey(new Date(), next.settings.rolloverHour)
      set({ save: next, today, view: view(pack, next.progress, next.settings, today) })
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

  /** Reveal up to `count` words linked to `from`, within the soft cap. */
  function autoReveal(progress: P.Progress, from: number, count: number): { progress: P.Progress; revealed: number[] } {
    const { pack, save, today } = get()
    if (!pack || !save.settings.autoReveal) return { progress, revealed: [] }
    const picks = autoRevealPicks(pack, view(pack, progress, save.settings, today), from, count, save.settings.openCap)
    let p = progress
    for (const j of picks) p = P.reveal(p, pack.words[j].id, today)
    return { progress: p, revealed: picks }
  }

  function capWarning() {
    const { view, save } = get()
    if (view && view.openCount >= save.settings.openCap) {
      get().toast(
        `You have ${view.openCount} open words (soft cap ${save.settings.openCap}). Finishing some first helps them stick.`,
        'warn',
      )
    }
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
    hovered: null,
    modal: null,
    quest: null,
    questLogOpen: false,
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
        const today = dayKey(new Date(), save.settings.rolloverHour)
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
          view: view(pack, save.progress, save.settings, today),
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
      const { pack, save, today } = get()
      const now = dayKey(new Date(), save.settings.rolloverHour)
      if (pack && now !== today) {
        set({ today: now, view: view(pack, save.progress, save.settings, now) })
      }
    },

    select(i, from = 'map', fly = false) {
      // On narrow screens the word panel and quest log share the bottom sheet slot.
      const narrow = i !== null && typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches
      set(narrow ? { selected: i, selectedFrom: from, questLogOpen: false } : { selected: i, selectedFrom: from })
      if (i !== null && fly) get().flyTo(i)
    },

    hover(i) {
      if (get().hovered !== i) set({ hovered: i })
    },

    flyTo(i) {
      const w = word(i)
      set({ camera: { x: w.x, y: w.y, seq: ++cameraSeq } })
    },

    flyToCell(x, y) {
      set({ camera: { x, y, seq: ++cameraSeq } })
    },

    flyHome() {
      const [x, y] = get().pack?.world.spawn ?? [0, 0]
      set({ camera: { x, y, resetZoom: true, seq: ++cameraSeq } })
    },

    setFocus(x, y) {
      focus = [x, y]
      const { pack, here } = get()
      if (!pack) return
      const r = regionAt(pack.world, x, y)
      if (r >= 0 && r !== here) set({ here: r })
    },

    openChar(ch) {
      set({ charFocus: ch, modal: 'char' })
    },

    setModal(modal) {
      set({ modal })
    },

    setQuestLog(open) {
      set({ questLogOpen: open })
    },

    openQuest(i, stage) {
      const { save } = get()
      const wp = save.progress[word(i).id]
      const [need, count] = rules(save.settings)
      const cur = P.currentStage(wp, need, count)
      set({ quest: { word: i, stage: stage ?? (cur < 0 ? count - 1 : cur) } })
    },

    closeQuest() {
      set({ quest: null })
    },

    revealWord(i) {
      const { save, today } = get()
      commit(P.reveal(save.progress, word(i).id, today))
      capWarning()
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

    startQuest(i) {
      const { save, today } = get()
      commit(P.startQuest(save.progress, word(i).id, today))
    },

    stopQuest(i) {
      commit(P.stopQuest(get().save.progress, word(i).id))
    },

    practiceSuccess(i, stage) {
      const { save, today } = get()
      const [need, count] = rules(save.settings)
      const id = word(i).id
      const before = save.progress[id]
      const doneBefore = P.stageDone(before?.stages[stage], need)
      const learnedBefore = P.isLearned(before, need, count)
      const r = P.recordSuccess(save.progress, id, stage, today, need)
      let progress = r.progress
      const after = progress[id]
      const stageFinished = !doneBefore && P.stageDone(after.stages[stage], need)
      const learned = !learnedBefore && P.isLearned(after, need, count)
      let revealed: number[] = []
      if (stageFinished || learned) {
        const res = autoReveal(progress, i, learned ? 2 : 1)
        progress = res.progress
        revealed = res.revealed
      }
      if (r.counted) commit(progress)
      return { counted: r.counted, stageFinished, learned, revealed }
    },

    markStage(i, stage, marked) {
      const { save, today } = get()
      const [need, count] = rules(save.settings)
      const id = word(i).id
      const learnedBefore = P.isLearned(save.progress[id], need, count)
      let progress = P.setStageMarked(save.progress, id, stage, marked, today)
      if (!learnedBefore && P.isLearned(progress[id], need, count)) {
        progress = autoReveal(progress, i, 2).progress
      }
      commit(progress)
    },

    markKnown(i) {
      const { save, today } = get()
      const id = word(i).id
      const wasLearned = P.isLearned(save.progress[id], ...rules(save.settings))
      let progress = P.markKnown(save.progress, id, today)
      let revealed: number[] = []
      if (!wasLearned) ({ progress, revealed } = autoReveal(progress, i, 2))
      commit(progress)
      const names = revealed.map((j) => word(j).hanzi).join('、')
      get().toast(`Marked ${word(i).hanzi} as known.${names ? ` Discovered ${names}.` : ''}`, 'success')
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
      for (const w of pack.words) {
        if (w.level > maxLevel || P.isLearned(progress[w.id], ...rules(save.settings))) continue
        progress = P.markKnown(progress, w.id, today)
        n++
      }
      // Open a few fresh threads just beyond what is known.
      const v = view(pack, progress, save.settings, today)
      const room = Math.max(0, Math.min(10, save.settings.openCap - v.openCount))
      for (const j of revealCandidates(pack, v, null, room)) progress = P.reveal(progress, pack.words[j].id, today)
      commit(progress)
      return n
    },

    updateSettings(patch) {
      const { pack, save } = get()
      const settings = cleanSettings({ ...save.settings, ...patch })
      const today = dayKey(new Date(), settings.rolloverHour)
      set({ today })
      const progress =
        settings.daysPerStage !== save.settings.daysPerStage
          ? P.lockCompleted(save.progress, save.settings.daysPerStage)
          : save.progress
      if (pack) commit(progress, { settings })
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
      set({ save: { ...fresh, settings: get().save.settings }, saveError: null, selected: null, quest: null })
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
