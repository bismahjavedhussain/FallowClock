"""Build a real bundle for a named farm.  B2's deliverable.

    python scripts/build_bundle.py                 # all configured farms
    python scripts/build_bundle.py --farm story-county-ia
    python scripts/build_bundle.py --list

Writes frontend/public/bundles/farm_<id>.json, which is what the UI loads.

Weather, erosivity and soil water are REAL NASA POWER data. Cover curves
are placeholders until B1's imagery pipeline lands, so these bundles carry
is_synthetic=True and the UI shows a red banner. That flag comes off when
B1 hands over ImageryInputs -- not before.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fallowclock.bundle import ImageryInputs, build_for_farm  # noqa: E402
from fallowclock.erosivity import peak_doy, peak_window_doy  # noqa: E402
from fallowclock.imagery import load_imagery, uncertainty_notes  # noqa: E402
from fallowclock.schema import Bundle, Farm, Uncertainty, write_bundle  # noqa: E402
from fallowclock.sources import check_eligibility  # noqa: E402
from fallowclock.weather import fetch_daily, frost_date_stats  # noqa: E402

OUT_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "bundles"
IMAGERY_DIR = Path(__file__).resolve().parents[1] / "data" / "imagery"

# A real place, named. "Farmers worldwide" appears nowhere in six years of
# Space Apps global winners; every one of them named a user and a location.
# OWNER NAME IS A PLACEHOLDER -- U2 must replace it with a real person or an
# honest composite, and say which it is.
FARMS: dict[str, Farm] = {
    "story-county-ia": Farm(
        id="story-county-ia",
        owner_name="TBD -- U2 to name a real farmer",
        place="Story County, Iowa",
        # 5 km NE of Ames. CDL 2014-2021 strict corn-soybean alternation;
        # 2022 corn, 2023 soy, 2024 corn, 2025 soy.
        centroid=(-93.564724, 42.050523),
        area_ha=39.3,
        polygon_geojson={
            "type": "Polygon",
            "coordinates": [
                [
                    [-93.568168, 42.04742],
                    [-93.561279, 42.04742],
                    [-93.561279, 42.053626],
                    [-93.568168, 42.053626],
                    [-93.568168, 42.04742],
                ]
            ],
        },
    ),
    "monona-county-ia": Farm(
        id="monona-county-ia",
        owner_name="TBD -- second farm, Loess Hills",
        place="Monona County, Iowa (Loess Hills)",
        # Loess Hills, 1.4 km from the original point. CDL 2014-2021
        # soybean-corn alternation; 2022 soy, 2023 corn, 2024 soy, 2025 corn.
        centroid=(-95.933558, 42.05),
        area_ha=14.9,
        polygon_geojson={
            "type": "Polygon",
            "coordinates": [
                [
                    [-95.936282, 42.048516],
                    [-95.930833, 42.048516],
                    [-95.930833, 42.051484],
                    [-95.936282, 42.051484],
                    [-95.936282, 42.048516],
                ]
            ],
        },
    ),
}


def imagery_for(farm_id: str) -> tuple[ImageryInputs | None, dict | None]:
    """B1's frozen satellite cover for a farm, or (None, None).

    Returning None rather than raising is deliberate: a teammate who has
    just cloned and wants to see the pipeline run should get a bundle with
    the synthetic banner on it, not an exception.
    """
    path = IMAGERY_DIR / f"{farm_id}.json"
    if not path.exists():
        return None, None
    imagery, report = load_imagery(path)
    # The report's `phases` is ordered the same way phase_covers is (most
    # observations first), so it names them. Only attach the labels if the
    # counts agree -- a wrong label is worse than no label.
    labels = list((report.get("phases") or {}).keys())
    if imagery.phase_covers and len(labels) == len(imagery.phase_covers):
        imagery.phase_labels = labels
    return imagery, report


def with_imagery_notes(bundle: Bundle, rep: dict) -> Bundle:
    """Append B1's imagery caveats. Re-running this script must not quietly
    drop them -- they are the honesty half of the bundle."""
    payload = bundle.model_dump(mode="json")
    payload["uncertainty"] = payload["uncertainty"] + [
        Uncertainty(**n).model_dump(mode="json") for n in uncertainty_notes(rep)
    ]
    return Bundle.model_validate(payload)


def report(farm: Farm, bundle, path: Path, rep: dict | None = None) -> list[str]:
    """Print the numbers, and return any sanity checks that failed."""
    c = bundle.climatology
    bare = sum(1 for v in c.soil_cover if v < 0.30)
    pk = peak_doy(c.erosivity_r)
    pk_win = peak_window_doy(c.erosivity_r)
    biggest = bundle.gaps[0] if bundle.gaps else None

    print(f"\n{farm.place}  ({farm.area_ha} ha)")
    print(f"  -> {path.name}  ({path.stat().st_size // 1024} KB)")
    print(f"  years            : {bundle.provenance.years_used[0]}"
          f"-{bundle.provenance.years_used[-1]}")
    cur = next((r for r in bundle.rotations if r.is_current), None)
    labels = bundle.observed_rotation.phase_labels
    if cur is not None and cur.bare_days_by_phase:
        split = ", ".join(
            f"{n}d after {lab}"
            for n, lab in zip(cur.bare_days_by_phase, labels or ["phase"] * 9)
        )
        print(f"  bare days        : {cur.bare_days} expected/yr ({split})"
              f"   [mean-cover curve alone reads {bare}]")
    else:
        print(f"  bare days        : {bare}")
    if rep:
        lo, hi = rep.get("bare_days_more_residue"), rep.get("bare_days_less_residue")
        if lo is not None and hi is not None:
            print(f"  bare-day band    : {lo}-{hi} for a +-0.02 NDTI endmember shift")
    print(f"  peak erosivity   : DOY {pk_win} (30-day window); single-day max DOY {pk}")
    print(f"  annual R         : {sum(c.erosivity_r):,.0f} MJ.mm/ha/h")
    if biggest:
        print(f"  biggest gap      : DOY {biggest.start_doy}-{biggest.end_doy} "
              f"({biggest.n_days}d, {biggest.share_of_annual_r*100:.0f}% of annual rain"
              f"{', wraps the year' if biggest.wraps_year else ''})")
    for r in bundle.rotations:
        print(f"    {r.label:<34} {r.bare_days:>3}d bare  "
              f"{r.delta_vs_current_pct:+6.1f}%  +${r.added_seed_cost_usd_ha:>3.0f}/ha")

    # Sanity checks from the plan's verification section.
    problems = []
    till = (rep or {}).get("tillage") or {}
    if not 120 <= bare <= 240:
        # The 120-240 range describes a CONVENTIONALLY TILLED corn-soy field.
        # A field whose own residue puts it in the NRCS reduced- or
        # conservation-tillage class is supposed to have fewer bare days, so
        # on those fields this is a finding to report, not a check to fail.
        if till.get("label") in ("reduced tillage", "conservation tillage"):
            print(f"  NOTE             : {bare} bare days is below the 120-240 range for a "
                  f"conventionally tilled field, but this one reads "
                  f"{till['post_planting_residue_median']*100:.0f}% residue after planting "
                  f"(n={till['n']}): NRCS {till['label']}, so few bare days is the finding")
        else:
            problems.append(f"bare days {bare} outside the plausible 120-240 for corn-soy")
    if not 91 <= pk_win <= 212:
        problems.append(f"erosivity peak window centres on DOY {pk_win}; Iowa "
                        "should be Apr-Jul (a January peak means a "
                        "day-of-year off-by-one)")
    eligible, nasa = check_eligibility(bundle.provenance.sources)
    if not eligible:
        problems.append("NO NASA DATA SOURCE -- the project would be ineligible")
    else:
        print(f"  NASA source      : {nasa[0]}")
    if bundle.provenance.is_synthetic:
        print("  NOTE             : cover curves are placeholders (B1 pending)")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--farm", help="farm id; default is all")
    ap.add_argument("--start-year", type=int, default=2000)
    ap.add_argument("--end-year", type=int, default=2024)
    ap.add_argument("--list", action="store_true", help="list configured farms")
    args = ap.parse_args()

    if args.list:
        for fid, f in FARMS.items():
            print(f"  {fid:<20} {f.place}")
        return 0

    targets = [FARMS[args.farm]] if args.farm else list(FARMS.values())
    if args.farm and args.farm not in FARMS:
        print(f"Unknown farm '{args.farm}'. Try --list.")
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    all_problems: list[str] = []

    for farm in targets:
        imagery, rep = imagery_for(farm.id)
        if imagery is None:
            print()
            print(f"[{farm.id}] no data/imagery/{farm.id}.json -- falling back to "
                  "SYNTHETIC cover curves. Run scripts/build_imagery.py for real ones.")
        bundle = build_for_farm(
            farm, start_year=args.start_year, end_year=args.end_year, imagery=imagery
        )
        if rep is not None:
            bundle = with_imagery_notes(bundle, rep)
        path = OUT_DIR / f"farm_{farm.id}.json"
        write_bundle(bundle, str(path))
        all_problems += [f"{farm.id}: {p}" for p in report(farm, bundle, path, rep)]

        fd = frost_date_stats(
            fetch_daily(farm.centroid[1], farm.centroid[0], args.start_year, args.end_year)
        )
        print(f"  frost (median)   : last spring DOY {fd.last_spring_doy}, "
              f"first fall DOY {fd.first_fall_doy} ({fd.frost_free_days} frost-free days)")

    print()
    if all_problems:
        print("SANITY CHECKS FAILED:")
        for p in all_problems:
            print(f"  - {p}")
        return 1
    print(f"{len(targets)} bundle(s) written and sanity-checked.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
