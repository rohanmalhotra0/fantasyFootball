"""Unit tests for draftengine.voice.parser.parse_utterance."""

from draftengine.voice.parser import parse_utterance

TEAM_NAMES = [
    "Dragons",
    "Sharks",
    "Wolves",
    "Eagles Nest",
    "Team Rocket",
    "Vipers",
    "Golden Bears",
    "Night Owls",
    "Red Storm",
    "Iron Wolves",
    "Blue Crew",
    "The Hammers",
]
TEAMS = 12


def parse(text):
    return parse_utterance(text, TEAM_NAMES, TEAMS)


def test_bare_player_name():
    out = parse("Breece Hall")
    assert out == {"team_index": None, "explicit_team": False, "player_text": "breece hall"}


def test_pick_number_and_numeric_team():
    out = parse("Pick 14, Team 3 takes Bijan Robinson")
    assert out["team_index"] == 3
    assert out["explicit_team"] is True
    assert out["player_text"] == "bijan robinson"


def test_word_number_team():
    out = parse("team seven selects Christian McCaffrey")
    assert out["team_index"] == 7
    assert out["explicit_team"] is True
    assert out["player_text"] == "christian mccaffrey"


def test_fuzzy_team_name_before_verb():
    out = parse("the Dragons take Puka Nacua")
    assert out["team_index"] == 1
    assert out["explicit_team"] is True
    assert out["player_text"] == "puka nacua"


def test_fuzzy_team_name_slightly_off():
    # STT drops the plural: still >= 85 against "Dragons".
    out = parse("the Dragon take Puka Nacua")
    assert out["team_index"] == 1
    assert out["player_text"] == "puka nacua"


def test_trailing_to_team_number():
    out = parse("Davante Adams to team 4")
    assert out["team_index"] == 4
    assert out["explicit_team"] is True
    assert out["player_text"] == "davante adams"


def test_trailing_to_team_name():
    out = parse("Josh Jacobs to the Sharks")
    assert out["team_index"] == 2
    assert out["player_text"] == "josh jacobs"


def test_ill_take():
    out = parse("I'll take Tyreek Hill")
    assert out["team_index"] is None
    assert out["explicit_team"] is False
    assert out["player_text"] == "tyreek hill"


def test_next_pick_is():
    out = parse("next pick is Justin Jefferson")
    assert out["team_index"] is None
    assert out["player_text"] == "justin jefferson"


def test_fillers_stripped():
    out = parse("okay um so uh Kyren Williams please")
    assert out["player_text"] == "kyren williams"


def test_ordinal_pick_phrase_stripped():
    out = parse("with the 14th pick Team 6 selects Derrick Henry")
    assert out["team_index"] == 6
    assert out["player_text"] == "derrick henry"


def test_overall_stripped():
    out = parse("Justin Jefferson overall")
    assert out["player_text"] == "justin jefferson"


def test_team_but_no_player():
    out = parse("the dragons take uh")
    assert out["team_index"] == 1
    assert out["explicit_team"] is True
    assert out["player_text"] == ""


def test_pure_filler_yields_empty():
    out = parse("uh the um next pick")
    assert out["player_text"] == ""
    assert out["team_index"] is None


def test_empty_and_none_never_crash():
    assert parse("")["player_text"] == ""
    assert parse_utterance(None, [], 0)["player_text"] == ""


def test_garbage_passthrough():
    out = parse("asdf qwerty")
    assert out == {"team_index": None, "explicit_team": False, "player_text": "asdf qwerty"}


def test_out_of_range_team_number_is_not_explicit():
    out = parse("team 19 takes Josh Allen")
    assert out["team_index"] is None
    assert out["explicit_team"] is False
    assert out["player_text"] == "josh allen"


def test_no_team_names_configured():
    out = parse_utterance("the Dragons take Puka Nacua", [], 12)
    # No fuzzy pool to match against: nothing is treated as a team.
    assert out["team_index"] is None
    assert out["explicit_team"] is False


def test_player_name_not_mistaken_for_team():
    # Subject before the verb only becomes a team at fuzz >= 85.
    out = parse("Davante Adams takes it")
    assert out["team_index"] is None
    assert out["explicit_team"] is False


def test_initials_survive_filler_stripping():
    out = parse("A.J. Brown")
    assert out["player_text"] == "a j brown"


def test_spoken_suffix_left_for_matcher():
    out = parse("Kenneth Walker the third")
    assert out["player_text"] == "kenneth walker the third"
