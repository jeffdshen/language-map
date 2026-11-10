import { beforeEach, describe, expect, it } from 'vitest'
import type { Sentence } from './data/types'
import { computeView, Vis } from './logic/explore'
import { newSave, rulesOf } from './logic/save'
import { disableWrites } from './persist'
import { useStore } from './store'
import { makePack } from './test/fixture'

const pack = makePack()
const id = (i: number) => pack.words[i].id
/** 学生 (1) and 老师 (2) with an unknown token in between. */
const sentence: Sentence = { id: 77, enId: 1, en: 'The student and the teacher.', seg: [['学生', 1], ['和'], ['老师', 2], ['。']] }

function reset(sentencesPerStage = 3) {
  const save = newSave('test', 2)
  save.settings = { ...save.settings, sentencesPerStage, autoReveal: false }
  useStore.setState({ pack, save, view: computeView(pack, save.progress, rulesOf(save.settings)), today: '2024-01-01' })
}

describe('store quests', () => {
  beforeEach(() => {
    disableWrites()
    reset()
  })

  it('collecting a sentence gives a point to every word in it', () => {
    const r = useStore.getState().collect(1, sentence, 'listen')
    expect(r.credited.sort()).toEqual([1, 2])
    const { save, view } = useStore.getState()
    expect(save.progress[id(1)].stages[0].n).toBe(1)
    expect(save.progress[id(2)].stages[0].n).toBe(1)
    // Sentence points never count toward the "hear it alone" stage.
    expect(save.progress[id(1)].stages[1].n).toBe(0)
    expect(save.collected.listen).toEqual([77])
    expect(save.collected.read).toEqual([])
    // Credited words join the map as active quests.
    expect(view!.vis[1]).toBe(Vis.Active)
    expect(view!.vis[2]).toBe(Vis.Active)
  })

  it('collecting the same sentence again only credits the quest word', () => {
    const { collect } = useStore.getState()
    collect(1, sentence, 'listen')
    const r = useStore.getState().collect(1, sentence, 'listen')
    expect(r.credited).toEqual([1])
    const { save } = useStore.getState()
    expect(save.progress[id(1)].stages[0].n).toBe(2)
    expect(save.progress[id(2)].stages[0].n).toBe(1)
    expect(save.collected.listen).toEqual([77])
    // Reading the sentence is a separate collect.
    expect(useStore.getState().collect(2, sentence, 'read').credited.sort()).toEqual([1, 2])
  })

  it('show answer credits just the word, and collect-all skips it afterwards', () => {
    const { creditWord } = useStore.getState()
    const shown = creditWord(1, 0)
    expect(shown.credited).toEqual([1])
    const r = useStore.getState().collect(1, sentence, 'listen', shown.credited)
    expect(r.credited).toEqual([2])
    const { save } = useStore.getState()
    expect(save.progress[id(1)].stages[0].n).toBe(1)
    expect(save.progress[id(2)].stages[0].n).toBe(1)
  })

  it('finishes stages, skips done ones and learns words', () => {
    const { collect, creditWord } = useStore.getState()
    collect(1, sentence, 'listen')
    collect(1, { ...sentence, id: 78 }, 'listen')
    let r = collect(1, { ...sentence, id: 79 }, 'listen')
    expect(r.finished.sort()).toEqual([1, 2])
    // Stage 0 is done for both: nothing more to credit there.
    r = collect(1, { ...sentence, id: 80 }, 'listen')
    expect(r.credited).toEqual([])
    r = creditWord(1, 1)
    expect(r.finished).toEqual([1])
    useStore.getState().updateSettings({ questMode: 'listening' })
    expect(useStore.getState().view!.vis[1]).toBe(Vis.Learned)
    r = creditWord(1, 1)
    expect(r.credited).toEqual([])
  })

  it('a word without sentences needs one check per stage', () => {
    const { creditWord } = useStore.getState()
    const r = creditWord(8, 0)
    expect(r.finished).toEqual([8])
  })

  it('keeps finished stages when sentences-per-stage goes up', () => {
    reset(1)
    useStore.getState().collect(1, sentence, 'listen')
    expect(useStore.getState().view!.stages[1]).toBe(1)
    useStore.getState().updateSettings({ sentencesPerStage: 10 })
    expect(useStore.getState().view!.stages[1]).toBe(1)
    expect(useStore.getState().save.progress[id(1)].stages[0].completed).toBe('2024-01-01')
  })
})
