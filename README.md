# language-map · 语言地图

A vocabulary world map for language learning, played like a small 2D game. Every word is a
landmark in a town on a tile map, so where a word sits, what it looks like and which words live
next to it all hint at what it means. You start in the central plaza and explore outward one quest
at a time.

First pack: **Mandarin Chinese → English, HSK 3.0 (official 2025 exam syllabus)**. It has all
11,000 words, HSK 1 to 7–9. The data model and app are language-agnostic.

**Live:** <https://jeffdshen.github.io/language-map/>

![Walking around the HSK 1 plaza: word landmarks over terrain, minimap with the current town](docs/img/map-overview.webp)

## How it works

- **The world.**
  - The map is an island on a grid. HSK 1 surrounds the start plaza, and each band further out
    is the next level.
  - Each band is split into **towns** of similar size (about 30 words in HSK 1, up to 70 in
    HSK 6), named after their dominant topic, e.g. 菜果园 *Vegetable Orchard* or
    问题港 *Question Harbor*.
  - HSK 7–9 is the **wilderness**: bigger, looser regions with forests, lakes, peaks and dunes.
  - Related words are pulled together. Word density is even everywhere, and it never gets
    denser further out.
- **Playing.**
  - The camera stays zoomed in like a game character. Walk with WASD / arrow keys or drag, and
    zoom a little with scroll, pinch or `+`/`−`.
  - The minimap (bottom right) shows the town you're in and its progress.
  - Press `M` or click the minimap for the **world map**: every region with
    learned/explored progress, sorted by level.
- **Landmarks.** A word's landmark shows its part of speech:
  - homes and halls for nouns
  - people for verbs
  - trees for adjectives
  - signposts for function words
  - …

  Its town's terrain and theme hint at the meaning. Explored words get a name plate with
  pinyin.
- **Fog.** Unexplored words are *dimmed* by default: their landmarks and hanzi are faded, so you
  can see the whole world and still tell what you've found. It can be set to *hidden* (only "?"
  spots next to explored words) or *off*. Click a faded landmark to reveal it, or use 🔭 Discover
  to pick a good word near you.
- **Quests.**
  - Each word has four stages: **hear it in a sentence → hear it alone → read it in a sentence
    → read it alone**.
  - A stage needs successes on 3 different days (configurable).
  - It's the honor system: listen or read, reveal the answer, then mark ✓ Got it or ✗ Not yet.
    You can mark any stage, or the whole word, as already known.
- **Listening-only mode.** Toggle 👂 *Listening* vs 👂📖 *Listen + read* in the top bar. In
  listening-only mode a word counts as learned after the two listening stages, and all progress
  displays use that. Reading practice is still recorded.
- **Pacing.** Finishing a stage reveals a nearby or related word, and learning a word reveals
  two, favoring easier levels. A soft cap on open words (25 by default) pauses auto-reveal.
- **Character links.** In the word panel, click any character to see every word that uses it:
  where they are on the map, how many you've found and learned in each region, and a sorted list.

![World map: towns and wilderness regions with per-region progress](docs/img/world-map.webp)

![Word panel with quest stages](docs/img/word-panel.webp)

Other features:
- Search by 汉字, pinyin (tone marks optional) or English.
- A quest log (`q`) lists what's due today.
- Shortcuts: `/` search, `h` back to the start, `m` world map, `Esc` close.
- Bulk "I know everything up to HSK n".
- Progress export/import.
- Works on mobile.

Audio uses the browser's built-in speech synthesis (`zh-CN`); if no Chinese voice is installed,
the app tells you to read the pinyin aloud instead.

Progress is stored locally in your browser (IndexedDB, falling back to localStorage). Nothing is
sent anywhere, so use **Settings → Export progress** to back up or move to another device. Tabs
open on the same browser stay in sync. Saves from the earlier (2021-list) version are migrated
automatically by matching words.

## Run it

Requires Node 22.12+ (CI uses 24).

```sh
cd app
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm run build` (static site in `app/dist/`, works from any sub-path),
`npm run preview`, `npm test`, `npm run lint`, `npm run typecheck`.

Every push to `main` deploys the build to GitHub Pages via
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) (repo **Settings → Pages → Source**
must be set to **GitHub Actions**).

## Repository layout

| Path | What |
|---|---|
| `app/` | Vite + React + TypeScript app. `src/map/` is the tile renderer, camera and minimap, `src/logic/` holds the pure progress, exploration and search logic (unit-tested), `src/ui/` the panels and modals, and `src/store.ts` the app state (zustand). |
| `data/zh-en/` | The committed language pack the app loads: words with grid positions, the world (terrain and regions), sentences, manifest. |
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

The code is [MIT](LICENSE).

The word list (levels, parts of speech, pinyin, short glosses) is the official 2025 HSK syllabus
via the [HearMandarin HSK 3.0 word list](https://github.com/wzperson/hearmandarin-hsk-3-0-word-list)
(CC BY 4.0). Note that many sites, such as hsk.academy, still show the older HSK 2.0 lists.
Additional English glosses come from CC-CEDICT (CC BY-SA 4.0). Example sentences come from
[Tatoeba](https://tatoeba.org) (CC BY 2.0 FR). Semantic placement uses ConceptNet Numberbatch
(CC BY-SA 4.0). The generated data pack is therefore **CC BY-SA 4.0** (sentences remain CC BY 2.0
FR). Full details are in [ATTRIBUTION.md](ATTRIBUTION.md).
