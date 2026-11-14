"""Is anything actually shifting?

The challenge is called Field Shift, and until now this tool answered a
static question: what does an average year look like. An average built
from 2000-2024 cannot tell you whether 2024 differs from 2000. This
module asks that, from the same NASA POWER record the rest of the model
runs on.

WHAT IS AND IS NOT TRENDED HERE. Weather is: one source, one point,
9,125 consecutive days, every year equally observed. A per-year trend on
that is honest.

The BARE WINDOW is deliberately not trended, and that is the important
restraint. Bare days come from 229 Landsat and 481 Sentinel-2 scenes
spread over about ten years -- roughly seventy clear looks a year, fewer
in an Iowa winter. A per-year 365-day cover curve from seventy scenes
would be mostly interpolation, and a trend fitted to it would be a trend
in cloud cover as much as in cropping. So this reports how the WEATHER
the field must cope with is moving, and leaves the field's own response
to the climatology, which has the scenes pooled across years and can
support it.

THEIL-SEN AND MANN-KENDALL, not least squares. Twenty-five annual values
is a short series and one flood year drags an OLS slope hard. Theil-Sen
takes the median of all pairwise slopes, so a single outlier moves it
very little, and Mann-Kendall tests monotonic trend by rank, assuming no
distribution. They are the standard pair for exactly this: short,
noisy, non-normal climate series.

A NULL RESULT IS A RESULT. Most of these will come back
not-significant over 25 years, and the tool says so rather than
reporting a slope as if it meant something.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .erosivity import daily_erosivity
from .weather import DailyRecord

DOY_LEN = 365

#: Below this many years a trend is not worth fitting.
MIN_YEARS = 10

#: Two-sided p below this counts as a real trend. 0.05 is convention; the
#: bundle carries the p-value too, so a reader can disagree.
ALPHA = 0.05

#: Killing frost. Matches the threshold the frost-date stats use.
FROST_C = 0.0


@dataclass(frozen=True)
class Trend:
    """A fitted trend over whole years, with its own verdict attached."""

    metric: str
    unit: str
    #: One (year, value) per year, in year order. Kept so the UI can draw it.
    years: list[int]
    values: list[float]
    #: Theil-Sen slope, in `unit` per decade.
    slope_per_decade: float
    #: Mann-Kendall two-sided p.
    p_value: float
    #: True when p < ALPHA. The only field a headline should read.
    significant: bool
    #: Plain-language direction: 'earlier', 'later', 'up', 'down', 'flat'.
    direction: str

    def as_dict(self) -> dict:
        return {
            "metric": self.metric,
            "unit": self.unit,
            "years": self.years,
            "values": [round(v, 4) for v in self.values],
            "slope_per_decade": round(self.slope_per_decade, 4),
            "p_value": round(self.p_value, 5),
            "significant": self.significant,
            "direction": self.direction,
        }


def theil_sen(xs: list[float], ys: list[float]) -> float:
    """Median of all pairwise slopes. Robust to a handful of odd years."""
    if len(xs) != len(ys):
        raise ValueError("xs and ys must be the same length")
    slopes = [
        (ys[j] - ys[i]) / (xs[j] - xs[i])
        for i in range(len(xs))
        for j in range(i + 1, len(xs))
        if xs[j] != xs[i]
    ]
    if not slopes:
        return 0.0
    slopes.sort()
    mid = len(slopes) // 2
    return slopes[mid] if len(slopes) % 2 else (slopes[mid - 1] + slopes[mid]) / 2.0


def mann_kendall_p(ys: list[float]) -> float:
    """Two-sided p for a monotonic trend, normal approximation with ties.

    Returns 1.0 (no evidence) for series too short to say anything.
    """
    n = len(ys)
    if n < 4:
        return 1.0
    s = 0
    for i in range(n - 1):
        for j in range(i + 1, n):
            s += (ys[j] > ys[i]) - (ys[j] < ys[i])

    # Variance, corrected for tied values -- annual DOYs tie often.
    counts: dict[float, int] = {}
    for y in ys:
        counts[y] = counts.get(y, 0) + 1
    tie_term = sum(t * (t - 1) * (2 * t + 5) for t in counts.values() if t > 1)
    var = (n * (n - 1) * (2 * n + 5) - tie_term) / 18.0
    if var <= 0:
        return 1.0

    # Continuity correction: S never sits exactly on the mean.
    if s > 0:
        z = (s - 1) / math.sqrt(var)
    elif s < 0:
        z = (s + 1) / math.sqrt(var)
    else:
        return 1.0
    return 2.0 * (1.0 - 0.5 * (1.0 + math.erf(abs(z) / math.sqrt(2.0))))


def fit_trend(metric: str, unit: str, by_year: dict[int, float], *, lower_is_earlier: bool = False) -> Trend | None:
    """Fit one metric. None when there are too few years to bother."""
    years = sorted(by_year)
    if len(years) < MIN_YEARS:
        return None
    values = [by_year[y] for y in years]
    slope_year = theil_sen([float(y) for y in years], values)
    p = mann_kendall_p(values)
    significant = p < ALPHA
    if not significant:
        direction = "flat"
    elif lower_is_earlier:
        direction = "earlier" if slope_year < 0 else "later"
    else:
        direction = "down" if slope_year < 0 else "up"
    return Trend(
        metric=metric,
        unit=unit,
        years=years,
        values=values,
        slope_per_decade=slope_year * 10.0,
        p_value=p,
        significant=significant,
        direction=direction,
    )


def _by_year(records: list[DailyRecord]) -> dict[int, list[DailyRecord]]:
    out: dict[int, list[DailyRecord]] = {}
    for r in records:
        out.setdefault(r.year, []).append(r)
    return out


def _complete_years(grouped: dict[int, list[DailyRecord]], min_days: int = 350) -> dict[int, list[DailyRecord]]:
    """Drop part-years. A year missing November is not a shorter year."""
    return {y: rs for y, rs in grouped.items() if len(rs) >= min_days}


def annual_bare_window_share(
    records: list[DailyRecord], a: float, b: float, start_doy: int, end_doy: int
) -> dict[int, float]:
    """Fraction of each year's erosive rain that fell while the field was bare.

    THIS IS THE METRIC THE PROJECT ACTUALLY CARES ABOUT, and it replaces a
    per-year peak date, which was tried first and had to be thrown out.

    Why the peak date failed: the heaviest-30-day window is an ARGMAX over
    one year's storms, and a single large August cell moves it by months.
    Across Monona's 25 years it bounced between DOY 100 and 286 with no
    stable centre, and Theil-Sen read a 40-day-per-decade drift out of
    that scatter at p=0.017 -- a number the underlying measurement cannot
    support. peak_window_doy is only trustworthy on the pooled
    climatology, where 25 years of storms are stacked; one year is noise.
    The codebase already carries this warning for peak_doy, and the
    windowed version is merely less fragile, not robust.

    This instead integrates erosivity over the field's bare window and
    divides by the year's total. An integral over ~83 days is stable where
    an argmax is not, it is a bounded 0-1 scalar so no circular-statistics
    trap, and it answers the question directly: is the hard rain
    increasingly arriving while the ground is open?

    The window is the climatological gap, held FIXED across years on
    purpose. Letting it move per year would confound a shift in the
    weather with a shift in the cropping, and the scene count cannot
    support a per-year bare window anyway -- see the module docstring.
    """
    if not 1 <= start_doy <= DOY_LEN or not 1 <= end_doy <= DOY_LEN:
        raise ValueError("start_doy and end_doy must be 1..365")
    wraps = start_doy > end_doy

    def in_window(doy: int) -> bool:
        return (doy >= start_doy or doy <= end_doy) if wraps else (start_doy <= doy <= end_doy)

    out: dict[int, float] = {}
    for year, rs in _complete_years(_by_year(records)).items():
        total = 0.0
        inside = 0.0
        for r in rs:
            e = daily_erosivity(r.precip_mm, a, b)
            total += e
            if in_window(r.doy):
                inside += e
        if total > 0:
            out[year] = inside / total
    return out


def annual_erosivity_total(records: list[DailyRecord], a: float, b: float) -> dict[int, float]:
    out: dict[int, float] = {}
    for year, rs in _complete_years(_by_year(records)).items():
        out[year] = sum(daily_erosivity(r.precip_mm, a, b) for r in rs)
    return out


def annual_last_spring_frost(records: list[DailyRecord]) -> dict[int, float]:
    """Last DOY before midsummer with a killing frost."""
    out: dict[int, float] = {}
    for year, rs in _complete_years(_by_year(records)).items():
        frosts = [r.doy for r in rs if r.doy <= 182 and r.tmin <= FROST_C]
        if frosts:
            out[year] = float(max(frosts))
    return out


def annual_first_fall_frost(records: list[DailyRecord]) -> dict[int, float]:
    out: dict[int, float] = {}
    for year, rs in _complete_years(_by_year(records)).items():
        frosts = [r.doy for r in rs if r.doy > 182 and r.tmin <= FROST_C]
        if frosts:
            out[year] = float(min(frosts))
    return out


def annual_growing_season_days(records: list[DailyRecord]) -> dict[int, float]:
    """Frost-free days between the last spring and first autumn frost."""
    last = annual_last_spring_frost(records)
    first = annual_first_fall_frost(records)
    return {y: first[y] - last[y] for y in sorted(set(last) & set(first))}


def build_trends(
    records: list[DailyRecord],
    *,
    a: float,
    b: float,
    gap_start_doy: int | None = None,
    gap_end_doy: int | None = None,
) -> list[Trend]:
    """Every trend the weather record can honestly support.

    `a` and `b` are the erosivity power-law coefficients, passed in so the
    trend uses the same calibration as the rest of the bundle rather than
    quietly re-deriving one. The gap window, when given, adds the share
    metric -- the one that speaks to this field rather than to Iowa.
    """
    specs: list[tuple[str, str, dict[int, float], bool]] = []
    if gap_start_doy is not None and gap_end_doy is not None:
        specs.append((
            "bare_window_erosivity_share",
            "fraction of annual R",
            annual_bare_window_share(records, a, b, gap_start_doy, gap_end_doy),
            False,
        ))
    specs += [
        ("annual_erosivity", "R units", annual_erosivity_total(records, a, b), False),
        ("last_spring_frost_doy", "day of year", annual_last_spring_frost(records), True),
        ("first_fall_frost_doy", "day of year", annual_first_fall_frost(records), True),
        ("growing_season_days", "days", annual_growing_season_days(records), False),
    ]
    out = []
    for metric, unit, series, earlier in specs:
        t = fit_trend(metric, unit, series, lower_is_earlier=earlier)
        if t is not None:
            out.append(t)
    return out
