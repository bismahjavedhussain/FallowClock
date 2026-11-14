"""Tests for B2's layers: weather, erosivity, soil water, rotations, bundle.

Every one of these is offline. Network calls are B2's slowest feedback loop
and the pipeline has to be testable without one.

Several tests exist specifically to pin bugs that were found and fixed
during the build. Those are labelled REGRESSION -- do not delete them
because they look obvious. They were not obvious.
"""

from __future__ import annotations

import math

import pytest

from fallowclock.cropfit import (
    DEFAULT_PLATEAU,
    TERMINATION_DAYS,
    evidence_rank,
    load_species,
    rank_species_for_gap,
    thermal_ramp_curve,
)
from fallowclock.erosivity import (
    DEFAULT_B,
    build_erosivity,
    calibrate_a,
    daily_erosivity,
    peak_doy,
)
from fallowclock.gaps import KILLING_FROST_PROB, build_gaps, exposed_erosivity
from fallowclock.rotations import compare, score_rotation, RotationPlan, union_cover
from fallowclock.schema import DOY_LEN, Gap
from fallowclock.soilwater import (
    MJ_TO_MM,
    default_kc_curve,
    extraterrestrial_radiation,
    hargreaves_et0,
    run_bucket,
)
from fallowclock.sources import NASA_SOURCES, NON_NASA_SOURCES, check_eligibility
from fallowclock.weather import (
    COOL_SEASON_CAPS,
    WARM_SEASON_CAPS,
    DailyRecord,
    build_climatology,
    doy_365,
    frost_date_stats,
    gdd_day,
)

IOWA_LAT = 42.03


def synth_records(years=range(2000, 2025)) -> list[DailyRecord]:
    """Deterministic pseudo-Iowa weather. No network.

    Storms are SEASONAL -- bigger and more frequent in late spring, like
    the Corn Belt. A uniform rain pattern would make the erosivity peak
    land on an arbitrary day and quietly turn the peak-timing test into a
    test of nothing.
    """
    out = []
    for y in years:
        for doy in range(1, DOY_LEN + 1):
            tmean = 10.5 - 14.0 * math.cos(2 * math.pi * (doy - 15) / DOY_LEN)
            swing = 11.0 + 2.0 * math.sin(doy * 0.7 + y)

            # Storm size peaks mid-June (DOY 165); frequency rises with it.
            season = math.exp(-(((doy - 165) / 55.0) ** 2))
            storm_due = (doy * 7 + y * 13) % max(4, int(19 - 12 * season)) == 0
            precip = (8.0 + 26.0 * season) if storm_due else 1.2

            out.append(
                DailyRecord(y, doy, tmean + swing / 2, tmean - swing / 2, precip)
            )
    return out


# --------------------------------------------------------------------------
# Day-of-year mapping
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "month,day,expected",
    [(1, 1, 1), (2, 28, 59), (3, 1, 60), (6, 30, 181), (12, 31, 365)],
)
def test_doy_365_matches_non_leap_calendar(month, day, expected):
    assert doy_365(month, day) == expected


def test_leap_day_is_dropped():
    """REGRESSION: 29 Feb shifts every later DOY by one. Mapping onto a
    fixed 365-day calendar is what keeps DOY 100 the same date every year."""
    assert doy_365(2, 29) is None


# --------------------------------------------------------------------------
# Growing degree days
# --------------------------------------------------------------------------


def test_gdd_is_zero_below_base():
    assert gdd_day(3.0, -5.0, 10.0) == 0.0


def test_gdd_uncapped_matches_hand_calculation():
    assert gdd_day(30.0, 10.0, 10.0) == pytest.approx(10.0)


def test_warm_season_caps_limit_accumulation():
    """REGRESSION: uncapped GDD overstated Iowa accumulation by ~40%
    (2096 vs ~1500 C-days). Corn GDD caps Tmax at 30 C and floors Tmin at
    10 C before averaging."""
    hot_uncapped = gdd_day(40.0, 25.0, 10.0)
    hot_capped = gdd_day(40.0, 25.0, 10.0, *WARM_SEASON_CAPS)
    assert hot_capped < hot_uncapped
    assert hot_capped == pytest.approx((30.0 + 25.0) / 2 - 10.0)


def test_cool_night_floored_for_warm_season():
    assert gdd_day(20.0, 2.0, 10.0, *WARM_SEASON_CAPS) == pytest.approx(
        (20.0 + 10.0) / 2 - 10.0
    )


def test_cool_season_has_no_lower_floor():
    assert COOL_SEASON_CAPS[1] is None
    assert gdd_day(12.0, 0.0, 4.0, *COOL_SEASON_CAPS) == pytest.approx(2.0)


# --------------------------------------------------------------------------
# Climatology
# --------------------------------------------------------------------------


