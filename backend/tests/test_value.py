"""Tests for draftengine.pipeline.value: replacement counts and VORP math."""

import pandas as pd
import pytest

from draftengine.league import LeagueSettings, RosterSlots
from draftengine.pipeline.value import add_vorp, replacement_counts, replacement_levels


class TestReplacementCounts:
    def test_default_12_team_reference_levels(self):
        """The classic 12-team 1QB/2RB/2WR/1TE/1FLEX league must reproduce
        QB13 / RB28 / WR34 / TE13 exactly (plus K13 / DST13)."""
        counts = replacement_counts(LeagueSettings())
        assert counts == {"QB": 13, "RB": 28, "WR": 34, "TE": 13, "K": 13, "DST": 13}

    def test_superflex_grows_qb_pool(self):
        base = replacement_counts(LeagueSettings(teams=10))
        sflex = replacement_counts(
            LeagueSettings(teams=10, roster=RosterSlots(superflex=1))
        )
        assert base["QB"] == 11  # 10 starters + 1
        assert sflex["QB"] > base["QB"]
        # 10 QB slots + 10 superflex * 0.8 QB share = 18 -> +1 = 19
        assert sflex["QB"] == 19

    def test_zero_slot_positions_dropped(self):
        counts = replacement_counts(LeagueSettings(roster=RosterSlots(k=0, dst=0)))
        assert "K" not in counts
        assert "DST" not in counts
        assert counts["QB"] == 13

    def test_scales_with_team_count(self):
        c8 = replacement_counts(LeagueSettings(teams=8))
        c16 = replacement_counts(LeagueSettings(teams=16))
        for pos in ["QB", "RB", "WR", "TE"]:
            assert c16[pos] > c8[pos]


def small_board() -> pd.DataFrame:
    """5 QBs + 5 RBs. Pools are smaller than the startable counts, so the
    replacement level clamps to the worst player at each position."""
    return pd.DataFrame(
        {
            "player_id": [f"qb{i}" for i in range(5)] + [f"rb{i}" for i in range(5)],
            "position": ["QB"] * 5 + ["RB"] * 5,
            "projected_points": [400.0, 350.0, 300.0, 250.0, 200.0]
            + [300.0, 280.0, 260.0, 240.0, 220.0],
        }
    )


class TestReplacementLevels:
    def test_clamps_to_last_player_in_small_pool(self):
        levels = replacement_levels(small_board(), LeagueSettings())
        assert levels["QB"] == 200.0
        assert levels["RB"] == 220.0
        # positions with no players simply have no level
        assert "WR" not in levels

    def test_indexes_into_deep_pool(self):
        # 40 QBs at 300, 299, ... -> replacement is the 13th best = 288
        board = pd.DataFrame(
            {
                "position": ["QB"] * 40,
                "projected_points": [300.0 - i for i in range(40)],
            }
        )
        levels = replacement_levels(board, LeagueSettings())
        assert levels["QB"] == 288.0


class TestAddVorp:
    def test_vorp_is_points_minus_replacement(self):
        out = add_vorp(small_board(), LeagueSettings())
        by_id = out.set_index("player_id")
        assert by_id.loc["qb0", "replacement_points"] == 200.0
        assert by_id.loc["qb0", "vorp"] == pytest.approx(200.0)
        assert by_id.loc["qb4", "vorp"] == pytest.approx(0.0)
        assert by_id.loc["rb0", "vorp"] == pytest.approx(80.0)
        assert by_id.loc["rb4", "vorp"] == pytest.approx(0.0)

    def test_model_rank_orders_by_vorp(self):
        out = add_vorp(small_board(), LeagueSettings())
        by_id = out.set_index("player_id")
        # vorp: qb0 200, qb1 150, qb2 100, rb0 80, rb1 60, qb3 50,
        #       rb2 40, rb3 20, qb4 0 (first), rb4 0
        expected = {
            "qb0": 1, "qb1": 2, "qb2": 3, "rb0": 4, "rb1": 5,
            "qb3": 6, "rb2": 7, "rb3": 8, "qb4": 9, "rb4": 10,
        }
        assert by_id["model_rank"].to_dict() == expected
        assert sorted(out["model_rank"]) == list(range(1, 11))

    def test_value_gap_only_when_adp_present(self):
        board = small_board()
        out = add_vorp(board, LeagueSettings())
        assert "value_gap" not in out.columns

        board["adp_rank"] = list(range(1, 11))
        out = add_vorp(board, LeagueSettings())
        assert (out["value_gap"] == out["adp_rank"] - out["model_rank"]).all()
        by_id = out.set_index("player_id")
        # qb0: drafted 1st, model rank 1 -> gap 0
        assert by_id.loc["qb0", "value_gap"] == 0
        # rb0: drafted 6th overall, model says 4th -> falls 2 spots (value)
        assert by_id.loc["rb0", "value_gap"] == 2

    def test_unstartable_position_capped_at_zero_vorp(self):
        # A position with no startable slots pins replacement to its best
        # player: nobody there can carry positive value over replacement.
        board = pd.DataFrame(
            {
                "player_id": ["fb1", "fb2"],
                "position": ["FB", "FB"],  # not in any roster slot
                "projected_points": [50.0, 30.0],
            }
        )
        out = add_vorp(board, LeagueSettings())
        assert out.loc[0, "replacement_points"] == pytest.approx(50.0)
        assert out.loc[0, "vorp"] == pytest.approx(0.0)
        assert out.loc[1, "vorp"] == pytest.approx(-20.0)

    def test_does_not_mutate_input(self):
        board = small_board()
        before = board.copy()
        add_vorp(board, LeagueSettings())
        pd.testing.assert_frame_equal(board, before)

    def test_custom_points_column(self):
        board = small_board().rename(columns={"projected_points": "pts"})
        out = add_vorp(board, LeagueSettings(), points_col="pts")
        assert out.set_index("player_id").loc["qb0", "vorp"] == pytest.approx(200.0)
