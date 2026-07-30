"""Tests for draftengine.pipeline.tiers: gap-based tiers and risk flags."""

import numpy as np
import pandas as pd

from draftengine.pipeline.tiers import MAX_TIERS, assign_tiers, risk_flags


def board_of(points_by_position: dict[str, list[float]]) -> pd.DataFrame:
    rows = []
    for pos, pts in points_by_position.items():
        for i, p in enumerate(pts):
            rows.append(
                {"player_id": f"{pos}{i}", "position": pos, "projected_points": p}
            )
    return pd.DataFrame(rows)


class TestAssignTiers:
    def test_big_gap_creates_new_tier(self):
        # drops: 5, 5, 40, 5, 5 -> mean 12, std 14, threshold 26.
        # Only the 40-point cliff starts a new tier.
        board = board_of({"RB": [300.0, 295.0, 290.0, 250.0, 245.0, 240.0]})
        tiers = assign_tiers(board)
        assert list(tiers) == [1, 1, 1, 2, 2, 2]

    def test_monotone_points_give_non_decreasing_tiers(self):
        rng = np.random.default_rng(42)
        board = board_of(
            {
                pos: sorted(rng.uniform(50, 350, size=50), reverse=True)
                for pos in ["QB", "RB", "WR", "TE"]
            }
        )
        tiers = assign_tiers(board)
        for pos in ["QB", "RB", "WR", "TE"]:
            group = board[board["position"] == pos].sort_values(
                "projected_points", ascending=False
            )
            pos_tiers = tiers.loc[group.index].to_list()
            assert pos_tiers[0] == 1
            assert all(a <= b for a, b in zip(pos_tiers, pos_tiers[1:], strict=False))
            assert max(pos_tiers) <= MAX_TIERS

    def test_tier_count_capped(self):
        # 10 flat groups of 4 separated by 100-point cliffs: 9 breaks exceed
        # the threshold (~65), but only MAX_TIERS tiers may exist.
        pts = [1000.0 - 100.0 * g for g in range(10) for _ in range(4)]
        board = board_of({"WR": pts})
        tiers = assign_tiers(board)
        assert tiers.max() == MAX_TIERS
        # first 8 groups get tiers 1..8; the overflow groups stay in tier 8
        assert list(tiers.iloc[:8]) == [1, 1, 1, 1, 2, 2, 2, 2]
        assert list(tiers.iloc[-8:]) == [MAX_TIERS] * 8

    def test_tiny_position_stays_tier_one(self):
        board = board_of({"TE": [200.0, 100.0]})  # < 3 players: no tiering
        assert list(assign_tiers(board)) == [1, 1]

    def test_positions_tiered_independently(self):
        board = board_of(
            {
                "RB": [300.0, 295.0, 290.0, 250.0, 245.0, 240.0],
                "TE": [180.0, 178.0, 176.0, 174.0, 172.0, 170.0],  # flat: one tier
            }
        )
        tiers = assign_tiers(board)
        assert list(tiers[board["position"] == "RB"]) == [1, 1, 1, 2, 2, 2]
        assert list(tiers[board["position"] == "TE"]) == [1, 1, 1, 1, 1, 1]

    def test_unsorted_input_aligns_by_index(self):
        board = board_of({"RB": [300.0, 295.0, 290.0, 250.0, 245.0, 240.0]})
        shuffled = board.sample(frac=1.0, random_state=7)  # keeps original index
        tiers = assign_tiers(shuffled)
        by_id = dict(zip(shuffled["player_id"], tiers, strict=True))
        assert by_id == {"RB0": 1, "RB1": 1, "RB2": 1, "RB3": 2, "RB4": 2, "RB5": 2}

    def test_custom_points_column(self):
        board = board_of({"RB": [300.0, 295.0, 290.0, 250.0, 245.0, 240.0]}).rename(
            columns={"projected_points": "pts"}
        )
        assert list(assign_tiers(board, points_col="pts")) == [1, 1, 1, 2, 2, 2]


class TestRiskFlags:
    def make(self, lag1_games, has_lag2, lag2_games):
        return pd.DataFrame(
            {
                "lag1_games": [lag1_games],
                "has_lag2": [has_lag2],
                "lag2_games": [lag2_games],
            }
        )

    def test_short_lag1_with_real_lag2_is_risky(self):
        assert risk_flags(self.make(6.0, 1, 15.0)).iloc[0]

    def test_boundaries(self):
        assert risk_flags(self.make(10.0, 1, 8.0)).iloc[0]  # exactly on both edges
        assert not risk_flags(self.make(11.0, 1, 15.0)).iloc[0]  # lag1 not short
        assert not risk_flags(self.make(10.0, 1, 7.0)).iloc[0]  # lag2 not real

    def test_full_lag1_season_not_risky(self):
        assert not risk_flags(self.make(17.0, 1, 17.0)).iloc[0]

    def test_no_lag2_not_risky(self):
        # a short season with no prior history is a rookie-ish unknown, not
        # an injury-extrapolation risk
        assert not risk_flags(self.make(5.0, 0, 0.0)).iloc[0]

    def test_nan_games_treated_as_zero(self):
        assert not risk_flags(self.make(np.nan, 1, np.nan)).iloc[0]
        assert risk_flags(self.make(np.nan, 1, 12.0)).iloc[0]

    def test_vectorized_over_board(self):
        board = pd.DataFrame(
            {
                "lag1_games": [6.0, 17.0, 8.0],
                "has_lag2": [1, 1, 0],
                "lag2_games": [16.0, 16.0, 0.0],
            }
        )
        assert list(risk_flags(board)) == [True, False, False]
