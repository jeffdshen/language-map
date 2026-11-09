# Language Map — Design

A vocab "world map" (mind map / skill tree / 2D game world) where each word is a
character on the map. Placement encodes relationships (shared characters,
semantics, level). First instance: Mandarin Chinese, HSK 3.0. Design stays
language-agnostic.

## Decisions so far
- **Language pair:** Mandarin Chinese → English (learner sees English glosses).
- **Platform:** static web app, local-first (progress in IndexedDB; export/import JSON).
- **Word list:** HSK 3.0, all levels including advanced (n1–n6 + n7 = bands 7–9),
  ~11.5k words, all in v1.
- **Script:** simplified characters only (HSK standard); traditional forms kept
  in the data for possible later use.
- **Pinyin:** tone marks, no tone coloring.
- **Determinism:** map, word data, and sentences are produced by an offline,
  seeded, version-pinned pipeline and **committed as artifacts**. Procedural
  generation is a build-time tool for iteration, never runtime. Same world for
  everyone → shareable, stable mental map.
- **Visuals v1:** clean stylized map (regions, terrain colors, nodes). Tile/sprite
  assets later.
- **Exploration:** fog of war with soft cap on open (revealed, unfinished) words.
  User controls: fog toggle (hidden vs. dimmed), fog scope (words only [default]
  vs. words + terrain), force-reveal via UI or search ("I already know this").
  Default fog mode is *hidden*: only "?" spots next to explored words are visible.
- **Progression:** 4 stages per word, each needs successes on 3 separate days
  (configurable); any stage can be self-marked done. Honor system.
  1. Listen — understand in a sentence (audio)
  2. Listen — understand word alone (audio / pinyin)
  3. Read — understand in a sentence (characters)
  4. Read — understand word alone (characters)

## Architecture
```
pipeline/ (Python, offline)                 app/ (TypeScript, Vite, React)
  sources -> words -> embed -> themes  ->     data/zh-en/*.json (committed)
          -> relate -> layout             ->  canvas map + quest UI + local progress
          -> sentences -> export/preview
```
The app has no backend. It is a static site that loads the committed pack and stores
progress in the browser.

### Data sources (open licenses)
| Data | Source | License |
|---|---|---|
| HSK 3.0 words, levels, POS, pinyin | ivankra/hsk30 | MIT |
| English glosses, traditional forms | CC-CEDICT via drkameleon/complete-hsk-vocabulary | CC BY-SA 4.0 |
| Example sentences (+ English) | Tatoeba cmn↔eng (pinned npm snapshot) | CC BY 2.0 FR |
| Semantic vectors (build time only) | ConceptNet Numberbatch 17.06 | CC BY-SA 4.0 |
| Word frequency | wordfreq | CC BY-SA 4.0 (data) |
| Audio | Browser Web Speech API (zh-CN) | n/a |

All inputs are pinned with sha256 checksums in `pipeline/sources.lock.json`. The
generated pack is CC BY-SA 4.0 (see `ATTRIBUTION.md`).

### Pack format
The format is documented in `pipeline/README.md`.
- `manifest.json`: levels with ring radii, starter words, `layoutVersion`, `contentHash`, sources.
- `words.json`: columnar rows `id, hanzi, pinyin, level, pos, theme, x, y, anchor, freq,
  glosses, neighbors, trad, alts`.
- `regions.json`: themes, label positions, ring radii and per-ring sector boundary angles.
- `sentences.json`: segmented sentences with per-token pinyin and HSK word links (loaded lazily).

Word ids are the official HSK ids (e.g. `L1-0194`), because some hanzi appear more than once.
Progress is keyed by these ids, so re-layouts don't lose progress.

