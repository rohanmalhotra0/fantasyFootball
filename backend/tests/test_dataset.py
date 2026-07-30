"""Tests for draftengine.pipeline.dataset: season aggregation + lagged features.

Synthetic weekly frames replicate the exact output shape of
nflverse.load_weekly: KEEP_COLUMNS plus the derived fumbles_lost and
two_pt_conversions columns.
"""

import numpy as np
import pandas as pd
import pytest

from draftengine.data.nflverse import KEEP_COLUMNS
from draftengine.pipeline.dataset import (
    FEATURE_COLUMNS,
    LAG_FEATURES,
    build_features,
    build_season_stats,
)


def week_row(player_id, name, position, team, season, week, **stats) -> dict:
    """One weekly row in the shape nflverse.load_weekly produces."""
    row = dict.fromkeys(KEEP_COLUMNS, 0.0)
    # columns load_weekly derives from the per-phase fumble/2pt columns
    row["fumbles_lost"] = 0.0
    row["two_pt_conversions"] = 0.0
    row.update(
        player_id=player_id,
        player_display_name=name,
        position=position,
        recent_team=team,
        season=season,
        week=week,
        season_type="REG",
    )
    row.update(stats)
    return row


def a_row(season, week, team="SF", **stats):
    return week_row("A", "Marvin Tester Jr.", "RB", team, season, week, **stats)


def synthetic_weekly() -> pd.DataFrame:
    rows = [
        # --- player A: RB, seasons 2021-2023 ---
        a_row(
            2021, 1,
            carries=10.0, rushing_yards=50.0, rushing_tds=1.0,
            receptions=2.0, targets=3.0, receiving_yards=20.0,
            fantasy_points=7.0, fantasy_points_ppr=9.0,
            target_share=0.10, air_yards_share=0.05, wopr=0.2,
        ),
        a_row(
            2021, 2,
            carries=5.0, rushing_yards=30.0,
            receptions=3.0, targets=4.0, receiving_yards=30.0,
            fantasy_points=9.0, fantasy_points_ppr=12.0,
            target_share=0.20, air_yards_share=0.15, wopr=0.3,
            fumbles_lost=1.0, two_pt_conversions=1.0,
        ),
        # 2022: traded mid-season, last team must win
        a_row(2022, 1, team="SF", carries=10.0, rushing_yards=40.0,
              receptions=2.0, receiving_yards=10.0, fantasy_points_ppr=10.0),
        a_row(2022, 2, team="SF", carries=10.0, rushing_yards=40.0,
              receptions=2.0, receiving_yards=10.0, fantasy_points_ppr=10.0),
        a_row(2022, 5, team="KC", carries=10.0, rushing_yards=40.0,
              receptions=2.0, receiving_yards=10.0, fantasy_points_ppr=10.0),
        a_row(2023, 1, team="KC", carries=8.0, rushing_yards=60.0,
              receptions=1.0, receiving_yards=5.0, fantasy_points_ppr=12.5),
        # --- player B: WR, 2022 only ---
        week_row("B", "Beta Guy", "WR", "DAL", 2022, 1,
                 receptions=4.0, targets=6.0, receiving_yards=50.0,
                 receiving_tds=1.0, fantasy_points_ppr=15.0,
                 target_share=0.20, wopr=0.4),
        week_row("B", "Beta Guy", "WR", "DAL", 2022, 2,
                 receptions=6.0, targets=9.0, receiving_yards=70.0,
                 fantasy_points_ppr=13.0, target_share=0.30, wopr=0.5),
        # --- player C: QB, 2023 only, zero touches ---
        week_row("C", "Cee Quarterback", "QB", "BUF", 2023, 1,
                 completions=20.0, attempts=30.0, passing_yards=250.0,
                 passing_tds=2.0, interceptions=1.0, fantasy_points_ppr=18.0),
        week_row("C", "Cee Quarterback", "QB", "BUF", 2023, 2,
                 completions=22.0, attempts=33.0, passing_yards=270.0,
                 passing_tds=1.0, fantasy_points_ppr=20.0),
    ]
    return pd.DataFrame(rows)


@pytest.fixture()
def season_stats() -> pd.DataFrame:
    return build_season_stats(synthetic_weekly())


def one(df: pd.DataFrame, player_id: str, season: int) -> pd.Series:
    rows = df[(df["player_id"] == player_id) & (df["season"] == season)]
    assert len(rows) == 1
    return rows.iloc[0]


