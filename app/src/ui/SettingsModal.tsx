import { useEffect, useReducer, useRef, useState } from 'react'
import type { QuestMode } from '../logic/progress'
import type { FogMode, FogScope, MapPinyin } from '../logic/save'
import { useStore } from '../store'
import { autoVoice, onVoicesChanged, speak, voiceFailed, voicesFor } from '../tts'
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

/** Text-to-speech voice for the pack's language, best first; Auto follows the ranking as voices load. */
function VoiceField({ lang, value, onChange }: { lang: string; value: string; onChange: (uri: string) => void }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => onVoicesChanged(rerender), [])
  const voices = voicesFor(lang)
  const auto = autoVoice(lang)
  const missing = value !== '' && !voices.some((v) => v.voiceURI === value)
  return (
    <label className="field">
      <span>Voice (natural/online voices sound best; on Windows, Edge has the most natural Chinese voices)</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">
          {auto ? `Auto — ${auto.name}` : voices.length ? 'Auto — browser default' : 'Auto — no Chinese voice found on this device'}
        </option>
        {missing ? <option value={value}>Saved voice (not on this device — using Auto)</option> : null}
        {voices.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} ({v.lang}
            {v.localService ? '' : ', online'}){voiceFailed(v.voiceURI) ? ' — not working here, skipped' : ''}
          </option>
        ))}
      </select>
    </label>
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
      await importSave(JSON.parse(await file.text()))
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
              <option value="dim">Dim — undiscovered landmarks are faded (default)</option>
              <option value="hidden">Hidden — only “?” next to explored words</option>
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
          <label className="field">
            <span>Pinyin under words on the map (characters under the pinyin in listening mode)</span>
            <select value={settings.mapPinyin} onChange={(e) => updateSettings({ mapPinyin: e.target.value as MapPinyin })}>
              <option value="auto">Auto — until you finish a region's listening quests</option>
              <option value="always">Always</option>
              <option value="never">Never</option>
            </select>
          </label>
        </section>
        <section>
          <h3>Learning</h3>
          <label className="field">
            <span>Quest mode</span>
            <select value={settings.questMode} onChange={(e) => updateSettings({ questMode: e.target.value as QuestMode })}>
              <option value="full">Listening + reading — all four stages</option>
              <option value="listening">Listening only — a word is learned after the two listening stages</option>
            </select>
          </label>
          <label className="field">
            <span>Sentences needed per sentence stage (any sentence you collect counts for every word in it)</span>
            <NumberField
              min={1}
              max={30}
              value={settings.sentencesPerStage}
              onCommit={(n) => updateSettings({ sentencesPerStage: n })}
            />
          </label>
          <label className="field check">
            <input
              type="checkbox"
              checked={settings.autoReveal}
              onChange={(e) => updateSettings({ autoReveal: e.target.checked })}
            />
            <span>Reveal linked words when I finish a stage</span>
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
          <VoiceField lang={pack.manifest.target.tts} value={settings.ttsVoice} onChange={(uri) => updateSettings({ ttsVoice: uri })} />
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
