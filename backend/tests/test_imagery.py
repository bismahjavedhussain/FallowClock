"""B1 imagery pipeline: offline tests (no network).

Every network call in the pipeline is a thin cached wrapper around one of
the pure functions tested here, so these cover the logic that can be wrong:
sensor scaling and masks, the wrap-aware day-of-year climatology, rotation
phases, phenology, cover-crop isolation, and the B1 -> B2 contract end to end.
"""

from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pytest

from fallowclock import imagery as im
from fallowclock import stac_client as sc
from fallowclock.bundle import assemble
from fallowclock.cdl import CropYear
from fallowclock.schema import DOY_LEN, Farm, Uncertainty
from fallowclock.weather import DailyRecord


# ---------------------------------------------------------------- helpers


EM = im.DEFAULT_ENDMEMBERS


def obs(day: date, green: float, ndvi: float | None = None, residue: float | None = None) -> im.Observation:
    """Observation with a residue FRACTION, converted to the NDTI that yields it."""
    return im.Observation(
        day=day, sensor="sentinel2", green=green,
        ndvi=ndvi if ndvi is not None else im.NDVI_SOIL + green * (im.NDVI_CANOPY - im.NDVI_SOIL),
        clear_fraction=1.0, n_pixels=100,
        ndti=None if residue is None else EM.soil + residue * (EM.residue - EM.soil),
        n_nongreen=0 if residue is None else 100,
    )


def crop_green(doy: int, greenup: int = 160, senesce: int = 255) -> float:
    rise = 1 / (1 + math.exp(-0.12 * (doy - greenup)))
    fall = 1 / (1 + math.exp(-0.12 * (doy - senesce)))
    return max(0.0, 0.9 * (rise - fall))


def synthetic_record(years=range(2017, 2024), step=5) -> list[im.Observation]:
    """Corn in odd years, soybean in even; residue high after corn harvest."""
    out = []
    for y in years:
        d = date(y, 1, 3)
        while d.year == y:
            doy = im.doy_365(d.month, d.day)
            if doy:
                corn_year = y % 2 == 1
                res = 0.8 if (doy > 290 and corn_year) or (doy < 121 and not corn_year) else 0.15
                out.append(obs(d, crop_green(doy, 155 if corn_year else 165), residue=res))
            d += timedelta(days=step)
    return out


def block(sensor: im.Sensor, red, nir, sw1, sw2, qa, shape=(4, 5), valid=255) -> np.ndarray:
    """A data-API style block from REFLECTANCES (converted back to DNs)."""
    def dn(r):
        if sensor.key == "sentinel2":
            return np.full(shape, r * 10_000 + 1000)  # baseline >= 04.00 offset
        return np.full(shape, (r + 0.2) / 2.75e-5)
    bands = [dn(red), dn(nir), dn(sw1), dn(sw2), np.full(shape, qa), np.full(shape, valid)]
    return np.stack(bands).astype(np.float64)


S2_PROPS = {"s2:processing_baseline": "05.10", "datetime": "2023-07-28T17:08:51Z"}


# ---------------------------------------------------------------- sensors


def test_s2_offset_follows_processing_baseline():
    assert im.s2_offset({"s2:processing_baseline": "05.10"}) == -1000.0
    assert im.s2_offset({"s2:processing_baseline": "04.00"}) == -1000.0
    assert im.s2_offset({"s2:processing_baseline": "02.14"}) == 0.0
    # No baseline: fall back on the 25 Jan 2022 cut-over date.
    assert im.s2_offset({"datetime": "2022-06-01T00:00:00Z"}) == -1000.0
    assert im.s2_offset({"datetime": "2019-06-01T00:00:00Z"}) == 0.0


