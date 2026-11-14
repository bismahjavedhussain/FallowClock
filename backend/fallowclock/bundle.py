"""Bundle assembly.  B2 owns this file.

Takes B1's imagery outputs and B2's weather/risk outputs and produces one
validated Bundle -- the single artifact the frontend consumes.

THE B1 -> B2 HANDOFF is the ImageryInputs dataclass below. That is the only
thing B1 has to produce. Everything downstream of it is B2's problem.

Until B1's pipeline lands, `placeholder_imagery()` supplies clearly-marked
synthetic cover curves so the rest of the pipeline can be built, run and
tested end to end against REAL NASA weather data. Bundles built that way
carry is_synthetic=True, which makes the UI show a red banner. Do not
remove that flag to make a demo look finished.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .cropfit import load_species
from .erosivity import build_erosivity, calibrate_a
from .erosivity import uncertainty_note as erosivity_note
from .gaps import build_gaps
from .rotations import build_standard_rotations
from .schema import (
    DOY_LEN,
    Bundle,
    Climatology,
    CropCurve,
    Farm,
    ObservedRotation,
    ObservedYear,
    Provenance,
    Source,
    Uncertainty,
)
from .sources import check_eligibility, nasa_source
from .soilwater import kc_from_cover, run_bucket
from .soilwater import uncertainty_note as water_note
from .weather import DailyRecord, bias_note, build_climatology, fetch_daily

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


@dataclass
class ImageryInputs:
    """THE B1 -> B2 CONTRACT. B1 produces this; B2 consumes it.

    All arrays length 365, indexed DOY-1, values 0-1.
    """

    green_cover: list[float]
    green_cover_p25: list[float]
    green_cover_p75: list[float]
    residue_cover: list[float]
    n_obs_per_doy: list[int]
    observed_years: list[ObservedYear]
    crop_curves: dict[str, CropCurve]
    sources: list[Source] = field(default_factory=list)
    inferred_label: str = "Unknown rotation"
    is_synthetic: bool = False
    #: One cover array per rotation phase (corn years, soybean years).
    #: Optional but strongly preferred -- without it erosivity is computed
    #: from mean cover, which understates it (Jensen's inequality).
    phase_covers: list[list[float]] | None = None

    def validate(self) -> None:
        for name in (
            "green_cover", "green_cover_p25", "green_cover_p75",
            "residue_cover", "n_obs_per_doy",
        ):
            arr = getattr(self, name)
            if len(arr) != DOY_LEN:
                raise ValueError(f"{name} must be length {DOY_LEN}, got {len(arr)}")
        for i, (lo, hi) in enumerate(zip(self.green_cover_p25, self.green_cover_p75)):
            if lo > hi + 1e-9:
                raise ValueError(f"green_cover_p25[{i}] > p75")


def placeholder_imagery() -> ImageryInputs:
    """Synthetic cover curves so the pipeline runs before B1 lands.

    Shapes are realistic Iowa corn/soybean phenology (see
    scripts/make_fixture.py) but no satellite saw them. Always produces
    is_synthetic=True.
    """
    import math

    def dbl(greenup, senescence, vmax, su=0.16, sd=0.13):
        out = []
        for d in range(1, DOY_LEN + 1):
            rise = 1.0 / (1.0 + math.exp(-su * (d - greenup)))
            fall = 1.0 / (1.0 + math.exp(-sd * (d - senescence)))
            out.append(max(0.0, vmax * (rise - fall)))
        return out

    def residue(harvest, initial, decay, tillage):
        out = [0.0] * DOY_LEN
        till = dict(tillage)
        level = initial
        for step in range(DOY_LEN):
            d = (harvest - 1 + step) % DOY_LEN + 1
            if d in till:
                level = till[d]
            out[d - 1] = level
            level = max(0.05, level - decay)
        return out

    def cereal_rye_literature():
        """Cereal rye as Midwest extension literature describes it.

        Labelled source="literature", NOT "observed" and NOT our thermal
        ramp. It matters: the generic ramp reaches its 85% plateau by early
        November and holds it all winter, which produced a -83% erosivity
        claim and zero bare days. Real Iowa rye manages maybe 30-45% cover
        before dormancy, holds through winter, then flushes in spring
        before termination ahead of planting.

        Replace this the moment B1's detected curve exists -- "we measured
        187 fields that already do this" is a far better answer than "the
        extension bulletin says".
        """
        out = [0.0] * DOY_LEN
        for d in range(1, DOY_LEN + 1):
            i = d - 1
            if 292 <= d <= DOY_LEN:      # fall establishment, slow
                out[i] = min(0.45, 0.012 * (d - 292))
            elif d <= 60:                 # winter dormancy, holds cover
                out[i] = 0.34
            elif 61 <= d <= 125:          # spring flush
                out[i] = min(0.78, 0.34 + 0.0075 * (d - 61))
            elif 126 <= d <= 136:         # termination before planting
                out[i] = max(0.0, 0.78 - 0.07 * (d - 126))
        return out

    corn_g = dbl(152, 255, 0.92)
    soy_g = dbl(163, 248, 0.86)
    rye_g = cereal_rye_literature()
    corn_r = residue(288, 0.55, 0.0009, [(325, 0.26), (118, 0.07)])
    soy_r = residue(275, 0.26, 0.0008, [(325, 0.14), (118, 0.05)])

    green = [(a + b) / 2 for a, b in zip(corn_g, soy_g)]
    res = [(a + b) / 2 for a, b in zip(corn_r, soy_r)]

    return ImageryInputs(
        green_cover=green,
        green_cover_p25=[max(0.0, v - 0.11) for v in green],
        green_cover_p75=[min(1.0, v + 0.11) for v in green],
        residue_cover=res,
        n_obs_per_doy=[0] * DOY_LEN,  # zero = no evidence; the UI grays it out
        observed_years=[
            ObservedYear(
                year=y,
                cdl_crop="Corn" if y % 2 == 1 else "Soybeans",
                cdl_code=1 if y % 2 == 1 else 5,
                planting_doy=125 if y % 2 == 1 else 138,
                harvest_doy=288 if y % 2 == 1 else 275,
            )
            for y in range(2017, 2026)
        ],
        crop_curves={
            "corn": CropCurve(
                green_cover=corn_g, n_fields=1, source="literature",
                detection="SYNTHETIC placeholder. Replace with this field's CDL corn years.",
            ),
            "soybean": CropCurve(
                green_cover=soy_g, n_fields=1, source="literature",
                detection="SYNTHETIC placeholder. Replace with this field's CDL soybean years.",
            ),
            "cereal_rye": CropCurve(
                green_cover=rye_g, n_fields=1, source="literature",
                detection=(
                    "Midwest extension literature, NOT observed. Replace with "
                    "the median curve of CDL corn/soy fields in this county "
                    "showing a spring green signal before cash-crop planting."
                ),
            ),
        },
        sources=[
            Source(
                name="SYNTHETIC cover curves",
                collection_id="none",
                n_obs=0,
                citation="Placeholder from bundle.placeholder_imagery(). Not observed.",
            )
        ],
        inferred_label="Corn-Soybean, no cover crop (placeholder)",
        is_synthetic=True,
        phase_covers=[
            [max(g, r) for g, r in zip(corn_g, corn_r)],
            [max(g, r) for g, r in zip(soy_g, soy_r)],
        ],
    )


def assemble(
    farm: Farm,
    imagery: ImageryInputs,
    records: list[DailyRecord],
    *,
    calibrate_erosivity: bool = True,
    species_csv: Path | str | None = None,
) -> Bundle:
    """Build and validate the complete Bundle."""
    imagery.validate()

    weather = build_climatology(records)
    a = calibrate_a(records) if calibrate_erosivity else None
    erosivity = build_erosivity(records, a=a) if a else build_erosivity(records)

    # Kc from the observed canopy keeps the water balance consistent with
    # the same satellite record driving everything else.
    soil_moisture = run_bucket(
        records, farm.centroid[1], kc_by_doy=kc_from_cover(imagery.green_cover)
    )

    soil_cover = [
        max(g, r) for g, r in zip(imagery.green_cover, imagery.residue_cover)
    ]
    gaps = build_gaps(soil_cover, erosivity.per_doy_r)
    species = load_species(species_csv or DATA_DIR / "species.csv")

    observed_curves = {k: v.green_cover for k, v in imagery.crop_curves.items()}
    rotations = build_standard_rotations(
        soil_cover, species, erosivity.per_doy_r,
        weather.gdd_base4, weather.gdd_base10, weather.frost_prob, soil_moisture,
        observed_curves, phase_covers=imagery.phase_covers,
    )

    sources = [nasa_source("power", n_obs=len(records)), *imagery.sources]
    eligible, nasa_names = check_eligibility(sources)
    if not eligible:
        raise ValueError(
            "No NASA data source in this bundle. The challenge requires at "
            "least one. Check fallowclock/sources.py."
        )

    uncertainty = [
        Uncertainty(**bias_note(farm.place)),
        Uncertainty(**erosivity_note()),
        Uncertainty(**water_note()),
    ]
    if imagery.is_synthetic:
        uncertainty.insert(
            0,
            Uncertainty(
                field="green_cover, residue_cover, soil_cover, crop_curves",
                level="high",
                reason=(
                    "Cover curves are SYNTHETIC placeholders, not satellite "
                    "observations. Weather, erosivity and soil water are real "
                    "NASA POWER data; the cover half is not."
                ),
                affects="Do not show this to a farmer or a judge as a result.",
            ),
        )
    else:
        uncertainty.append(
            Uncertainty(
                field="n_obs_per_doy",
                level="medium",
                reason=(
                    "Iowa loses most winter satellite scenes to cloud and snow, "
                    "so mid-winter cover rests on far fewer observations."
                ),
                affects="Trust the grayed-out arcs less than the summer ones.",
            )
        )

    bundle = Bundle(
        farm=farm,
        provenance=Provenance(
            generated_at=datetime.now(timezone.utc),
            years_used=weather.years_used,
            sources=sources,
            is_synthetic=imagery.is_synthetic,
        ),
        climatology=Climatology(
            green_cover=imagery.green_cover,
            green_cover_p25=imagery.green_cover_p25,
            green_cover_p75=imagery.green_cover_p75,
            residue_cover=imagery.residue_cover,
            soil_cover=soil_cover,
            n_obs_per_doy=imagery.n_obs_per_doy,
            erosivity_r=erosivity.per_doy_r,
            gdd_base4=weather.gdd_base4,
            gdd_base10=weather.gdd_base10,
            frost_prob=weather.frost_prob,
            heat_stress_prob=weather.heat_stress_prob,
            soil_moisture=soil_moisture,
        ),
        observed_rotation=ObservedRotation(
            years=imagery.observed_years, inferred_label=imagery.inferred_label
        ),
        gaps=gaps,
        crop_curves=imagery.crop_curves,
        species=species,
        rotations=rotations,
        uncertainty=uncertainty,
    )
    # Re-validate the serialised form: catches anything model construction
    # let through that JSON round-tripping would not.
    return Bundle.model_validate(bundle.model_dump(mode="json"))


def build_for_farm(
    farm: Farm,
    start_year: int = 2000,
    end_year: int = 2024,
    imagery: ImageryInputs | None = None,
    *,
    cache_dir: Path | str | None = None,
) -> Bundle:
    """Fetch everything B2 owns and assemble a Bundle for one farm."""
    lon, lat = farm.centroid
    records = fetch_daily(lat, lon, start_year, end_year, cache_dir=cache_dir)
    return assemble(farm, imagery or placeholder_imagery(), records)
