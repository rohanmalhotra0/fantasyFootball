"""Tests for draftengine.names (normalization shared by ADP joins + voice)."""

import pytest

from draftengine.names import first_initial_key, normalize_name


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Marvin Harrison Jr.", "marvin harrison"),
        ("Ja'Marr Chase", "jamarr chase"),
        ("A.J. Brown", "aj brown"),
        ("Kenneth Walker III", "kenneth walker"),
        ("Odell Beckham Sr.", "odell beckham"),
        ("Patrick Surtain II", "patrick surtain"),
        ("Somebody Jones IV", "somebody jones"),
        ("Somebody Jones V", "somebody jones"),
        ("Amon-Ra St. Brown", "amonra st brown"),
        # curly apostrophe (as shipped by some ADP feeds)
        ("D’Andre Swift", "dandre swift"),
        # whitespace collapses
        ("  Justin   Jefferson ", "justin jefferson"),
        # single-word names survive
        ("Cher", "cher"),
    ],
)
def test_normalize_name(raw, expected):
    assert normalize_name(raw) == expected


def test_normalize_name_is_idempotent():
    once = normalize_name("Marvin Harrison Jr.")
    assert normalize_name(once) == once


def test_normalize_name_lowercases():
    assert normalize_name("CEEDEE LAMB") == "ceedee lamb"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("A.J. Brown", "a brown"),
        ("aj brown", "a brown"),
        ("Kenneth Walker III", "k walker"),
        ("Marvin Harrison Jr.", "m harrison"),
        # multi-token surnames keep everything after the first name
        ("Amon-Ra St. Brown", "a st brown"),
    ],
)
def test_first_initial_key(raw, expected):
    assert first_initial_key(raw) == expected


def test_first_initial_key_single_word_passthrough():
    assert first_initial_key("Cher") == "cher"
