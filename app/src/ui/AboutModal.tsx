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
              <b>Walk</b> with <kbd>WASD</kbd> / arrow keys (<kbd>Shift</kbd> runs), or click / tap where to go.
              Drag to look around and <b>scroll / pinch</b> to zoom a little; <kbd>C</kbd> re-centers on you. The
              minimap shows the town you are in; click it (or press <kbd>M</kbd>) for the world map with your progress
              in every region.
            </li>
            <li>
              Walk up to a landmark and press <kbd>E</kbd> (or click it). New words just ask: <b>👁 Reveal</b> or{' '}
              <b>✓ Know it</b>. Discovered words offer a quest, an example sentence, or <b>📖 Details</b> for the full
              page. Number keys pick the options; <kbd>N</kbd> walks you to the next new word in the town.
            </li>
            <li>
              Accept a word's <b>quest</b>, then each day do its current stage from the ❗ quest log. Only one good day
              per stage counts each day.
            </li>
            <li>
              Every region has a <b>⚑ hall</b>. <b>🏋️ Train</b> runs the quests due in that region; <b>⚔️ Challenge</b>{' '}
              quizzes you on its words (by sound in listening-only mode) and clears each one you get right, so you can
              skip what you already know. Words you miss go onto your map.
            </li>
            <li>
              The four stages are: 👂 hear it in a sentence → 🗣️ hear it alone → 📖 read it in a sentence → 字 read
              it alone. In <b>listening-only</b> mode (top bar or Settings) a word counts as learned after the first
              two; reading practice is still recorded if you do it.
            </li>
            <li>
              Finishing stages reveals nearby and related words. You can also walk up to faded landmarks, use 🔭
              Discover (it picks a good word near you), click a character in a word's details to see where else it
              appears, or search.
            </li>
            <li>
              Keys: <kbd>WASD</kbd> walk · <kbd>E</kbd> talk · <kbd>1</kbd>–<kbd>4</kbd> choose · <kbd>N</kbd> next
              word · <kbd>C</kbd> center · <kbd>+</kbd>/<kbd>−</kbd> zoom · <kbd>M</kbd> world map · <kbd>/</kbd>{' '}
              search · <kbd>Q</kbd> quest log · <kbd>H</kbd> back to the start · <kbd>Esc</kbd> close ·
              in quests <kbd>Space</kbd> replay, <kbd>Enter</kbd> continue.
            </li>
          </ul>
        </section>
        <section>
          <h3>How the map is made</h3>
          <p>
            The map is built offline by a deterministic pipeline and is the same for everyone. Words are spread over
            an even grid (the same density everywhere) with HSK level setting the distance from the center and related
            words pulling together. Each level ring is then split into towns of similar size, named after their
            topic; HSK 7–9 forms looser wilderness regions. Words sit on randomly spaced lots with room to walk
            between them, joined by roads and trails to each region's hall. Terrain follows the topics, and each
            word's landmark (house, tree, rock, dune, lily pad…) comes from the ground it stands on.
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
