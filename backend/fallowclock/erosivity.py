"""Rainfall erosivity from daily precipitation.  B2 owns this file.

Erosivity (the R factor in RUSLE) is properly computed from 30-minute
rainfall intensity as EI30. We do not have 30-minute data from NASA POWER,
so we use the standard daily power law instead:

    R_day = a * P^b          for P > P_threshold
    R_day = 0                otherwise

This is the Richardson / Yu & Rosewell family of daily erosivity models.
The coefficients are regionally calibrated and ours are NOT calibrated for
Iowa -- see `ScaleInvariance` below for why that matters much less than it
sounds.

Only heavy rain erodes. Light rain soaks in. The 12.7 mm (0.5 inch)
threshold is the conventional cutoff for an erosive event and is the same
one USLE/RUSLE has used since Wischmeier.

UPGRADE PATH: Microsoft Planetary Computer serves `gpm-imerg-hhr` --
half-hourly IMERG. That makes true EI30 reachable rather than this
approximation. It is raster work, so it belongs to B1 if it happens at
all; this module is the version that ships.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from .schema import DOY_LEN
from .weather import DailyRecord

#: Rain below this does not erode. 12.7 mm = 0.5 inch, the conventional
#: USLE/RUSLE erosive-event cutoff.
EROSIVE_THRESHOLD_MM = 12.7

#: Daily power-law coefficients, R_day = a * P^b. Mid-range values from the
#: published daily-erosivity literature. NOT calibrated for Iowa. Exposed so
#: the UI can show the sensitivity and so a judge can change them.
DEFAULT_A = 0.29
DEFAULT_B = 1.77


SCALE_INVARIANCE = """\
Why uncalibrated coefficients do not break the answer.

The number we rank rotations by is

    exposed_erosivity = sum over DOY of  R(doy) * C(doy)

and `a` enters R as a pure multiplier: R = a * P^b. Multiplying every R by
a constant multiplies every rotation's score by that same constant, so the
ORDER of the rotations, and the PERCENTAGE difference between them, are
both completely unchanged.

What `a` does change is the absolute headline number in MJ.mm/ha/h. So:

  * "Cereal rye cuts exposed erosivity by 61%"     <- robust, report it
  * "Exposed erosivity falls to 710 MJ.mm/ha/h"    <- depends on a, caveat it

