# Language Map — Design

A vocab "world map" played like a small 2D game: each word lives in a landmark in a walkable
town on a tile map, and you explore it as a small character. Placement encodes relationships (level, meaning, shared characters). The first instance is
Mandarin Chinese with the HSK 3.0 syllabus. The design stays language-agnostic.

## Decisions so far
- **Language pair:** Mandarin Chinese → English (the learner sees English glosses).
- **Platform:** static web app, local-first. Progress is kept in IndexedDB, with JSON
  export/import.
- **Progress outlives the map.** Saves are keyed by syllabus word ids (`w00001`…), never by
  position or region, so redeploying with a new layout keeps everything. When
  `LAYOUT_VERSION` changes the app only shows a one-time "the map was redrawn" note. The
  manifest is always revalidated and the other pack files are fetched as `file?v=<contentHash>`,
  so a browser cache can never mix two builds after a deploy.
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
  - The world is a 2D tile grid. The camera follows a player character and stays at "one
    screen of a town" (zoom limited to 0.55–1.6× of the default).
  - The minimap and a world map (overview) replace infinite zoom.
  - Regions are towns with similar word counts, not geometric sectors.
- **Regions by meaning.** Within each level band, a town's words should share a meaning, and
  its name says what that is (*Family Village*, *Weather Crossroads*). Compact shapes still
  matter, so this is a trade-off; further out (big wilderness regions) the groups are looser.
  - No link lines are drawn on the map. Relationships are listed in the word details instead,
    and the character view shows where a character appears.
- **Walkable, not packed.** Words sit in small hamlets (1–7 related words) with open land, roads
  and ponds in between, like a game town you wander through. About 7 words per 100 land cells
  in towns and 5 in the wilderness.
- **Density is a hard rule.** Word density is even in towns and lower in the wilderness. It
  never increases further out.
- **Landmarks come from the biome, not the word.** A word is written on a cottage, shop, barn,
  tree, mountain, dune, cloud, lily pad, … picked from the ground it stands on. They don't try
  to depict the meaning, and the art avoids leaning on Chinese clichés.
- **Mobile: every popup is easy to dismiss.** Panels and dialogs are bottom sheets that leave a
  strip of map above (tap it to close), keep their × pinned while scrolling, close with a swipe
  down on the grip, and close with the phone's Back button.
- **Few clicks.** Opening a word plays (or shows) one of its sentences right away. `E` always
  confirms (collect / next), and the other choices (show answer, know it, another sentence,
  details) are one key or tap each. Only "Details" opens the full page, so going through known
  words is fast.
- **Halls.** Every region has a hall: ⚔️ Challenge (multiple-choice rounds that clear words you
  already know, several at a time) and 💬 Sentences (random sentences from the region's words,
  each one crediting every word in it).
- **Exploration:**
  - Fog of war with no cap on open words: you can have as many quests going as you like.
  - The default fog mode is *dim*: unexplored landmarks are faded but visible. The other modes
    are *hidden* ("?" spots near explored words) and *off*.
  - Words can be force-revealed through the map, search or 🔭 Discover.
- **Progression:** 4 stages per word, counted in points, not days. Honor system; any stage can
  be self-marked done.
  1. Listen: understand it in sentences (audio): 10 points (configurable 1–30)
  2. Listen: understand the word alone (audio / pinyin): 1 check
  3. Read: understand it in sentences (characters): 10 points
  4. Read: understand the word alone (characters): 1 check

  A word with no example sentences needs a single check per stage.
- **Sentences are multi-reward quests.** Collecting a sentence ("I understood it") gives a point
  to the sentence stage of *every* word in it, like a game quest with several rewards.
  - "Show answer" gives the point to the focus word only; you can still "collect all" after
    checking yourself.
  - Sentence points never count toward the "alone" stages.
  - Each sentence counts once per word; once a word's sentences run out, collecting one again
    credits only that word (its list loops).
  - A word you merely looked at stays undiscovered; it is revealed only when it earns a point.
- **Map labels:** in listen + read mode, every word on the map also shows its pinyin until all
  of its region's listening stages are done; after that the region shows characters only
  (setting: auto / always / never).
