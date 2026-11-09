import { useState } from 'react'
import type { QuestMode } from '../logic/progress'
import { useStore } from '../store'
import { Modal } from './common'

export function WelcomeModal() {
  const modal = useStore((s) => s.modal)
  const pack = useStore((s) => s.pack!)
  const { dismissWelcome, bulkKnown, toast, flyHome, updateSettings } = useStore.getState()
  const [known, setKnown] = useState(0)
  const [mode, setMode] = useState<QuestMode>(() => useStore.getState().save.settings.questMode)
  if (modal !== 'welcome') return null
  const start = () => {
    updateSettings({ questMode: mode })
    if (known > 0) {
      const n = bulkKnown(known)
      toast(`Marked ${n} words as known — the map is yours up to ${pack.manifest.levels[known - 1].label}.`, 'success')
    }
    dismissWelcome()
    flyHome()
  }
  return (
    <Modal className="welcome" wide>
      <div className="welcome-hero">
        <div className="hero-zh" lang="zh-Hans">
          语言地图
        </div>
        <h2>Welcome to the Language Map</h2>
        <p className="muted">{pack.manifest.title}</p>
      </div>
      <ul className="welcome-points">
        <li>
          <span>🗺️</span>
          <div>
            <b>Every word lives somewhere.</b> All {pack.words.length.toLocaleString()} words of the official HSK
            syllabus are landmarks and people in {pack.world.regions.length} towns and wilds. HSK 1 is around the
            fountain in the middle; each level is a ring of towns farther out, and HSK 7–9 is the wilderness.
          </div>
        </li>
        <li>
          <span>🧭</span>
          <div>
            <b>Location means something.</b> Each town gathers words on a topic, and neighbors share meaning. Walk
            with <kbd>WASD</kbd> or drag; press <kbd>M</kbd> for the world map and your progress in every region.
          </div>
        </li>
        <li>
          <span>⚔️</span>
          <div>
            <b>Each word is a quest</b>: hear it in a sentence → hear it alone → read it in a sentence → read it
            alone. Each stage needs a few good days. It's the honor system, and you can mark anything you already
            know. Only care about listening? Pick listening-only below.
          </div>
        </li>
        <li>
          <span>🌫️</span>
          <div>
            <b>Explore through the fog.</b> Finishing stages reveals linked words. Click “?” spots, use 🔭 Discover, or
            search. A soft cap keeps you from opening too many words at once.
          </div>
        </li>
      </ul>
      <div className="welcome-start">
        <label>
          Where are you starting?
          <select value={known} onChange={(e) => setKnown(Number(e.target.value))}>
            <option value={0}>I'm new — start at the center (HSK 1)</option>
            {pack.manifest.levels.slice(0, 6).map((l) => (
              <option key={l.level} value={l.level}>
                I already know words up to {l.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          What do you want to practice?
          <select value={mode} onChange={(e) => setMode(e.target.value as QuestMode)}>
            <option value="full">Listening + reading characters</option>
            <option value="listening">Listening only</option>
          </select>
        </label>
        <button type="button" className="primary big" onClick={start}>
          Start exploring
        </button>
      </div>
    </Modal>
  )
}
