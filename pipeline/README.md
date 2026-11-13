# langmap pipeline

Offline, deterministic build of the language packs in [`../data`](../data).
The app never runs this code; it only reads the committed JSON.

```sh
cd pipeline
uv sync
uv run langmap fetch          # download + sha256-verify pinned sources (~1.3 GB, cached in .cache/)
uv run langmap build          # regenerate ../data/zh-en and reports/
uv run pytest                 # unit tests (no downloads needed)
uv run ruff check . && uv run ruff format --check .
```

Running `build` twice produces byte-identical output. When you change the
pipeline, review the diffs of `reports/zh-en.md`, `reports/zh-en-preview.png`
and `data/zh-en/*.json`, and bump `LAYOUT_VERSION` in `langmap/world.py` if
word positions move (the app uses it to tell the player the map changed).

## Steps

| Module | What it does |
|---|---|
| `sources.py` | Fetches pinned inputs from `sources.lock.json` and verifies checksums. |
| `words.py` | Loads the official 2025 HSK syllabus (HearMandarin dataset): ids, levels, Chinese POS, pinyin, traditional forms and a short teaching gloss, followed by CC-CEDICT senses. Also maps the old 2021-list ids (ivankra/hsk30) to the new ids, so the app can migrate old saves. |
| `embed.py` | Builds one vector per word: the Numberbatch vector for the Chinese word plus a weighted vector for its English glosses. |
| `themes.py` | Assigns each word to one of the 17 curated topics in `config/zh-en/themes.json`, using zero-shot similarity to keyword centroids, part-of-speech rules, and two refinement passes. Topics set terrain and place suffixes; they are not regions themselves. `load_place_labels` reads the region name stems in `config/zh-en/places.json`. |
| `relate.py` | Finds semantic neighbors (k = 8) and an *anchor* for each word: the best lower-level word by meaning, shared characters (idf-weighted), containment, and topic. |
| `world.py` | Builds the tile world (see the module docstring and [docs/design.md](../docs/design.md#world-generation)): Poisson-disk hamlets ("lots") of 1–7 words on a wobbly island, a force layout (level → distance from the center, anchors and neighbors pull together, repulsion keeps density even), size-capped regions per level (a capacity-constrained k-means on position *and* meaning, solved by optimal transport, so a town's words share a meaning), region names from the curated stems in `config/zh-en/places.json` matched by meaning (Hungarian, each stem used once), quadratic-assignment swaps so related words share a lot, soft region borders, a hall per region, A* roads/trails/bridges, water and terrain. |
| `sentences.py` | Selects up to 10 Tatoeba sentences per word, easiest first: ranked by how many of the other words are above the word's level (and by how much), then length. The app credits every word in a collected sentence, so easy sentences matter. Segments them with jieba, disambiguates readings with pypinyin, and keeps only simplified script. Reports how many chosen sentences are "easy" (no other word above the level) per level. |
| `tts.py` | Speech hints: for words a voice would misread from their characters (a character alone with a less common reading, like 还 huán or 地 de, a character taught with two readings, like 长 cháng / zhǎng, or the rarer reading of a homograph, like 结果 jiēguǒ), picks common characters that are almost only ever read the wanted way (环, 的, 常 / 掌, 接果). How often each character is read each way is measured over wordfreq's words with pypinyin. |
| `phonemes.py`, `audio.py`, `audio_check.py` | Speech clips, run separately from the build (`langmap audio`, `audio-pack`, `audio-check`; see [docs/audio.md](../docs/audio.md)): turns the pack's pinyin into Kokoro phonemes with tone sandhi, says every word reading and sentence with Kokoro v1.1-zh on onnxruntime, and scores voices with a speech recogniser and pitch tracking. |
| `export.py` | Writes `manifest.json`, `words.json`, `world.json`, `sentences.json` and `legacy-ids.json`, plus `reports/zh-en.md` (counts, density by distance, region meaning coherence, every region with its most frequent words for reviewing names, and the speech hints). |
| `preview.py` | Renders `reports/zh-en-preview.png` (whole world with region labels) and `reports/zh-en-closeup.png` (the center at game scale). |

`uv run pytest` checks, among other things, that the world is deterministic, that no two words
touch and name plates have room, that every region is one connected piece of a single level
within its size cap, that regions group words by meaning (more coherent than a random split) and
get unique, keyword-matched names, that word density never increases outward (also on the
committed pack), that halls and the plaza are
clear of words and water, and that every word and hall can be reached on foot from the plaza.

## Pack format (`data/<pack>/`)

All files use schema 4. Coordinates are integer grid cells, with the start plaza at (0, 0) and y
pointing down.

- **`manifest.json`**: schema version, `layoutVersion`, `contentHash`, file names, levels (label,
  word count, region count), starter words, counts, sources with licenses and checksums, and
  build stats. The app always revalidates it, then fetches the other files as
  `file?v=<contentHash>`.
- **`words.json`**: `{"fields": [...], "rows": [[...], ...], "say": [...]}`, one row per word.
  Fields: `id, hanzi, pinyin, level, pos, theme, region, x, y, anchor, freq, glosses, neighbors,
  trad, alts, ex`.
  - `say` lists `[id, text]` for words that text-to-speech should read from other characters
    (see `tts.py`); every other word is spoken as its `hanzi`.
  - `id` is the syllabus id (`w00001`…).
  - `ex` is the number of example sentences for the word (0–10), so the app knows each stage's
    requirement before `sentences.json` loads.
  - `pos` is a coarse category (`noun`, `verb`, …).
  - `theme`, `anchor` (-1 = none) and `neighbors` are row indices; `region` is a region id.
- **`world.json`**:
  - `grid` `{x0, y0, w, h}` and `spawn`.
  - `ground`: ground code → `{name, color}`.
  - `themes`: topic names, colors, biome and place suffix.
  - `regions`: rows of `regionFields` = `id, level, kind (town|wild), theme, zh, en, count, cells,
    x, y, color`, where `x, y` is the region's hall (on land, clear of words).
  - `terrain`: one string per grid row of ground codes. Besides biomes and water (`~` sea, `=`
    lake), `p` is plaza, `+` road, `,` trail (wilderness) and `b` bridge. Words, halls and the
    plaza never stand on water.
  - `regionRuns`: per row, run-length `[regionId, length, …]` (-1 = sea).
- **`sentences.json`**: `rows` of `[id, en_id, en, seg]`.
  - Each `seg` token is one of:
    - `[text]` (punctuation)
    - `[text, word]` (a word with its dictionary pinyin)
    - `[text, word, pinyin]`

    `word` is -1 when the token is not an HSK word.
  - `byWord[i]` lists the sentence rows for word `i`, easiest first.
- **`legacy-ids.json`**: for each old (schema 1) band (`L1`…), the new word number for each old
  sequence number (0 = no match). The app uses it once to migrate old saves.
