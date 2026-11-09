from langmap.words import Word, clean_glosses, pos_category


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
