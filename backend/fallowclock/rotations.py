"""Rotation construction and comparison.  B2 owns this file.

The whole point of the project: three rotations, ranked by how much soil
they lose, with the farmer's current practice as the baseline.

A rotation's cover curve is SPLICED from observed crop curves, never
simulated. Where a species has no observed curve we fall back to the
thermal ramp in cropfit.py and label it modelled. Which of the two is on
screen is exactly the question a judge should be able to ask and get a
straight answer to.
"""

from __future__ import annotations

from dataclasses import dataclass

from .cropfit import FitResult, rank_species_for_gap
from .gaps import (
    RUSLE_B_DEFAULT,
    bare_days,
    build_gaps,
    exposed_erosivity,
    phase_averaged_exposed_erosivity,
    phase_bare_days,
)
from .schema import DOY_LEN, Gap, Rotation, Species


@dataclass
class RotationPlan:
    """A rotation before scoring: what to grow, and what fills the gaps."""

    id: str
    label: str
    sequence: list[str]
    is_current: bool = False
    fills: list[FitResult] | None = None


def union_cover(*curves: list[float]) -> list[float]:
    """Combine cover layers. A cover crop never makes a covered day barer."""
    for c in curves:
        if len(c) != DOY_LEN:
            raise ValueError(f"cover curve must be length {DOY_LEN}, got {len(c)}")
    return [max(vals) for vals in zip(*curves)]


def score_rotation(
    plan: RotationPlan,
    base_cover: list[float],
    erosivity_r: list[float],
    *,
    phase_covers: list[list[float]] | None = None,
    b: float = RUSLE_B_DEFAULT,
) -> Rotation:
    """Build the scored Rotation for one plan.

    `phase_covers`, when given, holds one cover array per phase of the
    rotation (the corn year, the soybean year, ...). Erosivity is then
    averaged ACROSS phases rather than computed from mean cover -- see
    phase_averaged_exposed_erosivity for why that distinction is not
    pedantry. Without it the score is systematically optimistic.
    """
    fills = plan.fills or []
    cover = union_cover(base_cover, *[list(f.cover_curve) for f in fills if f.cover_curve])

    if phase_covers:
        combined_phases = [
            union_cover(p, *[list(f.cover_curve) for f in fills if f.cover_curve])
            for p in phase_covers
        ]
        exposed = phase_averaged_exposed_erosivity(combined_phases, erosivity_r, b)
        # Same correction for the bare-day count. `cover` is the mean curve,
        # and thresholding a mean is not the mean of the thresholds -- it
        # hides a bare window that exists in one phase and not the other.
        by_phase = phase_bare_days(combined_phases)
        n_bare = round(sum(by_phase) / len(by_phase))
    else:
        exposed = exposed_erosivity(cover, erosivity_r, b)
        by_phase = None
        n_bare = bare_days(cover)

    return Rotation(
        id=plan.id,
        label=plan.label,
        sequence=plan.sequence,
        is_current=plan.is_current,
        soil_cover=cover,
        bare_days=n_bare,
        bare_days_by_phase=by_phase,
        exposed_r=exposed,
        delta_vs_current_pct=0.0,  # filled by compare()
        added_seed_cost_usd_ha=sum(f.seed_cost_usd_ha for f in fills),
        n_credit_kg_ha=sum(f.n_credit_kg_ha for f in fills),
    )


def compare(rotations: list[Rotation]) -> list[Rotation]:
    """Fill delta_vs_current_pct against the baseline. Negative is better."""
    current = [r for r in rotations if r.is_current]
    if len(current) != 1:
        raise ValueError(
            f"Exactly one rotation must have is_current=True, found {len(current)}"
        )
    baseline = current[0].exposed_r
    if baseline <= 0:
        raise ValueError("Baseline exposed erosivity is zero; cannot compute deltas")

    out = []
    for r in rotations:
        out.append(
            r.model_copy(
                update={
                    "delta_vs_current_pct": (r.exposed_r - baseline) / baseline * 100.0
                }
            )
        )
    return out


