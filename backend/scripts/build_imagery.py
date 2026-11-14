"""Real bundles: B1's satellite cover + B2's weather and model.  B1's script.

    python scripts/build_imagery.py                       # all farms, fetch everything
    python scripts/build_imagery.py --farm story-county-ia
    python scripts/build_imagery.py --from-saved          # no imagery fetch: reuse data/imagery/*.json
    python scripts/build_imagery.py --no-detect           # skip the neighbour cover-crop scan

Writes:
  backend/data/imagery/<farm>.json          the frozen B1 -> B2 handoff (ImageryInputs + diagnostics)
  frontend/public/bundles/farm_<farm>.json  the bundle the UI loads, is_synthetic = False

First run fetches ~1,500 scenes per farm from Planetary Computer (cached under
backend/cache/, ~20-30 min). Every later run is offline for the imagery.

FIELDS: B2's FARMS rectangles sit on a town and a wood (see find_fields.py),
so the farms keep B2's id, owner name and place, but use real corn/soybean
fields found in the same counties. B2's build_bundle.py still uses placeholder
imagery and will overwrite these bundles with synthetic ones if re-run; the
one-line fix there is B2's to make:  imagery=load_imagery(<json>)[0].
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fallowclock.bundle import build_for_farm  # noqa: E402
from fallowclock.imagery import (  # noqa: E402
    build_imagery,
    load_imagery,
    save_imagery,
    uncertainty_notes,
)
from fallowclock.schema import Bundle, Farm, Uncertainty, write_bundle  # noqa: E402
from fallowclock.weather import fetch_daily  # noqa: E402
from scripts.build_bundle import FARMS, OUT_DIR  # noqa: E402
from scripts.build_bundle import report as b2_report  # noqa: E402

IMAGERY_DIR = Path(__file__).resolve().parents[1] / "data" / "imagery"

#: Real corn/soybean fields, from scripts/find_fields.py (CDL 2014-2021 strict
#: alternation, checked against CropScape through 2025).
FIELDS: dict[str, dict] = {
    "story-county-ia": {
        # 5 km NE of Ames. CDL 2014-2021 C-S-C-S-C-S-C-S; 2022 corn, 2023 soy,
        # 2024 corn, 2025 soy.
        "centroid": (-93.564724, 42.050523),
        "area_ha": 39.3,
        "polygon_geojson": {"type": "Polygon", "coordinates": [[
            [-93.568168, 42.04742], [-93.561279, 42.04742], [-93.561279, 42.053626],
            [-93.568168, 42.053626], [-93.568168, 42.04742]]]},
    },
    "monona-county-ia": {
        # Loess Hills, 1.4 km from B2's original point. CDL 2014-2021
        # S-C-S-C-S-C-S-C; 2022 soy, 2023 corn, 2024 soy, 2025 corn.
        "centroid": (-95.933558, 42.05),
        "area_ha": 14.9,
        "polygon_geojson": {"type": "Polygon", "coordinates": [[
            [-95.936282, 42.048516], [-95.930833, 42.048516], [-95.930833, 42.051484],
            [-95.936282, 42.051484], [-95.936282, 42.048516]]]},
    },
}


def real_farm(fid: str) -> Farm:
    """B2's farm (id, named owner, place) on the real field's geometry."""
    return Farm.model_validate({**FARMS[fid].model_dump(), **FIELDS[fid]})


def rain_records(farm: Farm):
    """NASA POWER daily rain for the NDTI wet-soil gate, 2016 to now."""
    lon, lat = farm.centroid
    records = fetch_daily(lat, lon, 2016, 2025)
    try:
        records += fetch_daily(lat, lon, 2026, 2026)
    except Exception as exc:  # noqa: BLE001 - 2026 rain is a bonus, not a requirement
        print(f"  [rain] 2026 not available ({type(exc).__name__}); 2026 scenes get no residue reading")
    return records


def with_notes(bundle: Bundle, notes: list[dict]) -> Bundle:
    payload = bundle.model_dump(mode="json")
    payload["uncertainty"] = payload["uncertainty"] + [Uncertainty(**n).model_dump(mode="json") for n in notes]
    return Bundle.model_validate(payload)


def b1_checks(bundle: Bundle, rep: dict) -> list[str]:
    """README verification items that are B1's to answer."""
    problems = []
    rye = bundle.crop_curves.get("cereal_rye")
    det = rep.get("detection") or {}
    if rye is not None and rye.source == "observed":
        fall, term = det.get("fall_start_doy"), det.get("termination_doy")
        if fall is None or not 244 <= fall <= 334:
            problems.append(f"rye curve starts at DOY {fall}; expected Sep-Nov")
        if term is None or not 91 <= term <= 166:
            problems.append(f"rye curve terminates at DOY {term}; expected Apr-mid Jun")
    if rep["zero_obs_doys"] > 60:
        problems.append(f"{rep['zero_obs_doys']} days with no clear observation in +-8 days")
    if rep["observations"].get("landsat", 0) == 0:
        problems.append("no Landsat observations: the imagery contributes no NASA data")
    return problems


