from langmap.audio import TEST_PHRASE, clip_name, clip_phonemes, pack_clips, word_clip
from langmap.paths import DATA_DIR


def test_clip_names_match_the_app():
    # Same vectors as app/src/audio.test.ts.
    assert clip_name("") == "cbf29ce484222325"
    assert clip_name("a") == "af63dc4c8601ec8c"
    assert clip_name("你好") == "3d262481d7d5eaa3"
    assert clip_name(TEST_PHRASE) == "d5c8063e0f181e54"
    assert clip_name("e\u0301") == "0ac21707b7181e01"


def test_pack_clips_cover_every_word_reading_and_sentence():
    clips = pack_clips(DATA_DIR / "zh-en")
    keys = {c.key for c in clips}
    assert len({clip_name(k) for k in keys}) == len(keys) == len(clips)
    # Words written alike but read differently get a clip each.
    assert {word_clip("得", "dé"), word_clip("得", "děi")} <= keys
    assert TEST_PHRASE in keys
    for c in clips[:2000]:
        ph = clip_phonemes(c)
        assert ph and ph[-1] in ".!?…”" and all(p for p in ph), c