def test_reflectance_scaling():
    assert im.to_reflectance(im.SENTINEL2, np.array([4000.0]), S2_PROPS)[0] == pytest.approx(0.30)
    assert im.to_reflectance(im.SENTINEL2, np.array([3000.0]), {"s2:processing_baseline": "03.01"})[0] == pytest.approx(0.30)
    assert im.to_reflectance(im.LANDSAT, np.array([18181.818]), {})[0] == pytest.approx(0.30, abs=1e-4)


def test_landsat_qa_mask():
    qa = np.array([21824, 21762, 22280, 23826, 21824 | (1 << 5), 21824 | (1 << 7), 22080])
    # clear, dilated cloud, cloud, shadow, snow, water, clear (medium cloud confidence only)
    assert im.clear_mask(im.LANDSAT, qa).tolist() == [True, False, False, False, False, False, True]


def test_s2_scl_mask_keeps_only_vegetation_and_soil():
    scl = np.arange(12)
    assert np.nonzero(im.clear_mask(im.SENTINEL2, scl))[0].tolist() == [4, 5]


def test_scene_observation_green_canopy():
    b = block(im.SENTINEL2, red=0.03, nir=0.45, sw1=0.20, sw2=0.10, qa=4)
    o = im.scene_observation(im.SENTINEL2, b, np.ones((4, 5), bool), S2_PROPS, date(2023, 7, 28), wet=False)
    assert o is not None
    assert o.ndvi == pytest.approx((0.45 - 0.03) / 0.48, abs=1e-3)
    assert o.green == 1.0
    assert o.ndti is None  # all pixels green: NDTI unreadable


def test_scene_observation_residue_only_when_dry():
    b = block(im.LANDSAT, red=0.10, nir=0.14, sw1=0.30, sw2=0.20, qa=21824)
    inside = np.ones((4, 5), bool)
    dry = im.scene_observation(im.LANDSAT, b, inside, {}, date(2023, 11, 1), wet=False)
    assert dry.ndti == pytest.approx(0.10 / 0.50, abs=1e-3)
    assert dry.n_nongreen == 20
    assert EM.residue_fraction(dry.ndti) == pytest.approx((0.2 - EM.soil) / (EM.residue - EM.soil), abs=1e-3)
    assert EM.residue_fraction(dry.ndti, -0.02) > EM.residue_fraction(dry.ndti) > EM.residue_fraction(dry.ndti, 0.02)
    for wet in (True, None):  # wet soil AND unknown rain both withhold it
        assert im.scene_observation(im.LANDSAT, b, inside, {}, date(2023, 11, 1), wet=wet).ndti is None


def test_endmembers_from_samples():
    rng = np.random.default_rng(0)
    soil = rng.normal(0.06, 0.02, 200)
    residue = rng.normal(0.18, 0.02, 200)
    em = im.endmembers_from_samples(soil, residue, n_fields=50)
    assert em.source == "regional" and em.n_fields == 50
    assert em.soil == pytest.approx(np.percentile(soil, 5), abs=1e-4)
    assert em.residue == pytest.approx(np.percentile(residue, 95), abs=1e-4)
    assert im.endmembers_from_samples(soil[:10], residue, 5) is im.DEFAULT_ENDMEMBERS   # too few
    flat = np.full(200, 0.10)
    assert im.endmembers_from_samples(flat, flat + 0.03, 5) is im.DEFAULT_ENDMEMBERS    # no separation
    assert "95th percentiles" in em.describe() and "defaults" in im.DEFAULT_ENDMEMBERS.describe()


def test_scene_observation_rejects_cloudy_field_and_ignores_outside_pixels():
    b = block(im.SENTINEL2, red=0.05, nir=0.30, sw1=0.2, sw2=0.15, qa=4)
    b[4, :3, :] = 9  # cloud over 3 of 4 rows
    assert im.scene_observation(im.SENTINEL2, b, np.ones((4, 5), bool), S2_PROPS, date(2023, 5, 1), False) is None
    inside = np.zeros((4, 5), bool)
    inside[3, :] = True  # only the clear row is in the field
    assert im.scene_observation(im.SENTINEL2, b, inside, S2_PROPS, date(2023, 5, 1), False) is not None