def explain_low_bare_days(problems: list[str], rep: dict) -> list[str]:
    """B2's 120-240 bare-day range describes a conventionally tilled corn-soy
    field. A field whose own post-planting residue puts it in the NRCS
    conservation-tillage class is SUPPOSED to have few bare days, so that
    check is reported as a finding, not a failure."""
    till = rep.get("tillage") or {}
    if till.get("label") != "conservation tillage":
        return problems
    kept = []
    for p in problems:
        if "bare days" in p and "outside the plausible" in p:
            print(f"  NOTE             : {p} -- but this field reads {till['post_planting_residue_median']*100:.0f}% "
                  f"residue after planting (n={till['n']}): NRCS conservation tillage, so few bare days is the finding")
        else:
            kept.append(p)
    return kept


def summary(rep: dict, bundle: Bundle) -> None:
    det = rep.get("detection") or {}
    print(f"  imagery          : {rep['period'][0]} .. {rep['period'][1]}; scenes {rep['scenes']}; "
          f"clear obs {rep['observations']}; failed reads {rep['failed_reads']}")
    print(f"  residue readings : {rep['residue_obs']} (withheld wet/unknown rain: {rep['wet_or_unknown_rain']})")
    print(f"  bare days (B1)   : {rep['bare_days']}  [NDTI endmembers +-0.02: "
          f"{rep['bare_days_more_residue']}-{rep['bare_days_less_residue']}]; "
          f"days with no obs: {rep['zero_obs_doys']}")
    print(f"  rotation         : {bundle.observed_rotation.inferred_label}; phases {rep['phases']}")
    print(f"  NDTI endmembers  : {rep['endmembers']['text']}")
    if det:
        print(f"  cover-crop scan  : {det['n_field_seasons']} of {det['n_candidates']} field-springs "
              f"({det['n_fields']} fields) within {det['radius_km']:.0f} km; curve "
              f"{'observed' if det.get('curve') else 'NOT observed'}; fall start DOY "
              f"{det.get('fall_start_doy')}, peak DOY {det.get('peak_doy')} "
              f"({det.get('peak_cover')}), termination DOY {det.get('termination_doy')}")
    for w in rep.get("warnings", []):
        print(f"  WARNING          : {w}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--farm", choices=sorted(FIELDS))
    ap.add_argument("--from-saved", action="store_true", help="reuse data/imagery/<farm>.json")
    ap.add_argument("--no-detect", action="store_true", help="skip neighbour cover-crop detection")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--start-year", type=int, default=2000, help="weather years (B2)")
    ap.add_argument("--end-year", type=int, default=2024, help="weather years (B2)")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    problems: list[str] = []
    targets = [args.farm] if args.farm else list(FIELDS)
    for fid in targets:
        farm = real_farm(fid)
        saved = IMAGERY_DIR / f"{fid}.json"
        print(f"\n=== {fid}: {farm.place}, {farm.area_ha} ha at {farm.centroid}")
        if args.from_saved:
            imagery, rep = load_imagery(saved)
        else:
            imagery, report_obj = build_imagery(
                fid, farm.polygon_geojson, rain_records(farm),
                detect=not args.no_detect, workers=args.workers,
            )
            save_imagery(saved, imagery, report_obj)
            rep = asdict(report_obj)
            print(f"  -> {saved.relative_to(saved.parents[2])}")

        bundle = build_for_farm(farm, start_year=args.start_year, end_year=args.end_year, imagery=imagery)
        bundle = with_notes(bundle, uncertainty_notes(rep))
        out = OUT_DIR / f"farm_{fid}.json"
        write_bundle(bundle, str(out))
        problems += [f"{fid}: {p}" for p in explain_low_bare_days(b2_report(farm, bundle, out), rep)]
        summary(rep, bundle)
        problems += [f"{fid}: {p}" for p in b1_checks(bundle, rep)]

    print()
    if problems:
        print("SANITY CHECKS FLAGGED (real data -- investigate, do not tune to pass):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"{len(targets)} real bundle(s) written and sanity-checked.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
