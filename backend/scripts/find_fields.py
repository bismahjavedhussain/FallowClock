"""Find real corn/soybean fields for the demo farms.  B1's script.

    python scripts/find_fields.py
    python scripts/find_fields.py --farm story-county-ia --top 5

WHY THIS EXISTS: the two rectangles in scripts/build_bundle.py (B2's FARMS)
were sketched by hand and do not sit on cropland. Per USDA CDL 2019-2021 the
Story County box is 100% developed land -- it is in the town of Ames -- and
the Monona County box is ~80% deciduous forest and pasture. A satellite
pipeline run over them would faithfully report a town and a wood.

So for each farm this finds the NEAREST field in the same county with a
textbook corn/soybean rotation (CDL 2014-2021, alternating every year),
takes the largest rectangle that fits inside it (one 30 m pixel in from its
edges), and checks the years after 2021 against USDA CropScape.

Its output is pasted into FIELDS in scripts/build_imagery.py. Running it
again reproduces the same answer from cache.
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fallowclock.cdl import (  # noqa: E402
    ROW_CROPS,
    cdl_name,
    cropscape_value,
    find_corn_soy_fields,
    sample_points,
)

#: Search boxes are drawn INSIDE each county, around B2's original point,
#: so the farm keeps its place name.
SEARCH = {
    "story-county-ia": {
        "place": "Story County, Iowa",
        "region": (-93.69, 41.96, -93.50, 42.12),
        "target": (-93.62, 42.03),
        "min_ha": 30.0,
    },
    "monona-county-ia": {
        "place": "Monona County, Iowa (Loess Hills)",
        "region": (-96.03, 41.98, -95.86, 42.12),
        "target": (-95.95, 42.05),
        "min_ha": 12.0,
    },
}

SEQUENCE_YEARS = list(range(2014, 2022))
CHECK_YEARS = [2022, 2023, 2024, 2025]


def check_recent(polygon: dict) -> dict[int, list[str]]:
    """CropScape classes at five points inside the field, per recent year."""
    pts = sample_points(polygon)
    out: dict[int, list[str]] = {}
    for year in CHECK_YEARS:
        def one(pt, year=year):
            try:
                return cropscape_value(year, pt[0], pt[1])
            except Exception as exc:  # noqa: BLE001
                return (-1, f"unavailable ({type(exc).__name__})")

        with ThreadPoolExecutor(max_workers=3) as pool:
            out[year] = [f"{code}:{name}" for code, name in pool.map(one, pts)]
    return out


def recent_ok(recent: dict[int, list[str]], last_code: int) -> bool:
    """Still corn/soy after 2021, and still alternating where we can tell."""
    prev = last_code
    for year in CHECK_YEARS:
        codes = [int(s.split(":")[0]) for s in recent.get(year, []) if not s.startswith("-1")]
        if not codes:
            continue  # year not available: cannot tell, do not penalise
        majority = max(set(codes), key=codes.count)
        if majority not in ROW_CROPS or majority == prev:
            return False
        prev = majority
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--farm", choices=sorted(SEARCH))
    ap.add_argument("--top", type=int, default=3, help="candidates to verify per farm")
    args = ap.parse_args()

    chosen = {}
    for fid, spec in SEARCH.items():
        if args.farm and fid != args.farm:
            continue
        print(f"\n{fid}: searching {spec['region']} for strict corn/soy fields >= {spec['min_ha']} ha")
        cands = find_corn_soy_fields(
            spec["region"], SEQUENCE_YEARS, spec["target"], min_ha=spec["min_ha"]
        )
        print(f"  {len(cands)} candidates")
        for cand in cands[: args.top]:
            last = 1 if cand.sequence.endswith("C") else 5
            recent = check_recent(cand.polygon)
            ok = recent_ok(recent, last)
            print(f"  {cand.distance_km:5.2f} km  {cand.area_ha:5.1f} ha (field {cand.component_ha} ha)  "
                  f"{cand.sequence}  centroid {cand.centroid}  {'OK' if ok else 'rejected'}")
            for year, vals in recent.items():
                print(f"      {year}: {', '.join(vals)}")
            if ok:
                chosen[fid] = cand
                break

    print("\n# ---- paste into FIELDS in scripts/build_imagery.py ----")
    for fid, cand in chosen.items():
        print(json.dumps({
            "id": fid,
            "place": SEARCH[fid]["place"],
            "centroid": cand.centroid,
            "area_ha": cand.area_ha,
            "polygon_geojson": cand.polygon,
            "cdl_2014_2021": cand.sequence,
        }))
    missing = [f for f in SEARCH if f not in chosen and (not args.farm or f == args.farm)]
    if missing:
        print(f"\nNo verified field for: {', '.join(missing)} -- widen the region or raise --top")
        return 1
    print(f"\nLast CDL year checked: {cdl_name(1)}/{cdl_name(5)} alternation through {CHECK_YEARS[-1]} where available.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
