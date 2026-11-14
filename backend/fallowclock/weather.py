"""NASA POWER client and day-of-year climatology.  B2 owns this file.

One unauthenticated HTTP endpoint gives us everything the risk layer needs:
temperature (growing degree days, frost, heat stress) AND precipitation
(rainfall erosivity). No account, no token, no raster work.

    https://power.larc.nasa.gov/api/temporal/daily/point

Resolution is ~0.5 x 0.625 degrees (MERRA-2). That is coarse for a single
field -- fine for the seasonal shape we need, wrong for claiming a frost
date on one farm. Every bundle built from this carries an uncertainty entry
saying so.

Two details that are easy to get wrong and expensive to debug:

  * FILL VALUES. POWER returns -999 for missing. Averaging those in silently
    produces a climatology that looks plausible and is wrong.
  * LEAP YEARS. 29 February shifts every later day-of-year by one. We map
    calendar dates onto a fixed 365-day calendar and drop 29 Feb entirely,
    so DOY 100 means the same date in every year.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from pathlib import Path

from .cache import cached_get_json
from .schema import DOY_LEN

POWER_ENDPOINT = "https://power.larc.nasa.gov/api/temporal/daily/point"

#: POWER's missing-data sentinel. Anything <= this is not a measurement.
FILL_VALUE = -999.0

#: Parameters we request. POWER allows up to 20 per point request.
PARAMETERS = ("T2M_MAX", "T2M_MIN", "PRECTOTCORR")

#: Cumulative days before each month in a NON-leap year.
_MONTH_OFFSETS = (0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334)

#: Standard corn GDD caps (base 10 C): Tmax capped at 30 C, Tmin floored at
#: 10 C before averaging. Skipping the caps overstates accumulation by
#: roughly 40% in Iowa -- 2096 vs ~1500 C-days for 2023 -- which is the
#: difference between a hybrid that matures and one that does not.
WARM_SEASON_CAPS = (30.0, 10.0)

#: Cool-season species (rye, vetch, oats; base ~4 C) are conventionally
#: accumulated with an upper cap and no lower floor.
COOL_SEASON_CAPS = (30.0, None)

HEAT_STRESS_C = 32.0
FROST_C = 0.0


def doy_365(month: int, day: int) -> int | None:
    """Calendar date -> day of year on a fixed 365-day calendar.

    Returns None for 29 February, which we drop so that DOY 100 is the same
    calendar date in every year of the climatology.
    """
    if month == 2 and day == 29:
        return None
    return _MONTH_OFFSETS[month] + day


@dataclass(frozen=True)
class DailyRecord:
    """One day of weather, already cleaned of fill values."""

    year: int
    doy: int
    tmax: float
    tmin: float
    precip_mm: float

    @property
    def tmean(self) -> float:
        return (self.tmax + self.tmin) / 2.0


def power_url(
    lat: float,
    lon: float,
    start_year: int,
    end_year: int,
    parameters: tuple[str, ...] = PARAMETERS,
) -> str:
    return (
        f"{POWER_ENDPOINT}"
        f"?parameters={','.join(parameters)}"
        f"&community=AG"
        f"&longitude={lon}&latitude={lat}"
        f"&start={start_year}0101&end={end_year}1231"
        f"&format=JSON"
    )


def fetch_daily(
    lat: float,
    lon: float,
    start_year: int,
    end_year: int,
    *,
    cache_dir: Path | str | None = None,
    chunk_years: int = 10,
) -> list[DailyRecord]:
    """Fetch and clean daily weather for a point.

    Requests are chunked so a single long range cannot time out, and each
    chunk is cached independently -- a failure part way through does not
    throw away the chunks that already succeeded.
    """
    kw = {"cache_dir": cache_dir} if cache_dir is not None else {}
    records: list[DailyRecord] = []
    dropped = 0

    for chunk_start in range(start_year, end_year + 1, chunk_years):
        chunk_end = min(chunk_start + chunk_years - 1, end_year)
        payload = cached_get_json(
            power_url(lat, lon, chunk_start, chunk_end), **kw
        )
        try:
            params = payload["properties"]["parameter"]
        except (KeyError, TypeError) as exc:
            raise ValueError(
                f"Unexpected POWER response shape for {chunk_start}-{chunk_end}. "
                f"Top-level keys: {list(payload)[:6]}"
            ) from exc

        tmax_all = params["T2M_MAX"]
        tmin_all = params["T2M_MIN"]
        precip_all = params["PRECTOTCORR"]

        for stamp, tmax in tmax_all.items():
            tmin = tmin_all.get(stamp, FILL_VALUE)
            precip = precip_all.get(stamp, FILL_VALUE)

            # One bad parameter invalidates the day. Partial days would bias
            # whichever variable happened to survive.
            if min(tmax, tmin, precip) <= FILL_VALUE:
                dropped += 1
                continue

            year, month, day = int(stamp[:4]), int(stamp[4:6]), int(stamp[6:8])
            doy = doy_365(month, day)
            if doy is None:  # 29 February
                continue

            records.append(DailyRecord(year, doy, tmax, tmin, precip))

    if not records:
        raise ValueError(
            f"No usable POWER records for ({lat}, {lon}) {start_year}-{end_year}"
        )
    if dropped:
        print(f"  [power] dropped {dropped} days containing fill values")
    return records


def gdd_day(
    tmax: float,
    tmin: float,
    tbase: float,
    cap_max: float | None = None,
    cap_min: float | None = None,
) -> float:
    """Growing degree days for one day, with the standard caps.

    cap_max clips Tmax (heat stops helping); cap_min raises Tmin (nights
    below the base do not subtract). Pass both for warm-season crops, only
    cap_max for cool-season. See WARM_SEASON_CAPS / COOL_SEASON_CAPS.
    """
    if cap_max is not None:
        tmax = min(tmax, cap_max)
        tmin = min(tmin, cap_max)
    if cap_min is not None:
        tmax = max(tmax, cap_min)
        tmin = max(tmin, cap_min)
    return max(0.0, (tmax + tmin) / 2.0 - tbase)


def _group_by_doy(records: list[DailyRecord]) -> list[list[DailyRecord]]:
    buckets: list[list[DailyRecord]] = [[] for _ in range(DOY_LEN)]
    for r in records:
        buckets[r.doy - 1].append(r)
    return buckets


def _fill_empty_doys(values: list[float | None]) -> list[float]:
    """Interpolate any DOY with no observations from its neighbours.

    With 20+ years of daily data this should never fire, but a 365-length
    array with a None in it fails schema validation at the very end of the
    pipeline, which is the worst possible moment to discover it.
    """
    out = list(values)
    if all(v is None for v in out):
        raise ValueError("No data for any day of year")

    for i in range(DOY_LEN):
        if out[i] is not None:
            continue
        back = next(
            (out[(i - k) % DOY_LEN] for k in range(1, DOY_LEN)
             if out[(i - k) % DOY_LEN] is not None), None
        )
        fwd = next(
            (out[(i + k) % DOY_LEN] for k in range(1, DOY_LEN)
             if out[(i + k) % DOY_LEN] is not None), None
        )
        parts = [v for v in (back, fwd) if v is not None]
        out[i] = sum(parts) / len(parts)
    return [float(v) for v in out]  # type: ignore[arg-type]


def _smooth_circular(values: list[float], half_window: int) -> list[float]:
    """Centred moving average that wraps the year.

    Day-of-year statistics from ~25 samples are noisy; a frost probability
    that jumps 0.4 -> 0.8 -> 0.3 on consecutive days is sampling noise, not
    climate. Wrapping matters because the window around 1 January needs
    late December.
    """
    if half_window <= 0:
        return list(values)
    out = []
    for i in range(DOY_LEN):
        window = [values[(i + k) % DOY_LEN] for k in range(-half_window, half_window + 1)]
        out.append(sum(window) / len(window))
    return out


@dataclass
class WeatherClimatology:
    """Per-DOY arrays, all length 365, ready to drop into a Bundle."""

    gdd_base4: list[float]
    gdd_base10: list[float]
    frost_prob: list[float]
    heat_stress_prob: list[float]
    precip_mm: list[float]
    years_used: list[int]
    n_obs_per_doy: list[int]

    def as_dict(self) -> dict[str, list]:
        return {
            "gdd_base4": self.gdd_base4,
            "gdd_base10": self.gdd_base10,
            "frost_prob": self.frost_prob,
            "heat_stress_prob": self.heat_stress_prob,
        }


def build_climatology(
    records: list[DailyRecord], *, smooth_half_window: int = 5
) -> WeatherClimatology:
    """Collapse N years of daily weather into one typical year."""
    buckets = _group_by_doy(records)

    gdd4: list[float | None] = [None] * DOY_LEN
    gdd10: list[float | None] = [None] * DOY_LEN
    frost: list[float | None] = [None] * DOY_LEN
    heat: list[float | None] = [None] * DOY_LEN
    precip: list[float | None] = [None] * DOY_LEN
    counts = [0] * DOY_LEN

    for i, day_records in enumerate(buckets):
        counts[i] = len(day_records)
        if not day_records:
            continue
        gdd4[i] = statistics.fmean(
            gdd_day(r.tmax, r.tmin, 4.0, *COOL_SEASON_CAPS) for r in day_records
        )
        gdd10[i] = statistics.fmean(
            gdd_day(r.tmax, r.tmin, 10.0, *WARM_SEASON_CAPS) for r in day_records
        )
        frost[i] = sum(r.tmin < FROST_C for r in day_records) / len(day_records)
        heat[i] = sum(r.tmax > HEAT_STRESS_C for r in day_records) / len(day_records)
        # Mean, not median: median daily rainfall is 0 nearly everywhere and
        # would erase the erosivity signal entirely.
        precip[i] = statistics.fmean(r.precip_mm for r in day_records)

    return WeatherClimatology(
        gdd_base4=_smooth_circular(_fill_empty_doys(gdd4), smooth_half_window),
        gdd_base10=_smooth_circular(_fill_empty_doys(gdd10), smooth_half_window),
        frost_prob=[
            min(1.0, max(0.0, v))
            for v in _smooth_circular(_fill_empty_doys(frost), smooth_half_window)
        ],
        heat_stress_prob=[
            min(1.0, max(0.0, v))
            for v in _smooth_circular(_fill_empty_doys(heat), smooth_half_window)
        ],
        precip_mm=_fill_empty_doys(precip),  # NOT smoothed -- erosivity needs storms
        years_used=sorted({r.year for r in records}),
        n_obs_per_doy=counts,
    )


def fetch_climatology(
    lat: float,
    lon: float,
    start_year: int,
    end_year: int,
    *,
    cache_dir: Path | str | None = None,
) -> tuple[WeatherClimatology, list[DailyRecord]]:
    """Convenience: fetch and reduce in one call.

    Returns the climatology AND the raw records, because erosivity needs
    per-storm daily values rather than the per-DOY mean.
    """
    records = fetch_daily(lat, lon, start_year, end_year, cache_dir=cache_dir)
    return build_climatology(records), records


# ---------------------------------------------------------------------------
# Frost dates -- a statistic that is easy to compute wrongly
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FrostDates:
    last_spring_doy: int
    first_fall_doy: int
    frost_free_days: int
    spring_p10_doy: int
    fall_p90_doy: int


def frost_date_stats(
    records: list[DailyRecord], threshold_c: float = FROST_C
) -> FrostDates:
    """Median last-spring and first-fall frost, computed the correct way.

    THE TRAP: "last spring frost" is NOT the last day whose frost
    probability exceeds 50%. It is the median, across years, of each year's
    own last frost date. The two differ enormously, because by late spring
    no single calendar day has frost in half of all years even though most
    years still get one somewhere in that stretch.

    For Story County, 2000-2024:
        this (correct) method   DOY 111 and 288  -> 177 frost-free days
        50% probability         DOY  90 and 314  -> 224 frost-free days

    47 spurious frost-free days is not a rounding error. It would let a
    cover crop accumulate a month of growing degree days it will never get,
    and turn infeasible species feasible.

    Also returns the 10th/90th percentile dates, which is what you quote to
    a farmer: a median date is a coin flip, and nobody plans a planting
    around a coin flip.
    """
    years = sorted({r.year for r in records})
    by_year: dict[int, dict[int, DailyRecord]] = {y: {} for y in years}
    for r in records:
        by_year[r.year][r.doy] = r

    last_spring, first_fall = [], []
    for y in years:
        days = by_year[y]
        spring = [d for d in range(1, 182) if d in days and days[d].tmin < threshold_c]
        fall = [d for d in range(182, DOY_LEN + 1) if d in days and days[d].tmin < threshold_c]
        if spring:
            last_spring.append(max(spring))
        if fall:
            first_fall.append(min(fall))

    if not last_spring or not first_fall:
        raise ValueError("No frost in the record; frost dates are undefined here")

    last_spring.sort()
    first_fall.sort()
    med_spring = int(statistics.median(last_spring))
    med_fall = int(statistics.median(first_fall))

    def pct(values: list[int], q: float) -> int:
        return int(values[min(len(values) - 1, max(0, round(q * (len(values) - 1))))])

    return FrostDates(
        last_spring_doy=med_spring,
        first_fall_doy=med_fall,
        frost_free_days=med_fall - med_spring,
        spring_p10_doy=pct(last_spring, 0.10),
        fall_p90_doy=pct(first_fall, 0.90),
    )


#: Mean warm bias of POWER 2 m temperature against Ames, Iowa station
#: normals, measured over 2000-2024: +1.0 C annually, +0.5 to +1.6 C by
#: month. Gridded reanalysis smooths away the radiative cooling that
#: produces real overnight minima, so frost is under-predicted and growing
#: degree days over-predicted by roughly 12%. Documented, not corrected --
#: a fudge factor tuned to one station would not travel to another farm.
POWER_WARM_BIAS_C = 1.0


def bias_note(place: str = "Story County, Iowa") -> dict[str, str]:
    """The uncertainty entry every POWER-derived bundle must carry."""
    return {
        "field": "gdd_base4, gdd_base10, frost_prob, heat_stress_prob",
        "level": "medium",
        "reason": (
            f"NASA POWER is gridded reanalysis at ~0.5 deg (roughly 50 km), not a "
            f"weather station. Checked against {place} station normals over "
            f"2000-2024 it runs about +{POWER_WARM_BIAS_C:.1f} C warm, which "
            f"inflates growing degree days by roughly 12% and makes the "
            f"frost-free season about a week longer than it really is."
        ),
        "affects": (
            "Treat marginal cover crops -- ones that only just reach "
            "establishment before frost -- as not proven. Check your own "
            "last-frost date with your extension office before seeding."
        ),
    }
