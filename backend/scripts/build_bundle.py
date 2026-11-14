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

from fallowclock.bundle import build_for_farm  # noqa: E402
from fallowclock.erosivity import peak_doy, peak_window_doy  # noqa: E402
from fallowclock.schema import Farm, write_bundle  # noqa: E402
from fallowclock.sources import check_eligibility  # noqa: E402
from fallowclock.weather import fetch_daily, frost_date_stats  # noqa: E402

OUT_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "bundles"

# A real place, named. "Farmers worldwide" appears nowhere in six years of
# Space Apps global winners; every one of them named a user and a location.
# OWNER NAME IS A PLACEHOLDER -- U2 must replace it with a real person or an
# honest composite, and say which it is.
FARMS: dict[str, Farm] = {
    "story-county-ia": Farm(
        id="story-county-ia",
        owner_name="TBD -- U2 to name a real farmer",
        place="Story County, Iowa",
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
    "monona-county-ia": Farm(
        id="monona-county-ia",
        owner_name="TBD -- second farm, Loess Hills",
        place="Monona County, Iowa (Loess Hills)",
        centroid=(-95.95, 42.05),
        area_ha=48.2,
        polygon_geojson={
            "type": "Polygon",
            "coordinates": [
                [
                    [-95.957, 42.046],
                    [-95.944, 42.046],
                    [-95.944, 42.054],
                    [-95.957, 42.054],
                    [-95.957, 42.046],
                ]
            ],
        },
    ),
}


def report(farm: Farm, bundle, path: Path) -> list[str]:
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
    print(f"  bare days        : {bare}")
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
    if not 120 <= bare <= 240:
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
        bundle = build_for_farm(
            farm, start_year=args.start_year, end_year=args.end_year
        )
        path = OUT_DIR / f"farm_{farm.id}.json"
        write_bundle(bundle, str(path))
        all_problems += [f"{farm.id}: {p}" for p in report(farm, bundle, path)]

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
