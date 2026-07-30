"""Tests for draftengine.pipeline.model: walk-forward validation, no look-ahead.

Synthetic features: ~80 players x 4 target seasons with a learnable signal
(target = 0.9 * lag1 points + noise). Deterministic via seeded numpy +
XGB_PARAMS' fixed random_state.
"""

import numpy as np
import pandas as pd
import pytest

from draftengine.pipeline.dataset import FEATURE_COLUMNS
from draftengine.pipeline.model import (
    YearValidation,
    _spearman,
    fit_model,
    predict,
    validate_year,
    walk_forward_validate,
)

POSITIONS = ["QB", "RB", "WR", "TE"]
SEASONS = [2021, 2022, 2023, 2024]
N_PLAYERS = 80


def make_features(
    shift_year: int | None = None, shift: float = 0.0, seed: int = 42
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for season in SEASONS:
        for i in range(N_PLAYERS):
            pos = POSITIONS[i % 4]
            lag1_pts = float(rng.uniform(20.0, 350.0))
            row = dict.fromkeys(FEATURE_COLUMNS, 0.0)
            row.update(
                player_id=f"p{i}",
                norm_name=f"player {i}",
                position=pos,
                target_season=season,
                lag1_ppr_points=lag1_pts,
                lag1_ppg=lag1_pts / 17.0,
                lag1_games=17.0,
                lag2_ppr_points=lag1_pts * 0.9,
                has_lag2=1,
                experience=3,
            )
            for p in POSITIONS:
                row[f"pos_{p}"] = int(p == pos)
            target = 0.9 * lag1_pts + float(rng.normal(0.0, 15.0))
            if season == shift_year:
                target += shift
            row["ppr_points_target"] = target
            rows.append(row)
    return pd.DataFrame(rows)


@pytest.fixture(scope="module")
def features() -> pd.DataFrame:
    return make_features()


@pytest.fixture(scope="module")
def result_2024(features):
    """One shared validate_year run (each call fits a fresh XGB model)."""
    return validate_year(features, 2024)


class TestValidateYear:
    def test_returns_year_validation(self, result_2024):
        result, _ = result_2024
        assert isinstance(result, YearValidation)
        assert result.season == 2024
        assert result.n_players == N_PLAYERS

    def test_model_learns_the_signal(self, result_2024):
        result, _ = result_2024
        assert -1.0 <= result.spearman_model <= 1.0
        assert -1.0 <= result.spearman_naive <= 1.0
        assert result.spearman_model > 0.6
        assert result.spearman_naive > 0.8  # naive == lag1, which drives the target
        assert 0.0 <= result.mae_model < 60.0

    def test_drafted_fields_none_without_adp(self, result_2024):
        result, _ = result_2024
        assert result.n_drafted is None
        assert result.spearman_model_drafted is None
        assert result.spearman_naive_drafted is None
        assert result.spearman_adp_drafted is None

    def test_per_position_breakdown(self, result_2024):
        result, _ = result_2024
        assert set(result.per_position) == set(POSITIONS)
        for pos in POSITIONS:
            entry = result.per_position[pos]
            assert entry["n"] == N_PLAYERS // 4
            assert -1.0 <= entry["spearman_model"] <= 1.0
            assert -1.0 <= entry["spearman_naive"] <= 1.0
            assert entry["mae_model"] >= 0.0

    def test_holdout_frame(self, result_2024):
        _, holdout = result_2024
        assert len(holdout) == N_PLAYERS
        assert (holdout["target_season"] == 2024).all()
        assert holdout["predicted"].notna().all()
        pd.testing.assert_series_equal(
            holdout["naive"], holdout["lag1_ppr_points"], check_names=False
        )

    def test_to_dict_round_trips_fields(self, result_2024):
        result, _ = result_2024
        d = result.to_dict()
        assert d["season"] == 2024
        assert set(d) >= {
            "season",
            "n_players",
            "spearman_model",
            "spearman_naive",
            "mae_model",
            "n_drafted",
            "per_position",
        }

    def test_no_lookahead_under_distribution_shift(self):
        """Shift ONLY the holdout year's targets by +2000. A model trained
        strictly on older seasons cannot see the shift, so its predictions
        must stay in the old range; any leak would chase the shift."""
        shifted = make_features(shift_year=2024, shift=2000.0)
        result, holdout = validate_year(shifted, 2024)
        assert holdout["predicted"].max() < holdout["ppr_points_target"].min()
        assert result.mae_model > 1500.0
        # ranking skill is untouched by a constant shift
        assert result.spearman_model > 0.6

    def test_adp_drafted_subset(self, features):
        holdout = features[features["target_season"] == 2024]
        adp = holdout[["norm_name", "position", "lag1_ppr_points"]].head(30).copy()
        adp["adp_rank"] = adp["lag1_ppr_points"].rank(ascending=False).astype(int)
        result, _ = validate_year(features, 2024, adp=adp)
        assert result.n_drafted == 30
        for value in [
            result.spearman_model_drafted,
            result.spearman_naive_drafted,
            result.spearman_adp_drafted,
        ]:
            assert value is not None
            assert -1.0 <= value <= 1.0
        # adp_rank tracks lag1, which drives the target
        assert result.spearman_adp_drafted > 0.5

    def test_tiny_adp_sample_ignored(self, features):
        holdout = features[features["target_season"] == 2024]
        adp = holdout[["norm_name", "position"]].head(5).copy()
        adp["adp_rank"] = range(1, 6)
        result, _ = validate_year(features, 2024, adp=adp)
        assert result.n_drafted is None  # < 10 matches: not reported

    def test_no_train_data_raises(self, features):
        with pytest.raises(ValueError, match="no data to validate"):
            validate_year(features, SEASONS[0])  # nothing older to train on

    def test_no_holdout_data_raises(self, features):
        with pytest.raises(ValueError, match="no data to validate"):
            validate_year(features, 2030)


class TestWalkForward:
    def test_each_year_validated_independently(self, features):
        results, preds = walk_forward_validate(features, [2023, 2024])
        assert [r.season for r in results] == [2023, 2024]
        assert all(r.n_players == N_PLAYERS for r in results)
        assert len(preds) == 2 * N_PLAYERS
        assert set(preds["target_season"]) == {2023, 2024}


class TestHelpers:
    def test_fit_and_predict_shapes(self, features):
        train = features[features["target_season"] < 2024]
        model = fit_model(train)
        holdout = features[features["target_season"] == 2024]
        preds = predict(model, holdout)
        assert preds.shape == (N_PLAYERS,)
        assert np.isfinite(preds).all()

    @pytest.mark.filterwarnings("ignore:An input array is constant")
    def test_spearman_nan_guard(self):
        # constant input makes spearmanr return nan -> coerced to 0.0
        assert _spearman(np.ones(5), np.arange(5)) == 0.0
        assert _spearman(np.arange(5), np.arange(5)) == pytest.approx(1.0)
        assert _spearman(np.arange(5), -np.arange(5)) == pytest.approx(-1.0)


def test_year_validation_defaults_are_independent():
    a = YearValidation(2024, 10, 0.5, 0.4, 30.0)
    b = YearValidation(2023, 10, 0.5, 0.4, 30.0)
    a.per_position["QB"] = {"n": 1}
    assert b.per_position == {}  # default_factory, not a shared dict
