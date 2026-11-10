import { useEffect } from 'react'
import { MapView } from './map/MapView'
import { useStore } from './store'
import { AboutModal } from './ui/AboutModal'
import { CharModal } from './ui/CharModal'
import { HallModal } from './ui/HallModal'
import { Legend } from './ui/Legend'
import { MapModal } from './ui/MapModal'
import { QuestLog } from './ui/QuestLog'
import { SettingsModal } from './ui/SettingsModal'
import { Toasts } from './ui/Toasts'
import { TopBar } from './ui/TopBar'
import { WelcomeModal } from './ui/WelcomeModal'
import { WordPanel } from './ui/WordPanel'
import { WordPopover } from './ui/WordPopover'

const PACK = 'zh-en'

function wordFromHash(): string | null {
  const m = /(?:^#|&)w=([^&]+)/.exec(location.hash)
  return m ? decodeURIComponent(m[1]) : null
}

/** Keep `#w=<id>` in the URL in step with the selected word (without adding history entries). */
function writeHash() {
  const { pack, selected } = useStore.getState()
  if (!pack) return
  const hash = selected === null ? '' : `#w=${encodeURIComponent(pack.words[selected].id)}`
  if (location.hash !== hash) history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`)
}

type StoreState = ReturnType<typeof useStore.getState>

/** Anything the back button / Esc can close (the welcome screen has no close). */
function overlayOpen(s: StoreState): boolean {
  return (s.modal !== null && s.modal !== 'welcome') || s.hall !== null || s.selected !== null || s.questLogOpen
}

/** Close the topmost overlay, in the same order as Esc. */
function closeTop(s: StoreState) {
  if (s.modal !== null && s.modal !== 'welcome') s.setModal(null)
  else if (s.hall !== null) s.closeHall()
  else if (s.selected !== null && s.details) s.setDetails(false)
  else if (s.selected !== null) s.select(null)
  else if (s.questLogOpen) s.setQuestLog(false)
}

export default function App() {
  const ready = useStore((s) => s.pack !== null && s.view !== null)
  const loadError = useStore((s) => s.loadError)
  const saveError = useStore((s) => s.saveError)
  const popover = useStore((s) => s.selected !== null && !s.details)

  useEffect(() => {
    const { init, tick } = useStore.getState()
    let cancelled = false
    void init(import.meta.env.BASE_URL, PACK).then(() => {
      if (cancelled) return
      const { pack, select } = useStore.getState()
      const id = wordFromHash()
      const i = id && pack ? pack.byId.get(id) : undefined
      if (i !== undefined) select(i, 'url', true)
    })
    const timer = window.setInterval(tick, 60_000)
    const onVisible = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.selected !== prev.selected) writeHash()
      }),
    [],
  )

  // Phone back button (and browser Back) closes the topmost popup instead of leaving the page:
  // while anything is open we keep one extra history entry, and drop it when the last popup closes.
  useEffect(() => {
    let pushed = false
    let ownBack = false
    const sync = (s: StoreState) => {
      if (!s.pack) return
      const open = overlayOpen(s)
      if (open && !pushed) {
        history.pushState({ langmapOverlay: true }, '')
        pushed = true
      } else if (!open && pushed) {
        pushed = false
        ownBack = true
        history.back()
      }
    }
    const onPop = () => {
      if (ownBack) ownBack = false
      else if (pushed) {
        pushed = false
        closeTop(useStore.getState())
      }
      sync(useStore.getState())
      writeHash()
    }
    const unsub = useStore.subscribe(sync)
    window.addEventListener('popstate', onPop)
    sync(useStore.getState())
    return () => {
      unsub()
      window.removeEventListener('popstate', onPop)
    }
  }, [])

  useEffect(() => {
    const onHash = () => {
      const { pack, select, selected } = useStore.getState()
      const id = wordFromHash()
      const i = id && pack ? pack.byId.get(id) : undefined
      if (i !== undefined && i !== selected) select(i, 'url', true)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (!s.pack) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        if (s.modal) return
        if (s.hall !== null) s.closeHall()
        else if (s.selected !== null && s.details) s.setDetails(false)
        else if (s.selected !== null) s.select(null)
        else if (s.questLogOpen) s.setQuestLog(false)
        return
      }
      if (s.modal || s.hall !== null) return
      if (e.key === 'q' || e.key === 'Q') s.setQuestLog(!s.questLogOpen)
      else if (e.key === 'h' || e.key === 'H') s.flyHome()
      else if (e.key === 'm' || e.key === 'M') s.setModal('map')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (loadError) {
    return (
      <div className="splash error">
        <div className="hero-zh">语言地图</div>
        <p>Couldn't load the map data.</p>
        <pre>{loadError}</pre>
        <button type="button" onClick={() => location.reload()}>
          Retry
        </button>
      </div>
    )
  }
  if (!ready) {
    return (
      <div className="splash">
        <div className="hero-zh">语言地图</div>
        <p className="muted">Unfolding the map…</p>
      </div>
    )
  }
  return (
    <div className={popover ? 'app has-popover' : 'app'}>
      <MapView />
      <TopBar />
      <QuestLog />
      <WordPanel />
      <WordPopover />
      <Legend />
      <HallModal />
      <WelcomeModal />
      <SettingsModal />
      <AboutModal />
      <MapModal />
      <CharModal />
      <Toasts />
      {saveError ? (
        <div className="save-banner" role="alert">
          ⚠️ {saveError}
        </div>
      ) : null}
    </div>
  )
}