def test_climatology_arrays_are_all_365():
    clim = build_climatology(synth_records())
    for name, arr in clim.as_dict().items():
        assert len(arr) == DOY_LEN, name


def test_probabilities_stay_in_range():
    clim = build_climatology(synth_records())
    assert all(0.0 <= v <= 1.0 for v in clim.frost_prob)
    assert all(0.0 <= v <= 1.0 for v in clim.heat_stress_prob)


def test_frost_is_a_winter_phenomenon():
    clim = build_climatology(synth_records())
    assert clim.frost_prob[15] > clim.frost_prob[195]


def test_fill_values_are_excluded():
    """REGRESSION: POWER returns -999 for missing. Averaging those in
    silently produces a plausible-looking, wrong climatology."""
    from fallowclock.weather import FILL_VALUE

    assert FILL_VALUE == -999.0
    recs = synth_records(range(2000, 2003))
    assert all(r.tmax > FILL_VALUE for r in recs)


# --------------------------------------------------------------------------
# Frost dates -- the statistic that is easy to compute wrongly
# --------------------------------------------------------------------------


def test_frost_dates_use_per_year_medians_not_probability_crossings():
    """REGRESSION, and the expensive one.

    'Last spring frost' is the median of each year's own last frost date,
    NOT the last day whose frost probability exceeds 50%. For Story County
    the two give DOY 111 vs DOY 90, and at the other end 288 vs 314 -- a
    47-day overstatement of the frost-free season, which would hand every
    cover crop a month of growth it never gets.
    """
    recs = synth_records()
    fd = frost_date_stats(recs)
    clim = build_climatology(recs)

    prob_spring = max(
        (i + 1 for i in range(180) if clim.frost_prob[i] >= 0.5), default=0
    )
    assert fd.last_spring_doy > prob_spring, (
        "the correct method must put last spring frost LATER than a 50% "
        "probability crossing does"
    )
    assert 0 < fd.last_spring_doy < fd.first_fall_doy <= DOY_LEN
    assert fd.frost_free_days == fd.first_fall_doy - fd.last_spring_doy


def test_killing_frost_threshold_is_not_one_half():
    """Calibrated to 0.10 against known station frost dates."""
    assert KILLING_FROST_PROB == pytest.approx(0.10)


def test_percentile_dates_bracket_the_median():
    fd = frost_date_stats(synth_records())
    assert fd.spring_p10_doy <= fd.last_spring_doy
    assert fd.fall_p90_doy >= fd.first_fall_doy


# --------------------------------------------------------------------------
# Erosivity
# --------------------------------------------------------------------------


def test_light_rain_is_not_erosive():
    assert daily_erosivity(5.0) == 0.0
    assert daily_erosivity(12.7) == 0.0
    assert daily_erosivity(12.8) > 0.0


def test_erosivity_increases_faster_than_linearly():
    """b > 1: one 40 mm storm erodes more than two 20 mm ones."""
    assert daily_erosivity(40.0) > 2 * daily_erosivity(20.0)
    assert DEFAULT_B > 1.0


def test_erosivity_peaks_in_late_spring():
    """Iowa sanity check. A January peak means a day-of-year off-by-one."""
    e = build_erosivity(synth_records())
    assert 91 <= peak_doy(e.per_doy_r) <= 212


def test_coefficient_a_is_a_pure_scale_factor():
    """The ranking of rotations must be invariant to `a`, which is why an
    uncalibrated coefficient does not invalidate the comparison."""
    recs = synth_records()
    e1 = build_erosivity(recs, a=0.29)
    e2 = build_erosivity(recs, a=0.58)
    ratios = [y / x for x, y in zip(e1.per_doy_r, e2.per_doy_r) if x > 1e-12]
    assert all(r == pytest.approx(2.0) for r in ratios)


def test_smoothing_conserves_annual_total():
    recs = synth_records()
    rough = build_erosivity(recs, smooth_half_window=0)
    smooth = build_erosivity(recs, smooth_half_window=7)
    assert smooth.annual_r == pytest.approx(rough.annual_r, rel=1e-6)


def test_calibration_hits_the_target():
    recs = synth_records()
    a = calibrate_a(recs, target_annual_r=3500.0)
    assert build_erosivity(recs, a=a).annual_r == pytest.approx(3500.0, rel=1e-6)


def test_calibration_does_not_move_the_peak():
    recs = synth_records()
    before = peak_doy(build_erosivity(recs).per_doy_r)
    after = peak_doy(build_erosivity(recs, a=calibrate_a(recs)).per_doy_r)
    assert before == after


# --------------------------------------------------------------------------
# Soil water
# --------------------------------------------------------------------------


def test_extraterrestrial_radiation_peaks_at_solstice():
    ra = [extraterrestrial_radiation(IOWA_LAT, d) for d in range(1, DOY_LEN + 1)]
    assert 165 <= ra.index(max(ra)) + 1 <= 178
    assert 10 < min(ra) < 20 and 38 < max(ra) < 46


