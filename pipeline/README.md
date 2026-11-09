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
and `data/zh-en/*.json`, and bump `LAYOUT_VERSION` in `langmap/layout.py` if
word positions move (the app uses it to tell the player the map changed).

## Steps

| Module | What it does |
|---|---|
| `sources.py` | Fetches pinned inputs from `sources.lock.json` and verifies checksums. |
| `words.py` | Loads HSK 3.0 words (official ids, levels, POS, pinyin) and attaches CC-CEDICT glosses. Phrases missing a dictionary entry get glosses from `config/zh-en/gloss_overrides.json`. |
| `embed.py` | Builds one vector per word: the Numberbatch vector for the Chinese word plus a weighted vector for its English glosses. |
| `themes.py` | Assigns each word to one of the curated regions in `config/zh-en/themes.json`, using zero-shot similarity to keyword centroids, part-of-speech rules, and two refinement passes. |
| `relate.py` | Finds semantic neighbors (k = 8) and an *anchor* for each word: the best lower-level word by meaning, shared characters (idf-weighted), containment, and region. |
| `layout.py` | Places words. Level sets the ring (HSK 1 in the center), region sets the sector, a spectral order within each region and anchor/neighbor springs set the angle, and frequency sets the radius within the ring. Collisions are resolved with a minimum distance of 1. |
| `sentences.py` | Selects up to 6 Tatoeba sentences per word, preferring ones whose other words are at or below the word's level. Segments them with jieba, disambiguates readings with pypinyin, and keeps only simplified script. |
| `export.py` | Writes `manifest.json`, `words.json`, `regions.json` and `sentences.json`, plus `reports/zh-en.md`. |
| `preview.py` | Renders `reports/zh-en-preview.png`. |

## Pack format (`data/<pack>/`)

- **`manifest.json`**: schema version, `layoutVersion`, `contentHash`, levels with ring radii, starter words, sources with licenses and checksums, and build stats.
- **`words.json`**: `{"fields": [...], "rows": [[...], ...]}`, one row per word. Fields: `id, hanzi, pinyin, level, pos, theme, x, y, anchor, freq, glosses, neighbors, trad, alts`. `theme`, `anchor` (-1 = none) and `neighbors` are row indices.
- **`regions.json`**: region names and colors, label positions, and geometry (ring radii, per-ring sector boundary angles) for drawing terrain.
- **`sentences.json`**: `rows` of `[id, en_id, en, seg]`, where each `seg` token is `[text]` (punctuation), `[text, word]` (word with its dictionary pinyin), or `[text, word, pinyin]` (`word` = -1 when the token is not an HSK word). `byWord[i]` lists the sentence rows for word `i`.
