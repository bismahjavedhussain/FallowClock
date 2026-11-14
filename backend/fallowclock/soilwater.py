"""Soil water from a bucket model.  B2 owns this file.

The plan called for SMAP soil moisture. We do not use it, for two reasons:

  1. SMAP needs an Earthdata login, and it is not on Planetary Computer.
  2. SMAP is 9-11 km. One pixel covers roughly 1,500 fields the size of
     the demo farm. Presenting that as field-scale moisture would be the
     kind of overclaim this project is built to avoid.

Instead we run a single-layer bucket water balance driven entirely by the
NASA POWER record we already have:

    storage[d] = clamp( storage[d-1] + rain[d] - ET[d],  0,  capacity )

with reference ET from Hargreaves-Samani, which needs only temperature and
latitude -- no radiation, humidity or wind.

    ET0 = 0.0023 * Ra * (Tmean + 17.8) * sqrt(Tmax - Tmin)

BE CLEAR ABOUT WHAT THIS IS. It is a model, not an observation. It is
*self-consistent* with the rainfall driving the erosivity layer, and it is
at the same spatial scale as everything else from POWER, which SMAP would
not be. But nobody measured it. The bundle says so in its uncertainty
entry, and the UI must label it modelled.

It is used for exactly one decision: is there plausibly enough moisture to
germinate a cover crop in this seeding window. That is a coarse go/no-go,
and a bucket model is adequate for a coarse go/no-go.
"""

from __future__ import annotations

import math
import statistics

from .schema import DOY_LEN
from .weather import DailyRecord

#: Plant-available water in the top ~30 cm of a silty clay loam, mm.
#: Iowa Des Moines Lobe soils hold a lot; a sand would be nearer 40.
DEFAULT_CAPACITY_MM = 150.0

#: Crop coefficient for bare/stubble ground. Actual ET from an uncovered
#: field is well below reference ET -- only soil evaporation, no
#: transpiration.
FALLOW_KC = 0.30

#: Crop coefficient at full canopy closure (FAO-56 mid-season for maize).
FULL_CANOPY_KC = 1.15


def kc_from_cover(green_cover: list[float]) -> list[float]:
    """Crop coefficient from canopy cover: Kc = 0.30 + 0.85 * cover.

    Prefer this over the default seasonal curve once B1's observed green
    cover exists -- it makes the water balance consistent with the same
    satellite record that drives everything else, instead of assuming a
    generic corn season.
    """
    return [FALLOW_KC + (FULL_CANOPY_KC - FALLOW_KC) * c for c in green_cover]


def default_kc_curve() -> list[float]:
    """Fallback Kc when no observed canopy is available yet.

    Shaped like a Corn Belt season: bare until early May, canopy closed
    through July, senescing into an October harvest. A FLAT fallow Kc is
    badly wrong here -- with no crop ever drawing the profile down, the
    bucket stays above 80% capacity all year and every autumn seeding
    window looks comfortably moist when Iowa's are often not.
    """
    import math as _m

    curve = []
    for d in range(1, DOY_LEN + 1):
        rise = 1.0 / (1.0 + _m.exp(-0.14 * (d - 152)))
        fall = 1.0 / (1.0 + _m.exp(-0.12 * (d - 262)))
        cover = max(0.0, rise - fall)
        curve.append(FALLOW_KC + (FULL_CANOPY_KC - FALLOW_KC) * cover)
    return curve

SOLAR_CONSTANT = 0.0820  # MJ / m^2 / min

#: Converts radiation in MJ/m^2/day to its equivalent depth of evaporated
#: water in mm/day (1 / latent heat of vaporisation, 1/2.45).
#:
#: Hargreaves takes Ra in MM/DAY, not MJ. Leaving this out silently doubles
#: every ET estimate -- it gave 13.6 mm/day for an Iowa July against a real
#: ~5-7 -- which drains the bucket model to permanent drought and makes
#: every autumn seeding window look too dry to plant.
MJ_TO_MM = 0.408


