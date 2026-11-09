# language-map · 语言地图

A vocabulary world map for language learning. Every word is a character that lives somewhere on a
2D map — like a mind map, skill tree, or game world — so where a word sits, what it looks like and
who its neighbors are all hint at what it means. You explore outward from the center, one quest at
a time.

First pack: **Mandarin Chinese → English, HSK 3.0** — all 11,092 words, levels 1–9. The data
model and app are language-agnostic.

![Map overview: learned HSK 1 words in the center, "?" frontier spots around them](docs/img/map-overview.webp)

## How it works

- **The map.** HSK 1 sits around the center plaza; each further ring is a harder level, and the
  outer band holds HSK 7–9. Each wedge is a topic region (food, people, work, nature, grammar, …)
  with its own color. Words that share meaning sit near each other, and every word "branches from"
  a simpler anchor word (shared characters or meaning), so threads run outward like a skill tree.
- **Reading the map.** A word shows its characters and pinyin like a game character's nameplate.
  Its marker shape gives its part of speech (● noun, ◆ verb, ⬢ adjective, ▲ adverb, 👤 pronoun,
  ■ number/measure word, ▬ function word, 📜 phrase). The region and the surrounding words hint at
  the meaning.
- **Fog of war.** You start with a handful of HSK 1 words. "?" spots mark hidden words linked to
  what you've explored (at most one level further out). Click one to reveal it, or use 🔭 Discover.
  The fog can be set to *hidden*, *dim* or *off*.
- **Quests.** Each word has four stages: **hear it in a sentence → hear it alone → read it in a
  sentence → read it alone**. A stage needs successes on 3 different days (configurable). It's the
  honor system: listen or read, reveal the answer, then mark ✓ Got it or ✗ Not yet. You can mark
  any stage, or the whole word, as already known.
- **Pacing.** Finishing a stage reveals one linked word, and learning a word reveals two, favoring
  the inner levels. A soft cap on open words (25 by default) pauses auto-reveal so you don't end up
  with too many unfinished words. You can still choose where to expand by hand.
- **Explore hints.** The word panel lists what a word branches from and leads to, similar
  meanings, and each of its characters with "N hidden · reveal next" — good leads for where to go
  next.

![Word panel with quest stages, next to the word on the map](docs/img/word-panel.webp)

Other features:
- Search by 汉字, pinyin (tone marks optional) or English.
- A quest log (`q`) lists what's due today.
- Shortcuts: `/` search, `h` home, `Esc` close.
- Bulk "I know everything up to HSK n".
- Progress export/import.
- Works on mobile.

Audio uses the browser's built-in speech synthesis (`zh-CN`); if no Chinese voice is installed,
the app tells you to read the pinyin aloud instead.

Progress is stored locally in your browser (IndexedDB, falling back to localStorage). Nothing is
sent anywhere, so use **Settings → Export progress** to back up or move to another device. Tabs
open on the same browser stay in sync.

## Run it

Requires Node 22.12+ (CI uses 24).

```sh
cd app
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm run build` (static site in `app/dist/`, works from any sub-path),
`npm run preview`, `npm test`, `npm run lint`, `npm run typecheck`.

## Repository layout

| Path | What |
|---|---|
| `app/` | Vite + React + TypeScript app. `src/map/` is the canvas renderer and terrain, `src/logic/` holds the pure progress, exploration and search logic (unit-tested), `src/ui/` the panels and modals, and `src/store.ts` the app state (zustand). |
| `data/zh-en/` | The committed language pack the app loads: words with positions, regions, sentences, manifest. |
| `pipeline/` | Offline, deterministic Python pipeline that builds `data/` from pinned sources. See [pipeline/README.md](pipeline/README.md). |
| `docs/design.md` | Design notes and decisions. |

The map is generated **offline** and committed, so everyone gets the same stable world, and
changes show up as reviewable diffs. To rebuild it:

```sh
cd pipeline
uv sync
uv run langmap fetch   # pinned sources, sha256-verified (~1.3 GB, cached)
uv run langmap build   # regenerates ../data/zh-en (byte-identical on re-run)
uv run pytest
```

## Data and licenses

The word list comes from [ivankra/hsk30](https://github.com/ivankra/hsk30) (MIT). English glosses
come from CC-CEDICT (CC BY-SA 4.0). Example sentences come from [Tatoeba](https://tatoeba.org)
(CC BY 2.0 FR). Semantic placement uses ConceptNet Numberbatch (CC BY-SA 4.0). The generated data
pack is therefore **CC BY-SA 4.0** (sentences remain CC BY 2.0 FR). Full details are in
[ATTRIBUTION.md](ATTRIBUTION.md).
