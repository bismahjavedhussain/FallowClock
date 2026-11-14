"""Satellite cover pipeline: Sentinel-2 + Landsat 8/9 -> ImageryInputs.  B1 owns this file.

bundle.ImageryInputs is the B1 -> B2 handoff. This module fills it from real
observations, never from a model:

    field polygon
      -> every Sentinel-2 L2A and Landsat 8/9 C2 L2 scene (Planetary Computer)
      -> per scene: cloud / shadow / snow / water mask, NDVI, NDTI
      -> per scene: ONE field observation (green cover, mean NDTI of bare pixels)
      -> NDTI -> residue cover with endmembers CALIBRATED ON THE REGION
      -> per day of year, +-8 days, wrap-aware: median + IQR across years
      -> per rotation phase (CDL corn vs soybean years): the same, separately
      -> neighbouring corn/soy fields that are green before planting
         -> the observed cover-crop curve (cropfit uses it as "observed")

WHERE EVERY NUMBER COMES FROM
-----------------------------
green cover   Linear scaling of NDVI between bare soil and closed canopy
              (Gutman & Ignatov 1998, Int. J. Remote Sens. 19:1533).
residue cover NDTI = (SWIR1-SWIR2)/(SWIR1+SWIR2) (van Deventer et al. 1997,
              PE&RS 63:87), scaled linearly between a bare-soil and a
              full-residue endmember. NDTI needs LOCAL calibration (Zheng et
              al. 2014, Soil Till. Res. 138:26): bare loess in the Loess
              Hills reads ~0.06 higher than bare glacial till in Story
              County, enough to turn a bare winter into a "covered" one. So
              the endmembers are measured, per farm, on the surrounding
              fields: bare soil = 5th percentile of NDTI across nearby
              corn/soy fields just after planting (the conventionally tilled
              ones are truly bare), full residue = 95th percentile just after
              harvest. The bundle prints how many bare days move if both
              shift by +-0.02.
masking       README rules: residue only from pixels with NDVI <= 0.30, and
              only on dates with <= 3 mm rain over the prior two days. The
              rain is NASA POWER -- the same record that drives the erosivity
              layer, so one NASA rain series both sets the risk and gates
              the evidence.
bare          soil_cover < 0.30 is computed by B2 from what we hand over
              (schema.BARE_THRESHOLD, the NRCS conservation-tillage line).

SENSOR GOTCHAS HANDLED HERE
---------------------------
* Sentinel-2 processing baseline >= 04.00 (Jan 2022 on, and the 2024
  reprocessing of older years) stores reflectance + 1000. Skipping the
  offset turns a 0.82 NDVI into 0.51.
* Landsat C2 L2 surface reflectance = DN * 2.75e-5 - 0.2.
* Sentinel-2 NIR is B8A (865 nm, 20 m), not B08: it matches Landsat OLI
  band 5, so the two sensors' NDVI agree without a bandpass fudge.
* Planetary Computer lists the same acquisition more than once (two MGRS
  tiles, two processing baselines). One observation per platform per day.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from .bundle import ImageryInputs
from .cdl import (
    CORN,
    ROW_CROPS,
    SOYBEANS,
    CropYear,
    cdl_grid,
    erode_labels,
    field_crop_history,
    infer_rotation_label,
    majority_filter3,
    segment_fields,
    to_rotation_classes,
)
from .schema import BARE_THRESHOLD, DOY_LEN, CropCurve, ObservedYear, Source
from .sources import NON_NASA_SOURCES, nasa_source
from .stac_client import (
    Bbox,
    bbox_around,
    bbox_of,
    bbox_polygon,
    footprint_contains,
    geometry_mask,
    grid_shape,
    parallel_map,
    pixel_area_m2,
    pixel_centres,
    read_block,
    search,
)
from .weather import DailyRecord, doy_365

# --------------------------------------------------------------------------
# Constants -- each one is a claim; see the module docstring for sources
# --------------------------------------------------------------------------

NDVI_SOIL = 0.15        # bare Corn Belt soil, 20-30 m surface reflectance
NDVI_CANOPY = 0.85      # closed crop canopy

#: Fallback NDTI endmembers (glacial-till soils, central Iowa), used only
#: when the regional calibration has too few samples.
NDTI_SOIL = 0.02
NDTI_RESIDUE = 0.21
NDTI_SENSITIVITY = 0.02      # endmember shift used for the bare-day sensitivity
MIN_ENDMEMBER_SPREAD = 0.06  # below this the calibration is noise; fall back

GREEN_PIXEL_NDVI = 0.30  # README: NDTI is unreadable under green canopy
WET_RAIN_MM = 3.0        # README: wet soil depresses NDTI
WET_LOOKBACK_DAYS = 2

MIN_CLEAR_FRACTION = 0.70     # of field pixels clear, or the scene is skipped
MIN_NONGREEN_FRACTION = 0.50  # of clear pixels non-green, or no residue reading
HALF_WINDOW = 8               # schema: n_obs_per_doy counts a +-8 day window
PHASE_SPLIT_DOY = 121         # 1 May: before it, the field shows LAST year's crop
MIN_PHASE_OBS = 60            # a phase needs this many observations to be a curve

#: Cover-crop detection. 21 Mar - 5 May is after snowmelt and before any
#: Iowa cash crop has emerged, so a corn/soy field that is green then is
#: carrying a winter-hardy cover -- in Iowa overwhelmingly cereal rye.
SPRING_WINDOW = (80, 125)
SPRING_NDVI = 0.35
SPRING_MIN_OBS = 2
#: Where the cover crop's spring flush can peak: 1 Apr - 30 May.
COVER_PEAK_WINDOW = (91, 150)

#: Regional NDTI calibration windows (month-day), Sentinel-2 only.
SOIL_WINDOW = ("05-01", "06-30")      # post-planting, pre-canopy
RESIDUE_WINDOW = ("10-01", "11-30")   # post-harvest, fresh residue
CALIBRATION_SEASONS = (2019, 2020, 2021)
CALIBRATION_RES_M = 60.0
MIN_CALIBRATION_SAMPLES = 40

#: Phenology (green-up onset / senescence end), TIMESAT-style amplitude
#: thresholds on the field's own smoothed green-cover curve.
PHENO_FRACTION = 0.15
MIN_SEASON_AMPLITUDE = 0.30

DETECT_RADIUS_KM = 6.0
DETECT_SEASONS = (2018, 2019, 2020, 2021)  # springs; CDL for S-1 and S on PC
DETECT_MIN_FIELD_HA = 8.0
DETECT_MIN_FIELD_SEASONS = 3

START = "2017-01-01"
END = "2026-06-30"  # includes spring 2026 so the 2025 winter has a verdict


# --------------------------------------------------------------------------
# Sensors and per-pixel physics (pure)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Sensor:
    key: str
    collection: str
    bands: tuple[str, str, str, str, str]  # red, nir, swir1, swir2, qa
    res_m: float
    platforms: tuple[str, ...]


SENTINEL2 = Sensor(
    "sentinel2", "sentinel-2-l2a", ("B04", "B8A", "B11", "B12", "SCL"), 20.0,
    ("Sentinel-2A", "Sentinel-2B", "Sentinel-2C"),
)
LANDSAT = Sensor(
    "landsat", "landsat-c2-l2", ("red", "nir08", "swir16", "swir22", "qa_pixel"), 30.0,
    ("landsat-8", "landsat-9"),
)

#: Sen2Cor scene classes kept: 4 vegetation, 5 not-vegetated (soil, residue).
#: Dropped: no data, saturated, dark/shadow, cloud shadow, water,
#: unclassified, clouds, cirrus, snow.
S2_CLEAR_SCL = (4, 5)

#: Landsat C2 QA_PIXEL bits that disqualify a pixel: fill, dilated cloud,
#: cirrus, cloud, cloud shadow, snow, water. Bit 6 (clear) must be set.
LANDSAT_BAD_BITS = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 7)
LANDSAT_CLEAR_BIT = 1 << 6


def s2_offset(props: dict) -> float:
    """DN offset for a Sentinel-2 L2A item: -1000 from baseline 04.00 on."""
    try:
        return -1000.0 if float(props.get("s2:processing_baseline")) >= 4.0 else 0.0
    except (TypeError, ValueError):
        return -1000.0 if str(props.get("datetime", ""))[:10] >= "2022-01-25" else 0.0


def to_reflectance(sensor: Sensor, dn: np.ndarray, props: dict) -> np.ndarray:
    dn = dn.astype(np.float64)
    if sensor.key == "sentinel2":
        return (dn + s2_offset(props)) / 10_000.0
    return dn * 2.75e-5 - 0.2


def clear_mask(sensor: Sensor, qa: np.ndarray) -> np.ndarray:
    if sensor.key == "sentinel2":
        return np.isin(qa, S2_CLEAR_SCL)
    q = qa.astype(np.uint32)
    return ((q & LANDSAT_BAD_BITS) == 0) & ((q & LANDSAT_CLEAR_BIT) != 0)


def normalized_difference(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        return (a - b) / (a + b)


def green_fraction(ndvi: np.ndarray) -> np.ndarray:
    return np.clip((ndvi - NDVI_SOIL) / (NDVI_CANOPY - NDVI_SOIL), 0.0, 1.0)


@dataclass(frozen=True)
class Endmembers:
    """NDTI of bare soil and of a full residue mat, for one soil region."""

    soil: float
    residue: float
    source: str = "default"  # "regional" | "default"
    n_soil: int = 0
    n_residue: int = 0
    n_fields: int = 0

    def residue_fraction(self, ndti: float, shift: float = 0.0) -> float:
        lo, hi = self.soil + shift, self.residue + shift
        return float(np.clip((ndti - lo) / (hi - lo), 0.0, 1.0))

    def describe(self) -> str:
        if self.source == "regional":
            return (f"bare soil {self.soil:.3f} / full residue {self.residue:.3f}, the 5th and 95th "
                    f"percentiles of mean NDTI over {self.n_fields} nearby corn/soybean fields "
                    f"({self.n_soil} post-planting and {self.n_residue} post-harvest field-scenes, "
                    f"dry dates, non-green pixels)")
        return f"bare soil {self.soil:.3f} / full residue {self.residue:.3f} (central-Iowa defaults, not calibrated here)"


DEFAULT_ENDMEMBERS = Endmembers(NDTI_SOIL, NDTI_RESIDUE)


def endmembers_from_samples(soil_ndti, residue_ndti, n_fields: int = 0) -> Endmembers:
    """Regional endmembers from field-scene NDTI samples, or the defaults
    when there are too few samples or they do not separate."""
    soil_ndti, residue_ndti = np.asarray(soil_ndti, float), np.asarray(residue_ndti, float)
    if soil_ndti.size < MIN_CALIBRATION_SAMPLES or residue_ndti.size < MIN_CALIBRATION_SAMPLES:
        return DEFAULT_ENDMEMBERS
    soil, residue = float(np.percentile(soil_ndti, 5)), float(np.percentile(residue_ndti, 95))
    if residue - soil < MIN_ENDMEMBER_SPREAD:
        return DEFAULT_ENDMEMBERS
    return Endmembers(round(soil, 4), round(residue, 4), "regional", int(soil_ndti.size), int(residue_ndti.size), n_fields)


@dataclass(frozen=True)
class Observation:
    """One scene's verdict on one field. Residue is DERIVED later from
    `ndti` with the regional endmembers, so recalibration needs no refetch."""

    day: date
    sensor: str
    green: float
    ndvi: float
    clear_fraction: float
    n_pixels: int
    ndti: float | None = None   # mean NDTI of dry, non-green pixels; None = no reading
    n_nongreen: int = 0

    @property
    def doy(self) -> int | None:
        return doy_365(self.day.month, self.day.day)


def scene_observation(
    sensor: Sensor,
    block: np.ndarray,
    inside: np.ndarray,
    props: dict,
    day: date,
    wet: bool | None,
) -> Observation | None:
    """Reduce one scene block to one field observation, or None if the field
    was not clear enough. `wet=False` is the ONLY state that allows a residue
    reading: wet soil and unknown rain both withhold it."""
    red, nir, sw1, sw2 = (to_reflectance(sensor, block[i], props) for i in range(4))
    ok = inside & (block[5] > 0) & clear_mask(sensor, block[4])
    for band in (red, nir, sw1, sw2):
        ok &= (band > 0.0) & (band <= 1.0)
    n_inside = int(inside.sum())
    if n_inside == 0:
        return None
    clear_fraction = float(ok.sum()) / n_inside
    if clear_fraction < MIN_CLEAR_FRACTION:
        return None

    ndvi = normalized_difference(nir, red)
    v = ndvi[ok]
    ndti_mean, n_nongreen = None, 0
    if wet is False:
        non_green = ok & (ndvi <= GREEN_PIXEL_NDVI)
        if non_green.sum() >= MIN_NONGREEN_FRACTION * ok.sum():
            ndti_mean = round(float(normalized_difference(sw1, sw2)[non_green].mean()), 4)
            n_nongreen = int(non_green.sum())
    return Observation(
        day=day, sensor=sensor.key,
        green=round(float(green_fraction(v).mean()), 4),
        ndvi=round(float(np.median(v)), 4),
        clear_fraction=round(clear_fraction, 3),
        n_pixels=int(ok.sum()),
        ndti=ndti_mean, n_nongreen=n_nongreen,
    )


class RainGate:
    """NASA POWER daily rain -> was the soil wet at overpass?

    True/False when both prior days are on record, None when not -- and
    None withholds the residue reading exactly like True does."""

    def __init__(self, records: list[DailyRecord]):
        self._mm = {(r.year, r.doy): r.precip_mm for r in records}

    def is_wet(self, day: date) -> bool | None:
        total = 0.0
        for k in range(1, WET_LOOKBACK_DAYS + 1):
            d = day - timedelta(days=k)
            doy = doy_365(d.month, d.day)
            if doy is None:  # 29 Feb is not in the POWER records (dropped)
                continue
            mm = self._mm.get((d.year, doy))
            if mm is None:
                return None
            total += mm
        return total > WET_RAIN_MM


# --------------------------------------------------------------------------
# Scenes and observations (network, cached)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Scene:
    sensor: Sensor
    item_id: str
    day: date
    platform: str
    props: dict = field(compare=False, hash=False)
    footprint: dict | None = field(default=None, compare=False, hash=False)


def list_scenes(
    sensor: Sensor,
    geometry: dict,
    start: str,
    end: str,
    *,
    max_cloud: float = 70.0,
    per_tile: bool = False,
) -> list[Scene]:
    """Every usable scene, one per platform per day (or per tile per day
    when `per_tile`, for regions that straddle a tile edge).

    Among duplicates prefer a footprint that contains the whole area, then
    the newest processing baseline, then the clearer scene."""
    feats = search(sensor.collection, geometry, start, end, query={"eo:cloud_cover": {"lt": max_cloud}})
    bbox = bbox_of(geometry)
    best: dict[tuple, tuple[tuple, Scene]] = {}
    for f in feats:
        p = f.get("properties", {})
        platform = p.get("platform")
        if platform not in sensor.platforms:
            continue
        if sensor.key == "landsat" and p.get("landsat:collection_category", "T1") != "T1":
            continue
        day = date.fromisoformat(str(p["datetime"])[:10])
        tile = p.get("s2:mgrs_tile") or f"{p.get('landsat:wrs_path')}/{p.get('landsat:wrs_row')}"
        key = (platform, day, tile) if per_tile else (platform, day)
        footprint = f.get("geometry")
        contains = bool(footprint) and footprint_contains(footprint, bbox)
        try:
            baseline = float(p.get("s2:processing_baseline") or 0.0)
        except ValueError:
            baseline = 0.0
        rank = (contains, baseline, -float(p.get("eo:cloud_cover") or 0.0))
        scene = Scene(
            sensor, f["id"], day, platform,
            {"s2:processing_baseline": p.get("s2:processing_baseline"), "datetime": p["datetime"]},
            footprint,
        )
        if key not in best or rank > best[key][0]:
            best[key] = (rank, scene)
    return sorted((s for _, s in best.values()), key=lambda s: (s.day, s.item_id))


@dataclass(frozen=True)
class _Task:
    scene: Scene
    bbox: Bbox
    inside: np.ndarray = field(compare=False, hash=False)
    wet: bool | None


def _run_task(task: _Task) -> Observation | None:
    h, w = task.inside.shape
    block = read_block(task.scene.sensor.collection, task.scene.item_id, task.bbox, w, h, task.scene.sensor.bands)
    return scene_observation(task.scene.sensor, block, task.inside, task.scene.props, task.scene.day, task.wet)


def run_tasks(tasks: list[_Task], *, workers: int, label: str) -> tuple[list[Observation | None], int]:
    """Run reads in parallel; returns per-task results (None = not clear or
    failed) and the failure count. More than 20% failures is an outage, not
    noise, and raises instead of quietly thinning the record."""
    results = parallel_map(_run_task, tasks, workers=workers, label=label)
    failed = sum(1 for r in results if isinstance(r, Exception))
    if tasks and failed > 0.2 * len(tasks):
        first = next(r for r in results if isinstance(r, Exception))
        raise RuntimeError(f"{label}: {failed}/{len(tasks)} scene reads failed; first: {first}")
    return [None if isinstance(r, Exception) else r for r in results], failed


def observe_field(
    geometry: dict,
    rain: RainGate | None,
    *,
    start: str = START,
    end: str = END,
    workers: int = 8,
) -> tuple[list[Observation], dict]:
    """Every clear observation of one field, both sensors, oldest first."""
    bbox = bbox_of(geometry)
    tasks: list[_Task] = []
    listed: dict[str, int] = {}
    for sensor in (SENTINEL2, LANDSAT):
        scenes = list_scenes(sensor, geometry, start, end)
        listed[sensor.key] = len(scenes)
        w, h = grid_shape(bbox, sensor.res_m)
        inside = geometry_mask(geometry, bbox, w, h)
        for sc in scenes:
            tasks.append(_Task(sc, bbox, inside, rain.is_wet(sc.day) if rain else None))
    results, failed = run_tasks(tasks, workers=workers, label="field scenes")
    obs = sorted((r for r in results if r is not None), key=lambda o: (o.day, o.sensor))
    wet_skipped = sum(1 for t, r in zip(tasks, results) if r is not None and t.wet is not False)
    stats = {
        "scenes": listed,
        "observations": dict(Counter(o.sensor for o in obs)),
        "failed_reads": failed,
        "residue_obs": sum(1 for o in obs if o.ndti is not None),
        "wet_or_unknown_rain": wet_skipped,
    }
    return obs, stats


# --------------------------------------------------------------------------
# Day-of-year climatology (pure, wrap-aware)
# --------------------------------------------------------------------------


def circular_distance(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    d = np.abs(np.asarray(a) - np.asarray(b)) % DOY_LEN
    return np.minimum(d, DOY_LEN - d)


def window_stats(doys, values, half: int = HALF_WINDOW):
    """Median, p25, p75 and count for every DOY over a +-half window that
    wraps the year: an observation on 30 Dec counts toward 3 Jan. NaN where
    a window is empty."""
    doys = np.asarray(doys, dtype=float)
    values = np.asarray(values, dtype=float)
    med = np.full(DOY_LEN, np.nan)
    p25 = np.full(DOY_LEN, np.nan)
    p75 = np.full(DOY_LEN, np.nan)
    n = np.zeros(DOY_LEN, dtype=int)
    if doys.size == 0:
        return med, p25, p75, n
    axis = np.arange(1, DOY_LEN + 1, dtype=float)
    within = circular_distance(axis[:, None], doys[None, :]) <= half
    for i in range(DOY_LEN):
        v = values[within[i]]
        if v.size:
            p25[i], med[i], p75[i] = np.percentile(v, [25, 50, 75])
            n[i] = v.size
    return med, p25, p75, n


def fill_circular(values) -> np.ndarray:
    """Fill NaNs by linear interpolation around the circle (Dec -> Jan)."""
    v = np.asarray(values, dtype=float)
    ok = ~np.isnan(v)
    if not ok.any():
        raise ValueError("No data on any day of the year")
    if ok.all():
        return v
    x = np.arange(1, DOY_LEN + 1, dtype=float)
    return np.interp(x, x[ok], v[ok], period=DOY_LEN)


def _r(arr) -> list[float]:
    return [round(float(x), 4) for x in np.clip(arr, 0.0, 1.0)]


@dataclass
class CoverClimatology:
    green: list[float]
    green_p25: list[float]
    green_p75: list[float]
    residue: list[float]
    n_obs: list[int]
    n_residue: list[int]

    @property
    def soil(self) -> list[float]:
        return [max(g, r) for g, r in zip(self.green, self.residue)]

    @property
    def bare_days(self) -> int:
        return sum(1 for v in self.soil if v < BARE_THRESHOLD)


def build_cover_climatology(
    obs: list[Observation],
    em: Endmembers = DEFAULT_ENDMEMBERS,
    shift: float = 0.0,
) -> CoverClimatology:
    pts = [(o.doy, o.green) for o in obs if o.doy is not None]
    if not pts:
        raise ValueError("No observations to build a climatology from")
    d, g = zip(*pts)
    med, p25, p75, n = window_stats(d, g)
    green, lo, hi = fill_circular(med), fill_circular(p25), fill_circular(p75)
    lo = np.minimum(lo, green)
    hi = np.maximum(hi, green)

    res_pts = [(o.doy, em.residue_fraction(o.ndti, shift)) for o in obs
               if o.doy is not None and o.ndti is not None]
    if res_pts:
        rd, rv = zip(*res_pts)
        rmed, _, _, rn = window_stats(rd, rv)
        residue = fill_circular(rmed)
    else:  # no dry, non-green reading at all: claim no residue, never invent it
        residue, rn = np.zeros(DOY_LEN), np.zeros(DOY_LEN, dtype=int)
    return CoverClimatology(_r(green), _r(lo), _r(hi), _r(residue), [int(x) for x in n], [int(x) for x in rn])


def season_year(day: date) -> int:
    """The crop year whose cover a date shows. Before 1 May a field still
    shows the residue of LAST year's crop, so it belongs to that phase."""
    doy = doy_365(day.month, day.day) or 59
    return day.year if doy >= PHASE_SPLIT_DOY else day.year - 1


