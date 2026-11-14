"""Tests for gap detection and erosivity scoring.

The wrap cases matter more than the rest combined: the gap this entire
project is about (October harvest -> May planting) crosses 31 December.
"""

from __future__ import annotations

import math

import pytest

from fallowclock.gaps import (
    accumulate_gdd,
    bare_days,
    build_gaps,
    doys_in_run,
    exposed_erosivity,
    find_bare_runs,
    first_killing_frost_doy,
    rusle_c_factor,
)
from fallowclock.schema import DOY_LEN


def covered(n: int = DOY_LEN) -> list[float]:
    return [0.9] * n


def bare(n: int = DOY_LEN) -> list[float]:
    return [0.05] * n


# --------------------------------------------------------------------------
# RUSLE C factor
# --------------------------------------------------------------------------


def test_c_factor_bare_soil_is_one():
    assert rusle_c_factor(0.0) == pytest.approx(1.0)


def test_c_factor_decreases_with_cover():
    assert rusle_c_factor(0.9) < rusle_c_factor(0.5) < rusle_c_factor(0.1)


def test_c_factor_matches_hand_computation():
    # C = exp(-0.035 * 50) for 50% cover
    assert rusle_c_factor(0.5, b=0.035) == pytest.approx(math.exp(-1.75))


def test_c_factor_rejects_percent_passed_as_fraction():
    """Guards the most likely caller error: passing 50 instead of 0.5."""
    with pytest.raises(ValueError):
        rusle_c_factor(50.0)


# --------------------------------------------------------------------------
# Run detection -- linear cases
# --------------------------------------------------------------------------


def test_no_bare_days_gives_no_runs():
    assert find_bare_runs(covered()) == []


def test_all_bare_gives_one_full_year_run():
    assert find_bare_runs(bare()) == [(0, DOY_LEN - 1)]


def test_single_interior_run():
    sc = covered()
    for i in range(100, 150):
        sc[i] = 0.1
    assert find_bare_runs(sc) == [(100, 149)]


def test_two_separate_interior_runs():
    sc = covered()
    for i in range(50, 60):
        sc[i] = 0.1
    for i in range(200, 210):
        sc[i] = 0.1
    assert find_bare_runs(sc) == [(50, 59), (200, 209)]


def test_threshold_is_strict_less_than():
    """soil_cover exactly at 0.30 is COVERED, matching the NRCS definition
    of conservation tillage as >=30% residue."""
    sc = covered()
    sc[10] = 0.30
    assert find_bare_runs(sc) == []
    sc[10] = 0.2999
    assert find_bare_runs(sc) == [(10, 10)]


# --------------------------------------------------------------------------
# Run detection -- the wrap cases that matter
# --------------------------------------------------------------------------


def test_run_wrapping_new_year_is_merged():
    """Oct 16 (289) through May 4 (124): the corn-soybean fallow window."""
    sc = covered()
    for i in list(range(288, DOY_LEN)) + list(range(0, 124)):
        sc[i] = 0.1
    runs = find_bare_runs(sc)
    assert len(runs) == 1, "wrapping run must be merged, not reported as two"
    start, end = runs[0]
    assert start == 288 and end == 123
    assert start > end, "a wrapping run is signalled by start > end"


def test_wrapping_run_has_correct_day_count():
    sc = covered()
    for i in list(range(288, DOY_LEN)) + list(range(0, 124)):
        sc[i] = 0.1
    start, end = find_bare_runs(sc)[0]
    assert len(doys_in_run(start, end)) == (DOY_LEN - 288) + 124


def test_wrap_plus_separate_summer_run():
    sc = covered()
    for i in list(range(350, DOY_LEN)) + list(range(0, 50)):
        sc[i] = 0.1
    for i in range(180, 190):
        sc[i] = 0.1
    runs = find_bare_runs(sc)
    assert len(runs) == 2
    assert (350, 49) in runs
    assert (180, 189) in runs


