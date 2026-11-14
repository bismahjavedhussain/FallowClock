"""DAY-0 BLOCKER CHECK. Run this BEFORE the hackathon clock starts.

    python scripts/verify_gee.py --project YOUR_GCP_PROJECT_ID

Plan bottleneck B1: Earth Engine noncommercial access needs a registration
questionnaire in the Cloud console and is NOT instant. Finding that out at
hour 0 costs you the weekend. Use an institutional email -- Google's docs
say it helps verification.

Plan bottleneck B2: since 2026-04-27 every noncommercial project has a
monthly free compute-unit quota. Past it you drop into restricted mode,
which mid-hackathon is indistinguishable from an outage. So:

    NEVER export rasters. Only reduceRegion / reduceRegions over small
    polygons, and cache every result the moment it returns.

This script does exactly what the real pipeline does -- a server-side
reduction over one field polygon -- so if it passes, the pipeline's access
pattern is proven. If it fails, switch to the Planetary Computer fallback
and rewrite the backend split before the clock starts.
"""

from __future__ import annotations

import argparse
import sys

# A 65 ha field in Story County, Iowa. Small on purpose: this is the access
# pattern the whole pipeline uses.
TEST_POLYGON = [
    [-93.628, 42.026],
    [-93.613, 42.026],
    [-93.613, 42.035],
    [-93.628, 42.035],
    [-93.628, 42.026],
]

CHECKS: list[tuple[str, str]] = []


def record(name: str, ok: bool, detail: str = "") -> bool:
    CHECKS.append((name, "PASS" if ok else "FAIL"))
    mark = "  ok  " if ok else " FAIL "
    print(f"[{mark}] {name}" + (f"  -- {detail}" if detail else ""))
    return ok


def main(project: str | None) -> int:
    print("Earth Engine readiness check\n" + "=" * 54)

    try:
        import ee
    except ImportError:
        record("earthengine-api installed", False, "pip install earthengine-api")
        return 1
    record("earthengine-api installed", True, f"v{getattr(ee, '__version__', '?')}")

    try:
        ee.Initialize(project=project) if project else ee.Initialize()
    except Exception as exc:  # noqa: BLE001
        record("ee.Initialize()", False, str(exc)[:160])
        print(
            "\nMost likely causes, in order:\n"
            "  1. Not authenticated      -> run: earthengine authenticate\n"
            "  2. No project registered  -> https://code.earthengine.google.com/register\n"
            "  3. Registration pending   -> noncommercial approval is not instant\n"
            "  4. Wrong project id       -> pass --project YOUR_PROJECT_ID\n"
        )
        return 1
    record("ee.Initialize()", True, f"project={project or 'default'}")

    aoi = ee.Geometry.Polygon([TEST_POLYGON])

    # --- the exact access pattern the pipeline uses -----------------------
    try:
        s2 = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(aoi)
            .filterDate("2023-05-01", "2023-09-30")
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 40))
        )
        n = s2.size().getInfo()
        record("Sentinel-2 L2A reachable", n > 0, f"{n} scenes, summer 2023")

        def ndvi(img):
            return img.normalizedDifference(["B8", "B4"]).rename("ndvi")

        value = (
            ndvi(s2.median())
            .reduceRegion(reducer=ee.Reducer.mean(), geometry=aoi, scale=10, maxPixels=1e8)
            .get("ndvi")
            .getInfo()
        )
        ok = value is not None and 0.2 < value < 1.0
        record("reduceRegion NDVI", ok, f"mean summer NDVI = {value:.3f}" if value else "null")
    except Exception as exc:  # noqa: BLE001
        record("Sentinel-2 reduceRegion", False, str(exc)[:160])

    # --- NDTI: the residue index, needs the SWIR bands --------------------
    try:
        ndti = (
            s2.median()
            .normalizedDifference(["B11", "B12"])
            .rename("ndti")
            .reduceRegion(reducer=ee.Reducer.mean(), geometry=aoi, scale=20, maxPixels=1e8)
            .get("ndti")
            .getInfo()
        )
        record("NDTI (SWIR B11/B12)", ndti is not None, f"mean NDTI = {ndti:.3f}")
    except Exception as exc:  # noqa: BLE001
        record("NDTI (SWIR B11/B12)", False, str(exc)[:160])

    # --- the other collections the plan depends on ------------------------
    for label, cid, kind in [
        ("Landsat 8 C2 L2", "LANDSAT/LC08/C02/T1_L2", "ic"),
        ("Landsat 9 C2 L2", "LANDSAT/LC09/C02/T1_L2", "ic"),
        ("GPM IMERG V07", "NASA/GPM_L3/IMERG_V07", "ic"),
        ("USDA CDL", "USDA/NASS/CDL", "ic"),
        ("SRTM elevation", "USGS/SRTMGL1_003", "img"),
    ]:
        try:
            if kind == "ic":
                size = (
                    ee.ImageCollection(cid)
                    .filterBounds(aoi)
                    .filterDate("2023-01-01", "2023-12-31")
                    .size()
                    .getInfo()
                )
                record(label, size > 0, f"{size} images in 2023")
            else:
                band = ee.Image(cid).bandNames().getInfo()
                record(label, bool(band), f"bands={band}")
        except Exception as exc:  # noqa: BLE001
            record(label, False, str(exc)[:120])

    # --- SMAP: version suffix drifts, so probe a couple -------------------
    smap_ok = False
    for cid in [
        "NASA/SMAP/SPL4SMGP/008",
        "NASA/SMAP/SPL4SMGP/007",
        "NASA/SMAP/SPL3SMP_E/006",
    ]:
        try:
            if ee.ImageCollection(cid).filterDate("2023-06-01", "2023-06-10").size().getInfo() > 0:
                record(f"SMAP ({cid})", True)
                smap_ok = True
                break
        except Exception:  # noqa: BLE001, S112
            continue
    if not smap_ok:
        record("SMAP (any version)", False, "check the catalog for the current id")

    failed = [n for n, s in CHECKS if s == "FAIL"]
    print("=" * 54)
    if failed:
        print(f"{len(failed)} FAILED: {', '.join(failed)}")
        print("\nDo not start the hackathon until ee.Initialize() and")
        print("reduceRegion pass. Everything else has a documented fallback.")
        return 1

    print(f"All {len(CHECKS)} checks passed. GEE access is proven.")
    print("\nReminder: reduceRegion only. No raster exports. Cache everything.")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", help="Google Cloud project id registered for EE")
    sys.exit(main(ap.parse_args().project))
