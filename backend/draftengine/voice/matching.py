"""Fuzzy + phonetic matching of voice-transcribed text to draft-pool players.

Layered scoring; each player keeps the MAX score across layers:

  1. exact normalized match ............................ 1.00
  2. rapidfuzz token_set_ratio / partial_ratio ......... ratio/100 * 0.98
  3. double metaphone on the full name AND the last-name
     token: primary==primary 0.88, primary==secondary 0.82,
     plus a small rapidfuzz blend, capped at 0.91 so a purely
     phonetic hit can never clear the auto-commit bar (0.92)
  4. single-token utterance vs first OR last name token:
     exact 0.95, phonetic 0.85 (ambiguity across players shows
     up as equal confidences -> the endpoint demands confirmation)
  5. alias table for well-known nicknames/initials (expanded
     before matching, so an alias hit scores like layer 1)

The caller (routes_voice) owns the confirmation policy; this module only
produces honestly-graded candidates.
"""

from __future__ import annotations

import re

import pandas as pd
from metaphone import doublemetaphone
from rapidfuzz import fuzz

from ..names import normalize_name

# Spoken generational suffixes: STT writes "Kenneth Walker III" as
# "kenneth walker the third". names.normalize_name only strips the written
# forms (jr / iii / ...), so extend locally here — do not edit names.py.
_SPOKEN_SUFFIX = re.compile(r"\b(?:the (?:second|third|fourth|fifth)|junior|senior)\b")
_SAINT = re.compile(r"\bsaint\b")  # "amon ra saint brown" -> "amon ra st brown"
# STT splits spoken initials: "a j brown" -> "aj brown" (pool norm is "aj brown").
_SPLIT_INITIALS = re.compile(r"\b([a-z]) ([a-z])\b")
_SPACES = re.compile(r"\s+")

# Well-known nicknames / initials heard as whole utterances. Keys and values
# are in voice_normalize() form; values should be the player's normalized
# full name as it appears on real boards.
ALIASES: dict[str, str] = {
    "cmc": "christian mccaffrey",
    "jt": "jonathan taylor",
    "jj": "justin jefferson",
    "dk": "dk metcalf",
    "dj": "dj moore",
    "d j moore": "dj moore",  # STT often splits initials
    "obj": "odell beckham",
    "juju": "juju smithschuster",
    "ceedee": "ceedee lamb",
    "bijan": "bijan robinson",
    "hollywood": "marquise brown",
    "hollywood brown": "marquise brown",
    "saint brown": "amonra st brown",
    "st brown": "amonra st brown",
    "amon ra": "amonra st brown",
    "tank": "tank dell",
    "nathaniel dell": "tank dell",
    "kamara": "alvin kamara",
}

# Scoring constants (see module docstring).
_EXACT = 1.0
_FUZZ_WEIGHT = 0.98
_PHONETIC_PRIMARY = 0.88
_PHONETIC_SECONDARY = 0.82
_PHONETIC_CAP = 0.91  # phonetics alone must stay below the 0.92 auto-commit bar
_PHONETIC_RATIO_FLOOR = 40  # reject phonetic hits on wildly different strings
_SINGLE_EXACT = 0.95
_SINGLE_PHONETIC = 0.85
_MIN_SCORE = 0.30  # below this a candidate is noise, drop it
_TOP_N = 5


def _extra_normalize(norm: str) -> str:
    """Voice-specific cleanup applied on top of names.normalize_name output."""
    s = _SPOKEN_SUFFIX.sub(" ", norm)
    s = _SAINT.sub("st", s)
    s = _SPLIT_INITIALS.sub(r"\1\2", s)
    return _SPACES.sub(" ", s).strip()


def voice_normalize(text: str) -> str:
    """Full normalization for voice text: names.normalize_name + local extras."""
    return _extra_normalize(normalize_name(text or ""))