def best_fills_for_gaps(
    species: list[Species],
    gaps: list[Gap],
    base_cover: list[float],
    gdd_base4: list[float],
    gdd_base10: list[float],
    frost_prob: list[float],
    soil_moisture: list[float],
    erosivity_r: list[float],
    observed_curves: dict[str, list[float]] | None = None,
    *,
    allowed_species: list[str] | None = None,
    max_gaps: int = 2,
    b: float = RUSLE_B_DEFAULT,
    earliest_seed_doy: int | None = None,
) -> list[FitResult]:
    """Pick the best feasible species for each of the biggest gaps.

    Gaps arrive sorted by exposed erosivity, so taking the first `max_gaps`
    targets the windows that actually lose soil rather than every small
    one. A 3-day gap in July is not worth a seeding pass.
    """
    chosen: list[FitResult] = []
    running_cover = list(base_cover)

    for gap in gaps[:max_gaps]:
        pool = species
        if allowed_species is not None:
            pool = [s for s in species if s.id in allowed_species]
        if not pool:
            continue

        ranked = rank_species_for_gap(
            pool, gap, gdd_base4, gdd_base10, frost_prob, soil_moisture,
            erosivity_r, running_cover, observed_curves, b,
            earliest_seed_doy=earliest_seed_doy,
        )
        feasible = [r for r in ranked if r.feasible and r.delta_exposed_r > 0]
        if not feasible:
            continue

        best = feasible[0]
        chosen.append(best)
        # Later gaps are scored against the cover the earlier pick already
        # provides, so two cover crops cannot both claim the same soil.
        running_cover = union_cover(running_cover, list(best.cover_curve))

    return chosen


def build_standard_rotations(
    base_cover: list[float],
    species: list[Species],
    erosivity_r: list[float],
    gdd_base4: list[float],
    gdd_base10: list[float],
    frost_prob: list[float],
    soil_moisture: list[float],
    observed_curves: dict[str, list[float]] | None = None,
    *,
    phase_covers: list[list[float]] | None = None,
    b: float = RUSLE_B_DEFAULT,
    earliest_seed_doy: int | None = None,
) -> list[Rotation]:
    """The three rotations the brief asks us to compare, for the Corn Belt.

      1. Corn-Soybean, no cover         -- what the farmer does now
      2. Corn-Soybean + cereal rye      -- the realistic single change
      3. Corn-Soybean + best mix        -- the ambitious version

    Rotation 2 is deliberately rye-only: it is the change an Iowa farmer is
    most likely to actually make, and showing the realistic option beside
    the ambitious one is more useful than showing only the best case.
    """
    gaps = build_gaps(base_cover, erosivity_r, b=b, phase_covers=phase_covers)

    args = (base_cover, gdd_base4, gdd_base10, frost_prob, soil_moisture, erosivity_r)

    rye_fills = best_fills_for_gaps(
        species, gaps, *args, observed_curves,
        allowed_species=["cereal_rye"], max_gaps=1, b=b,
        earliest_seed_doy=earliest_seed_doy,
    )
    best_fills = best_fills_for_gaps(
        species, gaps, *args, observed_curves, max_gaps=2, b=b,
        earliest_seed_doy=earliest_seed_doy,
    )

    plans = [
        RotationPlan("corn_soy", "Corn-Soybean (current)", ["corn", "soybean"], True, []),
        RotationPlan(
            "corn_soy_rye",
            "Corn-Soybean + cereal rye",
            ["corn", "cereal_rye", "soybean", "cereal_rye"],
            False,
            rye_fills,
        ),
        RotationPlan(
            "corn_soy_best",
            "Corn-Soybean + best-fit cover",
            ["corn", "soybean"] + [f.species_id for f in best_fills],
            False,
            best_fills,
        ),
    ]

    scored = [
        score_rotation(p, base_cover, erosivity_r, phase_covers=phase_covers, b=b)
        for p in plans
    ]
    return compare(scored)
