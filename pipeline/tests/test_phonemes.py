from langmap.phonemes import apply_sandhi, phonemes, read_number, split_pinyin, syllable_phonemes


def test_syllables_use_kokoros_symbols():
    assert syllable_phonemes("zhi", 1) == ["ㄓ", "十", "1"]
    assert syllable_phonemes("si", 4) == ["ㄙ", "ㄭ", "4"]
    assert syllable_phonemes("lv", 4) == ["ㄌ", "ㄩ", "4"]
    assert syllable_phonemes("yuan", 2) == ["元", "2"]
    assert syllable_phonemes("huir", 4) == ["ㄏ", "为", "R", "4"]


def test_split_pinyin_follows_the_characters():
    assert split_pinyin("一会儿", "yíhuìr") == [("一", "yi", 2), ("会儿", "huir", 4)]
    assert split_pinyin("女儿", "nǚ’ér") == [("女", "nv", 3), ("儿", "er", 2)]
    assert split_pinyin("谁", "shéi/shuí") == [("谁", "shei", 2)]
    assert split_pinyin("嗯", "ǹg") == [("嗯", "ng", 4)]
    assert split_pinyin("结果", "kāfēi") is None


def tones(words):
    return [[t for _, _, t in w] for w in apply_sandhi(words)]


def test_tone_sandhi():
    assert tones([[("不", "bu", 4), ("去", "qu", 4)]]) == [[2, 4]]
    assert tones([[("一", "yi", 1), ("个", "ge", 4)]]) == [[2, 4]]
    assert tones([[("一", "yi", 1), ("百", "bai", 3)]]) == [[4, 3]]
    assert tones([[("第", "di", 4), ("一", "yi", 1)]]) == [[4, 1]]
    assert tones([[("看", "kan", 4), ("一", "yi", 1), ("看", "kan", 4)]]) == [[4, 5, 4]]
    assert tones([[("展", "zhan", 3), ("览", "lan", 3), ("馆", "guan", 3)]]) == [[2, 2, 3]]


def test_numbers_are_said_in_words():
    assert read_number("25") == "二十五"
    assert read_number("15") == "十五"
    assert read_number("1998", "年") == "一九九八"
    assert read_number("2", "个") == "两"
    assert read_number("2", "月") == "二"
    assert read_number("2000") == "两千"


def test_layout_matches_kokoros_training_text():
    # Words joined by "/", punctuation in ASCII and followed by a space except at the end.
    assert phonemes([("我", "wǒ"), ("不去", "bù qù"), ("。", None)]) == [
        *["我", "3", "/"],
        *["ㄅ", "ㄨ", "2", "ㄑ", "ㄩ", "4", "."],
    ]
    out = phonemes([("你好", "nǐ hǎo"), ("，", None), ("东西", "dōngxi"), ("！", None)])
    assert "".join(out) == "ㄋㄧ2ㄏㄠ3, ㄉ中1ㄒㄧ5!"
