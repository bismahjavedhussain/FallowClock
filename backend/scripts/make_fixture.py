"""Generate the synthetic fixture -- the H2 deliverable that unblocks the UI.

The UI pair builds against this and NOTHING else until H14. Which means the
numbers have to be realistic enough that the ring looks right when real data
replaces them. A fixture of random noise would let the UI ship a layout that
falls apart on contact with Iowa.

Everything here is shaped from published Iowa agronomy:
  * corn green-up ~DOY 150, senescence ~DOY 255, harvest ~DOY 288
  * soybean a little later in, a little earlier out, far less residue
  * rainfall erosivity peaking May-June
  * last spring frost ~DOY 118, first fall frost ~DOY 283

provenance.is_synthetic is True. The UI MUST render a banner when it sees
that flag -- the one unforgivable demo failure is showing fake data by
accident.

    python scripts/make_fixture.py
"""

from __future__ import annotations

import math
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fallowclock.erosivity import peak_window_doy  # noqa: E402
from fallowclock.gaps import bare_days, build_gaps, exposed_erosivity  # noqa: E402
from fallowclock.schema import (  # noqa: E402
    DOY_LEN,
    Bundle,
    Climatology,
    CropCurve,
    Farm,
    ObservedRotation,
    ObservedYear,
    Provenance,
    Rotation,
    Source,
    Uncertainty,
    write_bundle,
)
from fallowclock.cropfit import load_species  # noqa: E402

DOYS = list(range(1, DOY_LEN + 1))


def double_logistic(
    greenup: float, senescence: float, vmax: float, slope_up=0.16, slope_down=0.13
) -> list[float]:
    """Standard phenology curve. Same shape a real NDVI fit produces, which
    is the point -- the UI should be laid out against the real thing."""
    out = []
    for d in DOYS:
        rise = 1.0 / (1.0 + math.exp(-slope_up * (d - greenup)))
        fall = 1.0 / (1.0 + math.exp(-slope_down * (d - senescence)))
        out.append(max(0.0, vmax * (rise - fall)))
    return out


def residue_curve(
    harvest_doy: int,
    initial: float,
    decay_per_day: float,
    tillage: list[tuple[int, float]],
) -> list[float]:
    """Residue after harvest, decaying over winter, knocked down at each
    tillage pass. Wraps the year, because that is when it matters.

    `tillage` is [(doy, level_after), ...]. Tillage is what actually drives
    an Iowa field bare -- stover left undisturbed stays above the 30% line
    all winter, which is precisely why no-till scores so differently here.
    """
    out = [0.0] * DOY_LEN
    till = {d: lvl for d, lvl in tillage}
    level = initial
    for step in range(DOY_LEN):
        d = (harvest_doy - 1 + step) % DOY_LEN + 1
        if d in till:
            level = till[d]
        out[d - 1] = level
        level = max(0.05, level - decay_per_day)
    return out


def corn_year() -> tuple[list[float], list[float]]:
    """Corn leaves heavy stover (~55% cover at harvest), but the fall chisel
    pass buries most of it and the spring pass finishes the job."""
    green = double_logistic(greenup=152, senescence=255, vmax=0.92)
    residue = residue_curve(
        harvest_doy=288,
        initial=0.55,
        decay_per_day=0.0009,
        tillage=[(325, 0.26), (118, 0.07)],
    )
    return green, residue


def soybean_year() -> tuple[list[float], list[float]]:
    """Soybean residue is thin and decomposes fast. The soybean-to-corn
    winter is the genuinely bare one, and the reason the gap is so wide."""
    green = double_logistic(greenup=163, senescence=248, vmax=0.86)
    residue = residue_curve(
        harvest_doy=275,
        initial=0.26,
        decay_per_day=0.0008,
        tillage=[(325, 0.14), (118, 0.05)],
    )
    return green, residue


def cereal_rye_observed() -> list[float]:
    """What a rye cover crop actually looks like: seeded after October
    harvest, slow fall growth, dormant, then a fast spring flush before
    termination in early May."""
    out = [0.0] * DOY_LEN
    for d in DOYS:
        i = d - 1
        if 292 <= d <= DOY_LEN:  # fall establishment
            out[i] = min(0.45, 0.012 * (d - 292))
        elif d <= 60:  # winter dormancy, holds cover
            out[i] = 0.34
        elif 61 <= d <= 125:  # spring flush
            out[i] = min(0.78, 0.34 + 0.0075 * (d - 61))
        elif 126 <= d <= 136:  # termination
            out[i] = max(0.0, 0.78 - 0.07 * (d - 126))
    return out


def erosivity_iowa() -> list[float]:
    """Rainfall erosivity peaking May-June. If this ever peaks in January
    the IMERG day-of-year join has an off-by-one -- see the plan's
    verification section."""
    out = []
    for d in DOYS:
        main = 26.0 * math.exp(-(((d - 158) / 52.0) ** 2))
        shoulder = 7.0 * math.exp(-(((d - 250) / 60.0) ** 2))
        out.append(round(0.5 + main + shoulder, 4))
    return out