def _phonetic_score(a: tuple[str, str], b: tuple[str, str]) -> float:
    """Compare two doublemetaphone results. 0.0 when they don't agree."""
    a_pri, a_sec = a
    b_pri, b_sec = b
    if a_pri and a_pri == b_pri:
        return _PHONETIC_PRIMARY
    if (a_pri and a_pri == b_sec) or (b_pri and b_pri == a_sec):
        return _PHONETIC_SECONDARY
    return 0.0


def _score_multi_token(q: str, q_dm, q_last: str, q_last_dm, n_ext: str) -> float:
    """Layers 2 + 3 for a multi-token utterance against one pool name."""
    score = 0.0

    # Layer 2: fuzzy. partial_ratio needs enough characters on both sides or
    # tiny fragments trivially score 100 against everything.
    tsr = fuzz.token_set_ratio(q, n_ext)
    pr = fuzz.partial_ratio(q, n_ext) if min(len(q), len(n_ext)) >= 5 else 0.0
    score = max(score, max(tsr, pr) / 100.0 * _FUZZ_WEIGHT)

    # Layer 3: phonetics, gated by a rapidfuzz floor so wildly different
    # strings can't collide on codes alone.
    floor = fuzz.token_sort_ratio(q, n_ext)
    if floor >= _PHONETIC_RATIO_FLOOR:
        base = _phonetic_score(q_dm, doublemetaphone(n_ext))
        n_last = n_ext.rsplit(" ", 1)[-1]
        if len(q_last) >= 3 and len(n_last) >= 3:
            base = max(base, _phonetic_score(q_last_dm, doublemetaphone(n_last)))
        if base > 0.0:
            # Small blend so "bees on robinson" ranks Bijan above other
            # Robinsons, capped below the auto-commit bar.
            score = max(score, min(_PHONETIC_CAP, base + 0.03 * floor / 100.0))
    return score


def _score_single_token(q: str, q_dm, name_tokens: list[str]) -> float:
    """Layer 4: one-word utterance ("Bijan", "McCaffrey") vs first/last token."""
    first, last = name_tokens[0], name_tokens[-1]
    if q == first or q == last:
        return _SINGLE_EXACT
    if len(q) >= 3:
        for tok in (first, last):
            if len(tok) >= 3 and _phonetic_score(q_dm, doublemetaphone(tok)) >= _PHONETIC_SECONDARY:
                return _SINGLE_PHONETIC
    return 0.0


def match_player(text: str, pool: pd.DataFrame) -> list[dict]:
    """Match voice text against the player pool.

    pool: DataFrame with columns player_id, name, norm_name, position.
    Returns up to 5 dicts {player_id, name, position, confidence} sorted by
    confidence descending (deterministic tie-break on name, then id).
    """
    q = voice_normalize(text)
    q = ALIASES.get(q, q)
    if not q or pool is None or len(pool) == 0:
        return []

    q_tokens = q.split(" ")
    single = len(q_tokens) == 1
    q_dm = doublemetaphone(q)
    q_last = q_tokens[-1]
    q_last_dm = doublemetaphone(q_last)

    has_norm = "norm_name" in pool.columns
    results: list[dict] = []
    for row in pool.itertuples(index=False):
        name = str(getattr(row, "name", ""))
        base = str(getattr(row, "norm_name", "") or "") if has_norm else ""
        n_ext = _extra_normalize(base) if base else voice_normalize(name)
        if not n_ext:
            continue

        if q == n_ext:
            score = _EXACT
        elif single:
            score = _score_single_token(q, q_dm, n_ext.split(" "))
        else:
            score = _score_multi_token(q, q_dm, q_last, q_last_dm, n_ext)

        if score >= _MIN_SCORE:
            results.append(
                {
                    "player_id": str(row.player_id),
                    "name": name,
                    "position": str(row.position),
                    "confidence": round(score, 3),
                }
            )

    results.sort(key=lambda r: (-r["confidence"], r["name"], r["player_id"]))
    return results[:_TOP_N]
