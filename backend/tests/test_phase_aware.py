"""Phase-aware bare days, gaps, and the seeding-window fixes.

These cover the three things B1 handed back on integration day:
  * the farms must be the real fields, not the original rectangles
  * build_bundle must use B1's frozen imagery, not the placeholder
  * Jensen applies to bare days and gaps, not only to erosivity
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from fallowclock.bundle import placeholder_imagery
from fallowclock.cropfit import (
    PRE_GAP_SEEDING_DAYS,
    WINTER_HARDY_PRE_GAP_DAYS,
    candidate_seed_doys,
    load_species,
)
from fallowclock.gaps import (
    DOY_LEN,
    bare_days,
    build_gaps,
    phase_averaged_bare_days,
    phase_bare_days,
    phase_union_bare_runs,
)
from fallowclock.schema import BARE_THRESHOLD, Gap

DATA = Path(__file__).resolve().parents[1] / "data"
IMAGERY = DATA / "imagery"


# --------------------------------------------------------------------------
# The fields themselves
# --------------------------------------------------------------------------


def test_farms_match_b1_field_coordinates():
    """B1's build_imagery.FIELDS overlays build_bundle.FARMS. The two carry
    the same geometry now; if either drifts, the bundles and the imagery
    stop describing the same patch of ground, silently."""
    from scripts.build_bundle import FARMS
    from scripts.build_imagery import FIELDS

    assert set(FIELDS) <= set(FARMS)
    for fid, field in FIELDS.items():
        farm = FARMS[fid]
        assert tuple(farm.centroid) == tuple(field["centroid"]), fid
        assert farm.area_ha == pytest.approx(field["area_ha"]), fid
        assert farm.polygon_geojson == field["polygon_geojson"], fid


def test_farms_are_not_the_original_rectangles():
    """The first pair of rectangles sat on the town of Ames and on a wood.
    Guard against a revert."""
    from scripts.build_bundle import FARMS

    assert tuple(FARMS["story-county-ia"].centroid) != (-93.62, 42.03)
    assert tuple(FARMS["monona-county-ia"].centroid) != (-95.95, 42.05)


# --------------------------------------------------------------------------
# Jensen, for a step function this time
# --------------------------------------------------------------------------


def test_phase_averaged_bare_days_is_the_mean_of_the_counts():
    a = [0.0] * DOY_LEN  # bare all year
    b = [1.0] * DOY_LEN  # covered all year
    assert phase_bare_days([a, b]) == [DOY_LEN, 0]
    assert phase_averaged_bare_days([a, b]) == DOY_LEN / 2


def test_mean_cover_can_erase_a_real_gap():
    """The Monona case, reduced to its bones. One phase is bare, the other
    is comfortably covered, and the mean clears the threshold -- so the
    field reads as never bare although it is bare every other year."""
    bare_phase = [1.0] * DOY_LEN
    covered_phase = [1.0] * DOY_LEN
    for i in range(100, 114):
        bare_phase[i] = 0.0  # 14 bare days
        covered_phase[i] = 0.8  # mean = 0.4, above the 0.30 threshold

    mean_cover = [(x + y) / 2 for x, y in zip(bare_phase, covered_phase)]
    assert bare_days(mean_cover) == 0  # the gap vanishes
    assert phase_bare_days([bare_phase, covered_phase]) == [14, 0]
    assert phase_averaged_bare_days([bare_phase, covered_phase]) == 7.0


def test_phase_union_finds_runs_the_mean_misses():
    bare_phase = [1.0] * DOY_LEN
    covered_phase = [1.0] * DOY_LEN
    for i in range(100, 114):
        bare_phase[i], covered_phase[i] = 0.0, 0.8

    assert phase_union_bare_runs([bare_phase, covered_phase]) == [(100, 113)]


def test_phase_union_is_wrap_aware():
    p1 = [1.0] * DOY_LEN
    p2 = [1.0] * DOY_LEN
    for i in list(range(360, DOY_LEN)) + list(range(0, 5)):
        p1[i] = 0.0
    runs = phase_union_bare_runs([p1, p2])
    assert len(runs) == 1
    start, end = runs[0]
    assert start > end, "a gap through 31 Dec must come back as a wrap"


def test_build_gaps_with_phases_recovers_the_hidden_gap():
    bare_phase = [1.0] * DOY_LEN
    covered_phase = [1.0] * DOY_LEN
    for i in range(100, 114):
        bare_phase[i], covered_phase[i] = 0.0, 0.8
    mean_cover = [(x + y) / 2 for x, y in zip(bare_phase, covered_phase)]
    ero = [1.0] * DOY_LEN

    assert build_gaps(mean_cover, ero) == []
    gaps = build_gaps(mean_cover, ero, phase_covers=[bare_phase, covered_phase])
    assert [g.n_days for g in gaps] == [14]


def test_build_gaps_without_phases_is_unchanged():
    cover = [1.0] * DOY_LEN
    for i in range(10, 20):
        cover[i] = 0.0
    ero = [1.0] * DOY_LEN
    assert [g.n_days for g in build_gaps(cover, ero)] == [10]


def test_phase_helpers_reject_bad_input():
    with pytest.raises(ValueError):
        phase_bare_days([[0.0] * 364])
    with pytest.raises(ValueError):
        phase_union_bare_runs([])


# --------------------------------------------------------------------------
# Seeding windows
# --------------------------------------------------------------------------


def _gap(start: int, end: int) -> Gap:
    n = end - start + 1 if start <= end else DOY_LEN - start + end + 1
    return Gap(
        start_doy=start,
        end_doy=end,
        n_days=n,
        exposed_r=1.0,
        share_of_annual_r=0.1,
        wraps_year=start > end,
    )


def test_winter_hardy_species_reach_a_spring_gap():
    """Cereal rye is seeded in autumn to protect the next spring. With a
    flat 60-day lead its window (DOY 227-319) misses a spring gap entirely
    and the most important cover crop in the Midwest reads infeasible."""
    species = {s.id: s for s in load_species(DATA / "species.csv")}
    spring = _gap(83, 165)

    rye = species["cereal_rye"]
    assert rye.winter_hardy
    assert candidate_seed_doys(rye, spring, pre_gap_days=PRE_GAP_SEEDING_DAYS)

    oats = species["oats"]
    assert not oats.winter_hardy
    assert candidate_seed_doys(oats, spring) == []


def test_long_lead_does_not_wrap_past_itself():
    """lead + gap must stay under a year. Uncapped, a 300-day lead on a
    216-day gap produced a 151-day seeding period that was the COMPLEMENT
    of the intended one and excluded rye's whole autumn window."""
    species = {s.id: s for s in load_species(DATA / "species.csv")}
    rye = species["cereal_rye"]
    wrap_gap = _gap(280, 130)  # 216 days, through 31 Dec

    doys = candidate_seed_doys(rye, wrap_gap)
    assert doys, "rye must be seedable in a gap that spans its own window"
    lo, hi = rye.seeding_window
    assert all(lo <= d <= hi for d in doys)
    assert WINTER_HARDY_PRE_GAP_DAYS > DOY_LEN - wrap_gap.n_days