def gdd_curve(tbase: float) -> list[float]:
    """Daily GDD from a sinusoidal Iowa temperature year."""
    out = []
    for d in DOYS:
        tmean = 10.5 - 14.0 * math.cos(2 * math.pi * (d - 15) / DOY_LEN)
        out.append(round(max(0.0, tmean - tbase), 4))
    return out


def frost_probability() -> list[float]:
    """P(Tmin < 0 C). Crosses 0.5 near DOY 118 (last spring) and DOY 283
    (first fall), which is Story County."""
    out = []
    for d in DOYS:
        if d <= 150:
            p = 1.0 / (1.0 + math.exp(0.11 * (d - 118)))
        elif d >= 240:
            p = 1.0 / (1.0 + math.exp(-0.11 * (d - 283)))
        else:
            p = 0.0
        out.append(round(min(1.0, max(0.0, p)), 4))
    return out


def heat_stress_probability() -> list[float]:
    return [
        round(max(0.0, 0.46 * math.exp(-(((d - 199) / 34.0) ** 2))), 4) for d in DOYS
    ]


def soil_moisture_curve() -> list[float]:
    """SMAP-like: wet spring, late-summer drawdown. COARSE -- regional only."""
    return [
        round(0.28 + 0.09 * math.cos(2 * math.pi * (d - 110) / DOY_LEN), 4)
        for d in DOYS
    ]


def obs_per_doy() -> list[int]:
    """Usable observations in the +/-8 day window across 8 years x 2 sensor
    families. Iowa loses most winter scenes to cloud and snow, and that
    thinness is exactly what the ring's confidence shading should show."""
    out = []
    for d in DOYS:
        seasonal = 11.0 + 6.0 * math.sin(2 * math.pi * (d - 100) / DOY_LEN)
        jitter = 1.6 * math.sin(d * 2.7)
        out.append(max(2, int(round(seasonal + jitter))))
    return out


def blend(a: list[float], b: list[float]) -> list[float]:
    """The field alternates corn and soybean, so its typical year is the
    mean of the two. The per-crop curves live in crop_curves, and the
    rotation comparison splices THOSE rather than this blend."""
    return [(x + y) / 2.0 for x, y in zip(a, b)]


def union(*curves: list[float]) -> list[float]:
    return [max(vals) for vals in zip(*curves)]


