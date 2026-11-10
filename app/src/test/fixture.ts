import { buildPack, decodeWorld, regionAt, type Pack, type WorldFile } from '../data/pack'
import type { Manifest, Word } from '../data/types'

type Spec = [hanzi: string, pinyin: string, level: number, anchor: number, glosses: string[], xy: [number, number], neighbors?: number[]]

// Words sit on the brick lattice used by the real map (even rows; nearest neighbors 2 or √5 cells apart).
const SPECS: Spec[] = [
  ['学', 'xué', 1, -1, ['to learn; to study'], [0, 0], [1, 2]],
  ['学生', 'xuésheng', 1, -1, ['student; schoolchild'], [2, 0], [0, 3]],
  ['老师', 'lǎoshī', 1, -1, ['teacher'], [-2, 0], [1]],
  ['学校', 'xuéxiào', 2, 1, ['school'], [1, 2], [1, 2]],
  ['大学', 'dàxué', 2, 0, ['university; college'], [-1, 2], [3]],
  ['学习', 'xuéxí', 2, 0, ['to learn; to study'], [3, 2], [0]],
  ['吃', 'chī', 1, -1, ['to eat'], [-5, -2], [7]],
  ['吃饭', 'chī fàn', 2, 6, ['to have a meal; to eat'], [-5, 2], [6]],
  ['绿', 'lǜ', 3, -1, ['green'], [6, 0], []],
  ['留学', 'liúxué', 4, 4, ['to study abroad'], [5, -2], [4]],
]

/** 14 × 14 grid from (-7, -7): a row of sea on top, then three regions split by x. */
export function makeWorldFile(): WorldFile {
  const w = 14
  const h = 14
  const regionOfX = (x: number) => (x <= 0 ? 0 : x <= 4 ? 1 : 2)
  const terrain: string[] = []
  const regionRuns: number[][] = []
  for (let y = 0; y < h; y++) {
    if (y === 0) {
      terrain.push('~'.repeat(w))
      regionRuns.push([-1, w])
      continue
    }
    terrain.push('g'.repeat(w - 1) + '=')
    const runs: number[] = []
    for (let x = 0; x < w; x++) {
      const r = regionOfX(x - 7)
      if (runs.length && runs[runs.length - 2] === r) runs[runs.length - 1]++
      else runs.push(r, 1)
    }
    regionRuns.push(runs)
  }
  const color = '#88aa66'
  return {
    grid: { x0: -7, y0: -7, w, h },
    spawn: [0, 0],
    ground: { '~': { name: 'sea', color: '#3f6f9e' }, '=': { name: 'shallows', color: '#6fa3c8' }, g: { name: 'grass', color: '#9ccf7a' } },
    themes: [{ key: 'study', zh: '学', en: 'Study', biome: 'g', color, place: { zh: '镇', en: 'Town' }, count: 10 }],
    regionFields: ['id', 'level', 'kind', 'theme', 'zh', 'en', 'count', 'cells', 'x', 'y', 'color'],
    regions: [
      [0, 1, 'town', 0, '学镇', 'Study Town', 5, 104, -3, 1, color],
      [1, 2, 'town', 0, '校镇', 'School Town', 3, 52, 2, 1, color],
      [2, 7, 'wild', 0, '绿野', 'Green Wilds', 2, 26, 5, 1, color],
    ],
    terrain,
    regionRuns,
  }
}

export function makePack(): Pack {
  const world = decodeWorld(makeWorldFile())
  const words: Word[] = SPECS.map(([hanzi, pinyin, level, anchor, glosses, [x, y], neighbors], i) => ({
    i,
    id: `w${String(i + 1).padStart(5, '0')}`,
    hanzi,
    say: hanzi,
    pinyin,
    level,
    pos: 'noun',
    theme: 0,
    region: regionAt(world, x, y),
    x,
    y,
    anchor,
    freq: 6 - i * 0.1,
    glosses,
    neighbors: neighbors ?? [],
    trad: hanzi,
    alts: [],
    ex: i === 8 ? 0 : 2,
  }))
  const manifest = { pack: 'test', layoutVersion: 2, starters: [0, 6] } as unknown as Manifest
  return buildPack(manifest, world, words)
}