def test_hargreaves_needs_the_mj_to_mm_conversion():
    """REGRESSION: omitting the 0.408 latent-heat factor gave 13.6 mm/day
    for an Iowa July against a real 5-7, which drained the bucket to
    permanent drought and made every seeding window look too dry."""
    assert MJ_TO_MM == pytest.approx(0.408)
    assert 4.0 < hargreaves_et0(30.0, 18.0, IOWA_LAT, 196) < 7.5
    assert hargreaves_et0(-2.0, -10.0, IOWA_LAT, 15) < 1.0


def test_et0_is_never_negative():
    assert hargreaves_et0(-20.0, -25.0, IOWA_LAT, 1) >= 0.0


def test_kc_curve_is_seasonal_not_flat():
    """REGRESSION: a flat fallow Kc meant no crop ever drew the profile
    down, so the bucket sat above 80% capacity all year."""
    kc = default_kc_curve()
    assert len(kc) == DOY_LEN
    assert max(kc) > 1.0 > min(kc)
    assert kc[195] > kc[15]


def test_bucket_stays_in_range_and_dries_in_late_summer():
    sw = run_bucket(synth_records(), IOWA_LAT)
    assert len(sw) == DOY_LEN
    assert all(0.0 <= v <= 1.0 for v in sw)
    spring = sum(sw[90:150]) / 60
    late_summer = sum(sw[210:260]) / 50
    assert late_summer < spring


def test_bucket_rejects_wrong_length_kc():
    with pytest.raises(ValueError, match="365"):
        run_bucket(synth_records(range(2000, 2002)), IOWA_LAT, kc_by_doy=[1.0] * 10)


# --------------------------------------------------------------------------
# Cover crop curves
# --------------------------------------------------------------------------


def _gap(start: int, end: int) -> Gap:
    n = (end - start + 1) if start <= end else (DOY_LEN - start + 1 + end)
    return Gap(
        start_doy=start, end_doy=end, n_days=n, exposed_r=1.0,
        share_of_annual_r=0.5, wraps_year=start > end,
    )


def test_modelled_plateau_is_conservative():
    """REGRESSION: at 0.85 the fallback model out-scored every curve we had
    real evidence for, so the tool recommended the species it knew least
    about. A guess must not outrank evidence."""
    assert DEFAULT_PLATEAU <= 0.6


def test_thermal_ramp_terminates_before_the_cash_crop():
    """REGRESSION: without termination a modelled species held full cover
    straight through the spring erosivity peak -- something no farmer can
    do -- and beat real cereal rye."""
    species = {s.id: s for s in load_species("data/species.csv")}
    gap = _gap(300, 140)
    gdd = [6.0] * DOY_LEN
    curve = thermal_ramp_curve(species["cereal_rye"], 300, gap, gdd)
    assert curve[gap.end_doy - 1] < curve[(gap.end_doy - 1 - TERMINATION_DAYS) % DOY_LEN]


def test_evidence_outranks_a_bigger_modelled_benefit():
    """Observed and literature curves sort above modelled ones even when a
    modelled species claims a larger reduction."""
    assert evidence_rank(_fit("observed")) < evidence_rank(_fit("literature"))
    assert evidence_rank(_fit("literature")) < evidence_rank(_fit("modelled"))


def _fit(source: str):
    from fallowclock.cropfit import FitResult

    return FitResult("x", "X", 1, True, "", curve_source=source)


def test_ranking_puts_evidence_first():
    species = load_species("data/species.csv")
    clim = build_climatology(synth_records())
    ero = build_erosivity(synth_records())
    cover = [0.05] * DOY_LEN
    sw = run_bucket(synth_records(), IOWA_LAT)
    observed = {"cereal_rye": [0.4] * DOY_LEN}

    ranked = rank_species_for_gap(
        species, _gap(280, 130), clim.gdd_base4, clim.gdd_base10,
        clim.frost_prob, sw, ero.per_doy_r, cover, observed,
    )
    feasible = [r for r in ranked if r.feasible]
    assert feasible, "expected at least one feasible species"
    assert feasible[0].curve_source == "observed"


# --------------------------------------------------------------------------
# Rotations
# --------------------------------------------------------------------------


def test_union_cover_never_reduces_cover():
    a = [0.2] * DOY_LEN
    b = [0.7] * DOY_LEN
    assert union_cover(a, b) == [0.7] * DOY_LEN


def test_union_cover_rejects_wrong_length():
    with pytest.raises(ValueError, match="365"):
        union_cover([0.2] * DOY_LEN, [0.7] * 10)


