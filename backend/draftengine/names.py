"""Player-name normalization shared by ADP joins and voice matching."""

import re

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}
_PUNCT = re.compile(r"[.'’\-]")
_SPACES = re.compile(r"\s+")


def normalize_name(name: str) -> str:
    """Lowercase, strip punctuation and generational suffixes.

    'Marvin Harrison Jr.' -> 'marvin harrison'
    "Ja'Marr Chase"      -> 'jamarr chase'
    'A.J. Brown'         -> 'aj brown'
    """
    s = _PUNCT.sub("", name.lower())
    s = _SPACES.sub(" ", s).strip()
    parts = [p for p in s.split(" ") if p not in _SUFFIXES]
    return " ".join(parts)


def first_initial_key(name: str) -> str:
    """'aj brown' -> 'a brown'. Used as a looser join key."""
    norm = normalize_name(name)
    parts = norm.split(" ")
    if len(parts) < 2:
        return norm
    return f"{parts[0][0]} {' '.join(parts[1:])}"
