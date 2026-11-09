import { create } from 'zustand'
import { loadPack, type Pack } from './data/pack'
import { dayKey } from './logic/dates'
import { autoRevealPicks, computeView, nextHiddenWithChar, revealCandidates, Vis, type MapView } from './logic/explore'
import * as P from './logic/progress'
import { cleanSettings, newSave, parseSave, type SaveData, type Settings } from './logic/save'
import { buildSearchIndex, type SearchIndex } from './logic/search'
import { cancelPendingWrite, disableWrites, enableWrites, flushWrites, onExternalSave, readSave, scheduleWrite } from './persist'

export type Modal = 'settings' | 'about' | 'welcome' | null
export type SelectSource = 'map' | 'search' | 'link' | 'url'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'success' | 'warn'
}

export interface CameraRequest {
  x: number
  y: number
  /** Minimum zoom (pixels per world unit). */
  minScale?: number
  scale?: number
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
}

interface Actions {
  init(baseUrl: string, packName: string): Promise<void>
  tick(): void
  select(i: number | null, from?: SelectSource, fly?: boolean): void
  hover(i: number | null): void
  flyTo(i: number, minScale?: number): void
  flyHome(): void
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
  importSave(raw: unknown): void
  exportSave(): SaveData
  resetAll(): void
  toast(text: string, kind?: Toast['kind']): void
  dismissToast(id: number): void
}

export type Store = State & Actions

let toastSeq = 0
let cameraSeq = 0

export const useStore = create<Store>()((set, get) => {
  /** Apply a new progress map: recompute the view and persist. */
  function commit(progress: P.Progress, extra: Partial<SaveData> = {}) {
    const { pack, save, today } = get()
    if (!pack) return
    // Strictly increasing stamps, even if the clock steps back, so newer progress always wins across tabs.
    const now = Math.max(Date.now(), Date.parse(save.updatedAt) + 1 || 0)
    const next: SaveData = { ...save, ...extra, progress, updatedAt: new Date(now).toISOString() }
    const view = computeView(pack, progress, next.settings.daysPerStage, today)
    set({ save: next, view })
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
      set({ save: next, today, view: computeView(pack, next.progress, next.settings.daysPerStage, today) })
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
    const view = computeView(pack, progress, save.settings.daysPerStage, today)
    const picks = autoRevealPicks(pack, view, from, count, save.settings.openCap)
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

    async init(baseUrl, packName) {
      try {
        const pack = await loadPack(`${baseUrl}${packName}/`)
        const ids = new Set(pack.words.map((w) => w.id))
        let save = newSave(pack.manifest.pack, pack.manifest.layoutVersion)
        let saveError: string | null = null
        const read = await readSave(pack.manifest.pack)
        if (read.status === 'ok') {
          try {
            save = parseSave(read.data, pack.manifest.pack, ids)
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
        save = { ...save, layoutVersion: pack.manifest.layoutVersion }
        const view = computeView(pack, save.progress, save.settings.daysPerStage, today)
        set({
          pack,
          save,
          view,
          today,
          searchIndex: buildSearchIndex(pack.words),
          saveError,
          modal: save.welcomed || saveError ? null : 'welcome',
        })
        scheduleWrite(pack.manifest.pack, save)
        installSync(ids)
        if (layoutChanged) get().toast('The map layout was updated. Your progress is kept.', 'info')
      } catch (err) {
        set({ loadError: err instanceof Error ? err.message : String(err) })
      }
    },

    tick() {
      const { pack, save, today } = get()
      const now = dayKey(new Date(), save.settings.rolloverHour)
      if (pack && now !== today) {
        set({ today: now, view: computeView(pack, save.progress, save.settings.daysPerStage, now) })
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

    flyTo(i, minScale = 26) {
      const w = word(i)
      set({ camera: { x: w.x, y: w.y, minScale, seq: ++cameraSeq } })
    },

    flyHome() {
      set({ camera: { x: 0, y: 0, scale: 0, seq: ++cameraSeq } })
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
      const cur = P.currentStage(wp, save.settings.daysPerStage)
      set({ quest: { word: i, stage: stage ?? (cur < 0 ? P.STAGE_COUNT - 1 : cur) } })
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
      const from = get().selected
      let picks = from !== null && view.vis[from] >= Vis.Revealed ? revealCandidates(pack, view, from, 1) : []
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
      const need = save.settings.daysPerStage
      const id = word(i).id
      const before = save.progress[id]
      const doneBefore = P.stageDone(before?.stages[stage], need)
      const learnedBefore = P.isLearned(before, need)
      const r = P.recordSuccess(save.progress, id, stage, today, need)
      let progress = r.progress
      const after = progress[id]
      const stageFinished = !doneBefore && P.stageDone(after.stages[stage], need)
      const learned = !learnedBefore && P.isLearned(after, need)
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
      const need = save.settings.daysPerStage
      const id = word(i).id
      const learnedBefore = P.isLearned(save.progress[id], need)
      let progress = P.setStageMarked(save.progress, id, stage, marked, today)
      if (!learnedBefore && P.isLearned(progress[id], need)) {
        progress = autoReveal(progress, i, 2).progress
      }
      commit(progress)
    },

    markKnown(i) {
      const { save, today } = get()
      const id = word(i).id
      const wasLearned = P.isLearned(save.progress[id], save.settings.daysPerStage)
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
        if (w.level > maxLevel || P.isLearned(progress[w.id], save.settings.daysPerStage)) continue
        progress = P.markKnown(progress, w.id, today)
        n++
      }
      // Open a few fresh threads just beyond what is known.
      const view = computeView(pack, progress, save.settings.daysPerStage, today)
      const room = Math.max(0, Math.min(10, save.settings.openCap - view.openCount))
      for (const j of revealCandidates(pack, view, null, room)) progress = P.reveal(progress, pack.words[j].id, today)
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

    importSave(raw) {
      const { pack } = get()
      if (!pack) return
      const ids = new Set(pack.words.map((w) => w.id))
      const save = parseSave(raw, pack.manifest.pack, ids)
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