### Generic data model (language-agnostic)
- `Word { id, form, reading, glosses[], level, pos, freq, theme, x, y, anchor, neighbors[] }`
  (for zh, a word's characters are its components; another language could use morphemes or roots)
- Links are derived at load time:
  - **anchor**: the simpler word it branches from
  - **children**: words that branch from it
  - **neighbors**: semantic neighbors
  - **shared characters**: an index from character to words
- `Region { theme, name, color, icon, label position }` plus ring/sector geometry for terrain.
- `Sentence { id, en_id, en, seg[] }`, where tokens link to words and carry pinyin.
- Progress (client only): `{ wordId: { revealed, stages[4]: { days[], marked?, completed? } } }`

### Layout pipeline (deterministic)
1. **Embeddings:** each word gets a Numberbatch vector for the Chinese word, blended with the
   vectors of its English glosses.
2. **Regions:** 17 curated themes (`pipeline/config/zh-en/themes.json`). Words are assigned
   zero-shot by similarity to keyword centroids, with part-of-speech rules and refinement passes.
   Each theme is an angular sector whose width follows its word count per ring.
3. **Radial levels:** the HSK level sets the ring (HSK 1 core → HSK 7–9 frontier). Within a ring,
   more frequent words sit further in.
4. **Anchoring:** each word attaches to the best lower-level word. The score combines meaning,
   idf-weighted shared characters, containment (e.g. 看 → 看见) and same region.
5. **Placement:** a spectral order within each region and anchor/neighbor springs set the angle,
   then collisions are resolved (minimum distance 1). The output is committed and diffable.
6. **Stability:** `layoutVersion` is bumped when positions move; progress is keyed by word id.

### Sentence selection
- Up to 6 Tatoeba sentences per word, ranked by comprehensibility: the other words should be at
  or below the word's level. Length limits and deterministic tie-breaks apply.
- Sentences are segmented with jieba plus the HSK lexicon, readings are disambiguated with
  pypinyin, and only simplified-script sentences are kept.
- Coverage by level is reported in `pipeline/reports/zh-en.md`. Words without a sentence fall back
  to word-only practice in the sentence stages.

### App (as built)
- **Map:** a Canvas 2D renderer (no game engine).
  - The terrain bitmap is rasterized once at load.
  - Level of detail: region labels when zoomed out, then markers, then hanzi labels (scale ≥ 9),
    then pinyin (scale ≥ 18).
  - Uses a spatial grid for culling and hit testing, plus pan/zoom/pinch and animated fly-to.
- **Word "character":**
  - The marker shape gives the part of speech.
  - The color and fill give the state: hidden "?", revealed, active (with a due badge), learned.
  - A hanzi + pinyin nameplate.
  - Selecting a word highlights its anchor, children and neighbor links.
- **Visibility states:** hidden → frontier ("?") → revealed → active (quest accepted) → learned.
  - A hidden word becomes frontier when it is directly linked (anchor, child, or one of the top 4
    neighbors) to an explored word and is at most one level further out. The frontier therefore
    grows ring by ring.
- **Word panel:**
  - Meanings, quest stages (practice / mark done), example sentences.
  - "Explore" section: branches from, leads to, per-character "N hidden · reveal next",
    similar meaning.
  - On mobile it is a bottom sheet.
- **Quest:**
  - A modal per stage: listen or read, show the answer (hanzi, pinyin, English, highlighted
    word), then self-grade.
  - One success per learning day counts. The day rolls over at 04:00 local time (configurable).
  - A stage is done after N successful days or when self-marked. Its completion is locked in,
    so raising "days per stage" later doesn't undo finished stages.
- **Reveal logic:**
  - Finishing a stage reveals 1 linked word; learning a word reveals 2. Lower levels are
    preferred, then link strength and frequency.
  - Auto-reveal stops at the soft cap on open words. Manual reveal ("?", 🔭 Discover, search,
    hints) always works but shows a nudge when over the cap.
- **Search:** hanzi / pinyin (tone marks optional) / English. Results fly to the word.
- **Settings:**
  - Fog mode and scope, days per stage, open-word soft cap, auto-reveal, pinyin on the map,
    TTS rate, day rollover hour.
  - Bulk "known up to HSK n".
  - Export/import/reset.
- **Progress:** IndexedDB (localStorage fallback), debounced writes, versioned JSON export.
  Saves carry a monotonic `updatedAt`; open tabs sync via `BroadcastChannel` (newest save wins,
  stale writes are dropped). If an existing save can't be read, writes are disabled for the
  session and a warning is shown, so progress is never overwritten by a fresh start.
  Imports are validated.

## Milestones
1. ✅ **M0 Repo scaffold:** monorepo (`pipeline/`, `app/`, `data/`), CI, licenses/attribution.
2. ✅ **M1 Data:** HSK 3.0 + CC-CEDICT → normalized words; shared-character links.
3. ✅ **M2 Layout v1:** radial levels + semantic regions + anchoring → placements; preview image.
4. ✅ **M3 Map app:** map rendering, pan/zoom, word nodes, word panel, search.
5. ✅ **M4 Progress:** stages, quests, local storage, fog/reveal, soft cap.
6. ✅ **M5 Sentences:** Tatoeba selection + browser TTS → sentence-based stages.
7. **M6 Polish (next):**
   - Tile/sprite assets and biome art.
   - Character decomposition hints (Make Me a Hanzi).
   - Pre-generated audio.
   - Curated sentences for low-coverage words.
   - Label collision avoidance at mid zoom.
   - More language packs.
