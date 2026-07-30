"""Tests for draftengine.data.ffc: cached ADP loading + offline behavior.

Fixtures are written straight into the isolated cache dir (conftest points
DRAFTENGINE_DATA_DIR at a tmpdir) in the exact FFC response format.
"""

import json

import pandas as pd
import pytest

from draftengine.data import ffc
from draftengine.data.nflverse import OfflineError

FFC_BODY = {
    "status": "Success",
    "players": [
        # deliberately out of ADP order to prove load_adp sorts
        {
            "player_id": 3, "name": "Late Kicker", "position": "PK", "team": "BAL",
            "adp": 140.2, "stdev": 10.0, "high": 120, "low": 165,
            "times_drafted": 55, "bye": 14,
        },
        {
            "player_id": 1, "name": "Test Guy", "position": "RB", "team": "SF",
            "adp": 1.5, "stdev": 0.7, "high": 1, "low": 3,
            "times_drafted": 100, "bye": 9,
        },
        {
            "player_id": 4, "name": "Chicago Defense", "position": "DEF", "team": "CHI",
            "adp": 150.9, "stdev": 12.0, "high": 130, "low": 170,
            "times_drafted": 40, "bye": 7,
        },
        {
            "player_id": 2, "name": "Marvin Harrison Jr.", "position": "WR",
            "team": "ARI", "adp": 9.8, "stdev": 2.1, "high": 4, "low": 15,
            "times_drafted": 88, "bye": 11,
        },
        # unknown position: must be dropped
        {
            "player_id": 5, "name": "Sneaky Linebacker", "position": "LB",
            "team": "DAL", "adp": 160.0, "stdev": 1.0, "high": 155, "low": 165,
            "times_drafted": 5, "bye": 6,
        },
        # sparse row: no team, null optionals
        {
            "player_id": 6, "name": "Bare Bones", "position": "QB", "adp": 44.0,
            "stdev": None, "high": None, "low": None,
            "times_drafted": None, "bye": None,
        },
    ],
}


def write_fixture(year=2024, teams=12, scoring="ppr", body=FFC_BODY):
    path = ffc.adp_path(year, teams, scoring)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body))
    return path


class TestLoadAdp:
    def test_returns_none_when_uncached(self):
        assert ffc.load_adp(2024) is None

    def test_cache_key_includes_teams_and_scoring(self):
        write_fixture(year=2024, teams=12, scoring="ppr")
        assert ffc.load_adp(2024, teams=10) is None
        assert ffc.load_adp(2024, scoring="half-ppr") is None
        assert ffc.load_adp(2024) is not None

    def test_positions_mapped_and_unknown_dropped(self):
        write_fixture()
        df = ffc.load_adp(2024)
        assert len(df) == 5  # LB row dropped
        by_name = df.set_index("name")
        assert by_name.loc["Late Kicker", "position"] == "K"
        assert by_name.loc["Chicago Defense", "position"] == "DST"
        assert by_name.loc["Test Guy", "position"] == "RB"
        assert "Sneaky Linebacker" not in by_name.index

    def test_sorted_by_adp_with_dense_ranks(self):
        write_fixture()
        df = ffc.load_adp(2024)
        assert list(df["adp"]) == sorted(df["adp"])
        assert list(df["adp_rank"]) == [1, 2, 3, 4, 5]
        assert df.loc[0, "name"] == "Test Guy"  # adp 1.5 is the first pick
        assert df.loc[df["adp_rank"].idxmax(), "name"] == "Chicago Defense"

    def test_row_contents(self):
        write_fixture()
        row = ffc.load_adp(2024).set_index("name").loc["Test Guy"]
        assert row["adp_player_id"] == 1
        assert row["norm_name"] == "test guy"
        assert row["team"] == "SF"
        assert row["adp"] == pytest.approx(1.5)
        assert row["adp_stdev"] == pytest.approx(0.7)
        assert row["high"] == pytest.approx(1.0)
        assert row["low"] == pytest.approx(3.0)
        assert row["times_drafted"] == 100
        assert row["bye"] == 9
        assert row["season"] == 2024

    def test_norm_name_strips_suffixes(self):
        write_fixture()
        df = ffc.load_adp(2024)
        assert "marvin harrison" in set(df["norm_name"])

    def test_null_optionals_defaulted(self):
        write_fixture()
        row = ffc.load_adp(2024).set_index("name").loc["Bare Bones"]
        assert row["adp_stdev"] == 0.0
        assert row["high"] == pytest.approx(44.0)  # falls back to adp
        assert row["low"] == pytest.approx(44.0)
        assert row["times_drafted"] == 0
        assert pd.isna(row["bye"])
        assert pd.isna(row["team"])


class TestFetchAdp:
    def test_offline_and_uncached_raises(self, monkeypatch):
        monkeypatch.setenv("DRAFTENGINE_OFFLINE", "1")
        with pytest.raises(OfflineError, match="not cached"):
            ffc.fetch_adp(2019)

    def test_cached_short_circuits_before_network(self, monkeypatch):
        monkeypatch.setenv("DRAFTENGINE_OFFLINE", "1")
        path = write_fixture(year=2024)
        # would raise OfflineError if it tried to refetch
        assert ffc.fetch_adp(2024) == path

    def test_broken_year_raises_value_error(self, monkeypatch):
        monkeypatch.setenv("DRAFTENGINE_OFFLINE", "1")
        assert 2025 in ffc.BROKEN_YEARS
        with pytest.raises(ValueError, match="broken"):
            ffc.fetch_adp(2025)
