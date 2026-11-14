"""Generate shared test vectors from the Python implementation.

    python scripts/gen_vectors.py

Writes two identical copies:
    backend/tests/vectors.json
    frontend/src/lib/__vectors__.json

Both test suites assert against them. Python is the reference implementation;
if TypeScript disagrees, TypeScript is wrong.

This exists because cover-crop fitting is implemented twice (see the header
of fallowclock/cropfit.py). Without a shared fixture the two drift silently,
and you find out when the UI and the pitch deck quote different numbers in
front of a judge.
"""

from __future__ import annotations

import json
import math
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fallowclock.cropfit import (  # noqa: E402
    candidate_seed_doys,
    fit_species_in_gap,
    load_species,
    thermal_ramp_curve,
)
from fallowclock.gaps import (  # noqa: E402
    accumulate_gdd,
    build_gaps,
    doys_in_run,
    exposed_erosivity,
    first_killing_frost_doy,
    rusle_c_factor,
)
from fallowclock.schema import DOY_LEN  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DOYS = list(range(1, DOY_LEN + 1))


def r4(x: float) -> float:
    """Round to 4dp. Avoids float-formatting differences between languages
    turning into spurious test failures at 3am."""
    return round(x, 4)


def synth_climatology() -> dict[str, list[float]]:
    """A deterministic, simply-specified climatology. Not Iowa -- just a
    fixed input both implementations must agree on."""
    gdd4, gdd10, frost, moisture, erosivity, cover = [], [], [], [], [], []
    for d in DOYS:
        tmean = 10.5 - 14.0 * math.cos(2 * math.pi * (d - 15) / DOY_LEN)
        gdd4.append(r4(max(0.0, tmean - 4.0)))
        gdd10.append(r4(max(0.0, tmean - 10.0)))
        frost.append(r4(1.0 if (d <= 110 or d >= 288) else 0.0))
        moisture.append(r4(0.28 + 0.09 * math.cos(2 * math.pi * (d - 110) / DOY_LEN)))
        erosivity.append(r4(0.5 + 26.0 * math.exp(-(((d - 158) / 52.0) ** 2))))
        # Bare from DOY 300 through DOY 140, covered in between.
        cover.append(0.85 if 141 <= d <= 299 else 0.08)
    return {
        "gdd_base4": gdd4,
        "gdd_base10": gdd10,
        "frost_prob": frost,
        "soil_moisture": moisture,
        "erosivity_r": erosivity,
        "soil_cover": cover,
    }


