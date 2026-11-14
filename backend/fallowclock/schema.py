"""Fallow Clock bundle contract.

THE artifact. Both sides of the team are machine-checked against this file:
  * backend  -> builds and validates a Bundle before writing JSON
  * frontend -> `npm run gen:types` turns the exported JSON Schema into
                src/types/bundle.ts

Contract rules (non-negotiable, see plan):
  1. Every array in `climatology` has length 365. No nulls. Signal missing
     evidence with n_obs_per_doy == 0 and let the UI gray it out.
  2. `soil_cover` is the ONLY field the ring reads for bare/covered.
     green_cover and residue_cover are evidence, not classifiers.
  3. The synthetic fixture validates against this same model. If the fixture
     stops validating, the contract changed and both pairs need to know.
  4. Frozen at H24.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

DOY_LEN = 365
"""Day-of-year axis length. We drop Feb 29 everywhere; a leap day in a
climatology median is not worth the indexing bugs it causes."""

SCHEMA_VERSION = "1.0"

# NRCS defines conservation tillage as >=30% residue cover. We reuse that
# threshold for "is this soil protected", which is why it is a real citable
# number rather than one we invented.
BARE_THRESHOLD = 0.30

# RUSLE surface-cover subfactor: C = exp(-b * cover_percent).
# Exposed in the UI as a tunable so a judge can see the sensitivity.
RUSLE_B_DEFAULT = 0.035


class Strict(BaseModel):
    """Reject unknown fields. A typo in a backend field name should fail here,
    loudly, at build time -- not silently produce a bundle the UI renders as
    an empty ring at hour 40."""

    model_config = ConfigDict(extra="forbid")


DoyFloats = Annotated[list[float], Field(min_length=DOY_LEN, max_length=DOY_LEN)]
DoyInts = Annotated[list[int], Field(min_length=DOY_LEN, max_length=DOY_LEN)]
Fraction = Annotated[float, Field(ge=0.0, le=1.0)]
Doy = Annotated[int, Field(ge=1, le=DOY_LEN)]


# --------------------------------------------------------------------------
# Farm & provenance
# --------------------------------------------------------------------------


class Farm(Strict):
    id: str = Field(description="Slug, e.g. 'story-county-ia'")
    owner_name: str = Field(description="The named farmer. Not 'farmers worldwide'.")
    place: str = Field(description="Named place, e.g. 'Story County, Iowa'")
    centroid: tuple[float, float] = Field(description="[lon, lat]")
    area_ha: float = Field(gt=0)
    polygon_geojson: dict


class Source(Strict):
    name: str
    collection_id: str = Field(description="e.g. COPERNICUS/S2_SR_HARMONIZED")
    n_obs: int = Field(ge=0, description="Usable observations after masking")
    resolution_m: float | None = None
    citation: str


class Provenance(Strict):
    generated_at: datetime
    years_used: list[int] = Field(min_length=1)
    sources: list[Source] = Field(min_length=1)
    pipeline_version: str = SCHEMA_VERSION
    is_synthetic: bool = Field(
        default=False,
        description="True for the H2 fixture. The UI MUST show a banner when "
        "this is set -- we never want to demo fake data by accident.",
    )


# --------------------------------------------------------------------------
# Climatology -- the day-of-year axis everything else joins onto
# --------------------------------------------------------------------------


class Climatology(Strict):
    """All arrays indexed by DOY-1, length 365."""

    green_cover: DoyFloats = Field(description="From NDVI. 0-1.")
    green_cover_p25: DoyFloats
    green_cover_p75: DoyFloats
    residue_cover: DoyFloats = Field(
        description="From NDTI after wet-pixel + green-pixel masking. 0-1. "
        "Moisture-sensitive -- must carry an uncertainty entry."
    )
    soil_cover: DoyFloats = Field(
        description="max(green_cover, residue_cover). The ONLY field the ring "
        "reads for bare/covered classification."
    )
    n_obs_per_doy: DoyInts = Field(
        description="Usable satellite observations in the +/-8 day window. "
        "Drives confidence shading. 0 means no evidence -- gray it out."
    )
    erosivity_r: DoyFloats = Field(
        description="Per-DOY mean rainfall erosivity, MJ.mm/ha/h."
    )
    erosivity_peak_doy: Doy = Field(
        description="Centre DOY of the heaviest 30-day erosivity window, "
        "wrap-aware. Computed here rather than in the client because a "
        "single-day argmax picks the wrong month -- it returned late August "
        "for Monona when the real peak is May -- and a windowed, wrapping "
        "calculation is not something to duplicate and keep in sync.",
    )
    gdd_base4: DoyFloats = Field(description="Daily GDD, base 4 C (cool-season)")
    gdd_base10: DoyFloats = Field(description="Daily GDD, base 10 C (warm-season)")
    frost_prob: DoyFloats = Field(description="P(Tmin < 0 C)")
    heat_stress_prob: DoyFloats = Field(description="P(Tmax > 32 C)")
    soil_moisture: DoyFloats = Field(
        description="SMAP, 0-1. COARSE (9-11 km) -- regional flag only, never "
        "presented as a field-scale number."
    )
    phase_covers: list[DoyFloats] | None = Field(
        default=None,
        description="One soil_cover curve per rotation phase, ordered as "
        "observed_rotation.phase_labels. soil_cover is their MEAN, which is a "
        "curve no real year followed: a day can be covered on the mean and "
        "bare in half the actual years. gaps[] is built from these, not from "
        "soil_cover. None when the rotation has only one phase.",
    )

    @model_validator(mode="after")
    def _soil_cover_is_the_union(self) -> Climatology:
        """soil_cover = max(green, residue), by construction. Assert it rather
        than trust it -- this catches a whole class of indexing bug."""
        for i, (g, r, s) in enumerate(
            zip(self.green_cover, self.residue_cover, self.soil_cover)
        ):
            if s < max(g, r) - 1e-6:
                raise ValueError(
                    f"soil_cover[{i}]={s:.4f} < max(green={g:.4f}, "
                    f"residue={r:.4f}). soil_cover must be the union."
                )
        return self

    @model_validator(mode="after")
    def _percentiles_ordered(self) -> Climatology:
        for i, (lo, hi) in enumerate(zip(self.green_cover_p25, self.green_cover_p75)):
            if lo > hi + 1e-6:
                raise ValueError(f"green_cover_p25[{i}] > p75 ({lo} > {hi})")
        return self


# --------------------------------------------------------------------------
# What is actually grown, and where the holes are
# --------------------------------------------------------------------------


class ObservedYear(Strict):
    year: int
    cdl_crop: str = Field(description="USDA CDL class name, e.g. 'Corn'")
    cdl_code: int | None = None
    planting_doy: Doy | None = Field(
        default=None, description="From NDVI green-up inflection"
    )
    harvest_doy: Doy | None = Field(
        default=None, description="From NDVI senescence inflection"
    )
    cover_crop_detected: bool = Field(
        default=False,
        description="Winter NDVI above threshold between harvest and next "
        "planting. CDL does not label cover crops; the satellite does.",
    )


class ObservedRotation(Strict):
    years: list[ObservedYear] = Field(min_length=1)
    inferred_label: str = Field(description="e.g. 'Corn-Soybean, no cover'")
    phase_labels: list[str] | None = Field(
        default=None,
        description="Crop phase of the rotation, e.g. ['soybean', 'corn']. "
        "Indexes line up with Rotation.bare_days_by_phase. None when the "
        "rotation could not be split into phases.",
    )


class Gap(Strict):
    """A contiguous run of DOYs with soil_cover < BARE_THRESHOLD.

    May wrap the new year: if start_doy > end_doy the gap runs through
    31 Dec. Every consumer must handle the wrap -- the biggest gap in a
    corn-soy rotation is exactly the one that wraps.
    """

    start_doy: Doy
    end_doy: Doy
    n_days: int = Field(gt=0, le=DOY_LEN)
    exposed_r: float = Field(
        ge=0, description="Cover-weighted erosivity accumulated across the gap"
    )
    share_of_annual_r: Fraction
    wraps_year: bool = False

    @model_validator(mode="after")
    def _wrap_flag_matches(self) -> Gap:
        expected = self.start_doy > self.end_doy
        if self.wraps_year != expected:
            raise ValueError(
                f"wraps_year={self.wraps_year} but start={self.start_doy} "
                f"end={self.end_doy} implies {expected}"
            )
        return self


# --------------------------------------------------------------------------
# Observed crop curves -- nothing is simulated
# --------------------------------------------------------------------------


class CropCurve(Strict):
    """A median NDVI-by-DOY curve measured across real nearby fields.

    This is the project's strongest scientific card: we never simulate what a
    cover crop would look like. We measure fields that already grow it.
    """

    green_cover: DoyFloats
    n_fields: int = Field(ge=1, description="How many real fields went into the median")
    source: Literal["observed", "literature"] = "observed"
    detection: str = Field(
        description="Exactly how these fields were identified, in one sentence"
    )


# --------------------------------------------------------------------------
# Cover crop species table (hand-curated from SARE MCCP 3rd ed.)
# --------------------------------------------------------------------------


class Species(Strict):
    id: str
    name: str
    seeding_window: tuple[Doy, Doy] = Field(description="[earliest, latest] DOY")
    tbase_c: float = Field(description="Base temperature for GDD accumulation")
    gdd_establish: float = Field(gt=0, description="GDD from seeding to established")
    winterkill_c: float = Field(
        description="Temperature below which the stand dies. -99 = winter hardy."
    )
    water_mm: float = Field(ge=0, description="Water needed to establish")
    n_credit_kg_ha: float = Field(
        ge=0, description="Nitrogen credit to the following cash crop"
    )
    biomass_kg_ha: float = Field(ge=0, description="Typical above-ground biomass")
    seed_cost_usd_ha: float = Field(ge=0)
    winter_hardy: bool
    citation: str


# --------------------------------------------------------------------------
# Rotations -- the comparison that is the whole point
# --------------------------------------------------------------------------


class Rotation(Strict):
    id: str
    label: str
    sequence: list[str] = Field(min_length=1)
    is_current: bool = Field(
        default=False, description="Exactly one rotation is the farmer's current"
    )
    soil_cover: DoyFloats = Field(
        description="Spliced from observed crop curves. Never simulated."
    )
    bare_days: int = Field(
        ge=0,
        le=DOY_LEN,
        description="Expected bare days in a randomly chosen year. When the "
        "rotation has phases this is the mean of bare_days_by_phase, NOT the "
        "bare days of the mean cover curve -- see "
        "gaps.phase_averaged_bare_days for why those differ and why the "
        "difference does not have a predictable sign.",
    )
    bare_days_by_phase: list[int] | None = Field(
        default=None,
        description="Bare days in each phase, ordered as "
        "observed_rotation.phase_labels. A corn-soybean field is bare for "
        "different stretches after corn than after soybeans; the mean hides "
        "that, so show both.",
    )
    exposed_r: float = Field(ge=0)
    delta_vs_current_pct: float = Field(
        description="Negative is better (less exposed erosivity)"
    )
    added_seed_cost_usd_ha: float = 0.0
    n_credit_kg_ha: float = 0.0


# --------------------------------------------------------------------------
# Honesty, as a first-class field
# --------------------------------------------------------------------------


class Uncertainty(Strict):
    """The brief scores this. Render it prominently; do not bury it."""

    field: str = Field(description="Which bundle field this qualifies")
    level: Literal["low", "medium", "high"]
    reason: str = Field(description="Plain language, one or two sentences")
    affects: str = Field(description="What a farmer should do about it")


# --------------------------------------------------------------------------


class Bundle(Strict):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    farm: Farm
    provenance: Provenance
    climatology: Climatology
    observed_rotation: ObservedRotation
    gaps: list[Gap]
    crop_curves: dict[str, CropCurve]
    species: list[Species] = Field(min_length=1)
    rotations: list[Rotation] = Field(min_length=2)
    uncertainty: list[Uncertainty] = Field(min_length=1)

    @model_validator(mode="after")
    def _exactly_one_current_rotation(self) -> Bundle:
        n = sum(r.is_current for r in self.rotations)
        if n != 1:
            raise ValueError(
                f"Exactly one rotation must have is_current=True, found {n}. "
                "The comparison is meaningless without a baseline."
            )
        return self

    @model_validator(mode="after")
    def _gaps_agree_with_soil_cover(self) -> Bundle:
        """The gaps array must actually describe the climatology it ships with.
        Catches the case where someone recomputes one and forgets the other."""
        pc = self.climatology.phase_covers
        if pc:
            worst = [min(vals) for vals in zip(*pc)]
        else:
            worst = self.climatology.soil_cover
        bare = sum(1 for v in worst if v < BARE_THRESHOLD)
        claimed = sum(g.n_days for g in self.gaps)
        if abs(bare - claimed) > 2:  # tolerance for boundary rounding
            raise ValueError(
                f"The cover curves have {bare} bare days (across all phases) "
                f"but gaps[] claims {claimed}. They were computed from "
                f"different data."
            )
        return self


def write_bundle(bundle: Bundle, path: str) -> None:
    """Validate, then write. Never write an unvalidated bundle."""
    import json
    from pathlib import Path

    payload = bundle.model_dump(mode="json")
    Bundle.model_validate(payload)
    Path(path).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def export_json_schema() -> dict:
    """Feeds `npm run gen:types`."""
    return Bundle.model_json_schema()
