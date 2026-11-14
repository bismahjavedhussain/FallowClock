"""Live API.  B2 owns this file.

    uvicorn api.main:app --reload --port 8000

THE DEMO MUST NOT USE THIS. The demo loads a static committed JSON. This
exists so that when a judge asks "does it only work on your three farms?"
you can hand them the laptop and let them draw a polygon.

That is also why every failure path here returns a usable answer rather
than an error: falling back to the nearest precomputed farm, with a header
saying so, beats a spinner in front of a judge.

HONEST LIMITS, returned in the response so nobody has to take our word:
  * Weather, erosivity and soil water work anywhere on Earth (NASA POWER
    is global).
  * Crop identification needs USDA CDL, which is US only.
  * The cover crop species table is calibrated for the Midwest.
Outside the US Corn Belt this returns the ring and the risk layer, and
says plainly that the species ranking does not apply.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from fallowclock.bundle import build_for_farm  # noqa: E402
from fallowclock.cache import cache_stats  # noqa: E402
from fallowclock.schema import Bundle, Farm  # noqa: E402

try:
    from scripts.build_bundle import FARMS, imagery_for
except ImportError:  # running from a different cwd
    FARMS = {}

    def imagery_for(farm_id: str):  # type: ignore[misc]
        return None, None

BUNDLE_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "bundles"

# Continental US bounding box. Crude on purpose -- it gates a caveat, not a
# computation, so a few km of slop at the edges costs nothing.
CONUS = (-125.0, 24.0, -66.5, 49.5)

app = FastAPI(
    title="Fallow Clock API",
    description="Find the hole in your year. NASA Space Apps 2026.",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # hackathon demo; tighten before anything real
    allow_methods=["*"],
    allow_headers=["*"],
)


class BundleRequest(BaseModel):
    polygon: dict = Field(description="GeoJSON Polygon")
    name: str = Field(default="Your field", max_length=120)
    place: str = Field(default="", max_length=200)
    start_year: int = Field(default=2000, ge=1981, le=2030)
    end_year: int = Field(default=2024, ge=1981, le=2030)


def centroid_of(polygon: dict) -> tuple[float, float]:
    try:
        ring = polygon["coordinates"][0]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(422, "Malformed GeoJSON Polygon") from exc
    if len(ring) < 4:
        raise HTTPException(422, "A polygon ring needs at least 4 positions")
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    try:
        lon = sum(p[0] for p in pts) / len(pts)
        lat = sum(p[1] for p in pts) / len(pts)
    except (TypeError, IndexError) as exc:
        raise HTTPException(422, "Polygon coordinates must be [lon, lat] pairs") from exc
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise HTTPException(422, f"Centroid ({lon:.2f}, {lat:.2f}) is not on Earth")
    return lon, lat


def area_ha(polygon: dict, lat: float) -> float:
    """Shoelace on an equirectangular approximation. Good enough for a field."""
    ring = polygon["coordinates"][0]
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    scale = math.cos(math.radians(lat))
    acc = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i][0] * scale, pts[i][1]
        x2, y2 = pts[(i + 1) % len(pts)][0] * scale, pts[(i + 1) % len(pts)][1]
        acc += x1 * y2 - x2 * y1
    deg2 = abs(acc) / 2.0
    return deg2 * (111_320.0**2) / 10_000.0


def in_conus(lon: float, lat: float) -> bool:
    return CONUS[0] <= lon <= CONUS[2] and CONUS[1] <= lat <= CONUS[3]


def point_in_ring(lon: float, lat: float, ring: list) -> bool:
    """Ray casting. Our field polygons are small convex rectangles, so this
    does not need to be clever -- it needs to be right."""
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if (y1 > lat) != (y2 > lat):
            x_at = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lon < x_at:
                inside = not inside
    return inside


def known_field_at(lon: float, lat: float) -> str | None:
    """The precomputed farm whose field this point falls inside, if any.

    This is how a judge who draws over one of our two fields gets the REAL
    satellite cover instead of a synthetic placeholder. It is deliberately
    containment and not nearest-neighbour: handing one field's observed
    cover curve to a different field would be making data up.
    """
    for fid, f in FARMS.items():
        try:
            ring = f.polygon_geojson["coordinates"][0]
        except (KeyError, IndexError, TypeError):
            continue
        if point_in_ring(lon, lat, ring):
            return fid
    return None


def nearest_precomputed(lon: float, lat: float) -> str | None:
    best, best_d = None, float("inf")
    for fid, f in FARMS.items():
        d = math.hypot(f.centroid[0] - lon, f.centroid[1] - lat)
        if d < best_d:
            best, best_d = fid, d
    return best


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "precomputed_farms": sorted(FARMS),
        "cache": cache_stats(),
    }


@app.get("/bundles/{farm_id}")
def get_precomputed(farm_id: str) -> dict:
    """Serve a frozen bundle. This is the path the demo would use if it
    used the API at all -- no computation, no outbound calls."""
    path = BUNDLE_DIR / f"farm_{farm_id}.json"
    if not path.exists():
        raise HTTPException(404, f"No bundle for '{farm_id}'. Try {sorted(FARMS)}.")
    import json

    return json.loads(path.read_text(encoding="utf-8"))


@app.post("/bundle")
def build(req: BundleRequest) -> dict:
    """Build a bundle for an arbitrary polygon.

    Never raises for a plausible request: on failure it falls back to the
    nearest precomputed farm and says so in `fallback`.
    """
    if req.end_year < req.start_year:
        raise HTTPException(422, "end_year is before start_year")

    lon, lat = centroid_of(req.polygon)
    ha = area_ha(req.polygon, lat)
    if ha > 100_000:
        raise HTTPException(
            422, f"Polygon is {ha:,.0f} ha. This is a field-scale tool; draw a field."
        )

    caveats: list[str] = []
    if not in_conus(lon, lat):
        caveats.append(
            "Outside the continental US: weather, erosivity and soil water are "
            "valid (NASA POWER is global), but crop identification needs USDA "
            "CDL and the cover crop species table is calibrated for the US "
            "Midwest. Treat the species ranking as not applicable here."
        )
    if ha < 1.0:
        caveats.append(f"Polygon is only {ha:.2f} ha; NASA POWER is ~50 km gridded.")

    farm = Farm(
        id="adhoc",
        owner_name=req.name,
        place=req.place or f"{lat:.3f}, {lon:.3f}",
        centroid=(lon, lat),
        area_ha=max(0.01, ha),
        polygon_geojson=req.polygon,
    )

    # Cover curves need ~1,500 satellite scenes per field and 20-30 minutes,
    # so an arbitrary polygon cannot have real ones inside a web request.
    # What it CAN have, honestly, is the real NASA POWER half -- weather,
    # erosivity and soil water -- with the cover half flagged synthetic.
    imagery, _ = (None, None)
    known = known_field_at(lon, lat)
    if known:
        imagery, _ = imagery_for(known)
        if imagery is not None:
            caveats.append(
                f"This polygon falls inside our precomputed field "
                f"'{known}', so the cover curves are that field's real "
                f"Sentinel-2 and Landsat observations."
            )
    if imagery is None:
        caveats.append(
            "Cover curves are SYNTHETIC placeholders. Building real ones "
            "takes about 1,500 satellite scenes and 20-30 minutes, which "
            "does not fit in a web request. Weather, erosivity and soil "
            "water below are real NASA POWER data; the cover half is not."
        )

    try:
        bundle: Bundle = build_for_farm(
            farm, start_year=req.start_year, end_year=req.end_year,
            imagery=imagery,
        )
    except Exception as exc:  # noqa: BLE001 - a judge gets an answer, not a stack trace
        fid = nearest_precomputed(lon, lat)
        if not fid:
            raise HTTPException(503, f"Upstream data unavailable: {exc}") from exc
        payload = get_precomputed(fid)
        payload["_fallback"] = {
            "reason": str(exc)[:200],
            "served": fid,
            "note": "Live build failed; serving the nearest precomputed farm.",
        }
        return payload

    payload = bundle.model_dump(mode="json")
    payload["_caveats"] = caveats
    return payload