def extraterrestrial_radiation(lat_deg: float, doy: int) -> float:
    """Ra in MJ/m^2/day. Pure astronomy -- no measurement involved.

    FAO-56 Chapter 3. Depends only on latitude and day of year, which is
    why Hargreaves works anywhere without extra inputs.
    """
    phi = math.radians(lat_deg)
    dr = 1 + 0.033 * math.cos(2 * math.pi * doy / 365.0)
    decl = 0.409 * math.sin(2 * math.pi * doy / 365.0 - 1.39)

    # Sunset hour angle, guarded for polar day/night where |tan*tan| > 1.
    x = -math.tan(phi) * math.tan(decl)
    ws = math.acos(max(-1.0, min(1.0, x)))

    return (
        (24 * 60 / math.pi)
        * SOLAR_CONSTANT
        * dr
        * (ws * math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.sin(ws))
    )


def hargreaves_et0(tmax: float, tmin: float, lat_deg: float, doy: int) -> float:
    """Reference evapotranspiration, mm/day.

    Hargreaves-Samani. Less accurate than Penman-Monteith but needs only
    what POWER gives us for free. The temperature range term is a proxy for
    cloudiness: clear days swing more and evaporate more.
    """
    tmean = (tmax + tmin) / 2.0
    trange = max(0.0, tmax - tmin)
    ra_mm = extraterrestrial_radiation(lat_deg, doy) * MJ_TO_MM
    return max(0.0, 0.0023 * ra_mm * (tmean + 17.8) * math.sqrt(trange))


def run_bucket(
    records: list[DailyRecord],
    lat_deg: float,
    capacity_mm: float = DEFAULT_CAPACITY_MM,
    kc_by_doy: list[float] | None = None,
    spin_up_days: int = 365,
) -> list[float]:
    """Daily relative soil water (0-1) per DOY, averaged across years.

    Runs the balance continuously through the whole record so storage
    carries across winters, then averages by day of year. `spin_up_days`
    worth of leading output is discarded so the arbitrary initial condition
    cannot bias the climatology.
    """
    if not records:
        raise ValueError("No records")

    if kc_by_doy is None:
        kc_by_doy = default_kc_curve()
    if len(kc_by_doy) != DOY_LEN:
        raise ValueError(f"kc_by_doy must have length {DOY_LEN}, got {len(kc_by_doy)}")

    ordered = sorted(records, key=lambda r: (r.year, r.doy))
    storage = capacity_mm * 0.5  # arbitrary; spin-up removes its influence
    by_doy: list[list[float]] = [[] for _ in range(DOY_LEN)]

    for i, r in enumerate(ordered):
        et = kc_by_doy[r.doy - 1] * hargreaves_et0(r.tmax, r.tmin, lat_deg, r.doy)
        storage = max(0.0, min(capacity_mm, storage + r.precip_mm - et))
        if i >= spin_up_days:
            by_doy[r.doy - 1].append(storage / capacity_mm)

    out: list[float] = []
    for vals in by_doy:
        out.append(statistics.fmean(vals) if vals else 0.0)

    # A DOY with no post-spin-up samples would read 0.0 and look like a
    # drought. Backfill from neighbours instead.
    for i, v in enumerate(out):
        if v == 0.0 and not by_doy[i]:
            neighbours = [
                out[(i + k) % DOY_LEN]
                for k in (-2, -1, 1, 2)
                if by_doy[(i + k) % DOY_LEN]
            ]
            if neighbours:
                out[i] = statistics.fmean(neighbours)
    return out


def uncertainty_note() -> dict[str, str]:
    return {
        "field": "soil_moisture",
        "level": "high",
        "reason": (
            "This is a modelled single-layer bucket water balance driven by "
            "NASA POWER rainfall and Hargreaves reference ET -- not a "
            "measurement. We chose it over SMAP because SMAP is 9-11 km, so "
            "one pixel would cover roughly 1,500 fields this size. The model "
            "ignores runoff, drainage, soil texture and rooting depth."
        ),
        "affects": (
            "Use it only as a coarse go/no-go on whether a seeding window is "
            "plausibly moist. Never read it as your field's actual moisture."
        ),
    }