def test_rain_gate():
    recs = [DailyRecord(2023, d, 20, 5, 0.0) for d in range(1, 366)]
    recs[99] = DailyRecord(2023, 100, 20, 5, 4.0)  # 4 mm on DOY 100
    gate = im.RainGate(recs)
    assert gate.is_wet(date(2023, 4, 11)) is True   # DOY 101: rain the day before
    assert gate.is_wet(date(2023, 4, 12)) is True   # two days after
    assert gate.is_wet(date(2023, 4, 13)) is False
    assert gate.is_wet(date(2025, 4, 13)) is None   # no record: unknown, not dry


# ---------------------------------------------------------------- climatology


def test_window_wraps_the_year():
    med, _, _, n = im.window_stats([360], [0.5])
    assert n[2] == 1 and med[2] == 0.5      # DOY 3 is 8 days after DOY 360
    assert n[3] == 0                         # DOY 4 is 9 days away


def test_fill_circular_interpolates_through_new_year():
    v = np.full(DOY_LEN, np.nan)
    v[349], v[14] = 0.2, 0.4                 # DOY 350 and DOY 15
    filled = im.fill_circular(v)
    assert filled[364] == pytest.approx(0.2 + 0.2 * 15 / 30)
    with pytest.raises(ValueError):
        im.fill_circular(np.full(DOY_LEN, np.nan))


def test_cover_climatology_shape_and_order():
    clim = im.build_cover_climatology(synthetic_record())
    for arr in (clim.green, clim.green_p25, clim.green_p75, clim.residue, clim.n_obs):
        assert len(arr) == DOY_LEN
    assert all(lo <= g <= hi for lo, g, hi in zip(clim.green_p25, clim.green, clim.green_p75))
    assert all(0.0 <= v <= 1.0 for v in clim.soil)
    assert max(clim.green) > 0.7 and min(clim.green) < 0.05
    assert 120 <= clim.bare_days <= 260
    no_res = im.build_cover_climatology([obs(date(2020, 6, 1), 0.5)])
    assert no_res.residue == [0.0] * DOY_LEN  # no reading -> no invented residue


def test_phase_split_and_phase_climatologies():
    assert im.season_year(date(2021, 3, 1)) == 2020
    assert im.season_year(date(2021, 5, 1)) == 2021
    crops = {y: CropYear(y, 1 if y % 2 else 5, "Corn" if y % 2 else "Soybeans", 1.0, 5, "test")
             for y in range(2016, 2024)}
    phases = im.build_phase_climatologies(synthetic_record(), crops)
    assert set(phases) == {"corn", "soybean"}
    # After corn harvest (Nov) the corn phase carries corn stover; soy does not.
    assert phases["corn"].residue[320] > phases["soybean"].residue[320]


def test_season_phenology_finds_onset_and_end():
    year = [o for o in synthetic_record(range(2019, 2020), step=3)]
    onset, end = im.season_phenology(year)
    assert 120 <= onset <= 160
    assert 255 <= end <= 300
    assert im.season_phenology(year[:5]) == (None, None)


def test_winter_cover_flags():
    spring = [obs(date(2021, 4, d), 0.5, ndvi=0.55) for d in (1, 10, 20)]
    bare = [obs(date(2021, 4, d), 0.05, ndvi=0.18) for d in (1, 10, 20)]
    assert im.winter_cover(spring, 2020) is True
    assert im.winter_cover(bare, 2020) is False
    assert im.winter_cover(spring[:1], 2020) is None