- **Quest mode:** *listen + read* (all 4 stages) or *listening only* (stages 1–2).
  - It is a display/logic lens, not separate data. All stage progress is always recorded.
  - In listening-only mode, "learned", the counters, region progress, reveal rewards and the
    quest log consider only the first two stages. Hall challenges play audio instead of
    showing hanzi.
  - Switching back loses nothing.

## Architecture
```
pipeline/ (Python, offline)                    app/ (TypeScript, Vite, React)
  sources -> words -> embed -> themes  ->        data/zh-en/*.json (committed)
          -> relate -> world (grid)      ->      tile renderer + player + minimap + world map
          -> sentences -> export/preview         + word card, halls, quests + local progress
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
| Audio | Browser Web Speech API (zh-CN); speech hints for misread characters from pypinyin + wordfreq | n/a |

Audio is being moved from browser speech to pre-generated clips; see [audio.md](audio.md) for
why (browser speech is silent on some machines) and the open decisions.

All inputs are pinned with sha256 checksums in `pipeline/sources.lock.json`. The code is MIT.
The generated pack is CC BY-SA 4.0 (see `ATTRIBUTION.md`).

### Pack format (schema 4)
Documented in `pipeline/README.md`. Schema 3 added road, trail and bridge ground codes and made
a region's `x, y` its hall; schema 4 adds a per-word sentence count (`ex`).
- `manifest.json`: levels (with word and region counts), starter words, `layoutVersion`,
  `contentHash`, sources.
- `words.json`: columnar rows `id, hanzi, pinyin, level, pos, theme, region, x, y, anchor, freq,
  glosses, neighbors, trad, alts, ex`. `x, y` are integer grid cells.
- `world.json`: the grid, terrain (one ground-code string per row, including roads), region
  table (with hall positions) and run-length region map.
- `sentences.json`: segmented sentences with per-token pinyin and HSK word links (loaded lazily).
- `legacy-ids.json`: old id → new id (loaded only when an old save needs migrating).

Word ids are the syllabus ids (`w00001`…). Progress is keyed by id, so re-layouts don't lose
progress.

### Generic data model (language-agnostic)
- `Word { id, form, reading, glosses[], level, pos, freq, theme, region, x, y, anchor,
  neighbors[] }`. For zh, a word's characters are its components; another language could use
  morphemes or roots.
- `Region { id, level, kind: town|wild, theme, zh, en, count, cells, hall x/y, color }`.
- `World { grid, ground codes per cell, region id per cell }`.
- Links derived at load time:
  - anchor (the simpler word it builds on)
  - children
  - semantic neighbors
  - character → words index
  - spatial grid for nearby words
- `Sentence { id, en_id, en, seg[] }`, where tokens link to words and carry pinyin.
- Progress (client only): `{ wordId: { revealed, started, stages[4]: { n, marked?, completed? } } }`
  plus the collected sentence ids per kind (`collected: { listen[], read[] }`). Old day-based
  saves are migrated (each counted day becomes a point; stages that met the old day target stay
  completed).

## World generation
`pipeline/langmap/world.py`. Everything is seeded and deterministic.

1. **Lots.**
   - Words live in small hamlets ("lots") of 1–7 words. Lot centers are scattered by
     Poisson-disk sampling (≥ 6 cells apart), and each lot's words sit within 3.4 cells of
     its center. Inside a lot, words in nearby rows stay ≥ 3 columns apart so their name plates
     fit.
   - Lots are filled outward from the central plaza in order of a wobbly radius, `r_shape`: an
     angular coast factor times medium-scale fbm noise (±12%). This makes the island and the
     level bands organic rather than circular.
   - Word quotas are exact per 5-cell ring: 0.07 words per land cell in towns (HSK 1–6) and
     0.05 in the wilderness (HSK 7–9). So density is flat in towns and lower outside, which
     `pytest` checks.
2. **Force layout** on continuous coordinates. Each level keeps to its band (distance from the
   center follows HSK level). Topics start in angular sectors sized by word count. Words are
   pulled toward their anchor and semantic neighbors, and a short-range repulsion keeps the
   density even.
3. **Regions.** The lots of each level are grouped into compact regions of at most
   `REGION_CAP[level]` words (aiming for 88% of it, since lots can't be split): 30 for HSK 1,
   rising to 70 for HSK 6, and 120 for wilderness. That gives 172 regions: 12, 7, 15, 23, 31
   and 30 towns, plus 54 wilds. The region *shapes* (which lots/slots form a region) come from
   geography; which *words* go to each region is a capacity-constrained k-means over position
   and meaning (`semantic_regions`): the cost of putting a word in a region is its squared
   distance (normalized by the median) plus `REGION_MEANING` (30) × (1 − cosine to the
   region's meaning centroid), solved exactly by optimal transport, re-centering for up to 40
   rounds. Mean cosine to the region centroid (`region_coherence` in the report) is about
   0.41–0.54 per level against 0.22–0.36 for a random split of the same level.
4. **Neighbors.** Inside a region, words are first matched to slots by layout position
   (Hungarian algorithm), then improved by a quadratic-assignment local search: the best
   pairwise swap is applied until none helps. The cost pulls related words close (sparse
   affinity: embedding similarity, idf-weighted shared characters, "builds on" links, same
   topic; each word keeps its 6 strongest), with a weak pull back toward the layout.
5. **Cells.**
   - Land is everything within the coast (`r_shape` plus small-scale jitter), plus a margin
     around every word. Only the largest landmass is kept, and inland sea pockets are filled.
   - Each empty land cell joins a region by Gaussian-weighted membership (σ = 3.2) of nearby
     words, which gives smooth borders. Exclaves and enclaves are repaired, so every region is
     one piece.
6. **Halls and roads.**
   - Each region gets a hall near its middle, ≥ 3 cells from any word, on land.
   - Roads are A* paths on the grid (water costs 6× and becomes a bridge; reusing a road is
     cheap, so roads merge into networks). They link the plaza to the HSK 1 halls, each hall to
     neighboring regions' halls (a spanning tree plus ~30% extra loops), and every lot to its
     region's hall (a spanning tree per region). In the wilderness they are trails.
7. **Terrain.**
   - In towns, each topic has a pair of grounds (e.g. orchard/meadow), mixed by fbm "detail"
     noise. The topic itself is a smoothed field of nearby words' topics, so terrain varies
     smoothly but differs from town to town. Ponds appear in open town land.
   - The wilderness uses elevation/moisture noise, biased per topic, to pick forest, hills,
     marsh, dunes or red rock, peaks and snow, with lakes in open land.
   - Sand lines the coast. Words, halls and the plaza never stand on water.
8. **Names.** `config/zh-en/places.json` lists ~300 curated name stems, each with a few HSK
   keywords (e.g. 家人 *Family*: 爸爸, 妈妈, 哥哥, …). A stem's score for a region is the
   cosine between its keywords' mean vector and the region's meaning centroid, plus 0.6 × the
   share of its keywords that live in the region. The Hungarian algorithm gives every region a
   different stem (mean score 0.9; below 0.3 it would fall back to the region's most typical
   noun, which currently never happens). The stem gets the place suffix of the region's
   dominant topic (towns: 村, 果园, 钟楼, 驿 …) or wilderness ground (林, 沙丘, 山 …), e.g.
   家人村 *Family Village*, 天气驿 *Weather Crossroads*, 宇宙山 *Cosmos Peaks*. The report
   lists every region with its most frequent words, to review names.

`world_stats` reports density by distance and mean distance by level. The build prints them,
and `reports/zh-en.md` records them with lot and road counts. `reports/zh-en-preview.png` and
`zh-en-closeup.png` are for visual review.

## Sentence selection
- Up to 10 Tatoeba sentences per word, **easiest first**. The score is how many of the other
  words are above the word's level and by how much, plus a small penalty outside a comfortable
  length; ties go to shorter sentences, then the Tatoeba id. So sentences whose other words are
  all at or below the word's level ("easy": 57–69% of the chosen ones for HSK 1–6, see the
  report) come first, which matters because collecting a sentence credits every word in it.
- Sentences are segmented with jieba plus the HSK lexicon, readings are disambiguated with
  pypinyin, and only simplified-script sentences are kept.
- Coverage by level is reported in `pipeline/reports/zh-en.md`. Words without a sentence fall
  back to word-only practice in the sentence stages.

## App (as built)
- **Renderer** (`map/renderer.ts`): Canvas 2D, no game engine.
  - The terrain is rendered into an offscreen buffer for the visible area plus a margin.
    - Base ground is painted at 2 px per cell and upscaled with smoothing, so biomes blend.
    - Roads, trails and bridges are stroked between neighboring road cells (2×2 blocks are
      filled as small squares).
    - Then come per-cell details (grass tufts, flowers, trees, rocks, waves; hashed per cell
      so they are stable).
    - Then borders, traced with marching squares on the dual grid: coast, thick borders
      between levels, and thin soft borders between same-level regions.
  - Words are written on **landmarks** (`map/landmarks.ts`) chosen from the ground under them
    and a per-word hash: cottages, shops, domed houses, towers, barns and cabins in towns;
    trees, pines, fruit and blossom trees, boulders, mountains, clouds, dunes, mesas, crystals,
    lily pads and haystacks in the wilds. Colors vary per word.
  - Halls are drawn as a flagged building with a name plate; the start plaza has a fountain.
  - State is shown by quest marks ("!" on a discovered word with no points yet), stage pips
    under the hanzi, a ★ when learned, and a highlight ring on the landmark you're next to.
  - Pinyin plates are placed in priority order with an occupancy grid to avoid overlap. In
    listen + read mode (setting "auto") every word in a region whose listening stages aren't
    all done gets one, including faded unexplored words.
  - In listening-only mode the landmark shows the pinyin (listeners know the sound, not the
    writing) and the optional second plate shows the characters; the word card also leads with
    pinyin.
- **Player** (`map/player.ts`, `logic/walk.ts`):
  - WASD/arrows walk (Shift runs) with collision against landmarks, halls, water and the sea.
  - Clicking or tapping walks there along an A* path at a constant pace per trip: walking speed
    for short hops, faster for long trips (each trip takes about a second, capped), with no
    slowdown at the end. Clicking a landmark walks up to it and opens it. `N` walks to the next
    word with a quest nearby (skipping the last few visited).
  - `E`/Space interacts with the nearest landmark or hall in reach. The camera follows
    the player; dragging pans away and `C` re-centers.
  - The position is saved per pack. `H` and fast travel (search, world map) put the player in
    front of the target.
- **Minimap** (bottom right): the current region's name, level, kind and progress bar, a ⚑ Hall
  button (takes you to the region's hall and opens it), plus a small overview with the viewport
  rectangle. Clicking it opens the world map.
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
- **Word card** (`ui/WordPopover.tsx` → `ui/QuestCard.tsx`): a small card at the bottom that
  starts the word's current stage at once. A sentence stage plays the sentence (listening) or
  shows it (reading).
  - `E` / ✓ Collect: a point for every word in the sentence; the reward line lists them.
  - `Space` / Show answer: hanzi, pinyin, English; a point for this word only, and `E` then
    collects the rest.
  - `K` Know it (mark learned), `X` another sentence, `I` details, `R` replay, `N` next word.
  - After collecting, `E` goes to the next sentence (or the next word once it is learned).
  - An "alone" stage plays or shows just the word: `E` "got it", or `Space` to check first.
  - Learned words still show sentences, so collecting them credits the other words.
- **Halls** (`ui/HallModal.tsx`, `logic/boss.ts`):
  - The menu shows the region's level, progress and word list.
  - ⚔️ Challenge: rounds of 8 of the region's unlearned words (easiest and most common first),
    each a hanzi prompt (or audio in listening-only mode) with 4 English choices plus "Not
    sure". Distractors come from the same region and level (same part of speech preferred) and
    never share a sense with the answer or are its closest neighbors in meaning. A correct answer marks
    the word known; a miss reveals it and shows its meaning and an example. The summary lists
    cleared and missed words, and can start quests for the missed ones.
  - 💬 Sentences: a shuffled run through the region's unlearned words with sentences (all of
    them once the region is learned), one sentence each in the same quest card; `E` collects
    and moves on.
- **Word details** (📖): meanings, quest stages (practice / mark done), example sentences, and
  an "Explore" section:
  - builds on / leads to
  - per-character links (open the character view)
  - similar meaning
- **Mobile** (≤ 700 px wide):
  - The card, details, quest log and every dialog are bottom sheets (dialogs leave a 48 px strip
    of map above; the welcome screen keeps its start controls pinned at the bottom).
  - Sheets have a grip: a touch swipe down (> 70 px) closes them (`ui/useSwipeDismiss.ts`); the
    × stays pinned while the sheet scrolls and is a 40 px target.
  - The phone's Back button closes the topmost popup (`App.tsx`): while any popup is open the
    app keeps one extra history entry; Back pops it and closes one layer (dialog → quest → hall
    → details → card → quest log, like Esc), and closing the last popup another way removes
    the entry again.
- **Quest points:**
  - A stage is done once its points reach the requirement, or when self-marked. Completion is
    locked in, so lowering or raising "sentences per stage" never un-finishes a stage.
  - Points can be earned in any order; the card always works on the first unfinished stage.
- **Quest log** (`Q`, or click the 🧭 open / ⭐ learned counters in the top bar):
  - *Open*: words in progress (stage, mini progress bar, points/needed; closest to done first)
    and discovered words not started yet.
  - *Learned*: learned count per level (click a level to filter) and the learned words.
- **Reveal logic:**
  - Finishing a stage reveals 1 word; learning a word reveals 2.
  - Candidates are ranked by map proximity first, then meaning/character links, preferring
    easier levels so each band fills before the next.
  - 🔭 Discover picks the best candidate near the camera.
- **Search:** hanzi / pinyin (tone marks optional) / English. Results fly to the word.
- **Settings:**
  - quest mode, fog mode and scope
  - sentences needed per sentence stage (1–30, default 10), auto-reveal
  - pinyin on the map (auto / always / never), TTS rate and voice (auto = the best-ranked
    mainland Mandarin voice)
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
8. ✅ **M7 Walkable world:**
   - lower density: words in hamlets with open land, ponds, roads, trails and bridges
   - better neighbors (quadratic-assignment swaps on meaning/character/anchor affinity)
   - biome landmarks instead of part-of-speech icons
   - player character (WASD, click/tap to walk, `E`, `N`)
   - light word card; full details only on demand
   - region halls with Challenge and Train
9. ✅ **M8 Meaningful towns, listening labels, mobile:**
   - regions grouped by meaning as well as position, and named from curated stems matched by
     meaning (no more odd names such as "Son Plaza")
   - pinyin on the map in listening-only mode
   - bottom sheets with swipe-to-close, pinned close buttons, Back button support, compact
     top bar and welcome screen on phones
   - pack files cache-busted by `contentHash`, so a deploy never mixes old and new data
10. ✅ **M9 Sentence quests:**
   - points instead of days: 10 sentences per sentence stage (looping), 1 check for alone stages
   - multi-reward sentences: collecting credits every word in it; show answer credits the focus
     word; words are only revealed by earning a point
   - up to 10 sentences per word, easiest first (pack schema 4 with per-word counts)
   - quest card opens straight into a sentence; `E` confirms everywhere; no soft cap
   - hall 💬 Sentences replaces Train; clickable open/learned counters with log tabs
   - pinyin under every word until its region's listening stages are done
   - constant-pace, faster walking on long trips

## Ideas / next
- **Names:** wilderness names are just "stem + ground" (e.g. *Faintness Crystal Fields*); a
  second, evocative word list for wilds and a one-line blurb per town ("words about family and
  home") on the world map.
- **Landmark variety:** more axes per word (e.g. size by frequency, special landmarks for very
  common words or characters), and NPC-like walkers in towns.
- **Hall bosses with a story:** a named keeper per hall, a short sentence-based final round
  (listen to or read a sentence, pick its meaning) once most of a town is learned, and a
  stamp in a "passport" for clearing it.
- **Minimap navigation:** click a spot on the minimap (not only the button) to walk or fly
  there. A "next quest" compass arrow.
- **Sentence difficulty:** grade sentences by the learner's own progress (prefer sentences whose
  other words are already learned) rather than only by HSK level.
- **Spaced review:** an optional "review" queue that resurfaces learned words after a while,
  now that stages no longer use days.
- **Character decomposition** hints (Make Me a Hanzi). Pre-generated audio. Curated sentences
  for low-coverage words.
- **Sprites:** swap the vector landmarks and player for a pixel-art tile set if one with a
  compatible license fits.
- More language packs.