def test_bare_only_on_jan_1_does_not_falsely_wrap():
    sc = covered()
    sc[0] = 0.1
    assert find_bare_runs(sc) == [(0, 0)]


def test_bare_only_on_dec_31_does_not_falsely_wrap():
    sc = covered()
    sc[DOY_LEN - 1] = 0.1
    assert find_bare_runs(sc) == [(DOY_LEN - 1, DOY_LEN - 1)]


def test_doys_in_run_non_wrapping():
    assert doys_in_run(5, 8) == [5, 6, 7, 8]


def test_doys_in_run_wrapping():
    assert doys_in_run(363, 1) == [363, 364, 0, 1]


# --------------------------------------------------------------------------
# Gap scoring
# --------------------------------------------------------------------------


def test_gap_shares_sum_to_one_when_year_fully_bare():
    gaps = build_gaps(bare(), [1.0] * DOY_LEN)
    assert len(gaps) == 1
    assert gaps[0].share_of_annual_r == pytest.approx(1.0)
    assert gaps[0].n_days == DOY_LEN


def test_gap_share_uses_raw_rainfall_not_cover_weighted():
    """The headline claim is about the rain, not the cover: 'X% of the
    year's erosive rain falls while the field is bare'."""
    sc = covered()
    r = [0.0] * DOY_LEN
    for i in range(100, 110):
        sc[i] = 0.0
        r[i] = 10.0  # all the year's rain, during the bare window
    gaps = build_gaps(sc, r)
    assert gaps[0].share_of_annual_r == pytest.approx(1.0)


def test_gaps_sorted_by_exposed_erosivity_descending():
    sc = covered()
    r = [1.0] * DOY_LEN
    for i in range(10, 20):  # small gap
        sc[i] = 0.0
    for i in range(100, 160):  # big gap
        sc[i] = 0.0
    gaps = build_gaps(sc, r)
    assert gaps[0].n_days == 60, "biggest erosivity exposure must come first"
    assert gaps[0].exposed_r > gaps[1].exposed_r


def test_no_gaps_when_fully_covered():
    assert build_gaps(covered(), [1.0] * DOY_LEN) == []


def test_zero_rainfall_does_not_divide_by_zero():
    sc = covered()
    sc[50] = 0.0
    gaps = build_gaps(sc, [0.0] * DOY_LEN)
    assert gaps[0].share_of_annual_r == 0.0


def test_wrapping_gap_validates_against_schema():
    """Gap.wraps_year has a model_validator that must agree with the DOYs."""
    sc = covered()
    for i in list(range(300, DOY_LEN)) + list(range(0, 60)):
        sc[i] = 0.1
    gaps = build_gaps(sc, [1.0] * DOY_LEN)
    assert gaps[0].wraps_year is True
    assert gaps[0].start_doy == 301 and gaps[0].end_doy == 60


# --------------------------------------------------------------------------
# Exposed erosivity
# --------------------------------------------------------------------------


def test_bare_year_has_higher_exposure_than_covered_year():
    r = [2.0] * DOY_LEN
    assert exposed_erosivity(bare(), r) > exposed_erosivity(covered(), r)


def test_fully_bare_exposure_equals_total_rainfall_erosivity():
    """C == 1.0 at zero cover, so exposure collapses to the raw R sum."""
    r = [2.0] * DOY_LEN
    assert exposed_erosivity([0.0] * DOY_LEN, r) == pytest.approx(2.0 * DOY_LEN)


def test_cover_during_the_rain_beats_cover_during_the_dry_season():
    """The whole thesis: WHEN you are bare matters, not just how long."""
    r = [0.0] * DOY_LEN
    for i in range(120, 160):  # May-June erosivity peak
        r[i] = 50.0

    bare_in_the_rain = covered()
    for i in range(120, 160):
        bare_in_the_rain[i] = 0.0

    bare_in_the_dry = covered()
    for i in range(300, 340):
        bare_in_the_dry[i] = 0.0

    assert exposed_erosivity(bare_in_the_rain, r) > exposed_erosivity(
        bare_in_the_dry, r
    )


