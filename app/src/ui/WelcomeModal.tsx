import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './common'

export function WelcomeModal() {
  const modal = useStore((s) => s.modal)
  const pack = useStore((s) => s.pack!)
  const { dismissWelcome, bulkKnown, toast, flyHome } = useStore.getState()
  const [known, setKnown] = useState(0)
  if (modal !== 'welcome') return null
  const start = () => {
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
            <b>Every word lives somewhere.</b> All {pack.words.length.toLocaleString()} HSK words are characters on one
            world map. HSK 1 is in the center; harder words sit farther out.
          </div>
        </li>
        <li>
          <span>🧭</span>
          <div>
            <b>Location means something.</b> Regions are topics. Nearby words share meaning, and lines show which
            simpler word each one branches from. Words that share a character hint at where to go next.
          </div>
        </li>
        <li>
          <span>⚔️</span>
          <div>
            <b>Each word is a quest</b> in four stages: hear it in a sentence → hear it alone → read it in a sentence →
            read it alone. Each stage needs a few good days. It's the honor system, and you can mark anything you
            already know.
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
        <button type="button" className="primary big" onClick={start}>
          Start exploring
        </button>
      </div>
    </Modal>
  )
}
