"""Settings API: roundtrip + settings-driven replacement counts."""

from draftengine.league import LeagueSettings
from draftengine.pipeline.value import replacement_counts


def test_get_settings_defaults(client):
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    body = resp.json()
    assert body["settings"]["teams"] == 12
    assert body["settings"]["my_slot"] == 5
    assert body["rounds"] == 15  # 9 starters + 6 bench
    # The canonical 12-team 1QB/2RB/2WR/1TE/1FLEX PPR replacement levels.
    assert body["replacement_counts"] == {
        "QB": 13,
        "RB": 28,
        "WR": 34,
        "TE": 13,
        "K": 13,
        "DST": 13,
    }


def test_put_settings_roundtrip_and_team_count_change(client):
    settings = client.get("/api/settings").json()["settings"]
    settings["teams"] = 10
    settings["my_slot"] = 3

    resp = client.put("/api/settings", json=settings)
    assert resp.status_code == 200
    body = resp.json()
    assert body["settings"]["teams"] == 10
    assert body["settings"]["my_slot"] == 3

    expected = replacement_counts(LeagueSettings.model_validate(body["settings"]))
    assert body["replacement_counts"] == expected
    assert body["replacement_counts"]["QB"] == 11  # 10 starters + 1
    assert body["replacement_counts"]["QB"] < 13  # smaller league, shallower pool

    # Persisted: a fresh GET returns the new settings and the new counts.
    again = client.get("/api/settings").json()
    assert again["settings"]["teams"] == 10
    assert again["replacement_counts"] == expected


def test_superflex_deepens_qb_pool_and_adds_a_round(client):
    base = client.get("/api/settings").json()
    qb_before = base["replacement_counts"]["QB"]

    settings = base["settings"]
    settings["roster"]["superflex"] = 1
    resp = client.put("/api/settings", json=settings)
    assert resp.status_code == 200
    body = resp.json()
    assert body["replacement_counts"]["QB"] > qb_before
    assert body["rounds"] == base["rounds"] + 1


def test_put_settings_rejects_slot_beyond_teams(client):
    settings = client.get("/api/settings").json()["settings"]
    settings["teams"] = 10
    settings["my_slot"] = 11

    resp = client.put("/api/settings", json=settings)
    assert resp.status_code == 422
    detail = str(resp.json()["detail"]).lower()
    assert "slot" in detail
    assert "10" in detail  # tells the user the valid range

    # Invalid update must not overwrite the stored settings.
    assert client.get("/api/settings").json()["settings"]["teams"] == 12