def test_isolate_cover_season_zeroes_the_cash_crop():
    doys = np.arange(1, DOY_LEN + 1)
    rye = np.where(doys < 135, 0.3 + 0.4 * np.clip((doys - 60) / 60, 0, 1), 0)
    rye = np.where((doys >= 120) & (doys < 145), np.maximum(0.7 - 0.06 * (doys - 120), 0.05), rye)
    cash = np.array([crop_green(d, 170, 255) for d in doys])
    fall = np.where(doys > 285, 0.05 + 0.004 * (doys - 285), 0)
    curve = np.maximum.reduce([rye, cash, fall])
    out, start, term, peak = im.isolate_cover_season(curve)
    assert 270 <= start <= 300 and 120 <= term <= 160 and 100 <= peak <= 135
    assert all(v == 0 for v in out[term:start - 1])           # summer is the cash crop's
    assert im.COVER_PEAK_WINDOW[0] <= peak <= im.COVER_PEAK_WINDOW[1]
    assert out[0] > 0 and out[DOY_LEN - 1] > 0                  # winter wraps the year
    assert im.isolate_cover_season(np.zeros(DOY_LEN)) is None


# ---------------------------------------------------------------- scenes


def test_list_scenes_dedupes_and_filters(monkeypatch):
    big = sc.bbox_polygon((-94, 41, -93, 43))
    small = sc.bbox_polygon((-93.58, 42.0, -93.5, 42.1))  # misses the field's west edge
    feats = [
        {"id": "old", "geometry": big, "properties": {"platform": "Sentinel-2A", "datetime": "2023-07-28T17:00:00Z", "s2:processing_baseline": "05.09", "eo:cloud_cover": 1}},
        {"id": "new", "geometry": big, "properties": {"platform": "Sentinel-2A", "datetime": "2023-07-28T17:00:00Z", "s2:processing_baseline": "05.10", "eo:cloud_cover": 1}},
        {"id": "edge", "geometry": small, "properties": {"platform": "Sentinel-2A", "datetime": "2023-07-28T17:00:00Z", "s2:processing_baseline": "06.00", "eo:cloud_cover": 0}},
        {"id": "l7", "geometry": big, "properties": {"platform": "landsat-7", "datetime": "2023-07-28T17:00:00Z", "eo:cloud_cover": 0}},
    ]
    monkeypatch.setattr(im, "search", lambda *a, **k: feats)
    field = sc.bbox_polygon((-93.6, 42.0, -93.55, 42.05))
    scenes = im.list_scenes(im.SENTINEL2, field, "2023-01-01", "2023-12-31")
    assert [s.item_id for s in scenes] == ["new"]  # containment beats a newer baseline
    ls = [{"id": "t2", "geometry": big, "properties": {"platform": "landsat-8", "datetime": "2023-07-20T17:00:00Z", "landsat:collection_category": "T2"}}]
    monkeypatch.setattr(im, "search", lambda *a, **k: ls)
    assert im.list_scenes(im.LANDSAT, field, "2023-01-01", "2023-12-31") == []


# ---------------------------------------------------------------- geometry


def test_geometry_helpers():
    ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
    poly = {"type": "Polygon", "coordinates": [ring, hole]}
    inside = sc.points_in_geometry(np.array([1, 5, 11]), np.array([1, 5, 5]), poly)
    assert inside.tolist() == [True, False, False]
    lon, lat = sc.pixel_centres((0, 0, 4, 2), 4, 2)
    assert lat[0, 0] > lat[1, 0]  # row 0 is north
    assert sc.footprint_contains(sc.bbox_polygon((0, 0, 10, 10)), (1, 1, 2, 2))
    assert not sc.footprint_contains(sc.bbox_polygon((0, 0, 10, 10)), (9, 9, 11, 11))
    w, h = sc.grid_shape(sc.bbox_around(-93.6, 42.0, 1.0), 20.0)
    assert (w, h) == (100, 100)


# ---------------------------------------------------------------- contract