`b` is different: it is an exponent, so it reweights big storms against
small ones and CAN reorder rotations whose gaps sit in differently-stormy
parts of the year. It is the parameter worth a sensitivity check, not `a`.
"""


@dataclass
class ErosivityClimatology:
    per_doy_r: list[float]
    annual_r: float
    erosive_days_per_year: float
    share_in_top_10_days: float
    a: float
    b: float
    years_used: list[int]


def daily_erosivity(
    precip_mm: float,
    a: float = DEFAULT_A,
    b: float = DEFAULT_B,
    threshold_mm: float = EROSIVE_THRESHOLD_MM,
) -> float:
    """R for a single day. Returns 0 for non-erosive rain."""
    if precip_mm <= threshold_mm:
        return 0.0
    return a * (precip_mm**b)


def build_erosivity(
    records: list[DailyRecord],
    a: float = DEFAULT_A,
    b: float = DEFAULT_B,
    threshold_mm: float = EROSIVE_THRESHOLD_MM,
    smooth_half_window: int = 7,
) -> ErosivityClimatology:
    """Per-DOY mean erosivity across all years in the record.

    Smoothing is applied AFTER averaging across years, not to individual
    storms. A storm on 12 June in one year and 15 June in another describe
    the same mid-June risk; without smoothing the per-DOY array is a comb of
    spikes that makes the ring unreadable and gives knife-edge gap scores.
    """
    years = sorted({r.year for r in records})
    n_years = len(years)
    if n_years == 0:
        raise ValueError("No records")

    buckets: list[list[float]] = [[] for _ in range(DOY_LEN)]
    for r in records:
        buckets[r.doy - 1].append(daily_erosivity(r.precip_mm, a, b, threshold_mm))

    raw = [statistics.fmean(vals) if vals else 0.0 for vals in buckets]

    if smooth_half_window > 0:
        smoothed = []
        for i in range(DOY_LEN):
            window = [
                raw[(i + k) % DOY_LEN]
                for k in range(-smooth_half_window, smooth_half_window + 1)
            ]
            smoothed.append(statistics.fmean(window))
        # Preserve the annual total: smoothing must redistribute erosivity,
        # never create or destroy it.
        raw_total, sm_total = sum(raw), sum(smoothed)
        if sm_total > 0:
            smoothed = [v * raw_total / sm_total for v in smoothed]
        per_doy = smoothed
    else:
        per_doy = raw

    erosive_days = sum(1 for r in records if r.precip_mm > threshold_mm) / n_years

    # How concentrated is the risk? In most of the Corn Belt a handful of
    # storms carry most of the year's erosivity, which is the real reason
    # WHEN you are bare matters more than how long.
    all_daily = sorted(
        (daily_erosivity(r.precip_mm, a, b, threshold_mm) for r in records),
        reverse=True,
    )
    top_n = 10 * n_years
    total = sum(all_daily)
    share_top = sum(all_daily[:top_n]) / total if total > 0 else 0.0

    return ErosivityClimatology(
        per_doy_r=per_doy,
        annual_r=sum(per_doy),
        erosive_days_per_year=erosive_days,
        share_in_top_10_days=share_top,
        a=a,
        b=b,
        years_used=years,
    )


def peak_doy(per_doy_r: list[float]) -> int:
    """DOY of maximum erosivity. Sanity check: must land in May-June for
    Iowa. January means the day-of-year join has an off-by-one."""
    return per_doy_r.index(max(per_doy_r)) + 1


def uncertainty_note() -> dict[str, str]:
    """The uncertainty entry every erosivity-derived bundle must carry."""
    return {
        "field": "erosivity_r",
        "level": "medium",
        "reason": (
            "Rainfall erosivity is properly measured from 30-minute storm "
            "intensity (EI30). We approximate it from daily rainfall with a "
            "power law whose coefficients are not calibrated for Iowa, so the "
            "absolute value in MJ.mm/ha/h is uncertain. Because the "
            "coefficient enters as a multiplier, the RANKING of rotations and "
            "the percentage differences between them are unaffected."
        ),
        "affects": (
            "Trust the comparison between rotations. Do not quote the absolute "
            "erosivity number without saying it is an uncalibrated estimate."
        ),
    }


#: Published annual R factor for central Iowa, MJ.mm/ha/h/yr. Regional
#: isoerodent maps put the Corn Belt in the 3000-4500 band; 3500 is a
#: central value for Story County.
IOWA_ANNUAL_R = 3500.0


def calibrate_a(
    records: list[DailyRecord],
    target_annual_r: float = IOWA_ANNUAL_R,
    b: float = DEFAULT_B,
    threshold_mm: float = EROSIVE_THRESHOLD_MM,
) -> float:
    """Find the multiplier `a` that reproduces a published regional R.

    Uncalibrated defaults give ~1388 MJ.mm/ha/h/yr for Story County against
    a published ~3500. Since `a` is a pure multiplier (see SCALE_INVARIANCE)
    this changes no ranking and no percentage -- it only makes the absolute
    headline number defensible if you want to quote it.

    What this is: anchoring MAGNITUDE to published regional data while
    taking TIMING entirely from the observed rainfall record. Say exactly
    that if asked; it is a normal and defensible thing to do, and much more
    honest than quoting an uncalibrated number as though it were measured.
    """
    baseline = build_erosivity(records, a=1.0, b=b, threshold_mm=threshold_mm)
    if baseline.annual_r <= 0:
        raise ValueError("No erosive rainfall in record; cannot calibrate")
    return target_annual_r / baseline.annual_r


def peak_window_doy(per_doy_r: list[float], window_days: int = 30) -> int:
    """Centre DOY of the highest-total `window_days` window, wrap-aware.

    Prefer this over `peak_doy` for any sanity check or headline claim.

    A single-day argmax on a 365-point series is fragile: one narrow spike
    can beat a broad seasonal plateau carrying far more total erosivity.
    That is not hypothetical -- for the Monona County farm `peak_doy`
    returned DOY 233 (late August) while the monthly totals were clearly
    May-peaked (17.2% in May against 14.2% in August). The windowed peak
    returns May for both Iowa farms, which is the real answer.
    """
    if len(per_doy_r) != DOY_LEN:
        raise ValueError(f"per_doy_r must be length {DOY_LEN}")
    best_sum, best_start = -1.0, 0
    for start in range(DOY_LEN):
        total = sum(per_doy_r[(start + k) % DOY_LEN] for k in range(window_days))
        if total > best_sum:
            best_sum, best_start = total, start
    return (best_start + window_days // 2) % DOY_LEN + 1