def test_wrong_length_array_is_rejected():
    with pytest.raises(ValueError, match="365"):
        exposed_erosivity([0.5] * 100, [1.0] * 100)


# --------------------------------------------------------------------------
# GDD and frost
# --------------------------------------------------------------------------


def test_gdd_accumulation_simple_window():
    assert accumulate_gdd([1.0] * DOY_LEN, 10, 19) == pytest.approx(10.0)


def test_gdd_accumulation_wraps_the_year():
    """Seeding a cover crop in October and asking what it accumulates by
    March is the normal case, not the edge case."""
    assert accumulate_gdd([1.0] * DOY_LEN, 360, 5) == pytest.approx(11.0)


def test_gdd_rejects_out_of_range_doy():
    with pytest.raises(ValueError):
        accumulate_gdd([1.0] * DOY_LEN, 0, 10)
    with pytest.raises(ValueError):
        accumulate_gdd([1.0] * DOY_LEN, 1, 366)


def test_first_frost_found_after_seeding():
    fp = [0.0] * DOY_LEN
    fp[280] = 0.8
    assert first_killing_frost_doy(fp, after_doy=250) == 281


def test_first_frost_search_wraps_the_year():
    fp = [0.0] * DOY_LEN
    fp[10] = 0.9
    assert first_killing_frost_doy(fp, after_doy=350) == 11


def test_frost_free_climate_returns_none_not_an_error():
    assert first_killing_frost_doy([0.0] * DOY_LEN, after_doy=100) is None


def test_bare_days_counts_correctly():
    sc = covered()
    for i in range(0, 42):
        sc[i] = 0.0
    assert bare_days(sc) == 42


# --------------------------------------------------------------------------
# Jensen's inequality: phase averaging vs averaging the phases
# --------------------------------------------------------------------------


def test_phase_averaging_single_phase_matches_plain_exposure():
    from fallowclock.gaps import phase_averaged_exposed_erosivity

    sc, r = covered(), [1.0] * DOY_LEN
    assert phase_averaged_exposed_erosivity([sc], r) == pytest.approx(
        exposed_erosivity(sc, r)
    )


def test_averaging_cover_understates_erosion_versus_averaging_phases():
    """The bug this function exists to prevent. exp(-bx) is convex, so
    running the C-factor on mean cover always understates exposure."""
    from fallowclock.gaps import phase_averaged_exposed_erosivity

    r = [1.0] * DOY_LEN
    corn_phase = [0.8] * DOY_LEN
    soy_phase = [0.1] * DOY_LEN
    mean_cover = [(a + b) / 2 for a, b in zip(corn_phase, soy_phase)]

    correct = phase_averaged_exposed_erosivity([corn_phase, soy_phase], r)
    shortcut = exposed_erosivity(mean_cover, r)

    assert correct > shortcut, "averaging cover must understate exposure"
    assert (correct - shortcut) / correct > 0.05, (
        "the gap should be material, not rounding -- if this ever shrinks "
        "to nothing the test has stopped testing anything"
    )


def test_phase_averaging_identical_phases_equals_either_phase():
    from fallowclock.gaps import phase_averaged_exposed_erosivity

    sc, r = [0.4] * DOY_LEN, [2.0] * DOY_LEN
    assert phase_averaged_exposed_erosivity([sc, sc, sc], r) == pytest.approx(
        exposed_erosivity(sc, r)
    )


def test_phase_averaging_rejects_empty_and_wrong_length():
    from fallowclock.gaps import phase_averaged_exposed_erosivity

    with pytest.raises(ValueError):
        phase_averaged_exposed_erosivity([], [1.0] * DOY_LEN)
    with pytest.raises(ValueError, match="365"):
        phase_averaged_exposed_erosivity([[0.5] * 10], [1.0] * DOY_LEN)
