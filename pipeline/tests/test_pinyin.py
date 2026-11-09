from langmap.pinyin import normalize_numeric, numeric_syllable_to_marked, search_key, strip_tones


def test_numeric_to_marked():
    assert numeric_syllable_to_marked("xue2") == "xué"
    assert numeric_syllable_to_marked("hao3") == "hǎo"
    assert numeric_syllable_to_marked("lu:4") == "lǜ"
    assert numeric_syllable_to_marked("gou3") == "gǒu"
    assert numeric_syllable_to_marked("de5") == "de"
    assert numeric_syllable_to_marked("Zhong1") == "Zhōng"


def test_strip_and_search_key():
    assert strip_tones("xué sheng") == "xue sheng"
    assert search_key("Xuésheng") == "xuesheng"
    assert search_key("lǜ") == "lv"
    assert normalize_numeric("Lu:4") == "lv4"
