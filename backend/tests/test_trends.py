"""Trend fitting: robust slope, honest nulls, and no invented precision."""

import math

import pytest

from fallowclock.trends import (
    ALPHA,
    MIN_YEARS,
    annual_bare_window_share,
    annual_first_fall_frost,
    annual_growing_season_days,
    annual_last_spring_frost,
    build_trends,
    fit_trend,
    mann_kendall_p,
    theil_sen,
)
from fallowclock.weather import DailyRecord


def rec(year, doy, tmax=20.0, tmin=10.0, precip=0.0):
    return DailyRecord(year=year, doy=doy, tmax=tmax, tmin=tmin, precip_mm=precip)


def full_year(year, **kw):
    return [rec(year, d, **kw) for d in range(1, 366)]


class TestTheilSen:
    def test_recovers_an_exact_line(self):
        xs = [float(i) for i in range(10)]
        ys = [3.0 * x + 7.0 for x in xs]
        assert theil_sen(xs, ys) == pytest.approx(3.0)

    def test_one_wild_year_barely_moves_it(self):
        """The whole reason for Theil-Sen over least squares."""
        xs = [float(i) for i in range(12)]
        ys = [2.0 * x for x in xs]
        ys[6] = 500.0  # a flood year
        assert theil_sen(xs, ys) == pytest.approx(2.0, abs=0.35)

    def test_flat_series_has_no_slope(self):
        assert theil_sen([1.0, 2.0, 3.0], [5.0, 5.0, 5.0]) == 0.0

    def test_mismatched_lengths_raise(self):
        with pytest.raises(ValueError):
            theil_sen([1.0, 2.0], [1.0])


class TestMannKendall:
    def test_strong_monotonic_trend_is_significant(self):
        assert mann_kendall_p([float(i) for i in range(20)]) < 0.001

    def test_flat_series_is_not(self):
        assert mann_kendall_p([5.0] * 20) == 1.0

    def test_alternating_noise_is_not(self):
        assert mann_kendall_p([1.0, 2.0] * 10) > ALPHA

    def test_too_short_to_judge_returns_one(self):
        assert mann_kendall_p([1.0, 9.0]) == 1.0

    def test_direction_does_not_change_the_p_value(self):
        up = [float(i) for i in range(15)]
        assert mann_kendall_p(up) == pytest.approx(mann_kendall_p(list(reversed(up))))

    def test_p_is_a_probability(self):
        for series in ([1.0, 3.0, 2.0, 5.0, 4.0, 7.0], [9.0, 1.0, 8.0, 2.0, 7.0, 3.0]):
            p = mann_kendall_p(series)
            assert 0.0 <= p <= 1.0 and not math.isnan(p)


class TestFitTrend:
    def test_refuses_a_series_too_short_to_mean_anything(self):
        short = {2000 + i: float(i) for i in range(MIN_YEARS - 1)}
        assert fit_trend("x", "u", short) is None

    def test_reports_per_decade_not_per_year(self):
        series = {2000 + i: 2.0 * i for i in range(20)}
        t = fit_trend("x", "u", series)
        assert t is not None
        assert t.slope_per_decade == pytest.approx(20.0)

    def test_a_null_result_is_reported_as_flat(self):
        """Not significant must never be dressed up with a direction."""
        series = {2000 + i: (1.0 if i % 2 else 2.0) for i in range(20)}
        t = fit_trend("x", "u", series)
        assert t is not None
        assert not t.significant
        assert t.direction == "flat"

    def test_day_of_year_metrics_read_earlier_and_later(self):
        later = fit_trend("d", "day of year", {2000 + i: 100.0 + i for i in range(20)}, lower_is_earlier=True)
        earlier = fit_trend("d", "day of year", {2000 + i: 100.0 - i for i in range(20)}, lower_is_earlier=True)
        assert later is not None and later.direction == "later"
        assert earlier is not None and earlier.direction == "earlier"

    def test_round_trips_through_as_dict(self):
        t = fit_trend("x", "u", {2000 + i: float(i) for i in range(15)})
        assert t is not None
        d = t.as_dict()
        assert d["metric"] == "x"
        assert len(d["years"]) == len(d["values"]) == 15
        assert isinstance(d["significant"], bool)


