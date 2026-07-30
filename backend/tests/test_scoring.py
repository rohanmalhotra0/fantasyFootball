"""Tests for draftengine.scoring: presets, custom weights, apply_scoring, linearity."""

import numpy as np
import pandas as pd
import pytest

from draftengine.scoring import STAT_WEIGHTS, ScoringSettings, apply_scoring


def stat_row(**overrides) -> dict:
    row = {col: 0.0 for col in STAT_WEIGHTS}
    row.update(overrides)
    return row


# One busy stat line, points computed by hand:
#   300 pass yd * 0.04 = 12    2 pass td * 4 = 8      1 int * -2  = -2
#   50 rush yd * 0.1   = 5     1 rush td * 6 = 6
#   5 rec (PPR)        = 5     80 rec yd * 0.1 = 8    1 rec td * 6 = 6
#   1 fumble * -2      = -2    1 two-pt * 2 = 2       1 st td * 6  = 6
# total PPR = 54
FULL_LINE = dict(
    passing_yards=300.0,
    passing_tds=2.0,
    interceptions=1.0,
    rushing_yards=50.0,
    rushing_tds=1.0,
    receptions=5.0,
    receiving_yards=80.0,
    receiving_tds=1.0,
    fumbles_lost=1.0,
    two_pt_conversions=1.0,
    special_teams_tds=1.0,
)
PPR_TOTAL = 54.0


class TestPresets:
    def test_ppr_is_default(self):
        assert ScoringSettings.preset("ppr") == ScoringSettings()
        assert ScoringSettings.preset("ppr").reception == 1.0

    def test_half(self):
        half = ScoringSettings.preset("half")
        assert half.reception == 0.5
        # only the reception weight differs from PPR
        assert half.model_copy(update={"reception": 1.0}) == ScoringSettings()

    def test_standard(self):
        std = ScoringSettings.preset("standard")
        assert std.reception == 0.0
        assert std.model_copy(update={"reception": 1.0}) == ScoringSettings()

    def test_unknown_preset_raises(self):
        with pytest.raises(ValueError, match="unknown scoring preset"):
            ScoringSettings.preset("superflex-te-premium")


class TestApplyScoring:
    def test_hand_computed_ppr(self):
        frame = pd.DataFrame([stat_row(**FULL_LINE)])
        points = apply_scoring(frame, ScoringSettings.preset("ppr"))
        assert points.iloc[0] == pytest.approx(PPR_TOTAL)

    def test_hand_computed_half_and_standard(self):
        frame = pd.DataFrame([stat_row(**FULL_LINE)])
        half = apply_scoring(frame, ScoringSettings.preset("half"))
        std = apply_scoring(frame, ScoringSettings.preset("standard"))
        assert half.iloc[0] == pytest.approx(PPR_TOTAL - 0.5 * 5)  # 51.5
        assert std.iloc[0] == pytest.approx(PPR_TOTAL - 1.0 * 5)  # 49.0

    def test_custom_weights(self):
        # 6-point passing TDs, no INT penalty
        custom = ScoringSettings(pass_td=6.0, interception=0.0)
        frame = pd.DataFrame([stat_row(**FULL_LINE)])
        points = apply_scoring(frame, custom)
        # +2 per pass td (x2) and +2 back from the waived INT
        assert points.iloc[0] == pytest.approx(PPR_TOTAL + 2 * 2.0 + 2.0)

    def test_zero_line_scores_zero(self):
        frame = pd.DataFrame([stat_row()])
        assert apply_scoring(frame, ScoringSettings()).iloc[0] == 0.0

    def test_missing_columns_are_skipped(self):
        frame = pd.DataFrame({"rushing_yards": [100.0], "unrelated": [5.0]})
        points = apply_scoring(frame, ScoringSettings())
        assert points.iloc[0] == pytest.approx(10.0)

    def test_nan_stats_count_as_zero(self):
        frame = pd.DataFrame(
            [stat_row(rushing_yards=100.0, receptions=np.nan, receiving_yards=np.nan)]
        )
        points = apply_scoring(frame, ScoringSettings())
        assert points.iloc[0] == pytest.approx(10.0)

    def test_preserves_index(self):
        frame = pd.DataFrame([stat_row(), stat_row()], index=[17, 3])
        points = apply_scoring(frame, ScoringSettings())
        assert list(points.index) == [17, 3]


class TestLinearity:
    def test_weekly_sum_equals_season_total_scoring(self):
        """Scoring weekly rows then summing == scoring the season totals."""
        rng = np.random.default_rng(42)
        rows = []
        for player in ["a", "b", "c"]:
            for week in range(1, 6):
                row = stat_row(
                    **{col: float(rng.integers(0, 40)) for col in STAT_WEIGHTS}
                )
                row["player_id"] = player
                row["week"] = week
                rows.append(row)
        weekly = pd.DataFrame(rows)

        for preset in ["ppr", "half", "standard"]:
            scoring = ScoringSettings.preset(preset)
            weekly_points = apply_scoring(weekly, scoring)
            summed_by_player = weekly_points.groupby(weekly["player_id"]).sum()

            season_totals = weekly.groupby("player_id")[list(STAT_WEIGHTS)].sum()
            season_points = apply_scoring(season_totals, scoring)

            pd.testing.assert_series_equal(
                summed_by_player, season_points, check_names=False
            )
