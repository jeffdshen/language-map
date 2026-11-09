from langmap.export import legacy_bands
from langmap.words import (
    Word,
    cedict_meanings,
    char_levels,
    clean_glosses,
    dedupe_senses,
    parse_pos_zh,
    pos_category,
)


def test_clean_glosses_drops_noise():
    out = clean_glosses(
        [
            "surname Wang",
            "king; monarch",
            "variant of 王[wang2]",
            "to study CL:個|个[ge4]",
            "king; monarch",
        ]
    )
    assert out == ["king; monarch", "to study"]


def test_clean_glosses_resolves_references():
    assert clean_glosses(["see 學生|学生[xue2 sheng5]"]) == ["see 学生"]
    assert clean_glosses(["used in 学生[xue2 sheng5]"]) == ["used in 学生"]


def test_pos_category_and_chars():
    w = Word("L1-0001", "学学生", "xué", 1, ["N"], "", ["x"])
    assert pos_category(w) == "noun"
    assert w.chars == ["学", "生"]
    assert pos_category(Word("x", "a", "a", 1, [], "", [])) == "phrase"


def test_parse_pos_zh_orders_minor_uses_last():
    assert parse_pos_zh("动、（名、量）") == ["V", "N", "M"]
    assert parse_pos_zh("名、动") == ["N", "V"]
    assert parse_pos_zh("（名）、形") == ["Adj", "N"]
    assert parse_pos_zh("") == []


def test_cedict_meanings_prefers_exact_tones():
    dk = {
        "长": {
            "f": [
                {"i": {"n": "chang2"}, "m": ["long"]},
                {"i": {"n": "zhang3"}, "m": ["chief", "to grow"]},
            ]
        },
        "吧": {"f": [{"i": {"n": "ba1"}, "m": ["bar"]}]},
    }
    assert cedict_meanings(dk, "长", "zhang3") == ["chief", "to grow"]
    assert cedict_meanings(dk, "长", "chang5") == ["long"]  # toneless fallback
    assert cedict_meanings(dk, "吧", "ba5") == ["bar"]  # sole reading
    assert cedict_meanings(dk, "无", "wu2") == []


def test_dedupe_senses_drops_repeats():
    assert dedupe_senses(["eight", "eight; 8", "Eight"]) == ["eight", "8"]


def test_char_levels_takes_first_level():
    words = [
        Word("a", "学生", "x", 2, [], "", []),
        Word("b", "学", "x", 1, [], "", []),
        Word("c", "生日", "x", 3, [], "", []),
    ]
    assert char_levels(words) == {"学": 1, "生": 2, "日": 3}


def test_legacy_bands_pack_ids():
    out = legacy_bands({"L1-0001": "w00003", "L1-0003": "w00010", "L7-0002": "w05401"})
    assert out == {"L1": [3, 0, 10], "L7": [0, 5401]}
