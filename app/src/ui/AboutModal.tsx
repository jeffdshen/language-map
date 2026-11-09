import { useStore } from '../store'
import { Modal } from './common'

export function AboutModal() {
  const modal = useStore((s) => s.modal)
  const manifest = useStore((s) => s.pack!.manifest)
  const setModal = useStore((s) => s.setModal)
  if (modal !== 'about') return null
  return (
    <Modal title="About Language Map" onClose={() => setModal(null)} wide>
      <div className="about">
        <section>
          <h3>How to play</h3>
          <ul>
            <li>
              <b>Drag</b> to pan, <b>scroll / pinch</b> to zoom, <b>click</b> a word to open it. Double-click zooms in.
            </li>
            <li>
              Open a discovered word and <b>accept its quest</b>. Each day, do the current stage from the ❗ quest log.
              Only one good day per stage counts each day.
            </li>
            <li>
              The four stages are: 👂 hear it in a sentence → 🗣️ hear it alone → 📖 read it in a sentence → 字 read
              it alone.
            </li>
            <li>
              Finishing stages reveals linked words. You can also click “?” spots, use 🔭 Discover, follow shared
              characters in the word panel, or search.
            </li>
            <li>
              Keys: <kbd>/</kbd> search · <kbd>Q</kbd> quest log · <kbd>H</kbd> center · <kbd>Esc</kbd> close ·
              in quests <kbd>Space</kbd> replay, <kbd>Enter</kbd> continue.
            </li>
          </ul>
        </section>
        <section>
          <h3>How the map is made</h3>
          <p>
            The map is built offline by a deterministic pipeline and is the same for everyone. Level sets the ring and
            topic sets the region. Each word branches from a related easier word (shared characters and meaning), and
            nearby words have similar meanings.
          </p>
          <p className="muted">
            Pack <code>{manifest.pack}</code> · layout v{manifest.layoutVersion} · content{' '}
            <code>{manifest.contentHash}</code> · {manifest.counts.words.toLocaleString()} words ·{' '}
            {manifest.counts.sentences.toLocaleString()} example sentences
          </p>
        </section>
        <section>
          <h3>Data sources</h3>
          <table className="sources">
            <thead>
              <tr>
                <th>Source</th>
                <th>License</th>
              </tr>
            </thead>
            <tbody>
              {manifest.sources.map((s) => (
                <tr key={s.key}>
                  <td>
                    <a href={s.homepage} target="_blank" rel="noreferrer">
                      {s.name}
                    </a>
                  </td>
                  <td>{s.license}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Glosses come from CC-CEDICT (CC BY-SA 4.0). Example sentences come from Tatoeba (CC BY 2.0 FR); each links
            to its original page. Audio uses your browser's built-in speech synthesis.
          </p>
        </section>
      </div>
    </Modal>
  )
}