def build() -> Bundle:
    corn_green, corn_residue = corn_year()
    soy_green, soy_residue = soybean_year()
    rye = cereal_rye_observed()

    green = blend(corn_green, soy_green)
    residue = blend(corn_residue, soy_residue)
    soil_cover = union(green, residue)

    erosivity = erosivity_iowa()
    gdd4 = gdd_curve(4.0)
    gdd10 = gdd_curve(10.0)
    frost = frost_probability()
    moisture = soil_moisture_curve()
    n_obs = obs_per_doy()

    gaps = build_gaps(soil_cover, erosivity)

    # --- rotations -------------------------------------------------------
    current_cover = soil_cover
    current_exposed = exposed_erosivity(current_cover, erosivity)

    rye_cover = union(soil_cover, rye)
    rye_exposed = exposed_erosivity(rye_cover, erosivity)

    # Extended rotation: oats underseeded with red clover in the third year
    # holds cover across most of the late summer and the following spring.
    small_grain = double_logistic(greenup=105, senescence=190, vmax=0.80)
    clover = [0.55 if 150 <= d <= 365 or d <= 130 else 0.0 for d in DOYS]
    extended_cover = union(soil_cover, small_grain, clover)
    extended_exposed = exposed_erosivity(extended_cover, erosivity)

    rotations = [
        Rotation(
            id="corn_soy",
            label="Corn-Soybean (current)",
            sequence=["corn", "soybean"],
            is_current=True,
            soil_cover=current_cover,
            bare_days=bare_days(current_cover),
            exposed_r=current_exposed,
            delta_vs_current_pct=0.0,
        ),
        Rotation(
            id="corn_soy_rye",
            label="Corn-Soybean + cereal rye",
            sequence=["corn", "cereal_rye", "soybean", "cereal_rye"],
            soil_cover=rye_cover,
            bare_days=bare_days(rye_cover),
            exposed_r=rye_exposed,
            delta_vs_current_pct=(rye_exposed - current_exposed)
            / current_exposed
            * 100.0,
            added_seed_cost_usd_ha=62.0,
        ),
        Rotation(
            id="corn_soy_oat_clover",
            label="Corn-Soybean-Oat/Clover",
            sequence=["corn", "soybean", "oats", "red_clover"],
            soil_cover=extended_cover,
            bare_days=bare_days(extended_cover),
            exposed_r=extended_exposed,
            delta_vs_current_pct=(extended_exposed - current_exposed)
            / current_exposed
            * 100.0,
            added_seed_cost_usd_ha=138.0,
            n_credit_kg_ha=90.0,
        ),
    ]

    species = load_species(Path(__file__).resolve().parents[1] / "data" / "species.csv")

    return Bundle(
        farm=Farm(
            id="synthetic-story-ia",
            owner_name="SYNTHETIC FIXTURE -- not a real farm",
            place="Story County, Iowa (synthetic)",
            centroid=(-93.62, 42.03),
            area_ha=64.7,
            polygon_geojson={
                "type": "Polygon",
                "coordinates": [
                    [
                        [-93.628, 42.026],
                        [-93.613, 42.026],
                        [-93.613, 42.035],
                        [-93.628, 42.035],
                        [-93.628, 42.026],
                    ]
                ],
            },
        ),
        provenance=Provenance(
            generated_at=datetime.now(timezone.utc),
            years_used=list(range(2017, 2026)),
            is_synthetic=True,
            sources=[
                Source(
                    name="SYNTHETIC",
                    collection_id="none",
                    n_obs=0,
                    citation="Generated by scripts/make_fixture.py. Not real data.",
                )
            ],
        ),
        climatology=Climatology(
            green_cover=green,
            green_cover_p25=[max(0.0, v - 0.11) for v in green],
            green_cover_p75=[min(1.0, v + 0.11) for v in green],
            residue_cover=residue,
            soil_cover=soil_cover,
            n_obs_per_doy=n_obs,
            erosivity_r=erosivity,
            erosivity_peak_doy=peak_window_doy(erosivity),
            gdd_base4=gdd4,
            gdd_base10=gdd10,
            frost_prob=frost,
            heat_stress_prob=heat_stress_probability(),
            soil_moisture=moisture,
        ),
        observed_rotation=ObservedRotation(
            inferred_label="Corn-Soybean, no cover crop",
            years=[
                ObservedYear(
                    year=y,
                    cdl_crop="Corn" if y % 2 == 1 else "Soybeans",
                    cdl_code=1 if y % 2 == 1 else 5,
                    planting_doy=125 if y % 2 == 1 else 138,
                    harvest_doy=288 if y % 2 == 1 else 275,
                    cover_crop_detected=False,
                )
                for y in range(2017, 2026)
            ],
        ),
        gaps=gaps,
        crop_curves={
            "corn": CropCurve(
                green_cover=corn_green,
                n_fields=1,
                source="observed",
                detection="SYNTHETIC. Real version: this field's own CDL corn years.",
            ),
            "soybean": CropCurve(
                green_cover=soy_green,
                n_fields=1,
                source="observed",
                detection="SYNTHETIC. Real version: this field's own CDL soybean years.",
            ),
            "cereal_rye": CropCurve(
                green_cover=rye,
                n_fields=187,
                source="observed",
                detection=(
                    "SYNTHETIC. Real version: CDL corn/soy fields in Story County "
                    "showing winter NDVI > 0.3 between harvest and next planting."
                ),
            ),
        },
        species=species,
        rotations=rotations,
        uncertainty=[
            Uncertainty(
                field="ALL",
                level="high",
                reason="This bundle is synthetic. No satellite data was used.",
                affects="Nothing here should be shown to a farmer or a judge.",
            ),
            Uncertainty(
                field="residue_cover",
                level="medium",
                reason=(
                    "NDTI is strongly moisture-sensitive; published work shows "
                    "moisture variability cutting the NDTI-residue R2 by up to 60%. "
                    "We drop pixels with >3 mm IMERG rain in the prior 2 days and "
                    "pixels with NDVI > 0.3, which removes much but not all of it."
                ),
                affects=(
                    "Residue cover may be overestimated after wet periods. Treat "
                    "the bare/covered line as approximate within a week or two."
                ),
            ),
            Uncertainty(
                field="soil_moisture",
                level="high",
                reason="SMAP is 9-11 km; this field is 65 ha. A single SMAP pixel "
                "covers roughly 1,500 fields of this size.",
                affects="Use as a regional planting-window flag only. Check your "
                "own field before seeding.",
            ),
            Uncertainty(
                field="n_obs_per_doy",
                level="medium",
                reason="Iowa loses most winter satellite scenes to cloud and snow. "
                "Mid-winter cover estimates rest on far fewer observations.",
                affects="The ring grays out thin-evidence days. Trust those arcs "
                "less than the summer ones.",
            ),
        ],
    )


if __name__ == "__main__":
    bundle = build()
    out_dir = Path(__file__).resolve().parents[2] / "frontend" / "public" / "bundles"
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "farm_synthetic.json"
    write_bundle(bundle, str(target))

    cl = bundle.climatology
    print(f"wrote {target}")
    print(f"  bare days (current):   {bare_days(cl.soil_cover)}")
    print(f"  gaps found:            {len(bundle.gaps)}")
    for g in bundle.gaps:
        print(
            f"    DOY {g.start_doy:>3}-{g.end_doy:<3} "
            f"{g.n_days:>3}d  {g.share_of_annual_r*100:5.1f}% of annual R"
            f"{'  (wraps)' if g.wraps_year else ''}"
        )
    print(f"  peak erosivity at DOY: {cl.erosivity_r.index(max(cl.erosivity_r)) + 1}")
    for r in bundle.rotations:
        print(
            f"  {r.label:<32} {r.bare_days:>3} bare days  "
            f"{r.delta_vs_current_pct:+6.1f}% exposed R"
        )
