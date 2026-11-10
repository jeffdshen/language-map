import { useStore } from '../store'
import { QuestCard } from './QuestCard'
import { useSwipeDismiss } from './useSwipeDismiss'

/** The dialog for the selected landmark: the word's quest, with the full page one key away. */
export function WordPopover() {
  const i = useStore((s) => s.selected)
  const details = useStore((s) => s.details)
  if (i === null || details) return null
  return <PopoverInner key={i} i={i} />
}

function PopoverInner({ i }: { i: number }) {
  const color = useStore((s) => s.pack!.world.regions[s.pack!.words[i].region]?.color ?? '#999')
  const { select, nextWord } = useStore.getState()
  const swipe = useSwipeDismiss(() => select(null))
  return (
    <section className="popover" aria-label="Word" style={{ ['--region' as string]: color }} data-sheet {...swipe}>
      <button type="button" className="icon close" onClick={() => select(null)} aria-label="Close" title="Close (Esc)">
        ×
      </button>
      <QuestCard key={i} i={i} where="popover" onNextWord={nextWord} />
    </section>
  )
}