def test_nothing_is_seeded_into_a_standing_crop():
    """earliest_seed_doy is the observed harvest. Before this was plumbed
    through, rye was seeded on DOY 227 -- six weeks before Story County's
    observed DOY 272 harvest -- and credited a full autumn of growth."""
    species = {s.id: s for s in load_species(DATA / "species.csv")}
    spring = _gap(83, 165)
    harvest = 272

    for sp in species.values():
        for d in candidate_seed_doys(sp, spring, earliest_seed_doy=harvest):
            in_autumn = harvest <= d <= DOY_LEN
            in_next_year = d <= spring.end_doy
            assert in_autumn or in_next_year, f"{sp.id} seeded DOY {d}"


# --------------------------------------------------------------------------
# The handoff
# --------------------------------------------------------------------------


@pytest.mark.parametrize("fid", ["story-county-ia", "monona-county-ia"])
def test_frozen_imagery_loads_and_is_real(fid):
    from fallowclock.imagery import load_imagery

    imagery, report = load_imagery(IMAGERY / f"{fid}.json")
    imagery.validate()
    assert not imagery.is_synthetic
    assert imagery.phase_covers and len(imagery.phase_covers) == 2
    assert report["phases"]


@pytest.mark.parametrize("fid", ["story-county-ia", "monona-county-ia"])
def test_imagery_for_attaches_phase_labels(fid):
    from scripts.build_bundle import imagery_for

    imagery, report = imagery_for(fid)
    assert imagery is not None, "build_bundle must use B1's frozen imagery"
    assert imagery.phase_labels == list(report["phases"])
    assert set(imagery.phase_labels) == {"corn", "soybean"}


def test_mismatched_phase_labels_are_rejected():
    im = placeholder_imagery()
    im.phase_labels = ["corn"]  # two phase_covers, one label
    with pytest.raises(ValueError, match="phase_labels"):
        im.validate()


@pytest.mark.parametrize("fid", ["story-county-ia", "monona-county-ia"])
def test_shipped_bundle_carries_the_phase_split(fid):
    path = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "public"
        / "bundles"
        / f"farm_{fid}.json"
    )
    bundle = json.loads(path.read_text(encoding="utf-8"))

    assert bundle["provenance"]["is_synthetic"] is False
    labels = bundle["observed_rotation"]["phase_labels"]
    phase_covers = bundle["climatology"]["phase_covers"]
    assert labels and phase_covers and len(labels) == len(phase_covers)

    current = next(r for r in bundle["rotations"] if r["is_current"])
    by_phase = current["bare_days_by_phase"]
    assert by_phase and len(by_phase) == len(labels)
    assert current["bare_days"] == round(sum(by_phase) / len(by_phase))

    # gaps[] must describe the union of the phases, not the mean curve.
    worst = [min(vals) for vals in zip(*phase_covers)]
    union_bare = sum(1 for v in worst if v < BARE_THRESHOLD)
    assert abs(sum(g["n_days"] for g in bundle["gaps"]) - union_bare) <= 2
