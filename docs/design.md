# Language Map — Design (draft)

A vocab "world map" (mind map / skill tree / 2D game world) where each word is a
character on the map. Placement encodes relationships (shared characters,
semantics, level). First instance: Mandarin Chinese, HSK 3.0. Design stays
language-agnostic.

## Decisions so far
- **Platform:** static web app, local-first (progress in IndexedDB; export/import JSON).
- **Word list:** HSK 3.0 (n1–n6 + n7 = bands 7–9), ~11.5k words.
- **Determinism:** map, word data, and sentences are produced by an offline,
  seeded, version-pinned pipeline and **committed as artifacts**. Procedural
  generation is a build-time tool for iteration, never runtime. Same world for
  everyone → shareable, stable mental map.
- **Visuals v1:** clean stylized map (regions, terrain colors, nodes). Tile/sprite
  assets later.
- **Exploration:** fog of war with soft cap on open (revealed, unfinished) words.
  User controls: fog toggle (hidden vs. dimmed), fog scope (words only [default]
  vs. words + terrain), force-reveal via UI or search ("I already know this").
- **Progression:** 4 stages per word, each needs successes on 3 separate days
  (configurable); any stage can be self-marked done. Honor system.
  1. Listen — understand in a sentence (audio)
  2. Listen — understand word alone (audio / pinyin)
  3. Read — understand in a sentence (characters)
  4. Read — understand word alone (characters)

## Architecture
```
pipeline/ (Python, offline)          app/ (TypeScript, Vite)
  sources -> normalize -> relate  ->   data/*.json (committed, versioned)
          -> layout -> sentences  ->   map renderer + quest UI + progress store
```

### Data sources (open licenses)
| Data | Source | License |
|---|---|---|
| HSK 3.0 words, pinyin, POS, freq, radical | drkameleon/complete-hsk-vocabulary | MIT |
| Definitions / extra readings | CC-CEDICT | CC BY-SA 4.0 |
| Example sentences (+ English) | Tatoeba (cmn↔eng) | CC BY 2.0 FR |
| Character decomposition (later) | Make Me a Hanzi / IDS | LGPL / various |
| Audio v1 | Browser Web Speech API (zh-CN) | n/a |
| Audio later | Pre-generated TTS, bundled | TBD |

### Generic data model (language-agnostic)
- `Word { id, form, reading, glosses[], level, pos[], freq, components[] }`
  (components = characters for zh; morphemes/roots for other languages)
- `Edge { a, b, kind: shared_component | semantic | ..., weight }`
- `Region { id, name, theme, polygon, biome }` (semantic cluster → biome)
- `Placement { wordId, x, y, regionId, anchorWordId }`
- `Sentence { id, text, reading, translation, wordIds[], source, license }`
- `LanguagePack { meta, words, edges, regions, placements, sentences }`
- Progress (client only): `{ wordId, revealed, stages[4]: { days: date[], selfMarked } }`

### Layout pipeline (deterministic, seeded)
1. **Relations:** shared-character edges; semantic edges from embeddings of
   word + glosses (multilingual sentence-embedding model, pinned version),
   kNN graph.
2. **Regions:** cluster embeddings into themed regions (food, travel, emotion,
   work, nature, …); each region is an angular sector/biome.
3. **Radial levels:** HSK level sets distance from center (HSK1 core → n7 frontier).
4. **Anchoring:** each outer word attaches to its most related inner word
   (shared char > semantic) → skill-tree threads outward.
5. **Placement:** constrained force layout (radius band + sector + anchors),
   collision removal, fixed seed. Output committed; diffs reviewable.
6. **Stability:** re-runs keep existing positions unless explicitly re-laid out
   (layout versioning), so users' mental maps don't break.

### Sentence selection
- For each word, choose N sentences from Tatoeba whose other words are mostly
  at or below the word's level (comprehensibility score), with length limits.
- Segmentation via jieba (pinned) + HSK lexicon; deterministic ranking/tie-breaks.
- Words with no good sentence are flagged in a report (later: curated/LLM fill,
  reviewed and committed).

### App
- **Map:** pan/zoom canvas (PixiJS or similar), level-of-detail (regions → clusters
  → words), fog layer, region labels.
- **Word "character":** hanzi + pinyin nameplate; look hints at meaning via region
  biome, POS-based shape/icon, neighbors.
- **Word panel:** meanings, shared-character links ("explore hints"),
  neighbors, stage progress, start quest, mark known.
- **Quest:** per stage, show today's example (sentence/audio/word), user
  self-grades; one success per calendar day counts.
- **Reveal logic:** finishing a stage/word reveals anchored + strongly linked
  neighbors; suggestions prefer inner levels; soft cap on open words shows a
  warning/nudge, never blocks.
- **Search:** hanzi / pinyin (tone-insensitive) / English; reveal or fly to result.
- **Settings:** fog mode, fog scope, days per stage, open-word soft cap.
- **Progress:** IndexedDB, JSON export/import.

## Milestones
1. **M0 Repo scaffold:** monorepo (`pipeline/`, `app/`, `data/`), CI, licenses/attribution.
2. **M1 Data:** ingest HSK 3.0 + CC-CEDICT → normalized words; shared-char edges.
3. **M2 Layout v1:** radial levels + semantic regions + anchoring → placements JSON;
   debug visualization.
4. **M3 Map app:** render map, pan/zoom, word nodes, word panel, search.
5. **M4 Progress:** stages, quests (word-only stages first), local storage, fog/reveal.
6. **M5 Sentences:** Tatoeba selection + TTS → sentence-based stages.
7. **M6 Polish:** biomes/terrain, appearance hints, assets/tilemaps, sharing.

## Open questions
- Simplified only, or show traditional too?
- Tone colors on pinyin?
- Should n7 (bands 7–9, ~5.6k words) be in v1 or deferred?
