# Data sources and licenses

The code in this repository is licensed under the [MIT License](LICENSE). This
file covers third-party data. The generated language pack in `data/zh-en/` is
derived from the third-party sources below and is distributed under their terms.
Because it contains CC-CEDICT glosses and ConceptNet-derived placement, **the
data pack as a whole is licensed CC BY-SA 4.0**; example sentences remain under
CC BY 2.0 FR.

| Source | Used for | License |
|---|---|---|
| [HearMandarin HSK 3.0 word list](https://github.com/wzperson/hearmandarin-hsk-3-0-word-list) ([hearmandarin.com](https://hearmandarin.com/datasets/)) — the official 2025 HSK exam syllabus | word list, ids, levels, POS, pinyin, short teaching glosses, traditional forms | CC BY 4.0 |
| [ivankra/hsk30](https://github.com/ivankra/hsk30) — the 2021 HSK 3.0 list | migrating saves from the old word ids; alternate forms | MIT |
| [CC-CEDICT](https://cc-cedict.org/) via [drkameleon/complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) | additional English glosses | CC BY-SA 4.0 (CC-CEDICT); MIT (packaging) |
| [Tatoeba](https://tatoeba.org/) via the npm package `tatoeba-sentence-pairs-in-mandarin-chinese-english` | example sentences (Chinese ↔ English) | CC BY 2.0 FR |
| [ConceptNet Numberbatch 17.06](https://github.com/commonsense/conceptnet-numberbatch) | semantic embeddings for topics, neighbors and world layout (vectors are not redistributed) | CC BY-SA 4.0 |
| [wordfreq](https://github.com/rspeer/wordfreq) | word frequency (placement within a level, discovery order) | Apache-2.0 code; data CC BY-SA 4.0 |
| [jieba](https://github.com/fxsjy/jieba), [pypinyin](https://github.com/mozillazg/python-pinyin), [OpenCC](https://github.com/BYVoid/OpenCC) | segmentation, reading disambiguation, script filtering | MIT / MIT / Apache-2.0 |

Tatoeba sentences keep their original ids (`id`, `en_id` in `sentences.json`);
each sentence can be viewed at `https://tatoeba.org/sentences/show/<id>`, which
credits its contributor.

Exact versions and checksums of every input are pinned in
[`pipeline/sources.lock.json`](pipeline/sources.lock.json).