def build_phase_climatologies(
    obs: list[Observation], crops: dict[int, CropYear], em: Endmembers = DEFAULT_ENDMEMBERS
) -> dict[str, CoverClimatology]:
    """One climatology per crop phase ('corn', 'soybean', ...), largest first."""
    groups: dict[str, list[Observation]] = {}
    for o in obs:
        cy = crops.get(season_year(o.day))
        if cy is not None:
            groups.setdefault(cy.key, []).append(o)
    ranked = sorted(groups.items(), key=lambda kv: -len(kv[1]))
    return {k: build_cover_climatology(v, em) for k, v in ranked if len(v) >= MIN_PHASE_OBS}


# --------------------------------------------------------------------------
# Phenology and the field's own cover-crop history (pure)
# --------------------------------------------------------------------------


def season_phenology(obs_year: list[Observation]) -> tuple[int | None, int | None]:
    """(green-up onset DOY, senescence end DOY) for one calendar year.

    These are what the satellite sees -- the canopy appearing and going --
    and they are what the schema's planting_doy / harvest_doy hold ("from
    NDVI green-up / senescence"). Onset trails planting by ~3-4 weeks;
    senescence end leads harvest by ~1-3 weeks."""
    pts = [(o.doy, o.green) for o in obs_year if o.doy is not None]
    if sum(1 for d, _ in pts if 100 <= d <= 300) < 8:
        return None, None
    d = np.array([p[0] for p in pts], dtype=float)
    g = np.array([p[1] for p in pts], dtype=float)
    curve = np.full(DOY_LEN, np.nan)
    for i in range(DOY_LEN):
        sel = np.abs(d - (i + 1)) <= 10
        if sel.any():
            curve[i] = np.median(g[sel])
    ok = ~np.isnan(curve)
    first, last = int(np.argmax(ok)), DOY_LEN - 1 - int(np.argmax(ok[::-1]))
    x = np.arange(DOY_LEN)
    curve[first:last + 1] = np.interp(x[first:last + 1], x[ok], curve[ok])

    peak = 149 + int(np.nanargmax(np.where(np.isnan(curve[149:260]), -1.0, curve[149:260])))
    spring, fall = curve[59:peak], curve[peak:340]
    if np.all(np.isnan(spring)) or np.all(np.isnan(fall)):
        return None, None
    base_s, base_f = float(np.nanmin(spring)), float(np.nanmin(fall))
    if curve[peak] - base_s < MIN_SEASON_AMPLITUDE or curve[peak] - base_f < MIN_SEASON_AMPLITUDE:
        return None, None
    thr_s = base_s + PHENO_FRACTION * (curve[peak] - base_s)
    thr_f = base_f + PHENO_FRACTION * (curve[peak] - base_f)
    below = np.nonzero(spring < thr_s)[0]
    onset = 59 + int(below[-1]) + 2 if below.size else None
    after = np.nonzero(fall <= thr_f)[0]
    end = peak + int(after[0]) + 1 if after.size else None
    return onset, end


