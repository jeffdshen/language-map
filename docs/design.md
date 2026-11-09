# Language Map — Design

A vocab "world map" played like a small 2D game: each word is a landmark in a town on a tile
map. Placement encodes relationships (level, meaning, shared characters). The first instance is
Mandarin Chinese with the HSK 3.0 syllabus. The design stays language-agnostic.

## Decisions so far
- **Language pair:** Mandarin Chinese → English (the learner sees English glosses).
- **Platform:** static web app, local-first. Progress is kept in IndexedDB, with JSON
  export/import.
- **Word list: the official 2025 HSK exam syllabus.**
  - 11,000 words: HSK 1–6 plus 7–9, all in v1.
  - It replaced the 2021 HSK 3.0 draft list (ivankra/hsk30). Old saves are migrated by
    matching hanzi and pinyin.
  - Many sites (e.g. hsk.academy) still show the HSK 2.0 lists, which differ a lot.
- **Script:** simplified characters only (the HSK standard). Traditional forms are kept in the
  data.
- **Pinyin:** tone marks, no tone coloring.
- **Determinism:** the map, word data and sentences come from an offline, seeded,
  version-pinned pipeline and are **committed as artifacts**. Procedural generation is a
  build-time tool, never runtime. Everyone gets the same world, so the mental map is shareable
  and stable.
- **Game map, not a zoomable chart.**
  - The world is a 2D tile grid. The camera stays at "one screen of a town" (zoom limited to
    0.55–1.6× of the default).
  - The minimap and a world map (overview) replace infinite zoom.
  - Regions are towns with similar word counts, not geometric sectors.
  - No link lines are drawn on the map. Relationships are listed in the word panel instead, and
    the character view shows where a character appears.
- **Density is a hard rule.** Word density is even in towns and lower in the wilderness. It
  never increases further out.
- **Exploration:**
  - Fog of war, with a soft cap on open (revealed, unfinished) words.
  - The default fog mode is *dim*: unexplored landmarks are faded but visible. The other modes
    are *hidden* ("?" spots near explored words) and *off*.
  - Words can be force-revealed through the map, search or 🔭 Discover.
- **Progression:** 4 stages per word, each needing successes on 3 separate days
  (configurable). Any stage can be self-marked done. Honor system.
  1. Listen: understand in a sentence (audio)
  2. Listen: understand the word alone (audio / pinyin)
  3. Read: understand in a sentence (characters)
  4. Read: understand the word alone (characters)
- **Quest mode:** *listen + read* (all 4 stages) or *listening only* (stages 1–2).
  - It is a display/logic lens, not separate data. All stage progress is always recorded.
  - In listening-only mode, "learned", the counters, region progress, reveal rewards and the
    quest log consider only the first two stages.
  - Switching back loses nothing.

## Architecture
```
pipeline/ (Python, offline)                    app/ (TypeScript, Vite, React)
  sources -> words -> embed -> themes  ->        data/zh-en/*.json (committed)
          -> relate -> world (grid)      ->      tile renderer + minimap + world map
          -> sentences -> export/preview         + quest UI + local progress
```
The app has no backend. It is a static site that loads the committed pack and stores progress in
the browser. GitHub Pages deploys it from Actions on every push to `main`.

### Data sources (open licenses)
| Data | Source | License |
|---|---|---|
| HSK words, ids, levels, POS, pinyin, short glosses (2025 syllabus) | HearMandarin HSK 3.0 word list | CC BY 4.0 |
| Old-id mapping (save migration), alternate forms | ivankra/hsk30 (2021 list) | MIT |
| Additional English glosses | CC-CEDICT via drkameleon/complete-hsk-vocabulary | CC BY-SA 4.0 |
| Example sentences (+ English) | Tatoeba cmn↔eng (pinned npm snapshot) | CC BY 2.0 FR |
| Semantic vectors (build time only) | ConceptNet Numberbatch 17.06 | CC BY-SA 4.0 |
| Word frequency | wordfreq | CC BY-SA 4.0 (data) |
| Audio | Browser Web Speech API (zh-CN) | n/a |

All inputs are pinned with sha256 checksums in `pipeline/sources.lock.json`. The code is MIT.
The generated pack is CC BY-SA 4.0 (see `ATTRIBUTION.md`).

### Pack format (schema 2)
Documented in `pipeline/README.md`.
- `manifest.json`: levels (with word and region counts), starter words, `layoutVersion`,
  `contentHash`, sources.
- `words.json`: columnar rows `id, hanzi, pinyin, level, pos, theme, region, x, y, anchor, freq,
  glosses, neighbors, trad, alts`. `x, y` are integer grid cells.
- `world.json`: the grid, terrain (one ground-code string per row), region table and
  run-length region map.
- `sentences.json`: segmented sentences with per-token pinyin and HSK word links (loaded lazily).
- `legacy-ids.json`: old id → new id (loaded only when an old save needs migrating).

Word ids are the syllabus ids (`w00001`…). Progress is keyed by id, so re-layouts don't lose
progress.

