"""Unit tests for draftengine.voice.matching.match_player."""

import pandas as pd

from draftengine.names import normalize_name
from draftengine.voice.matching import match_player, voice_normalize

PLAYERS = [
    ("Bijan Robinson", "RB"),
    ("Brian Robinson Jr.", "RB"),
    ("Christian McCaffrey", "RB"),
    ("Ja'Marr Chase", "WR"),
    ("Davante Adams", "WR"),
    ("DeVonta Smith", "WR"),
    ("Tyreek Hill", "WR"),
    ("Amon-Ra St. Brown", "WR"),
    ("A.J. Brown", "WR"),
    ("Marquise Brown", "WR"),
    ("Kenneth Walker III", "RB"),
    ("Marvin Harrison Jr.", "WR"),
    ("Kyren Williams", "RB"),
    ("Puka Nacua", "WR"),
    ("Isiah Pacheco", "RB"),
    ("Jonathan Taylor", "RB"),
    ("Alvin Kamara", "RB"),
    ("Tank Dell", "WR"),
    ("DJ Moore", "WR"),
    ("Josh Allen", "QB"),
]


def make_pool(players=PLAYERS) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "player_id": f"p{i:03d}",
                "name": name,
                "norm_name": normalize_name(name),
                "position": pos,
            }
            for i, (name, pos) in enumerate(players)
        ]
    )


POOL = make_pool()


def best(text, pool=POOL):
    res = match_player(text, pool)
    assert res, f"no candidates for {text!r}"
    return res[0]


# ---------- layer 1: exact ----------


def test_exact_normalized_match_is_confidence_one():
    b = best("Bijan Robinson")
    assert b["name"] == "Bijan Robinson"
    assert b["confidence"] == 1.0


def test_exact_match_with_punctuation_variants():
    assert best("jamarr chase")["name"] == "Ja'Marr Chase"
    assert best("jamarr chase")["confidence"] == 1.0
    # "amonra" heard as two words is near-exact, not exact — still the best hit.
    b = best("amon ra st brown")
    assert b["name"] == "Amon-Ra St. Brown"
    assert b["confidence"] >= 0.90


def test_split_initials_merge_to_exact():
    b = best("a j brown")
    assert b["name"] == "A.J. Brown"
    assert b["confidence"] == 1.0


# ---------- layer 2: fuzzy ----------


def test_fuzzy_close_misspelling_scores_below_exact():
    b = best("jamar chase")
    assert b["name"] == "Ja'Marr Chase"
    assert 0.9 <= b["confidence"] < 1.0


def test_fuzzy_isaiah_pacheco():
    b = best("isaiah pacheco")
    assert b["name"] == "Isiah Pacheco"
    assert b["confidence"] >= 0.92


# ---------- layer 3: phonetics ----------


def test_phonetic_devonte_adams():
    b = best("devonte adams")
    assert b["name"] == "Davante Adams"
    assert b["confidence"] >= 0.80


def test_phonetic_tyreek_heel():
    b = best("tyreek heel")
    assert b["name"] == "Tyreek Hill"
    assert b["confidence"] >= 0.80


def test_phonetic_puka_nakua():
    b = best("puka nakua")
    assert b["name"] == "Puka Nacua"
    assert b["confidence"] >= 0.80


def test_phonetic_never_reaches_auto_commit_alone():
    # "bees on robinson" is a pure phonetic hit; it must stay below 0.92 so
    # the endpoint always asks before committing.
    res = match_player("bees on robinson", POOL)
    names = [r["name"] for r in res]
    assert "Bijan Robinson" in names[:2]
    assert all(r["confidence"] < 0.92 for r in res)


def test_phonetic_ambiguity_is_close_between_robinsons():
    res = match_player("bees on robinson", POOL)
    by_name = {r["name"]: r["confidence"] for r in res}
    assert "Bijan Robinson" in by_name and "Brian Robinson Jr." in by_name
    assert abs(by_name["Bijan Robinson"] - by_name["Brian Robinson Jr."]) < 0.08


def test_phonetic_b_john_robinson():
    res = match_player("b john robinson", POOL)
    assert "Bijan Robinson" in [r["name"] for r in res[:2]]


def test_phonetic_needs_ratio_floor():
    # Sharing a metaphone code is not enough when the strings are wildly
    # different: no phonetic-tier score against unrelated long names.
    res = match_player("kw", make_pool([("Kyren Williams", "RB")]))
    assert not res or res[0]["confidence"] < 0.60


# ---------- layer 4: single token ----------


def test_single_first_name_exact():
    b = best("bijan")
    assert b["name"] == "Bijan Robinson"
    assert b["confidence"] >= 0.95


def test_single_last_name_exact():
    b = best("mccaffrey")
    assert b["name"] == "Christian McCaffrey"
    assert b["confidence"] == 0.95


def test_single_token_ambiguity_close_confidences():
    res = match_player("brown", POOL)
    browns = [r for r in res if "Brown" in r["name"]]
    assert len(browns) >= 3
    confs = [r["confidence"] for r in browns]
    assert max(confs) - min(confs) < 0.08  # endpoint must demand confirmation


def test_single_token_phonetic():
    b = best("mccafrey")  # dropped letter, phonetic hit
    assert b["name"] == "Christian McCaffrey"
    assert b["confidence"] >= 0.85


# ---------- layer 5: aliases + spoken suffixes ----------


def test_alias_cmc():
    b = best("cmc")
    assert b["name"] == "Christian McCaffrey"
    assert b["confidence"] == 1.0


def test_alias_jt():
    assert best("jt")["name"] == "Jonathan Taylor"


def test_alias_hollywood_brown():
    assert best("hollywood brown")["name"] == "Marquise Brown"


def test_alias_saint_brown():
    assert best("saint brown")["name"] == "Amon-Ra St. Brown"


def test_alias_tank():
    assert best("tank")["name"] == "Tank Dell"


def test_spoken_suffix_the_third():
    b = best("kenneth walker the third")
    assert b["name"] == "Kenneth Walker III"
    assert b["confidence"] == 1.0


def test_spoken_suffix_junior():
    b = best("marvin harrison junior")
    assert b["name"] == "Marvin Harrison Jr."
    assert b["confidence"] == 1.0


def test_voice_normalize_saint_and_suffix():
    assert voice_normalize("Amon Ra Saint Brown") == "amon ra st brown"
    assert voice_normalize("Kenneth Walker the Third") == "kenneth walker"


# ---------- output contract ----------


def test_returns_at_most_five_sorted_desc():
    res = match_player("brown", POOL)
    assert len(res) <= 5
    confs = [r["confidence"] for r in res]
    assert confs == sorted(confs, reverse=True)
    for r in res:
        assert set(r) == {"player_id", "name", "position", "confidence"}
        assert 0.0 <= r["confidence"] <= 1.0


def test_empty_text_and_empty_pool():
    assert match_player("", POOL) == []
    assert match_player("bijan", POOL.iloc[0:0]) == []


def test_garbage_scores_low():
    res = match_player("asdf qwerty", POOL)
    assert all(r["confidence"] < 0.60 for r in res)


def test_deterministic_ordering():
    a = match_player("brown", POOL)
    b = match_player("brown", POOL)
    assert a == b