def build() -> dict:
    clim = synth_climatology()
    species = load_species(ROOT / "backend" / "data" / "species.csv")
    by_id = {s.id: s for s in species}

    gaps = build_gaps(clim["soil_cover"], clim["erosivity_r"])
    main_gap = gaps[0]

    cases: dict = {
        "rusle_c_factor": [
            {"cover": c, "b": 0.035, "expect": r4(rusle_c_factor(c, 0.035))}
            for c in [0.0, 0.1, 0.3, 0.5, 0.85, 1.0]
        ],
        "doys_in_run": [
            {"start": s, "end": e, "expect": doys_in_run(s, e)}
            for s, e in [(5, 8), (363, 1), (0, 0), (364, 364), (300, 59)]
        ],
        "accumulate_gdd": [
            {"start_doy": s, "end_doy": e,
             "expect": r4(accumulate_gdd(clim["gdd_base4"], s, e))}
            for s, e in [(10, 19), (360, 5), (1, 365), (288, 300), (250, 287)]
        ],
        "first_killing_frost_doy": [
            {"after_doy": a, "expect": first_killing_frost_doy(clim["frost_prob"], a)}
            for a in [100, 250, 287, 350, 115]
        ],
        "exposed_erosivity": [
            {
                "label": "baseline",
                "expect": r4(exposed_erosivity(clim["soil_cover"], clim["erosivity_r"])),
            },
            {
                "label": "fully_bare",
                "cover_const": 0.0,
                "expect": r4(exposed_erosivity([0.0] * DOY_LEN, clim["erosivity_r"])),
            },
            {
                "label": "fully_covered",
                "cover_const": 0.95,
                "expect": r4(exposed_erosivity([0.95] * DOY_LEN, clim["erosivity_r"])),
            },
        ],
        "gaps": [
            {
                "start_doy": g.start_doy,
                "end_doy": g.end_doy,
                "n_days": g.n_days,
                "exposed_r": r4(g.exposed_r),
                "share_of_annual_r": r4(g.share_of_annual_r),
                "wraps_year": g.wraps_year,
            }
            for g in gaps
        ],
        "candidate_seed_doys": [],
        "thermal_ramp_curve": [],
        "fit_species_in_gap": [],
    }

    gap_payload = {
        "start_doy": main_gap.start_doy,
        "end_doy": main_gap.end_doy,
        "n_days": main_gap.n_days,
        "exposed_r": r4(main_gap.exposed_r),
        "share_of_annual_r": r4(main_gap.share_of_annual_r),
        "wraps_year": main_gap.wraps_year,
    }

    for sid in ["cereal_rye", "forage_radish", "hairy_vetch", "buckwheat", "oats"]:
        sp = by_id[sid]
        cands = candidate_seed_doys(sp, main_gap)
        cases["candidate_seed_doys"].append(
            {"species_id": sid, "expect_count": len(cands),
             "expect_first": cands[0] if cands else None,
             "expect_last": cands[-1] if cands else None}
        )

        if cands:
            gdd = clim["gdd_base10"] if sp.tbase_c >= 10 else clim["gdd_base4"]
            curve = thermal_ramp_curve(sp, cands[0], main_gap, gdd)
            cases["thermal_ramp_curve"].append(
                {
                    "species_id": sid,
                    "seed_doy": cands[0],
                    "expect_sum": r4(sum(curve)),
                    "expect_max": r4(max(curve)),
                    "expect_nonzero_days": sum(1 for v in curve if v > 0),
                }
            )

        fit = fit_species_in_gap(
            sp, main_gap,
            clim["gdd_base4"], clim["gdd_base10"], clim["frost_prob"],
            clim["soil_moisture"], clim["erosivity_r"], clim["soil_cover"],
        )
        cases["fit_species_in_gap"].append(
            {
                "species_id": sid,
                "expect_feasible": fit.feasible,
                "expect_seed_doy": fit.seed_doy,
                "expect_gdd_available": r4(fit.gdd_available),
                "expect_delta_exposed_r": r4(fit.delta_exposed_r),
                "expect_pct_reduction": r4(fit.pct_reduction),
                "expect_curve_source": fit.curve_source,
            }
        )

    return {
        "_readme": (
            "Generated by backend/scripts/gen_vectors.py. Python is the "
            "reference implementation. Do not hand-edit."
        ),
        "climatology": clim,
        "gap": gap_payload,
        "species_csv": "backend/data/species.csv",
        "cases": cases,
    }


if __name__ == "__main__":
    payload = build()
    primary = ROOT / "backend" / "tests" / "vectors.json"
    primary.write_text(json.dumps(payload, indent=1), encoding="utf-8")

    mirror = ROOT / "frontend" / "src" / "lib" / "__vectors__.json"
    mirror.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(primary, mirror)

    print(f"wrote {primary}")
    print(f"wrote {mirror}")
    n = sum(len(v) for v in payload["cases"].values())
    print(f"  {n} vectors across {len(payload['cases'])} functions")
    print(f"  main gap: DOY {payload['gap']['start_doy']}-{payload['gap']['end_doy']}"
          f" ({payload['gap']['n_days']}d, wraps={payload['gap']['wraps_year']})")
    for f in payload["cases"]["fit_species_in_gap"]:
        print(f"    {f['species_id']:<16} feasible={str(f['expect_feasible']):<5} "
              f"seed={f['expect_seed_doy']:<4} "
              f"reduction={f['expect_pct_reduction']:.1f}%")