### Generic data model (language-agnostic)
- `Word { id, form, reading, glosses[], level, pos, freq, theme, region, x, y, anchor,
  neighbors[] }`. For zh, a word's characters are its components; another language could use
  morphemes or roots.
- `Region { id, level, kind: town|wild, theme, zh, en, count, cells, label x/y, color }`.
- `World { grid, ground codes per cell, region id per cell }`.
- Links derived at load time:
  - anchor (the simpler word it builds on)
  - children
  - semantic neighbors
  - character → words index
  - spatial grid for nearby words
- `Sentence { id, en_id, en, seg[] }`, where tokens link to words and carry pinyin.
- Progress (client only): `{ wordId: { revealed, stages[4]: { days[], marked?, completed? } } }`.

## World generation
`pipeline/langmap/world.py`. Everything is seeded and deterministic.

1. **Slots.**
   - Words sit on a *brick lattice*: even rows, every other cell, with alternate rows offset.
     No two words touch (Chebyshev distance ≥ 2), each word has room for a label, and odd
     rows stay free for walking.
   - Slots are taken outward in order of a wobbly radius, `r_shape`: an angular coast factor
     times medium-scale fbm noise (±12%). This makes the island and the level bands organic
     rather than circular.
   - Slot quotas are exact per 2-cell ring:
     - Towns (HSK 1–6) keep ~92% of the lattice. The gaps become plazas and parks.
     - The wilderness (HSK 7–9) keeps ~78%. The gaps grow into lakes, peaks and clearings.
   - So density is constant in towns and lower outside, which `pytest` checks.
2. **Force layout** on continuous coordinates. Each level keeps to its band (distance from the
   center follows HSK level). Topics start in angular sectors sized by word count. Words are
   pulled toward their anchor and semantic neighbors, and a short-range repulsion keeps the
   density even.
3. **Regions.** Each level is split into balanced clusters of at most `REGION_CAP[level]` words:
   30 for HSK 1, rising to 70 for HSK 6, and 160 for wilderness. That gives 137 regions: 10, 6,
   13, 20, 27 and 26 towns, plus 35 wilds.
4. **Assignment.** Capacity-constrained optimal transport (a power diagram) gives each region
   exactly as many slots as it has words. The Hungarian algorithm then matches words to their
   region's slots, preserving the layout.
5. **Cells.**
   - Land is everything within the coast (`r_shape` plus small-scale jitter), plus a 2-cell
     margin around every slot. Only the largest landmass is kept, and inland sea pockets are
     filled.
   - Each empty land cell joins a region by Gaussian-weighted membership (σ = 1.7) of nearby
     words, rather than by nearest slot. This gives smooth borders instead of zig-zags.
   - Exclaves and enclaves are repaired, so every region is one piece.
6. **Terrain.**
   - In towns, each topic has a pair of grounds (e.g. orchard/meadow), mixed by fbm "detail"
     noise. The topic itself is a smoothed (σ = 3) field of nearby words' topics, so terrain
     varies smoothly but differs from town to town.
   - Gaps between words are paved as plazas, and so is the start plaza.
   - The wilderness uses elevation/moisture noise, biased per topic, to pick forest, hills,
     marsh, dunes or red rock, peaks and snow. Its gaps become lakes or peaks.
   - Sand lines the coast. Words never stand on water.
7. **Names.** A town is named after a frequent concrete noun (preferring its dominant topic)
   plus that topic's place suffix, e.g. 菜果园 *Vegetable Orchard*. Wilds use their dominant ground (林 forest, 谷
   canyon, 沙丘 dunes, …). Duplicate names get a suffix (·二, ·三).

`world_stats` reports density by distance and mean distance by level. The build prints them,
and `reports/zh-en.md` records them. `reports/zh-en-preview.png` and `zh-en-closeup.png` are
for visual review.

## Sentence selection
- Up to 6 Tatoeba sentences per word, ranked by comprehensibility: the other words should be at
  or below the word's level. Length limits and deterministic tie-breaks apply.
- Sentences are segmented with jieba plus the HSK lexicon, readings are disambiguated with
  pypinyin, and only simplified-script sentences are kept.
- Coverage by level is reported in `pipeline/reports/zh-en.md`. Words without a sentence fall
  back to word-only practice in the sentence stages.

## App (as built)
- **Renderer** (`map/renderer.ts`): Canvas 2D, no game engine.
  - The terrain is rendered into an offscreen buffer for the visible area plus a margin.
    - Base ground is painted at 2 px per cell and upscaled with smoothing, so biomes blend.
    - Then come per-cell details (grass tufts, trees, rocks, waves; hashed per cell so they
      are stable).
    - Then borders, traced with marching squares on the dual grid, so they run straight or at
      45°: coast, thick borders between levels, and thin soft borders between same-level
      regions.
  - Words are drawn as **landmarks** by part of speech (`map/draw.ts`):
    - house (noun), or hut in the wilds
    - person (verb), elder (pronoun), tree (adjective), banner (adverb)
    - tower (number/measure), signpost (function word), bell (interjection), tent (phrase)
    - Color varies per word.
  - State is shown by a pedestal, quest marks ("!" when due), stage pips and a ★ when learned.
  - Name plates are placed in priority order with an occupancy grid to avoid overlap.
