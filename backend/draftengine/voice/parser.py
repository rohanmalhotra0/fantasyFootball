"""Parse a draft-room voice utterance into (team, player text).

Handles phrasings like:
  "Pick 14, Team 3 takes Bijan Robinson"   -> team 3, "bijan robinson"
  "team seven selects Josh Allen"          -> team 7, "josh allen"
  "the Dragons take Puka Nacua"            -> fuzzy team-name match
  "Davante Adams to team 4"                -> team 4
  "I'll take Breece Hall" / bare "Breece Hall" / "next pick is X"

Never raises on garbage; an empty player_text is a valid outcome the
endpoint turns into a polite "didn't hear a name" response.
"""

from __future__ import annotations

import re

from rapidfuzz import fuzz

_WORD_NUMBERS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
}
_NUM = r"(?:\d{1,2}|" + "|".join(_WORD_NUMBERS) + r")"
_ORDINAL = (
    r"(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|"
    r"eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth)"
)
_VERBS = r"(?:takes?|selects?|picks?|drafts?|grabs?|gets?|goes with|go with|chooses?)"

_FILLERS = re.compile(r"\b(?:um+|uh+|erm?|okay|ok|alright|so|please|yeah|well|like)\b")
_PICK_PHRASES = [
    re.compile(rf"\bwith the {_NUM}(?:st|nd|rd|th)? (?:overall )?pick\b"),
    re.compile(rf"\b(?:the )?{_ORDINAL} (?:overall )?pick\b"),
    re.compile(rf"\bpick (?:number )?{_NUM}\b"),
    re.compile(r"\b(?:the )?next pick is\b"),
    re.compile(r"\b(?:the )?next pick\b"),
    re.compile(r"\bon the clock\b"),
    re.compile(r"\boverall\b"),
    re.compile(r"\bwith the\b"),
]
_LEADING_I_PHRASES = re.compile(
    rf"^(?:i'?ll|i will|we'?ll|we will|i'?m|i am|we'?re) (?:gonna |going to )?{_VERBS} "
    r"|^(?:give me|i want|we want|my pick is|the pick is|it'?s|its) "
)
_TEAM_NUM_TRAILING = re.compile(rf"\b(?:to|for) (?:the )?team ({_NUM})\b")
_TEAM_NUM_LEADING = re.compile(rf"\bteam ({_NUM})\b(?: {_VERBS}\b)?")
_TEAM_NAME_TRAILING = re.compile(r"\b(?:to|for) (?:the )?([a-z' ]{2,40})$")
_TEAM_NAME_LEADING = re.compile(rf"^(?:the )?([a-z' ]{{2,40}}?) {_VERBS}\b\s*(.*)$")
_LEADING_VERB = re.compile(rf"^{_VERBS} ")
# Only "the": stripping "a"/"an" would mangle names like "A.J. Brown".
_LEADING_ARTICLE = re.compile(r"^the ")
_PUNCT = re.compile(r"[,.;:!?\"()]")
_SPACES = re.compile(r"\s+")

_TEAM_NAME_MIN_RATIO = 85


def _to_int(token: str) -> int | None:
    if token.isdigit():
        return int(token)
    return _WORD_NUMBERS.get(token)


def _squeeze(s: str) -> str:
    return _SPACES.sub(" ", s).strip()


def _fuzzy_team(candidate: str, team_names: list[str]) -> int | None:
    """1-based index of the best team-name match at >= 85, else None."""
    candidate = _squeeze(candidate)
    if not candidate:
        return None
    best_idx, best_score = None, 0.0
    for i, name in enumerate(team_names):
        name = (name or "").strip().lower()
        if not name:
            continue
        score = fuzz.token_set_ratio(candidate, name)
        if score > best_score:
            best_idx, best_score = i + 1, score
    if best_idx is not None and best_score >= _TEAM_NAME_MIN_RATIO:
        return best_idx
    return None


def parse_utterance(text: str, team_names: list[str], teams: int) -> dict:
    """Extract an explicit team (if named) and the residual player text.

    Returns {"team_index": int | None, "explicit_team": bool, "player_text": str}.
    team_index is 1-based and only set when the utterance names a valid team;
    resolving "no explicit team" to the on-clock team is the endpoint's job.
    """
    s = _squeeze(_PUNCT.sub(" ", str(text or "").lower()))
    s = _squeeze(_FILLERS.sub(" ", s))
    for pat in _PICK_PHRASES:
        s = _squeeze(pat.sub(" ", s))
    s = _squeeze(_LEADING_I_PHRASES.sub("", s))

    team_index: int | None = None
    max_team = teams if isinstance(teams, int) and teams > 0 else 0

    # "... to team 4" / "... for team four"
    m = _TEAM_NUM_TRAILING.search(s)
    if m:
        n = _to_int(m.group(1))
        if n is not None and 1 <= n <= max_team:
            team_index = n
        s = _squeeze(s[: m.start()] + " " + s[m.end() :])
    # "team 3 takes ..." (also plain "team 3 ...")
    if team_index is None:
        m = _TEAM_NUM_LEADING.search(s)
        if m:
            n = _to_int(m.group(1))
            if n is not None and 1 <= n <= max_team:
                team_index = n
            s = _squeeze(s[: m.start()] + " " + s[m.end() :])
    # "... to the Dragons" (fuzzy team name at the end)
    if team_index is None:
        m = _TEAM_NAME_TRAILING.search(s)
        if m:
            idx = _fuzzy_team(m.group(1), team_names or [])
            if idx is not None:
                team_index = idx
                s = _squeeze(s[: m.start()] + " " + s[m.end() :])
    # "the Dragons take ..." (fuzzy team name before a pick verb)
    if team_index is None:
        m = _TEAM_NAME_LEADING.match(s)
        if m:
            idx = _fuzzy_team(m.group(1), team_names or [])
            if idx is not None:
                team_index = idx
                s = _squeeze(m.group(2))

    # Leftover verb after a team phrase was removed ("takes bijan robinson").
    s = _squeeze(_LEADING_VERB.sub("", s))
    s = _squeeze(_LEADING_ARTICLE.sub("", s))

    return {
        "team_index": team_index,
        "explicit_team": team_index is not None,
        "player_text": s,
    }