def _imagery_from_synthetic() -> im.ImageryInputs:
    record = synthetic_record()
    clim = im.build_cover_climatology(record)
    crops = {y: CropYear(y, 1 if y % 2 else 5, "Corn" if y % 2 else "Soybeans", 1.0, 5, "test")
             for y in range(2016, 2024)}
    phases = im.build_phase_climatologies(record, crops)
    years = [im.ObservedYear(year=y, cdl_crop=crops[y].name, cdl_code=crops[y].code) for y in range(2017, 2024)]
    return im.ImageryInputs(
        green_cover=clim.green, green_cover_p25=clim.green_p25, green_cover_p75=clim.green_p75,
        residue_cover=clim.residue, n_obs_per_doy=clim.n_obs, observed_years=years,
        crop_curves={"corn": im._crop_curve(record, crops, 1, "corn")},
        sources=[im.nasa_source("landsat", n_obs=10)], inferred_label="Corn-Soybean, no cover crop",
        phase_covers=[p.soil for p in phases.values()],
    )


def test_imagery_inputs_round_trip(tmp_path):
    imagery = _imagery_from_synthetic()
    path = tmp_path / "farm.json"
    im.save_imagery(path, imagery, {"bare_days": 1})
    back, rep = im.load_imagery(path)
    assert im.imagery_to_dict(back) == im.imagery_to_dict(imagery)
    assert rep == {"bare_days": 1}


def test_handoff_assembles_into_a_valid_real_bundle():
    """B2's own assemble() accepts what B1 produces, and the bundle is real."""
    records = []
    for y in range(2018, 2021):
        for d in range(1, DOY_LEN + 1):
            t = 12 + 16 * math.sin(2 * math.pi * (d - 110) / 365)
            records.append(DailyRecord(y, d, t + 6, t - 6, 30.0 if d % 7 == 0 else 0.0))
    farm = Farm(id="t", owner_name="test", place="Test", centroid=(-93.56, 42.05), area_ha=39.3,
                polygon_geojson=sc.bbox_polygon((-93.57, 42.04, -93.56, 42.05)))
    bundle = assemble(farm, _imagery_from_synthetic(), records, calibrate_erosivity=False)
    assert bundle.provenance.is_synthetic is False
    assert all(g <= s + 1e-9 for g, s in zip(bundle.climatology.green_cover, bundle.climatology.soil_cover))
    rep = {"bare_days": 180, "bare_days_more_residue": 170, "bare_days_less_residue": 190, "detection": None,
           "endmembers": {"source": "regional", "text": "test"}}
    for note in im.uncertainty_notes(rep):
        Uncertainty(**note)


def test_field_season_curves_median_weights_each_field_once():
    """One dense early-drilled stand must not define winter for the typical rye."""
    def season(level_winter, level_spring, fid):
        out = []
        for doy in list(range(300, 366, 6)) + list(range(60, 170, 6)):
            d = date(2021, 1, 1) + timedelta(days=doy - 1)
            g = level_spring if 90 <= doy <= 140 else (0.1 if 150 < doy < 290 else level_winter)
            out.append(obs(d, g))
        return (fid, 2021), out
    per = dict([season(0.2, 0.45, 1), season(0.25, 0.5, 2), season(0.85, 0.9, 3)])
    per[(4, 2021)] = per[(1, 2021)][:3]  # too few observations: dropped
    curves = im.field_season_curves(per)
    assert set(curves) == {(1, 2021), (2, 2021), (3, 2021)}
    med = np.median(np.vstack(list(curves.values())), axis=0)
    assert 0.2 <= med[10] <= 0.25            # January follows the typical fields
    assert 0.45 <= med[110] <= 0.5


def test_classify_tillage_nrcs_classes():
    assert im.classify_tillage([0.4] * 12)["label"] == "conservation tillage"
    assert im.classify_tillage([0.2] * 12)["label"] == "reduced tillage"
    assert im.classify_tillage([0.05] * 12)["label"] == "conventional tillage"
    assert im.classify_tillage([0.4] * 5) is None
