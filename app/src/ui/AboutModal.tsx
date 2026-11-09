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
              <b>Walk</b> with <kbd>WASD</kbd> / arrow keys or drag the map; <b>scroll / pinch</b> zooms a little.
              <b>Click</b> a landmark to open its word. The minimap shows the town you are in; click it (or press{' '}
              <kbd>M</kbd>) for the world map with your progress in every region.
            </li>
            <li>
              Open a discovered word and <b>accept its quest</b>. Each day, do the current stage from the ❗ quest log.
              Only one good day per stage counts each day.
            </li>
            <li>
              The four stages are: 👂 hear it in a sentence → 🗣️ hear it alone → 📖 read it in a sentence → 字 read
              it alone. In <b>listening-only</b> mode (top bar or Settings) a word counts as learned after the first
              two; reading practice is still recorded if you do it.
            </li>
            <li>
              Finishing stages reveals nearby and related words. You can also click faded landmarks, use 🔭 Discover
              (it picks a good word near you), click a character in the word panel to see where else it appears, or
              search.
            </li>
            <li>
              Keys: <kbd>WASD</kbd> walk · <kbd>+</kbd>/<kbd>−</kbd> zoom · <kbd>M</kbd> world map · <kbd>/</kbd> search ·{' '}
              <kbd>Q</kbd> quest log · <kbd>H</kbd> back to the start · <kbd>Esc</kbd> close ·
              in quests <kbd>Space</kbd> replay, <kbd>Enter</kbd> continue.
            </li>
          </ul>
        </section>
        <section>
          <h3>How the map is made</h3>
          <p>
            The map is built offline by a deterministic pipeline and is the same for everyone. Words are packed onto
            an even grid (the same density everywhere) with HSK level setting the distance from the center and related
            words pulling together. Each level ring is then split into towns of similar size, named after their
            topic; HSK 7–9 forms looser wilderness regions. Terrain follows the topics, and each word's landmark
            follows its part of speech (homes and halls for nouns, people for verbs, trees for adjectives…).
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
