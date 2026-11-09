import { useRef, useState } from 'react'
import type { FogMode, FogScope } from '../logic/save'
import { useStore } from '../store'
import { speak } from '../tts'
import { Modal } from './common'

/** Number input that keeps a local draft and only commits on blur or Enter, so typing isn't clamped mid-edit. */
function NumberField({
  value,
  min,
  max,
  onCommit,
}: {
  value: number
  min: number
  max: number
  onCommit: (n: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const n = Math.round(Number(draft))
    if (draft.trim() !== '' && Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)))
    setDraft(null)
  }
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}

export function SettingsModal() {
  const modal = useStore((s) => s.modal)
  const settings = useStore((s) => s.save.settings)
  const pack = useStore((s) => s.pack!)
  const { setModal, updateSettings, bulkKnown, exportSave, importSave, resetAll, toast } = useStore.getState()
  const [bulkLevel, setBulkLevel] = useState(1)
  const fileRef = useRef<HTMLInputElement>(null)
  if (modal !== 'settings') return null

  const download = () => {
    const blob = new Blob([JSON.stringify(exportSave(), null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `language-map-${pack.manifest.pack}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const upload = async (file: File) => {
    try {
      importSave(JSON.parse(await file.text()))
      toast('Progress imported.', 'success')
    } catch (err) {
      toast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 'warn')
    }
  }

  return (
    <Modal title="Settings" onClose={() => setModal(null)} wide>
      <div className="settings">
        <section>
          <h3>Map</h3>
          <label className="field">
            <span>Fog of war</span>
            <select value={settings.fogMode} onChange={(e) => updateSettings({ fogMode: e.target.value as FogMode })}>
              <option value="hidden">Hidden — only “?” next to explored words</option>
              <option value="dim">Dim — undiscovered words are faded</option>
              <option value="off">Off — show every word</option>
            </select>
          </label>
          <label className="field">
            <span>Fog covers</span>
            <select value={settings.fogScope} onChange={(e) => updateSettings({ fogScope: e.target.value as FogScope })}>
              <option value="words">Words only</option>
              <option value="terrain">Words and terrain</option>
            </select>
          </label>
          <label className="field check">
            <input
              type="checkbox"
              checked={settings.mapPinyin}
              onChange={(e) => updateSettings({ mapPinyin: e.target.checked })}
            />
            <span>Show pinyin under words on the map</span>
          </label>
        </section>
        <section>
          <h3>Learning</h3>
          <label className="field">
            <span>Good days needed per stage</span>
            <select
              value={settings.daysPerStage}
              onChange={(e) => updateSettings({ daysPerStage: Number(e.target.value) })}
            >
              {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'day' : 'days'}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Soft cap on open words</span>
            <NumberField
              min={3}
              max={500}
              value={settings.openCap}
              onCommit={(n) => updateSettings({ openCap: n })}
            />
          </label>
          <label className="field check">
            <input
              type="checkbox"
              checked={settings.autoReveal}
              onChange={(e) => updateSettings({ autoReveal: e.target.checked })}
            />
            <span>Reveal linked words when I finish a stage (stops at the cap)</span>
          </label>
          <label className="field">
            <span>New day starts at</span>
            <select
              value={settings.rolloverHour}
              onChange={(e) => updateSettings({ rolloverHour: Number(e.target.value) })}
            >
              {Array.from({ length: 13 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Speech rate ({settings.ttsRate.toFixed(2)})</span>
            <span className="row">
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={settings.ttsRate}
                onChange={(e) => updateSettings({ ttsRate: Number(e.target.value) })}
              />
              <button type="button" className="small" onClick={() => speak('你好，欢迎来到语言地图。', pack.manifest.target.tts, settings.ttsRate)}>
                🔊 Test
              </button>
            </span>
          </label>
        </section>
        <section>
          <h3>Progress</h3>
          <div className="field">
            <span>Mark every word up to a level as known</span>
            <span className="row">
              <select value={bulkLevel} onChange={(e) => setBulkLevel(Number(e.target.value))}>
                {pack.manifest.levels.map((l) => (
                  <option key={l.level} value={l.level}>
                    {l.label} and below
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const label = pack.manifest.levels[bulkLevel - 1].label
                  if (confirm(`Mark all words up to ${label} as known?`)) {
                    const n = bulkKnown(bulkLevel)
                    toast(`Marked ${n} words as known.`, 'success')
                  }
                }}
              >
                Apply
              </button>
            </span>
          </div>
          <div className="row">
            <button type="button" onClick={download}>
              ⬇ Export progress
            </button>
            <button type="button" onClick={() => fileRef.current?.click()}>
              ⬆ Import progress
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void upload(f)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (confirm('Erase all progress and start over? Export first if you want a backup.')) resetAll()
              }}
            >
              Reset everything
            </button>
          </div>
          <p className="muted">Progress is stored only in this browser. Export it to back it up or move devices.</p>
        </section>
      </div>
    </Modal>
  )
}
