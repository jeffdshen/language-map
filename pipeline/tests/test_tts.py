from langmap.tts import align, say_for, speech_overrides


def test_align_splits_pinyin_per_character():
    assert align("结果", "jiēguǒ") == ["jiē", "guǒ"]
    assert align("哪儿", "nǎr") == ["nǎ", "r"]
    assert align("结果", "kāfēi") is None


def test_lone_character_with_a_rare_reading_is_spelled_out():
    assert say_for("还", "huán") == "环"
    assert say_for("行", "háng") == "航"
    assert say_for("地", "de") == "的"
    # Its usual reading needs no hint, and neither does a neutral tone or tone sandhi.
    assert say_for("还", "hái") is None
    assert say_for("得", "de") is None
    assert say_for("一", "yì") is None


def test_both_readings_of_a_taught_homograph_are_spelled_out():
    # Voices disagree on 长 alone; each reading gets a character only ever read that way.
    long = say_for("长", "cháng", ["zhǎng"])
    grow = say_for("长", "zhǎng", ["cháng"])
    assert long and grow and "长" not in long + grow and long != grow


def test_multi_character_words_only_when_written_like_another_word():
    assert say_for("结果", "jiēguǒ", ["jiéguǒ"]) == "接果"
    assert say_for("结果", "jiéguǒ", ["jiēguǒ"]) is None
    assert say_for("银行", "yínháng") is None


def test_speech_overrides_lists_only_misread_words():
    entries = [("w1", "还", "hái"), ("w2", "还", "huán"), ("w3", "银行", "yínháng")]
    assert speech_overrides(entries) == [["w2", "环"]]
