import { buildPack, type Pack } from '../data/pack'
import type { Manifest, Regions, Word } from '../data/types'

type Spec = [hanzi: string, pinyin: string, level: number, anchor: number, glosses: string[], neighbors?: number[]]

const SPECS: Spec[] = [
  ['学', 'xué', 1, -1, ['to learn; to study'], [1, 2]],
  ['学生', 'xuésheng', 1, -1, ['student; schoolchild'], [0, 3]],
  ['老师', 'lǎoshī', 1, -1, ['teacher'], [1]],
  ['学校', 'xuéxiào', 2, 1, ['school'], [1, 2]],
  ['大学', 'dàxué', 2, 0, ['university; college'], [3]],
  ['学习', 'xuéxí', 2, 0, ['to learn; to study'], [0]],
  ['吃', 'chī', 1, -1, ['to eat'], [7]],
  ['吃饭', 'chī fàn', 2, 6, ['to have a meal; to eat'], [6]],
  ['绿', 'lǜ', 3, -1, ['green'], []],
  ['留学', 'liúxué', 4, 4, ['to study abroad'], [4]],
]

export function makePack(): Pack {
  const words: Word[] = SPECS.map(([hanzi, pinyin, level, anchor, glosses, neighbors], i) => ({
    i,
    id: `L${level}-${String(i).padStart(4, '0')}`,
    hanzi,
    pinyin,
    level,
    pos: 'noun',
    theme: 0,
    x: i,
    y: 0,
    anchor,
    freq: 6 - i * 0.1,
    glosses,
    neighbors: neighbors ?? [],
    trad: hanzi,
    alts: [],
  }))
  const manifest = { pack: 'test', layoutVersion: 1, starters: [0, 6] } as unknown as Manifest
  const regions = { themes: [], geometry: { theta0: 0, radii: [], mids: [], bounds: [] } } as Regions
  return buildPack(manifest, regions, words)
}
