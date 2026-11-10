from langmap.sentences import _encode_seg, filter_sentences
from langmap.words import Word


def test_filter_sentences():
    rows = [
        (1, "我是学生。", 10, "I am a student."),
        (2, "我是學生。", 11, "I am a student."),  # traditional
        (3, "好", 12, "Good."),  # too short
        (4, "我有 ABC 吗？", 13, "?"),
    ]
    kept = [r[0] for r in filter_sentences(rows)]
    assert 1 in kept and 2 not in kept and 3 not in kept


def test_encode_seg():
    words = [Word("L1-0001", "学生", "xuésheng", 1, ["N"], "", ["student"], index=0)]
    assert _encode_seg(words, "。", "", -1) == ["。"]
    assert _encode_seg(words, "学生", "xuésheng", 0) == ["学生", 0]
    assert _encode_seg(words, "学生", "xuéshēng", 0) == ["学生", 0, "xuéshēng"]


def test_select_sentences_easiest_first_and_capped(monkeypatch):
    from langmap import sentences as S

    words = [
        Word("w1", "学生", "xuésheng", 1, ["N"], "", ["student"], index=0),
        Word("w2", "我们", "wǒmen", 1, ["R"], "", ["we"], index=1),
        Word("w3", "研究", "yánjiū", 4, ["V"], "", ["to research"], index=2),
    ]
    # One hard sentence (研究 is above HSK 1) and many easy ones for 学生.
    rows = [(1, "学生研究学生。", 100, "Students study students.")]
    rows += [
        (10 + k, "我们是学生" + "，是" * k + "。", 200 + k, f"We are students {k}.")
        for k in range(14)
    ]
    monkeypatch.setattr(S, "load_tatoeba", lambda: rows)
    sentences, by_word, stats = S.select_sentences(words, {"是": 1})
    chosen = [sentences[k]["id"] for k in by_word[0]]
    assert len(chosen) == S.MAX_PER_WORD
    # The sentence with a harder word comes last, if at all.
    assert chosen[0] != 1 and (1 not in chosen or chosen[-1] == 1)
    level1 = stats["easy_by_level"]["1"]
    assert level1[0] >= S.MAX_PER_WORD and level1[1] >= S.MAX_PER_WORD
    # Sentences carry word indices for every known word, so one collect can credit several words.
    seg = sentences[by_word[0][0]]["seg"]
    assert ["学生", 0] in seg and ["我们", 1] in seg
