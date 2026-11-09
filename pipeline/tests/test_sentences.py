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