- **Camera:** WASD/arrows walk at a constant speed, drag pans, and scroll/pinch/`+`/`−` zoom
  within 0.55–1.6×.
  - Flying to a word keeps it clear of the word panel.
  - The camera position is saved per pack.
  - `H` returns to the start plaza.
- **Minimap** (bottom right): the current region's name, level, kind and progress bar, plus a
  small overview with the viewport rectangle. Clicking it opens the world map.
- **World map** (`M`):
  - Every region filled by state: unexplored, explored, or learned. Discovered words show as
    white squares and learned ones as gold.
  - Thick level borders, region labels, and a "you are here" pin.
  - A side list of regions per level with learned/total bars.
  - Clicking a region or row flies there.
- **Character view:** clicking any character in the word panel shows a cropped map of every word
  containing it, the found/learned counts per region (sorted), and the word list. Clicking an
  entry flies there.
- **Visibility states:** hidden → frontier ("?") → revealed → active (quest accepted) → learned.
  - A hidden word within ~3.7 cells of an explored word is a frontier.
  - In *dim* fog every hidden landmark is drawn faded and clickable. In *hidden* fog only
    frontier "?" spots show.
  - The optional "fog scope: terrain" setting also darkens unexplored ground.
- **Word panel:** meanings, quest stages (practice / mark done), example sentences, and an
  "Explore" section:
  - builds on / leads to
  - per-character links (open the character view)
  - similar meaning

  On mobile it is a bottom sheet.
- **Quest:**
  - A modal per stage: listen or read, show the answer (hanzi, pinyin, English, highlighted
    word), then self-grade.
  - One success per learning day counts. The day rolls over at 04:00 local time
    (configurable).
  - A stage is done after N successful days or when self-marked. Its completion is locked in.
- **Reveal logic:**
  - Finishing a stage reveals 1 word; learning a word reveals 2.
  - Candidates are ranked by map proximity first, then meaning/character links, preferring
    easier levels so each band fills before the next.
  - Auto-reveal stops at the soft cap on open words.
  - 🔭 Discover picks the best candidate near the camera.
- **Search:** hanzi / pinyin (tone marks optional) / English. Results fly to the word.
- **Settings:**
  - quest mode, fog mode and scope
  - days per stage, open-word soft cap, auto-reveal
  - pinyin on the map, TTS rate, day rollover hour
  - bulk "known up to HSK n"
  - export/import/reset
- **Progress storage:**
  - IndexedDB (localStorage fallback), debounced writes, versioned JSON export.
  - Saves carry a monotonic `updatedAt`. Tabs sync via `BroadcastChannel`, where the newest
    save wins and stale writes are dropped.
  - If a save can't be read, writes are disabled for the session and a warning is shown, so
    progress is never overwritten by a fresh start.
  - Imports are validated.
  - Schema-1 saves (old 2021 ids) are migrated through `legacy-ids.json`. The app reports how
    many words moved or were lost.

## Progress
1. ✅ **M0 Repo scaffold:** monorepo (`pipeline/`, `app/`, `data/`), CI, Pages via Actions.
2. ✅ **M1 Data:** HSK words + CC-CEDICT → normalized words; shared-character links.
3. ✅ **M2 Layout v1:** radial rings + topic sectors. Replaced in M6.
4. ✅ **M3 Map app:** rendering, pan/zoom, word nodes, word panel, search.
5. ✅ **M4 Progress:** stages, quests, local storage, fog/reveal, soft cap.
6. ✅ **M5 Sentences:** Tatoeba selection + browser TTS → sentence-based stages.
7. ✅ **M6 Game world:**
   - official 2025 syllabus, save migration and MIT license
   - grid world with towns and wilderness, even density, smooth terrain and borders
   - landmarks, minimap, world map, character view
   - listening-only mode, dim fog by default, link lines removed

## Ideas / next
- **Roads** between neighboring towns and a few bridges, so walking routes feel intentional.
- **Better names:** avoid the "·二/·三" duplicate suffixes with a larger name vocabulary (second
  noun, topic adjectives). Give wilderness regions proper place names.
- **Landmark variety:** more axes per word (e.g. size by frequency, roof/clothing color by
  topic, special landmarks for very common words or characters). Town centers or wells at
  region label positions.
- **Minimap navigation:** click a spot on the minimap (not only the button) to walk or fly
  there. A "next due quest" compass arrow.
- **Due pulse:** gently animate landmarks whose quests are due today.
- **Region quests:** small rewards for finishing a town, e.g. revealing the next town's entrance
  or a stamp in a "passport".
- **Character decomposition** hints (Make Me a Hanzi). Pre-generated audio. Curated sentences
  for low-coverage words.
- **Sprites:** swap the vector landmarks for a pixel-art tile set if one with a compatible
  license fits.
- More language packs.
