"""Cover-crop fitting: can this species live in this gap, and what does it buy?

Deliberately a filter-and-rank, not a solver. 12 species x ~2 gaps is a
microsecond of work, which is why the same logic runs client-side in the
browser and dragging a crop into the ring feels instant.

DUPLICATION WARNING
-------------------
This logic exists twice: here, and in frontend/src/lib/cropFit.ts. Running
Python in the browser was not worth it for ~80 lines. The guard against
drift is tests/vectors.json -- generated from THIS file, asserted by both
test suites. If you change a rule here, run:

    python scripts/gen_vectors.py

and both suites will tell you if the TypeScript side disagreed.

COVER CURVES
------------
Where we have an observed curve for a species (measured on real nearby
fields -- see imagery.detect_cover_cropped_fields) we use it, and the UI
labels it "observed". Where we do not, we fall back to a thermal-time ramp,
and the UI labels it "modelled". Never blur the two: which one is on screen
is exactly the question a judge should be able to ask and get a straight
answer to.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

from .gaps import (
    accumulate_gdd,
    doys_in_run,
    first_killing_frost_doy,
    rusle_c_factor,
)
from .schema import BARE_THRESHOLD, DOY_LEN, RUSLE_B_DEFAULT, Gap, Species

# Ceiling on cover for a MODELLED (thermal-ramp) species, i.e. one with no
# observed or literature curve.
#
# Deliberately conservative, and 0.55 rather than the 0.85 we started with.
# At 0.85 the fallback model beat every curve we had actual evidence for:
# a generic winter-hardy species would ramp to 85% by November, hold it all
# winter, and so out-score real cereal rye -- whose literature curve peaks
# at 78% and only after a spring flush. The tool was recommending the
# species it knew LEAST about, and reporting an 83% erosivity reduction
# with zero bare days.
#
# A guess should never outrank evidence. Where we are modelling, we
# under-promise.
DEFAULT_PLATEAU = 0.55

# soil_moisture is a MODELLED bucket balance (soilwater.py), not a
# measurement, so this is a coarse go/no-go flag and never a field-scale
# number. Seeding into a modelled dry spell is still a real failure mode
# worth flagging -- it just must not be reported as an observation.
MIN_SEEDING_MOISTURE = 0.15

# Cover crops are routinely seeded BEFORE the gap opens -- aerially
# interseeded into senescing corn, or drilled the same day as harvest.
# Restricting candidate seeding dates to days the field is already bare
# makes almost every species infeasible in the Midwest, which is wrong:
# in Iowa a cover crop that waits for a bare field has already missed its
# window.
# 60 days, not 30. The bare gap (soil cover < 30%) opens well AFTER harvest,
# because stover keeps protecting the soil until it decays or gets tilled
# under. But the seeding decision is driven by harvest, not by the day the
# cover estimate crosses a threshold. In Iowa the practical window for
# radish, oats and vetch is late August to mid September -- aerially
# interseeded into senescing corn, or drilled straight after an early
# soybean harvest. The real pipeline should pass `earliest_seed_doy` from
# the observed harvest date instead of relying on this default.
PRE_GAP_SEEDING_DAYS = 60

# A winter-hardy cover crop is seeded in autumn precisely so that it is
# standing the FOLLOWING spring, and on a reduced-tillage field the spring
# window is the one that matters: Story County's residue mat holds cover
# above the bare threshold all winter, then thins after planting, leaving
# the field bare DOY 88-159 -- straight through the DOY 170 erosivity peak.
#
# With a flat 60-day lead, cereal rye's seeding window (DOY 227-319) misses
# that gap by four months and the model reports "seeding window does not
# overlap this gap" for every winter-hardy species. The single most
# important cover crop in the Midwest came back infeasible on both of our
# real fields, and the "+ cereal rye" rotation scored identically to doing
# nothing. The lead has to span a winter for the species that overwinter.
WINTER_HARDY_PRE_GAP_DAYS = 300

# Once a non-hardy stand is frost-killed its residue decomposes. Roughly
# halves over a winter and floors at a persistent mat. This is what
# separates a radish (dead by November, residue thinning all winter) from
# cereal rye (dormant, then growing again in March) -- without it the model
# rates every species identically and the whole "which crop fits" feature
# stops discriminating.
RESIDUE_DECAY_PER_DAY = 0.006
RESIDUE_DECAY_FLOOR = 0.35

# Every cover crop is terminated before the cash crop is planted -- sprayed,
# rolled or tilled. Cover falls to near zero over roughly a fortnight at the
# end of the gap.
#
# Leaving this out is not a detail. A modelled species held its full plateau
# straight through to planting, right across the spring erosivity peak, and
# so out-scored real cereal rye -- whose literature curve terminates around
# DOY 136 because that is what actually happens in the field. The model was
# winning by doing something no farmer can do.
TERMINATION_DAYS = 12
TERMINATION_RESIDUAL = 0.15


@dataclass(frozen=True)
class FitResult:
    species_id: str
    species_name: str
    seed_doy: int
    feasible: bool
    reason: str
    gdd_available: float = 0.0
    gdd_required: float = 0.0
    establish_by_doy: int | None = None
    cover_curve: tuple[float, ...] = ()
    delta_exposed_r: float = 0.0
    pct_reduction: float = 0.0
    n_credit_kg_ha: float = 0.0
    seed_cost_usd_ha: float = 0.0
    curve_source: str = "modelled"


def load_species(path: str | Path) -> list[Species]:
    """Read data/species.csv. Comment lines start with '#'."""
    rows: list[Species] = []
    with open(path, encoding="utf-8-sig") as fh:
        lines = [ln for ln in fh if not ln.lstrip().startswith("#") and ln.strip()]
    for row in csv.DictReader(lines):
        rows.append(
            Species(
                id=row["id"],
                name=row["name"],
                seeding_window=(int(row["seed_start_doy"]), int(row["seed_end_doy"])),
                tbase_c=float(row["tbase_c"]),
                gdd_establish=float(row["gdd_establish"]),
                winterkill_c=float(row["winterkill_c"]),
                water_mm=float(row["water_mm"]),
                n_credit_kg_ha=float(row["n_credit_kg_ha"]),
                biomass_kg_ha=float(row["biomass_kg_ha"]),
                seed_cost_usd_ha=float(row["seed_cost_usd_ha"]),
                winter_hardy=row["winter_hardy"].strip().lower() == "true",
                citation=row["citation"],
            )
        )
    if not rows:
        raise ValueError(f"No species parsed from {path}")
    return rows


def _in_window(doy: int, window: tuple[int, int]) -> bool:
    """Seeding windows can wrap the year the same way gaps can."""
    start, end = window
    if start <= end:
        return start <= doy <= end
    return doy >= start or doy <= end


def candidate_seed_doys(
    species: Species,
    gap: Gap,
    pre_gap_days: int = PRE_GAP_SEEDING_DAYS,
    earliest_seed_doy: int | None = None,
) -> list[int]:
    """DOYs inside both the species' seeding window and the seeding period.

    The seeding period runs from `earliest_seed_doy` (pass the observed cash
    crop harvest DOY here when you have it) to the end of the gap. Without
    it, the gap start is extended backwards by `pre_gap_days` as a proxy.
    """
    if earliest_seed_doy is not None:
        start_idx = earliest_seed_doy - 1
    else:
        lead = pre_gap_days
        if species.winter_hardy:
            lead = max(lead, WINTER_HARDY_PRE_GAP_DAYS)
        # The seeding period is lead + gap, and it must not exceed a year.
        # Without this cap it wraps PAST itself and doys_in_run returns the
        # complement -- the window the species may NOT be seeded in. A
        # 300-day lead on a 216-day gap silently became a 151-day period
        # that excluded rye's entire autumn window.
        lead = max(0, min(lead, DOY_LEN - gap.n_days))
        start_idx = (gap.start_doy - 1 - lead) % DOY_LEN
    doys = doys_in_run(start_idx, gap.end_doy - 1)
    return [d + 1 for d in doys if _in_window(d + 1, species.seeding_window)]


def establishment_deadline(species: Species, gap: Gap, frost_prob: list[float],
                           seed_doy: int) -> int:
    """The DOY by which the stand must be established.

    This differs by winter hardiness, and getting it wrong makes cereal rye
    -- the single most important cover crop in the Midwest -- look
    infeasible in Iowa:

      * Winter-hardy (rye, wheat, hairy vetch): a hard frost does not kill
        them. They establish in autumn, go dormant, and finish growing in
        spring. The deadline is the end of the gap, when the next cash crop
        goes in. Dormancy needs no special handling -- GDD is zero below
        the base temperature, so winter contributes nothing on its own.

      * Not hardy (oats, radish, buckwheat): the first killing frost ends
        them. Whatever they built by then is what you get -- though they
        keep protecting the soil afterwards as residue, which is exactly
        why residue is tracked separately from green cover.
    """
    if species.winter_hardy:
        return gap.end_doy
    frost_doy = first_killing_frost_doy(frost_prob, after_doy=seed_doy)
    return frost_doy if frost_doy is not None else gap.end_doy


def thermal_ramp_curve(
    species: Species,
    seed_doy: int,
    gap: Gap,
    gdd_daily: list[float],
    plateau: float = DEFAULT_PLATEAU,
    stop_growth_doy: int | None = None,
) -> list[float]:
    """Cover fraction as a function of accumulated thermal time.

        cover(d) = plateau * min(1, GDD(seed -> d) / gdd_establish)

    Runs from the seeding date to the end of the gap, NOT from the start of
    the gap: cover crops are routinely seeded while the cash crop is still
    standing, and a curve that only starts once the field reads bare would
    credit them with nothing. (The erosivity delta still only counts days
    inside the gap, so pre-gap growth cannot inflate the benefit.)

    After `stop_growth_doy` -- the killing frost, for species that are not
    winter hardy -- the curve HOLDS rather than dropping to zero. A
    frost-killed radish stand is still residue, and residue still protects
    soil. That is the entire reason residue is tracked separately from
    green cover.

    Transparent, and obviously a model. Where an observed curve exists we
    use that instead, and the UI labels which one is on screen.
    """
    curve = [0.0] * DOY_LEN
    span = doys_in_run(seed_doy - 1, gap.end_doy - 1)
    n_span = len(span)

    accumulated = 0.0
    frozen_at: float | None = None
    days_since_kill = 0
    for idx in span:
        doy = idx + 1
        if frozen_at is not None:
            days_since_kill += 1
            decayed = frozen_at * max(
                RESIDUE_DECAY_FLOOR, 1.0 - RESIDUE_DECAY_PER_DAY * days_since_kill
            )
            curve[idx] = decayed
            continue
        accumulated += gdd_daily[idx]
        curve[idx] = plateau * min(1.0, accumulated / species.gdd_establish)
        if stop_growth_doy is not None and doy == stop_growth_doy:
            frozen_at = curve[idx]

    # Terminate into the cash crop: ramp down over the last TERMINATION_DAYS
    # of the gap, leaving a residual mat rather than bare ground.
    for offset in range(min(TERMINATION_DAYS, n_span)):
        pos = n_span - min(TERMINATION_DAYS, n_span) + offset
        idx = span[pos]
        frac = 1.0 - (offset + 1) / min(TERMINATION_DAYS, n_span)
        curve[idx] = curve[idx] * max(TERMINATION_RESIDUAL, frac)
    return curve


def fit_species_in_gap(
    species: Species,
    gap: Gap,
    gdd_base4: list[float],
    gdd_base10: list[float],
    frost_prob: list[float],
    soil_moisture: list[float],
    erosivity_r: list[float],
    base_soil_cover: list[float],
    observed_curve: list[float] | None = None,
    b: float = RUSLE_B_DEFAULT,
    earliest_seed_doy: int | None = None,
) -> FitResult:
    """Best feasible seeding date for one species in one gap.

    Tries every candidate seeding DOY and keeps whichever gives the largest
    erosivity reduction. Infeasible species are still returned, with the
    reason -- "cereal rye would work here but hairy vetch cannot establish
    in time" is useful information, not noise to filter out.
    """
    gdd_daily = gdd_base10 if species.tbase_c >= 10.0 else gdd_base4
    candidates = candidate_seed_doys(species, gap, earliest_seed_doy=earliest_seed_doy)

    if not candidates:
        return FitResult(
            species.id,
            species.name,
            seed_doy=0,
            feasible=False,
            reason=(
                f"Seeding window (DOY {species.seeding_window[0]}-"
                f"{species.seeding_window[1]}) does not overlap this gap"
            ),
            n_credit_kg_ha=species.n_credit_kg_ha,
            seed_cost_usd_ha=species.seed_cost_usd_ha,
        )

    best: FitResult | None = None
    last_failure: FitResult | None = None

    for seed_doy in candidates:
        if soil_moisture[seed_doy - 1] < MIN_SEEDING_MOISTURE:
            last_failure = FitResult(
                species.id,
                species.name,
                seed_doy,
                feasible=False,
                reason="Modelled soil water too low at seeding (bucket model, not a measurement)",
                n_credit_kg_ha=species.n_credit_kg_ha,
                seed_cost_usd_ha=species.seed_cost_usd_ha,
            )
            continue

        establish_by = establishment_deadline(species, gap, frost_prob, seed_doy)
        gdd_available = accumulate_gdd(gdd_daily, seed_doy, establish_by)

        if gdd_available < species.gdd_establish:
            deadline_label = (
                "before the next cash crop"
                if species.winter_hardy
                else "before first frost"
            )
            last_failure = FitResult(
                species.id,
                species.name,
                seed_doy,
                feasible=False,
                reason=(
                    f"Only {gdd_available:.0f} GDD {deadline_label}; needs "
                    f"{species.gdd_establish:.0f} to establish"
                ),
                gdd_available=gdd_available,
                gdd_required=species.gdd_establish,
                establish_by_doy=establish_by,
                n_credit_kg_ha=species.n_credit_kg_ha,
                seed_cost_usd_ha=species.seed_cost_usd_ha,
            )
            continue

        if observed_curve is not None:
            curve = list(observed_curve)
            curve_source = "observed"
        else:
            curve = thermal_ramp_curve(
                species,
                seed_doy,
                gap,
                gdd_daily,
                stop_growth_doy=None if species.winter_hardy else establish_by,
            )
            curve_source = "modelled"

        combined = [max(base_soil_cover[i], curve[i]) for i in range(DOY_LEN)]
        gap_idxs = doys_in_run(gap.start_doy - 1, gap.end_doy - 1)
        before = sum(
            erosivity_r[i] * rusle_c_factor(base_soil_cover[i], b) for i in gap_idxs
        )
        after = sum(erosivity_r[i] * rusle_c_factor(combined[i], b) for i in gap_idxs)
        delta = before - after

        result = FitResult(
            species.id,
            species.name,
            seed_doy,
            feasible=True,
            reason=(
                f"Establishes with {gdd_available:.0f} GDD "
                + ("before the next cash crop" if species.winter_hardy else "before first frost")
            ),
            gdd_available=gdd_available,
            gdd_required=species.gdd_establish,
            establish_by_doy=establish_by,
            cover_curve=tuple(curve),
            delta_exposed_r=delta,
            pct_reduction=(delta / before * 100.0) if before > 0 else 0.0,
            n_credit_kg_ha=species.n_credit_kg_ha,
            seed_cost_usd_ha=species.seed_cost_usd_ha,
            curve_source=curve_source,
        )
        if best is None or result.delta_exposed_r > best.delta_exposed_r:
            best = result

    return best or last_failure or FitResult(
        species.id, species.name, 0, False, "No feasible seeding date"
    )


#: Lower sorts first. "observed" means a curve measured on real nearby
#: fields; "modelled" means our thermal ramp, which nobody has checked.
EVIDENCE_ORDER = {"observed": 0, "literature": 1, "modelled": 2}


def evidence_rank(result: "FitResult") -> int:
    return EVIDENCE_ORDER.get(result.curve_source, 99)


def rank_species_for_gap(
    species_list: list[Species],
    gap: Gap,
    gdd_base4: list[float],
    gdd_base10: list[float],
    frost_prob: list[float],
    soil_moisture: list[float],
    erosivity_r: list[float],
    base_soil_cover: list[float],
    observed_curves: dict[str, list[float]] | None = None,
    b: float = RUSLE_B_DEFAULT,
    earliest_seed_doy: int | None = None,
) -> list[FitResult]:
    """All species scored for one gap, feasible first, best reduction first.

    `earliest_seed_doy` is the observed cash-crop harvest: nothing can be
    drilled into a field that still has a crop standing on it.
    """
    observed_curves = observed_curves or {}
    results = [
        fit_species_in_gap(
            sp,
            gap,
            gdd_base4,
            gdd_base10,
            frost_prob,
            soil_moisture,
            erosivity_r,
            base_soil_cover,
            observed_curve=observed_curves.get(sp.id),
            b=b,
            earliest_seed_doy=earliest_seed_doy,
        )
        for sp in species_list
    ]
    # Sort: feasible first, then by EVIDENCE TIER, then by benefit.
    #
    # Evidence outranks magnitude on purpose. A modelled thermal ramp will
    # often out-score a species we have a real curve for, simply because
    # the model is a smooth idealisation and the measurement is not. Three
    # rounds of making the model more realistic (conservative plateau,
    # frost kill, termination) narrowed that gap without closing it, and
    # chasing it further would just be tuning a guess until it agrees with
    # us -- which is not evidence, it is decoration.
    #
    # So we show both, and we put what we can defend first. The brief asks
    # the tool to support farmer judgment rather than replace it; a ranked
    # list that silently promotes the least-verified option does the
    # opposite. The UI must print the tier beside the number.
    results.sort(
        key=lambda r: (not r.feasible, evidence_rank(r), -r.delta_exposed_r)
    )
    return results


def splice_rotation_cover(
    base_soil_cover: list[float],
    fills: list[tuple[Gap, list[float]]],
) -> list[float]:
    """Overlay fitted cover curves onto the baseline to build a rotation.

    Union, not replacement: if the cash crop already covers the soil on a
    given day, a cover crop does not make it less covered.
    """
    out = list(base_soil_cover)
    for _, curve in fills:
        for i in range(DOY_LEN):
            out[i] = max(out[i], curve[i])
    return out


def summarize(cover: list[float], threshold: float = BARE_THRESHOLD) -> int:
    return sum(1 for v in cover if v < threshold)