def spring_signal(obs: list[Observation], year: int) -> tuple[float | None, int]:
    vals = [o.ndvi for o in obs
            if o.day.year == year and o.doy and SPRING_WINDOW[0] <= o.doy <= SPRING_WINDOW[1]]
    return (float(np.median(vals)) if vals else None), len(vals)


def winter_cover(obs: list[Observation], harvest_year: int) -> bool | None:
    """Was the winter after `harvest_year` cover-cropped? None = not enough
    clear spring scenes to tell."""
    med, n = spring_signal(obs, harvest_year + 1)
    if n < SPRING_MIN_OBS or med is None:
        return None
    return med >= SPRING_NDVI


# --------------------------------------------------------------------------
# The region around the farm: CDL fields and region-wide scene reductions
# --------------------------------------------------------------------------


@dataclass
class RegionFields:
    """Neighbouring fields from CDL crop sequences (cdl.segment_fields),
    one pixel in from their edges, with the farm's own field removed."""

    region: Bbox
    w: int
    h: int
    years: list[int]
    labels: np.ndarray           # (h, w) int64, 0 = not a field
    crop: dict[int, np.ndarray]  # year -> per-label majority crop (0, CORN, SOYBEANS)
    total: np.ndarray            # pixels per label

    @property
    def n_labels(self) -> int:
        return int(self.labels.max()) + 1

    @property
    def polygon(self) -> dict:
        return bbox_polygon(self.region)

    def labels_on_grid(self, bbox: Bbox, w: int, h: int) -> np.ndarray:
        """Field labels looked up at the centres of any lon/lat grid."""
        lh, lw = self.labels.shape
        x0, y0, x1, y1 = self.region
        lon, lat = pixel_centres(bbox, w, h)
        col = np.clip(np.floor((lon - x0) / ((x1 - x0) / lw)).astype(int), 0, lw - 1)
        row = np.clip(np.floor((y1 - lat) / ((y1 - y0) / lh)).astype(int), 0, lh - 1)
        return self.labels[row, col]

    def field_bbox(self, fid: int) -> Bbox:
        x0, y0, x1, y1 = self.region
        dx, dy = (x1 - x0) / self.w, (y1 - y0) / self.h
        r, c = np.nonzero(self.labels == fid)
        return (x0 + c.min() * dx, y1 - (r.max() + 1) * dy, x0 + (c.max() + 1) * dx, y1 - r.min() * dy)

    def row_crop_fields(self, year: int) -> np.ndarray:
        """Label ids that CDL calls corn or soybean in `year`."""
        ids = np.arange(self.n_labels)
        return ids[(self.total > 0) & np.isin(self.crop[year], ROW_CROPS) & (ids > 0)]


