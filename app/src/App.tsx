import { useEffect } from 'react'
import { MapView } from './map/MapView'
import { useStore } from './store'
import { AboutModal } from './ui/AboutModal'
import { CharModal } from './ui/CharModal'
import { Legend } from './ui/Legend'
import { MapModal } from './ui/MapModal'
import { QuestLog } from './ui/QuestLog'
import { QuestModal } from './ui/QuestModal'
import { SettingsModal } from './ui/SettingsModal'
import { Toasts } from './ui/Toasts'
import { TopBar } from './ui/TopBar'
import { WelcomeModal } from './ui/WelcomeModal'
import { WordPanel } from './ui/WordPanel'

const PACK = 'zh-en'

function wordFromHash(): string | null {
  const m = /(?:^#|&)w=([^&]+)/.exec(location.hash)
  return m ? decodeURIComponent(m[1]) : null
}

export default function App() {
  const ready = useStore((s) => s.pack !== null && s.view !== null)
  const loadError = useStore((s) => s.loadError)
  const saveError = useStore((s) => s.saveError)

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
        if (s.selected === prev.selected || !s.pack) return
        const hash = s.selected === null ? '' : `#w=${encodeURIComponent(s.pack.words[s.selected].id)}`
        history.replaceState(null, '', `${location.pathname}${location.search}${hash}`)
      }),
    [],
  )

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
        if (s.quest || s.modal) return
        if (s.selected !== null) s.select(null)
        else if (s.questLogOpen) s.setQuestLog(false)
        return
      }
      if (s.quest || s.modal) return
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
    <div className="app">
      <MapView />
      <TopBar />
      <QuestLog />
      <WordPanel />
      <Legend />
      <QuestModal />
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