class TestAnnualMetrics:
    def test_frost_dates_split_at_midsummer(self):
        recs = full_year(2001)
        recs[59] = rec(2001, 60, tmin=-3.0)    # spring frost, DOY 60
        recs[299] = rec(2001, 300, tmin=-2.0)  # autumn frost, DOY 300
        assert annual_last_spring_frost(recs) == {2001: 60.0}
        assert annual_first_fall_frost(recs) == {2001: 300.0}
        assert annual_growing_season_days(recs) == {2001: 240.0}

    def test_a_year_with_no_frost_is_omitted_not_guessed(self):
        assert annual_last_spring_frost(full_year(2001)) == {}

    def test_part_years_are_dropped(self):
        """A year missing a season is not a year with a short season."""
        stub = [rec(2002, d, tmin=-3.0) for d in range(1, 100)]
        assert annual_last_spring_frost(stub) == {}

    def test_bare_window_share_counts_only_rain_inside_it(self):
        recs = full_year(2003)
        recs[99] = rec(2003, 100, precip=50.0)   # inside 90-150
        recs[199] = rec(2003, 200, precip=50.0)  # outside
        share = annual_bare_window_share(recs, 0.29, 1.77, 90, 150)
        assert share[2003] == pytest.approx(0.5)

    def test_bare_window_share_handles_a_window_across_new_year(self):
        recs = full_year(2004)
        recs[4] = rec(2004, 5, precip=40.0)      # inside 330-20
        recs[359] = rec(2004, 360, precip=40.0)  # inside
        recs[179] = rec(2004, 180, precip=40.0)  # outside
        share = annual_bare_window_share(recs, 0.29, 1.77, 330, 20)
        assert share[2004] == pytest.approx(2 / 3)

    def test_bare_window_share_is_a_fraction(self):
        recs = full_year(2005)
        for d in (50, 120, 250):
            recs[d - 1] = rec(2005, d, precip=30.0)
        for v in annual_bare_window_share(recs, 0.29, 1.77, 90, 150).values():
            assert 0.0 <= v <= 1.0

    def test_a_dry_year_is_omitted_rather_than_divided_by_zero(self):
        assert annual_bare_window_share(full_year(2006), 0.29, 1.77, 90, 150) == {}

    def test_bare_window_rejects_an_out_of_range_window(self):
        with pytest.raises(ValueError):
            annual_bare_window_share(full_year(2007), 0.29, 1.77, 0, 150)


class TestBuildTrends:
    def _record_set(self):
        recs = []
        for i in range(25):
            year = 2000 + i
            recs += full_year(year)
            # Autumn frost walks later; spring frost stays put.
            recs[-366 + 59] = rec(year, 60, tmin=-3.0)
            recs[-366 + (280 + i)] = rec(year, 281 + i, tmin=-2.0)
            recs[-366 + 119] = rec(year, 120, precip=40.0)
        return recs

    def test_finds_the_planted_autumn_trend_and_no_spring_one(self):
        trends = {t.metric: t for t in build_trends(self._record_set(), a=0.29, b=1.77)}
        assert trends["first_fall_frost_doy"].significant
        assert trends["first_fall_frost_doy"].direction == "later"
        assert not trends["last_spring_frost_doy"].significant

    def test_the_share_metric_appears_only_with_a_window(self):
        recs = self._record_set()
        without = {t.metric for t in build_trends(recs, a=0.29, b=1.77)}
        with_gap = {t.metric for t in build_trends(recs, a=0.29, b=1.77, gap_start_doy=83, gap_end_doy=165)}
        assert "bare_window_erosivity_share" not in without
        assert "bare_window_erosivity_share" in with_gap

    def test_every_trend_is_serialisable(self):
        for t in build_trends(self._record_set(), a=0.29, b=1.77):
            d = t.as_dict()
            assert set(d) == {
                "metric", "unit", "years", "values",
                "slope_per_decade", "p_value", "significant", "direction",
            }