def region_fields(geometry: dict, radius_km: float, years: list[int]) -> RegionFields:
    b = bbox_of(geometry)
    lon, lat = (b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0
    region = bbox_around(lon, lat, radius_km)
    w, h = grid_shape(region, 30.0)
    classes = np.stack([majority_filter3(to_rotation_classes(cdl_grid(y, region, w, h))) for y in years])
    px_ha = pixel_area_m2(region, w, h) / 10_000.0
    labels = erode_labels(segment_fields(classes, int(DETECT_MIN_FIELD_HA / px_ha))).astype(np.int64)
    farm = set(np.unique(labels[geometry_mask(geometry, region, w, h)]).tolist()) - {0}
    labels = np.where(np.isin(labels, list(farm)), 0, labels)
    n_labels = int(labels.max()) + 1
    total = np.bincount(labels.ravel(), minlength=n_labels)
    crop: dict[int, np.ndarray] = {}
    for k, y in enumerate(years):
        best = np.zeros(n_labels, dtype=int)
        for code in ROW_CROPS:
            share = np.bincount(labels.ravel(), weights=(classes[k] == code).ravel(), minlength=n_labels)
            best = np.where(share >= 0.5 * np.maximum(total, 1), code, best)
        crop[y] = best
    return RegionFields(region, w, h, list(years), labels, crop, total)


def _region_field_means(
    scene: Scene, rf: RegionFields, labels: np.ndarray, *, with_swir: bool
) -> tuple[date, dict[int, tuple[float, float | None]]]:
    """One region-wide Sentinel-2 read -> per field: (mean NDVI, mean NDTI of
    non-green pixels or None). A field counts if >= 80% of its pixels are
    clear; NDTI needs >= 50% of those non-green."""
    h, w = labels.shape
    assets = ("B04", "B8A", "B11", "B12", "SCL") if with_swir else ("B04", "B8A", "SCL")
    block = read_block(scene.sensor.collection, scene.item_id, rf.region, w, h, assets)
    red = to_reflectance(SENTINEL2, block[0], scene.props)
    nir = to_reflectance(SENTINEL2, block[1], scene.props)
    ok = (block[-1] > 0) & np.isin(block[len(assets) - 1], S2_CLEAR_SCL)
    ok &= (red > 0) & (nir > 0) & (red <= 1) & (nir <= 1)
    ndvi = normalized_difference(nir, red)
    n = rf.n_labels
    lab, okr = labels.ravel(), ok.ravel()
    total = np.bincount(lab, minlength=n)
    clear = np.bincount(lab[okr], minlength=n)
    ndvi_sum = np.bincount(lab[okr], weights=ndvi.ravel()[okr], minlength=n)
    good = (total > 0) & (clear >= 0.8 * total)
    good[0] = False
    out: dict[int, tuple[float, float | None]] = {}
    if with_swir:
        sw1 = to_reflectance(SENTINEL2, block[2], scene.props)
        sw2 = to_reflectance(SENTINEL2, block[3], scene.props)
        ng = ok & (ndvi <= GREEN_PIXEL_NDVI) & (sw1 > 0) & (sw2 > 0) & (sw1 <= 1) & (sw2 <= 1)
        ngr = ng.ravel()
        n_ng = np.bincount(lab[ngr], minlength=n)
        ndti_sum = np.bincount(lab[ngr], weights=normalized_difference(sw1, sw2).ravel()[ngr], minlength=n)
    for fid in np.nonzero(good)[0]:
        mean_ndvi = float(ndvi_sum[fid] / clear[fid])
        ndti = None
        if with_swir and n_ng[fid] >= MIN_NONGREEN_FRACTION * clear[fid]:
            ndti = float(ndti_sum[fid] / n_ng[fid])
        out[int(fid)] = (mean_ndvi, ndti)
    return scene.day, out


def calibrate_endmembers(
    rf: RegionFields,
    rain: RainGate,
    *,
    seasons: tuple[int, ...] = CALIBRATION_SEASONS,
    workers: int = 8,
) -> Endmembers:
    """Regional NDTI endmembers from the neighbouring corn/soy fields.

    Bare soil: 5th percentile of field-mean NDTI across fields in the
    post-planting window (1 May - 30 Jun) -- the conventionally tilled
    fields are truly bare then. Full residue: 95th percentile in the
    post-harvest window (1 Oct - 30 Nov). Dry dates (NASA POWER) and
    non-green pixels only, same gates as the farm's own readings."""
    w, h = grid_shape(rf.region, CALIBRATION_RES_M)
    labels = rf.labels_on_grid(rf.region, w, h)
    jobs: list[tuple[str, int, Scene]] = []
    for s in seasons:
        if s not in rf.crop:
            continue
        for kind, (m0, m1) in (("soil", SOIL_WINDOW), ("residue", RESIDUE_WINDOW)):
            for sc in list_scenes(SENTINEL2, rf.polygon, f"{s}-{m0}", f"{s}-{m1}", max_cloud=40.0, per_tile=True):
                if rain.is_wet(sc.day) is False:
                    jobs.append((kind, s, sc))
    reads = parallel_map(lambda j: _region_field_means(j[2], rf, labels, with_swir=True),
                         jobs, workers=workers, label="calibration scenes")
    samples: dict[str, list[float]] = {"soil": [], "residue": []}
    fields: set[int] = set()
    for (kind, s, _), res in zip(jobs, reads):
        if isinstance(res, Exception):
            continue
        eligible = set(rf.row_crop_fields(s).tolist())
        for fid, (_, ndti) in res[1].items():
            if ndti is not None and fid in eligible:
                samples[kind].append(ndti)
                fields.add(fid)
    return endmembers_from_samples(samples["soil"], samples["residue"], len(fields))


# --------------------------------------------------------------------------
# Neighbouring cover-cropped fields -> the observed cover-crop curve
# --------------------------------------------------------------------------


def isolate_cover_season(curve) -> tuple[list[float], int, int, int] | None:
    """Keep a cover-cropped field's green cover only from its post-harvest
    low to its spring termination low; zero the cash-crop season.

    rotations.py unions this curve with the field's own cover on every day
    of the year, so anything left in summer would credit the cover crop with
    the cash crop's canopy. The spring peak is looked for in Apr-May only
    (COVER_PEAK_WINDOW): that is when an Iowa rye stand flushes before
    termination. Returns (curve, fall_start_doy, termination_doy, peak_doy),
    or None if there is no spring peak to speak of."""
    c = np.asarray(curve, dtype=float)
    p0, p1 = COVER_PEAK_WINDOW[0] - 1, COVER_PEAK_WINDOW[1]
    peak = p0 + int(np.argmax(c[p0:p1]))
    if c[peak] < 0.20:
        return None
    term = peak + int(np.argmin(c[peak:min(peak + 60, 200)]))
    fall = 239 + int(np.argmin(c[239:335]))
    out = np.zeros(DOY_LEN)
    keep = list(range(fall, DOY_LEN)) + list(range(0, term + 1))
    out[keep] = c[keep]
    return _r(out), fall + 1, term + 1, peak + 1


@dataclass
class CoverCropDetection:
    curve: list[float] | None
    n_fields: int
    n_field_seasons: int
    n_candidates: int
    n_obs: int
    seasons: list[int]
    radius_km: float
    fall_start_doy: int | None = None
    termination_doy: int | None = None
    peak_doy: int | None = None
    peak_cover: float | None = None
    #: Spread across the detected fields, same season mask as `curve`.
    curve_p25: list[float] | None = None
    curve_p75: list[float] | None = None
    #: Every clear observation behind the curve: [field, season, date, green, ndvi]
    observations: list[list] = field(default_factory=list)

    @property
    def usable(self) -> bool:
        return self.curve is not None and self.n_field_seasons >= DETECT_MIN_FIELD_SEASONS

    def detection_text(self) -> str:
        s0, s1 = self.seasons[0], self.seasons[-1]
        return (
            f"{self.n_fields} corn/soybean fields within {self.radius_km:.0f} km (USDA CDL) "
            f"whose Sentinel-2 NDVI median was >= {SPRING_NDVI} between 21 Mar and 5 May, "
            f"before any cash crop emerges -- {self.n_field_seasons} of {self.n_candidates} "
            f"field-springs screened, {s0}-{s1}; one curve per field-season from {self.n_obs} clear "
            f"observations, median across fields, kept from the post-harvest low (DOY {self.fall_start_doy}) to the "
            f"spring termination low (DOY {self.termination_doy}). CDL does not label cover "
            f"crops; in Iowa a spring-green winter cover is overwhelmingly cereal rye."
        )


def detect_cover_cropped_fields(
    rf: RegionFields,
    *,
    seasons: tuple[int, ...] = DETECT_SEASONS,
    radius_km: float = DETECT_RADIUS_KM,
    workers: int = 8,
) -> CoverCropDetection:
    """Find corn/soy fields near the farm that already grow a winter cover,
    and measure what that cover looks like across the year.

    1. Candidates, per spring: fields CDL calls corn/soy both the year
       before and that year (excludes wheat, hay, pasture).
    2. Region-wide Sentinel-2 reads in the spring window -> detection.
    3. Each detected field-spring: every clear scene from 15 Aug to 15 Jul,
       field-level -> green cover; the median across all of them is the
       curve, kept only for the cover-crop season."""
    candidates: dict[int, set[int]] = {}
    spring_scenes: list[tuple[int, Scene]] = []
    for s in seasons:
        candidates[s] = set(rf.row_crop_fields(s - 1).tolist()) & set(rf.row_crop_fields(s).tolist())
        for sc in list_scenes(SENTINEL2, rf.polygon, f"{s}-03-21", f"{s}-05-05", max_cloud=60.0, per_tile=True):
            spring_scenes.append((s, sc))

    reads = parallel_map(lambda t: _region_field_means(t[1], rf, rf.labels, with_swir=False),
                         spring_scenes, workers=workers, label="spring region scenes")
    spring: dict[tuple[int, int], dict[date, float]] = {}
    for (s, _), res in zip(spring_scenes, reads):
        if isinstance(res, Exception):
            continue
        day, vals = res
        for fid, (ndvi, _) in vals.items():
            spring.setdefault((fid, s), {}).setdefault(day, ndvi)  # first tile wins

    detected = []
    for s in seasons:
        for fid in sorted(candidates[s]):
            vals = list(spring.get((fid, s), {}).values())
            if len(vals) >= SPRING_MIN_OBS and float(np.median(vals)) >= SPRING_NDVI:
                detected.append((fid, s))
    n_cand = sum(len(v) for v in candidates.values())
    result = CoverCropDetection(None, len({f for f, _ in detected}), len(detected), n_cand, 0,
                                list(seasons), radius_km)
    if not detected:
        return result

    season_scenes = {s: list_scenes(SENTINEL2, rf.polygon, f"{s - 1}-08-15", f"{s}-07-15",
                                    max_cloud=60.0, per_tile=True) for s in {s for _, s in detected}}
    tasks: list[_Task] = []
    owners: list[tuple[int, int]] = []
    for fid, s in detected:
        fb = rf.field_bbox(fid)
        fw, fh = grid_shape(fb, SENTINEL2.res_m)
        inside = rf.labels_on_grid(fb, fw, fh) == fid
        seen: set[tuple[str, date]] = set()
        for sc in season_scenes[s]:
            if (sc.platform, sc.day) in seen or not (sc.footprint and footprint_contains(sc.footprint, fb)):
                continue
            seen.add((sc.platform, sc.day))
            tasks.append(_Task(sc, fb, inside, None))
            owners.append((fid, s))
    results, _ = run_tasks(tasks, workers=workers, label="cover-crop field scenes")
    obs = [(o, own) for o, own in zip(results, owners) if o is not None]
    result.n_obs = len(obs)
    result.observations = [[fid, s, o.day.isoformat(), o.green, o.ndvi] for o, (fid, s) in obs]
    per: dict[tuple[int, int], list[Observation]] = {}
    for o, own in obs:
        per.setdefault(own, []).append(o)
    curves = field_season_curves(per)
    result.n_field_seasons = len(curves)
    result.n_fields = len({f for f, _ in curves})
    if not curves:
        return result
    stack = np.vstack(list(curves.values()))
    iso = isolate_cover_season(np.median(stack, axis=0))
    if iso is None:
        return result
    curve, fall, term, peak = iso
    keep = np.zeros(DOY_LEN, dtype=bool)
    keep[fall - 1:] = True
    keep[:term] = True
    result.curve, result.fall_start_doy, result.termination_doy, result.peak_doy = curve, fall, term, peak
    result.peak_cover = curve[peak - 1]
    result.curve_p25 = _r(np.where(keep, np.percentile(stack, 25, axis=0), 0.0))
    result.curve_p75 = _r(np.where(keep, np.percentile(stack, 75, axis=0), 0.0))
    return result


def field_season_curves(
    per_field_season: dict[tuple[int, int], list[Observation]], *, min_obs: int = 10
) -> dict[tuple[int, int], np.ndarray]:
    """One green-cover curve per field-season (+-12 day median, gaps
    interpolated around the year), so that the median ACROSS fields weights
    every field once. Pooling observations instead would let whichever field
    happened to have clear January scenes define January for all of them --
    which is exactly how an early-drilled, unusually dense stand came to
    stand in for the typical late-drilled rye of its neighbours."""
    out: dict[tuple[int, int], np.ndarray] = {}
    for key, olist in per_field_season.items():
        pts = [(o.doy, o.green) for o in olist if o.doy is not None]
        if len(pts) < min_obs:
            continue
        d, g = zip(*pts)
        med, _, _, _ = window_stats(d, g, half=12)
        out[key] = fill_circular(med)
    return out


#: NRCS tillage classes by residue cover measured after planting.
TILLAGE_CLASSES = ((0.30, "conservation tillage"), (0.15, "reduced tillage"), (0.0, "conventional tillage"))
TILLAGE_WINDOW = (121, 181)  # 1 May - 30 Jun, after planting
MIN_TILLAGE_OBS = 10


def classify_tillage(post_planting_residue) -> dict | None:
    """NRCS: >= 30% residue after planting is conservation tillage, 15-30%
    reduced, < 15% conventional. Measured on this field's own dry, non-green
    post-planting readings. None when there are too few."""
    vals = np.asarray(list(post_planting_residue), dtype=float)
    if vals.size < MIN_TILLAGE_OBS:
        return None
    med = float(np.median(vals))
    label = next(name for lo, name in TILLAGE_CLASSES if med >= lo)
    return {"label": label, "post_planting_residue_median": round(med, 3), "n": int(vals.size)}


# --------------------------------------------------------------------------
# Assembly -> ImageryInputs
# --------------------------------------------------------------------------


@dataclass
class ImageryReport:
    """Diagnostics that do not fit the contract but must reach the bundle's
    uncertainty section and the build log."""

    farm_id: str
    period: list[str]
    scenes: dict[str, int]
    observations: dict[str, int]
    failed_reads: int
    residue_obs: int
    wet_or_unknown_rain: int
    zero_obs_doys: int
    bare_days: int
    bare_days_more_residue: int
    bare_days_less_residue: int
    endmembers: dict
    tillage: dict | None
    phases: dict[str, int]
    cdl_years: dict[int, str]
    detection: dict | None
    warnings: list[str] = field(default_factory=list)
    #: Every clear observation of the farm's field: [date, sensor, green, ndvi, ndti]
    field_observations: list[list] = field(default_factory=list)


def _crop_curve(obs: list[Observation], crops: dict[int, CropYear], code: int, label: str) -> CropCurve | None:
    years = sorted(y for y, c in crops.items() if c.code == code)
    sub = [o for o in obs if o.day.year in years]
    if len(sub) < MIN_PHASE_OBS:
        return None
    clim = build_cover_climatology(sub)
    return CropCurve(
        green_cover=clim.green, n_fields=1, source="observed",
        detection=(
            f"This field's own green cover in its {len(years)} CDL {label} years "
            f"({', '.join(map(str, years))}): median of {len(sub)} clear Sentinel-2 and "
            f"Landsat 8/9 observations, +-{HALF_WINDOW} day window."
        ),
    )


def literature_rye_curve(reason: str) -> CropCurve:
    """B2's Midwest-literature rye curve, used only when no neighbouring
    field shows a cover crop. Labelled literature, never observed."""
    from .bundle import placeholder_imagery

    base = placeholder_imagery().crop_curves["cereal_rye"]
    return base.model_copy(update={"detection": f"{reason} Falling back to the Midwest "
                                                "extension-literature curve: NOT observed."})


def build_imagery(
    farm_id: str,
    geometry: dict,
    records: list[DailyRecord],
    *,
    start: str = START,
    end: str = END,
    detect: bool = True,
    workers: int = 8,
) -> tuple[ImageryInputs, ImageryReport]:
    """The whole B1 pipeline for one field."""
    rain = RainGate(records)
    obs, stats = observe_field(geometry, rain, start=start, end=end, workers=workers)
    if len(obs) < 100:
        raise RuntimeError(f"Only {len(obs)} clear observations of {farm_id}; refusing to build a climatology")

    warnings: list[str] = []
    region_years = list(range(min(DETECT_SEASONS) - 4, max(DETECT_SEASONS) + 1))
    rf = region_fields(geometry, DETECT_RADIUS_KM, region_years)
    em = calibrate_endmembers(rf, rain, workers=workers)
    if em.source != "regional":
        warnings.append("Regional NDTI calibration had too few samples; using default endmembers.")

    clim = build_cover_climatology(obs, em)
    more = build_cover_climatology(obs, em, -NDTI_SENSITIVITY)
    less = build_cover_climatology(obs, em, NDTI_SENSITIVITY)

    years = sorted({o.day.year for o in obs})
    crops = field_crop_history(geometry, list(range(years[0] - 1, years[-1] + 1)))
    phases = build_phase_climatologies(obs, crops, em)

    observed_years: list[ObservedYear] = []
    winters: dict[int, bool | None] = {}
    for y in years:
        if y not in crops:
            continue
        onset, end_doy = season_phenology([o for o in obs if o.day.year == y])
        winters[y] = winter_cover(obs, y)
        observed_years.append(ObservedYear(
            year=y, cdl_crop=crops[y].name, cdl_code=crops[y].code,
            planting_doy=onset, harvest_doy=end_doy,
            cover_crop_detected=bool(winters[y]),
        ))
    if not observed_years:
        raise RuntimeError(f"No CDL year overlaps the imagery for {farm_id}")

    crop_curves: dict[str, CropCurve] = {}
    for code, key, label in ((CORN, "corn", "corn"), (SOYBEANS, "soybean", "soybean")):
        cc = _crop_curve(obs, crops, code, label)
        if cc is not None:
            crop_curves[key] = cc

    detection = detect_cover_cropped_fields(rf, workers=workers) if detect else None
    if detection is not None and detection.usable:
        crop_curves["cereal_rye"] = CropCurve(
            green_cover=detection.curve, n_fields=max(1, detection.n_fields),
            source="observed", detection=detection.detection_text(),
        )
    else:
        why = ("Cover-crop detection was skipped." if detection is None else
               f"Only {detection.n_field_seasons} cover-cropped field-springs found among "
               f"{detection.n_candidates} screened within {detection.radius_km:.0f} km.")
        crop_curves["cereal_rye"] = literature_rye_curve(why)
        warnings.append(why + " Rye curve is literature, not observed.")

    n_s2 = stats["observations"].get("sentinel2", 0)
    n_ls = stats["observations"].get("landsat", 0)
    cdl_src = NON_NASA_SOURCES["cdl"].model_copy(update={
        "n_obs": len(crops),
        "citation": "USDA NASS Cropland Data Layer -- not NASA. 2008-2021 via Microsoft "
                    "Planetary Computer, 2022+ via USDA NASS CropScape.",
    })
    sources: list[Source] = [
        nasa_source("landsat", n_obs=n_ls),
        NON_NASA_SOURCES["sentinel2"].model_copy(update={"n_obs": n_s2}),
        cdl_src,
    ]

    tillage = classify_tillage(
        em.residue_fraction(o.ndti) for o in obs
        if o.ndti is not None and o.doy and TILLAGE_WINDOW[0] <= o.doy <= TILLAGE_WINDOW[1]
    )
    label = infer_rotation_label({y.year: crops[y.year] for y in observed_years}, winters)
    if tillage:
        label = f"{label}; {tillage['label']}"

    zero = sum(1 for n in clim.n_obs if n == 0)
    if zero > 30:
        warnings.append(f"{zero} days of the year have no clear observation within +-{HALF_WINDOW} days.")
    if stats["residue_obs"] < 50:
        warnings.append(f"Only {stats['residue_obs']} dry, non-green residue readings.")

    imagery = ImageryInputs(
        green_cover=clim.green,
        green_cover_p25=clim.green_p25,
        green_cover_p75=clim.green_p75,
        residue_cover=clim.residue,
        n_obs_per_doy=clim.n_obs,
        observed_years=observed_years,
        crop_curves=crop_curves,
        sources=sources,
        inferred_label=label,
        is_synthetic=False,
        phase_covers=[p.soil for p in phases.values()] if len(phases) >= 2 else None,
    )
    imagery.validate()
    report = ImageryReport(
        farm_id=farm_id,
        period=[obs[0].day.isoformat(), obs[-1].day.isoformat()],
        scenes=stats["scenes"],
        observations=stats["observations"],
        failed_reads=stats["failed_reads"],
        residue_obs=stats["residue_obs"],
        wet_or_unknown_rain=stats["wet_or_unknown_rain"],
        zero_obs_doys=zero,
        bare_days=clim.bare_days,
        bare_days_more_residue=more.bare_days,
        bare_days_less_residue=less.bare_days,
        endmembers={**asdict(em), "text": em.describe()},
        tillage=tillage,
        phases={k: sum(1 for o in obs if crops.get(season_year(o.day)) and crops[season_year(o.day)].key == k)
                for k in phases},
        cdl_years={y: c.name for y, c in sorted(crops.items())},
        detection=asdict(detection) if detection is not None else None,
        warnings=warnings,
        field_observations=[[o.day.isoformat(), o.sensor, o.green, o.ndvi, o.ndti] for o in obs],
    )
    return imagery, report


def uncertainty_notes(report: dict) -> list[dict]:
    """Uncertainty entries for the bundle, from what this run measured."""
    lo = min(report["bare_days_more_residue"], report["bare_days_less_residue"])
    hi = max(report["bare_days_more_residue"], report["bare_days_less_residue"])
    em = report.get("endmembers") or {}
    em_text = em.get("text") or DEFAULT_ENDMEMBERS.describe()
    notes = [{
        "field": "residue_cover",
        "level": "medium" if em.get("source") == "regional" else "high",
        "reason": (
            f"Residue cover comes from the NDTI tillage index scaled between two endmembers: "
            f"{em_text}. No residue transects were measured on this farm; moisture and soil "
            f"colour shift NDTI. Shifting both endmembers by +-{NDTI_SENSITIVITY} moves this field "
            f"from {report['bare_days']} to {lo}-{hi} bare days. Readings use only non-green pixels "
            f"on dates with <= {WET_RAIN_MM:g} mm of NASA POWER rain in the prior two days."
        ),
        "affects": "Read the edges of the autumn and spring gaps as approximate, not to the day.",
    }]
    det = report.get("detection") or {}
    if det.get("curve") is not None and det.get("n_field_seasons", 0) >= DETECT_MIN_FIELD_SEASONS:
        notes.append({
            "field": "crop_curves.cereal_rye",
            "level": "medium",
            "reason": (
                f"The cover-crop curve is measured, not modelled: the median of "
                f"{det['n_fields']} nearby fields that were green before planting. CDL does not "
                f"label cover crops, so a few of those fields could carry winter weeds or "
                f"volunteer grain instead of a seeded cover."
            ),
            "affects": "Expect a real rye stand on this farm to land within the spread of its neighbours, not on the median.",
        })
    else:
        notes.append({
            "field": "crop_curves.cereal_rye",
            "level": "high",
            "reason": "No neighbouring cover-cropped fields were detected, so the rye curve is "
                      "from Midwest extension literature, not observed here.",
            "affects": "Treat the rye rotation's numbers as indicative only.",
        })
    notes.append({
        "field": "observed_rotation.years (planting_doy, harvest_doy)",
        "level": "low",
        "reason": "These are satellite phenology dates: green-up onset trails planting by about "
                  "three to four weeks, and the end of senescence comes one to three weeks "
                  "before harvest.",
        "affects": "Use them for timing the season, not as the farm's operation dates.",
    })
    return notes


# --------------------------------------------------------------------------
# Freezing the handoff (H24: bundles become static; so does their input)
# --------------------------------------------------------------------------


def imagery_to_dict(im: ImageryInputs) -> dict:
    return {
        "green_cover": im.green_cover,
        "green_cover_p25": im.green_cover_p25,
        "green_cover_p75": im.green_cover_p75,
        "residue_cover": im.residue_cover,
        "n_obs_per_doy": im.n_obs_per_doy,
        "observed_years": [y.model_dump(mode="json") for y in im.observed_years],
        "crop_curves": {k: v.model_dump(mode="json") for k, v in im.crop_curves.items()},
        "sources": [s.model_dump(mode="json") for s in im.sources],
        "inferred_label": im.inferred_label,
        "is_synthetic": im.is_synthetic,
        "phase_covers": im.phase_covers,
    }


def imagery_from_dict(d: dict) -> ImageryInputs:
    im = ImageryInputs(
        green_cover=list(d["green_cover"]),
        green_cover_p25=list(d["green_cover_p25"]),
        green_cover_p75=list(d["green_cover_p75"]),
        residue_cover=list(d["residue_cover"]),
        n_obs_per_doy=list(d["n_obs_per_doy"]),
        observed_years=[ObservedYear.model_validate(y) for y in d["observed_years"]],
        crop_curves={k: CropCurve.model_validate(v) for k, v in d["crop_curves"].items()},
        sources=[Source.model_validate(s) for s in d["sources"]],
        inferred_label=d["inferred_label"],
        is_synthetic=bool(d["is_synthetic"]),
        phase_covers=d.get("phase_covers"),
    )
    im.validate()
    return im


def save_imagery(path: Path | str, imagery: ImageryInputs, report: ImageryReport | dict) -> None:
    rep = asdict(report) if isinstance(report, ImageryReport) else report
    payload = {"imagery": imagery_to_dict(imagery), "report": rep}
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, indent=1, default=str), encoding="utf-8")


def load_imagery(path: Path | str) -> tuple[ImageryInputs, dict]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return imagery_from_dict(payload["imagery"]), payload["report"]


__all__ = [
    "Endmembers", "ImageryReport", "Observation", "RegionFields", "build_imagery",
    "calibrate_endmembers", "detect_cover_cropped_fields", "load_imagery", "region_fields",
    "save_imagery", "uncertainty_notes",
]