class TestBuildSeasonStats:
    def test_one_row_per_player_season(self, season_stats):
        assert len(season_stats) == 5
        keys = set(zip(season_stats["player_id"], season_stats["season"], strict=True))
        assert keys == {("A", 2021), ("A", 2022), ("A", 2023), ("B", 2022), ("C", 2023)}

    def test_sums_games_and_ppg(self, season_stats):
        a21 = one(season_stats, "A", 2021)
        assert a21["games"] == 2
        assert a21["carries"] == pytest.approx(15.0)
        assert a21["rushing_yards"] == pytest.approx(80.0)
        assert a21["rushing_tds"] == pytest.approx(1.0)
        assert a21["receptions"] == pytest.approx(5.0)
        assert a21["targets"] == pytest.approx(7.0)
        assert a21["receiving_yards"] == pytest.approx(50.0)
        assert a21["fumbles_lost"] == pytest.approx(1.0)
        assert a21["two_pt_conversions"] == pytest.approx(1.0)
        assert a21["ppr_points"] == pytest.approx(21.0)
        assert a21["ppg"] == pytest.approx(10.5)

    def test_mean_columns_average_over_weeks(self, season_stats):
        a21 = one(season_stats, "A", 2021)
        assert a21["target_share"] == pytest.approx(0.15)
        assert a21["air_yards_share"] == pytest.approx(0.10)
        assert a21["wopr"] == pytest.approx(0.25)

    def test_yards_per_touch(self, season_stats):
        a21 = one(season_stats, "A", 2021)
        # (80 rush + 50 rec) / (15 carries + 5 receptions)
        assert a21["yards_per_touch"] == pytest.approx(130.0 / 20.0)

    def test_yards_per_touch_zero_when_no_touches(self, season_stats):
        c23 = one(season_stats, "C", 2023)
        assert c23["yards_per_touch"] == 0.0

    def test_team_and_name_take_last_row(self, season_stats):
        assert one(season_stats, "A", 2022)["team"] == "KC"
        assert one(season_stats, "A", 2021)["name"] == "Marvin Tester Jr."

    def test_norm_name(self, season_stats):
        assert one(season_stats, "A", 2021)["norm_name"] == "marvin tester"

    def test_first_season(self, season_stats):
        assert set(season_stats[season_stats["player_id"] == "A"]["first_season"]) == {2021}
        assert one(season_stats, "B", 2022)["first_season"] == 2022
        assert one(season_stats, "C", 2023)["first_season"] == 2023


class TestBuildFeatures:
    @pytest.fixture()
    def features(self, season_stats) -> pd.DataFrame:
        return build_features(season_stats, [2023, 2024])

    def test_row_universe(self, features):
        # a row needs a lag1 season: C (first game 2023) is absent for 2023
        keys = set(zip(features["player_id"], features["target_season"], strict=True))
        assert keys == {("A", 2023), ("B", 2023), ("A", 2024), ("C", 2024)}

    def test_all_feature_columns_present_and_filled(self, features):
        for col in FEATURE_COLUMNS:
            assert col in features.columns, col
        assert not features[FEATURE_COLUMNS].isna().any().any()

    def test_lag1_and_lag2_values(self, features, season_stats):
        row = one(features.rename(columns={"target_season": "season"}), "A", 2023)
        a22 = one(season_stats, "A", 2022)
        a21 = one(season_stats, "A", 2021)
        for feat in LAG_FEATURES:
            assert row[f"lag1_{feat}"] == pytest.approx(a22[feat]), feat
            assert row[f"lag2_{feat}"] == pytest.approx(a21[feat]), feat
        assert row["has_lag2"] == 1

    def test_missing_lag2_flagged_and_zeroed(self, features):
        row = one(features.rename(columns={"target_season": "season"}), "B", 2023)
        assert row["has_lag2"] == 0
        for feat in LAG_FEATURES:
            assert row[f"lag2_{feat}"] == 0.0, feat

    def test_target_values(self, features):
        feats = features.rename(columns={"target_season": "season"})
        a23 = one(feats, "A", 2023)
        assert a23["ppr_points_target"] == pytest.approx(12.5)
        assert a23["games_target"] == 1
        # B sat out 2023; 2024 has not been played by anyone
        assert pd.isna(one(feats, "B", 2023)["ppr_points_target"])
        assert pd.isna(one(feats, "A", 2024)["ppr_points_target"])
        assert pd.isna(one(feats, "C", 2024)["games_target"])

    def test_experience_math(self, features):
        feats = features.rename(columns={"target_season": "season"})
        assert one(feats, "A", 2023)["experience"] == 2  # first season 2021
        assert one(feats, "B", 2023)["experience"] == 1
        assert one(feats, "A", 2024)["experience"] == 3
        assert one(feats, "C", 2024)["experience"] == 1

    def test_position_one_hots(self, features):
        onehots = features[["pos_QB", "pos_RB", "pos_WR", "pos_TE"]]
        assert (onehots.sum(axis=1) == 1).all()
        for _, row in features.iterrows():
            assert row[f"pos_{row['position']}"] == 1

    def test_identity_columns_carried(self, features):
        feats = features.rename(columns={"target_season": "season"})
        a24 = one(feats, "A", 2024)
        assert a24["name"] == "Marvin Tester Jr."
        assert a24["norm_name"] == "marvin tester"
        assert a24["position"] == "RB"
        assert a24["team"] == "KC"


def test_feature_columns_shape():
    """FEATURE_COLUMNS = lag1 + lag2 + experience/has_lag2 + 4 one-hots."""
    assert len(FEATURE_COLUMNS) == 2 * len(LAG_FEATURES) + 6
    assert len(set(FEATURE_COLUMNS)) == len(FEATURE_COLUMNS)
    assert np.all([isinstance(c, str) for c in FEATURE_COLUMNS])