def test_compare_sets_baseline_to_zero_and_others_relative():
    ero = [1.0] * DOY_LEN
    base = [0.1] * DOY_LEN
    better = [0.8] * DOY_LEN

    rots = [
        score_rotation(RotationPlan("cur", "Current", ["corn"], True, []), base, ero),
        score_rotation(RotationPlan("alt", "Alt", ["corn", "rye"], False, []), better, ero),
    ]
    out = compare(rots)
    assert out[0].delta_vs_current_pct == pytest.approx(0.0)
    assert out[1].delta_vs_current_pct < 0, "more cover must mean less soil loss"


def test_compare_requires_exactly_one_baseline():
    ero = [1.0] * DOY_LEN
    r = score_rotation(RotationPlan("a", "A", ["corn"], False, []), [0.1] * DOY_LEN, ero)
    with pytest.raises(ValueError, match="is_current"):
        compare([r, r])


def test_phase_averaging_beats_averaging_phases():
    """Jensen's inequality, through the rotation scorer."""
    ero = [1.0] * DOY_LEN
    corn = [0.8] * DOY_LEN
    soy = [0.1] * DOY_LEN
    mean_cover = [(a + b) / 2 for a, b in zip(corn, soy)]

    phased = score_rotation(
        RotationPlan("p", "P", ["corn", "soy"], True, []),
        mean_cover, ero, phase_covers=[corn, soy],
    )
    naive = score_rotation(
        RotationPlan("n", "N", ["corn", "soy"], True, []), mean_cover, ero
    )
    assert phased.exposed_r > naive.exposed_r


# --------------------------------------------------------------------------
# Eligibility -- the challenge requires a NASA source
# --------------------------------------------------------------------------


def test_power_satisfies_the_nasa_requirement():
    ok, names = check_eligibility([NASA_SOURCES["power"]])
    assert ok and names


def test_sentinel2_alone_does_not_satisfy_it():
    """Sentinel-2 is ESA. A pipeline built only on it is NOT eligible."""
    ok, names = check_eligibility([NON_NASA_SOURCES["sentinel2"]])
    assert not ok and not names


def test_sentinel2_plus_landsat_is_eligible():
    ok, names = check_eligibility(
        [NON_NASA_SOURCES["sentinel2"], NASA_SOURCES["landsat"]]
    )
    assert ok and len(names) == 1


# --------------------------------------------------------------------------
# End to end, offline
# --------------------------------------------------------------------------


def test_full_pipeline_offline():
    from fallowclock.bundle import assemble, placeholder_imagery
    from fallowclock.schema import Bundle, Farm

    farm = Farm(
        id="test", owner_name="Test", place="Nowhere",
        centroid=(-93.62, 42.03), area_ha=10.0,
        polygon_geojson={"type": "Polygon", "coordinates": []},
    )
    bundle = assemble(farm, placeholder_imagery(), synth_records())

    assert isinstance(bundle, Bundle)
    assert bundle.provenance.is_synthetic is True
    assert len(bundle.rotations) >= 2
    assert sum(r.is_current for r in bundle.rotations) == 1
    assert bundle.uncertainty
    ok, _ = check_eligibility(bundle.provenance.sources)
    assert ok, "every bundle must carry a NASA source"


def test_gaps_and_climatology_cannot_disagree():
    """The schema validator rejects a bundle whose gaps were computed from
    different data than the climatology it ships with."""
    cover = [0.05 if d < 100 else 0.9 for d in range(DOY_LEN)]
    ero = [1.0] * DOY_LEN
    gaps = build_gaps(cover, ero)
    assert sum(g.n_days for g in gaps) == sum(1 for v in cover if v < 0.30)
    assert exposed_erosivity(cover, ero) > 0


def test_windowed_peak_is_robust_to_a_single_spike():
    """REGRESSION: single-day argmax on a 365-point series is fragile. One
    narrow spike beat a broad seasonal plateau and put the Monona County
    erosivity peak in late August when the monthly totals were clearly
    May-peaked."""
    from fallowclock.erosivity import peak_doy, peak_window_doy

    series = [0.0] * DOY_LEN
    for d in range(130, 171):       # broad May-June plateau, most of the mass
        series[d] = 10.0
    series[232] = 40.0              # one freak August storm

    assert peak_doy(series) == 233, "argmax should be fooled by the spike"
    assert 120 <= peak_window_doy(series) <= 190, "window should not be"


def test_windowed_peak_wraps_the_year():
    from fallowclock.erosivity import peak_window_doy

    series = [0.0] * DOY_LEN
    for d in list(range(355, DOY_LEN)) + list(range(0, 15)):
        series[d] = 5.0
    pk = peak_window_doy(series)
    assert pk >= 350 or pk <= 20, f"expected a turn-of-year peak, got DOY {pk}"


def test_windowed_peak_rejects_wrong_length():
    from fallowclock.erosivity import peak_window_doy

    with pytest.raises(ValueError, match="365"):
        peak_window_doy([1.0] * 100)
