"""Planetary Computer client: STAC search and server-side pixel reads.  B1 owns this file.

WHY PLANETARY COMPUTER AND NOT EARTH ENGINE
-------------------------------------------
The plan made Earth Engine primary and Planetary Computer the fallback. We
run on the fallback, deliberately:

  * Earth Engine needs an approved noncommercial Cloud project, and that
    approval is not instant (README, plan bottleneck B1). Planetary Computer
    needs no account at all: STAC search and the data API are anonymous HTTPS.
  * sources.py (B2) already cites Landsat and Sentinel-2 as "accessed via
    Microsoft Planetary Computer" with PC collection ids, and the NASA
    eligibility check matches on those ids. Using PC keeps the provenance the
    bundle prints true without touching B2's file.

THE ACCESS PATTERN -- same discipline as reduceRegion
-----------------------------------------------------
We never download a scene. The PC data API (TiTiler) crops each scene on the
server to a bounding box, reprojects it onto a regular lon/lat grid and
returns a small .npy block -- about 20 KB for a 60 ha field. One request per
scene, cached forever (cache.cached_get_bytes), so the second run is offline
and the airplane-mode test stays honest.

Everything here is either pure geometry (unit-tested, no network) or a thin
cached HTTP call. No new dependencies: urllib + numpy.
"""

from __future__ import annotations

import io
import math
import sys
import urllib.parse
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import TypeVar

import numpy as np

from .cache import FetchError, cached_get_bytes, cached_post_json, drop_cached

STAC_API = "https://planetarycomputer.microsoft.com/api/stac/v1"
DATA_API = "https://planetarycomputer.microsoft.com/api/data/v1"

Bbox = tuple[float, float, float, float]
"""(min_lon, min_lat, max_lon, max_lat), EPSG:4326."""

#: Metres per degree of latitude. The true value runs 110.6-111.7 km from
#: equator to pole; 111.13 km is within 0.1% across Iowa.
M_PER_DEG_LAT = 111_132.0


def m_per_deg_lon(lat: float) -> float:
    return 111_320.0 * math.cos(math.radians(lat))


# --------------------------------------------------------------------------
# Geometry -- pure, and the part most worth testing
# --------------------------------------------------------------------------


def polygons_of(geometry: dict) -> list:
    """Polygon / MultiPolygon -> list of polygons, each a list of rings."""
    kind = geometry.get("type")
    if kind == "Polygon":
        return [geometry["coordinates"]]
    if kind == "MultiPolygon":
        return list(geometry["coordinates"])
    raise ValueError(f"Expected a Polygon or MultiPolygon, got {kind!r}")


def bbox_of(geometry: dict) -> Bbox:
    xs: list[float] = []
    ys: list[float] = []
    for poly in polygons_of(geometry):
        for ring in poly:
            for point in ring:
                xs.append(float(point[0]))
                ys.append(float(point[1]))
    return (min(xs), min(ys), max(xs), max(ys))


def bbox_polygon(bbox: Bbox) -> dict:
    x0, y0, x1, y1 = bbox
    return {
        "type": "Polygon",
        "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
    }


def bbox_around(lon: float, lat: float, half_km: float) -> Bbox:
    """A square-ish box of +-half_km around a point."""
    dx = half_km * 1000.0 / m_per_deg_lon(lat)
    dy = half_km * 1000.0 / M_PER_DEG_LAT
    return (lon - dx, lat - dy, lon + dx, lat + dy)


def _ring_parity(x: np.ndarray, y: np.ndarray, ring: Sequence) -> np.ndarray:
    pts = np.asarray([(float(p[0]), float(p[1])) for p in ring], dtype=float)
    if not np.allclose(pts[0], pts[-1]):
        pts = np.vstack([pts, pts[:1]])
    parity = np.zeros(np.shape(x), dtype=bool)
    for (x1, y1), (x2, y2) in zip(pts[:-1], pts[1:]):
        crosses = (y1 > y) != (y2 > y)
        if not np.any(crosses):
            continue
        with np.errstate(divide="ignore", invalid="ignore"):
            x_cross = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
        parity ^= crosses & (x < x_cross)
    return parity


def points_in_geometry(lon: np.ndarray, lat: np.ndarray, geometry: dict) -> np.ndarray:
    """Vectorised even-odd point-in-polygon. Holes are handled by parity."""
    lon = np.asarray(lon, dtype=float)
    lat = np.asarray(lat, dtype=float)
    inside = np.zeros(lon.shape, dtype=bool)
    for poly in polygons_of(geometry):
        in_poly = np.zeros(lon.shape, dtype=bool)
        for ring in poly:
            in_poly ^= _ring_parity(lon, lat, ring)
        inside |= in_poly
    return inside


def grid_shape(bbox: Bbox, res_m: float) -> tuple[int, int]:
    """(width, height) in pixels of a lon/lat grid with ~res_m pixels."""
    x0, y0, x1, y1 = bbox
    lat = (y0 + y1) / 2.0
    width = max(1, round((x1 - x0) * m_per_deg_lon(lat) / res_m))
    height = max(1, round((y1 - y0) * M_PER_DEG_LAT / res_m))
    return width, height


def pixel_centres(bbox: Bbox, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """Lon/lat of every pixel centre. Row 0 is the NORTH edge, as in any
    north-up raster (and as the data API returns it)."""
    x0, y0, x1, y1 = bbox
    dx = (x1 - x0) / width
    dy = (y1 - y0) / height
    lon = x0 + (np.arange(width) + 0.5) * dx
    lat = y1 - (np.arange(height) + 0.5) * dy
    return np.meshgrid(lon, lat)


def geometry_mask(geometry: dict, bbox: Bbox, width: int, height: int) -> np.ndarray:
    """Boolean (height, width): True where the pixel centre is inside."""
    lon, lat = pixel_centres(bbox, width, height)
    return points_in_geometry(lon, lat, geometry)


def footprint_contains(footprint: dict, bbox: Bbox) -> bool:
    """Does a scene footprint contain all four corners of `bbox`?"""
    x0, y0, x1, y1 = bbox
    xs = np.array([x0, x1, x1, x0])
    ys = np.array([y0, y0, y1, y1])
    return bool(points_in_geometry(xs, ys, footprint).all())


def pixel_area_m2(bbox: Bbox, width: int, height: int) -> float:
    x0, y0, x1, y1 = bbox
    lat = (y0 + y1) / 2.0
    return ((x1 - x0) / width * m_per_deg_lon(lat)) * ((y1 - y0) / height * M_PER_DEG_LAT)


# --------------------------------------------------------------------------
# STAC search
# --------------------------------------------------------------------------


def search(
    collection: str,
    geometry: dict,
    start: str,
    end: str,
    *,
    query: dict | None = None,
    limit: int = 500,
    max_pages: int = 60,
) -> list[dict]:
    """All STAC items in `collection` intersecting `geometry` in [start, end].

    Follows `next` links (PC paginates POST searches with a token in the
    body). Each page is cached, so a repeat search costs nothing.
    """
    url = f"{STAC_API}/search"
    body: dict = {
        "collections": [collection],
        "intersects": geometry,
        "datetime": f"{start}/{end}",
        "limit": limit,
    }
    if query:
        body["query"] = query

    features: list[dict] = []
    for _ in range(max_pages):
        page = cached_post_json(url, body)
        features.extend(page.get("features", []))
        nxt = next((ln for ln in page.get("links", []) if ln.get("rel") == "next"), None)
        if nxt is None:
            return features
        if str(nxt.get("method", "GET")).upper() == "POST" and isinstance(nxt.get("body"), dict):
            body = {**body, **nxt["body"]} if nxt.get("merge") else dict(nxt["body"])
            url = nxt.get("href", url)
            continue
        # GET-style pagination: the token is in the href.
        import json

        raw = cached_get_bytes(nxt["href"], suffix=".json", validate=json.loads)
        page = json.loads(raw)
        features.extend(page.get("features", []))
        if not any(ln.get("rel") == "next" for ln in page.get("links", [])):
            return features
        raise RuntimeError("Unexpected multi-page GET pagination from the STAC API")
    raise RuntimeError(f"STAC search for {collection} exceeded {max_pages} pages")


# --------------------------------------------------------------------------
# Pixel blocks
# --------------------------------------------------------------------------


def block_url(
    collection: str,
    item_id: str,
    bbox: Bbox,
    width: int,
    height: int,
    assets: Sequence[str],
) -> str:
    x0, y0, x1, y1 = bbox
    params = [
        ("collection", collection),
        ("item", item_id),
        ("coord_crs", "epsg:4326"),
        ("dst_crs", "epsg:4326"),
        # Nearest everywhere: SCL and QA_PIXEL are categorical, and nearest
        # keeps every reflectance an actual measurement.
        ("resampling", "nearest"),
        ("reproject", "nearest"),
        ("return_mask", "true"),
    ] + [("assets", a) for a in assets]
    return (
        f"{DATA_API}/item/bbox/{x0:.6f},{y0:.6f},{x1:.6f},{y1:.6f}/"
        f"{width}x{height}.npy?{urllib.parse.urlencode(params)}"
    )


def _load_npy(raw: bytes) -> np.ndarray:
    return np.load(io.BytesIO(raw), allow_pickle=False)


def read_block(
    collection: str,
    item_id: str,
    bbox: Bbox,
    width: int,
    height: int,
    assets: Sequence[str],
) -> np.ndarray:
    """One scene, cropped server-side to `bbox` on a width x height lon/lat
    grid. Returns (len(assets) + 1, height, width): one band per asset in
    the order asked for, then the data mask (0 = no data, 255 = data)."""
    expected = (len(assets) + 1, height, width)

    def validate(raw: bytes) -> None:
        arr = _load_npy(raw)
        if arr.shape != expected:
            raise ValueError(f"Block shape {arr.shape}, expected {expected}")

    url = block_url(collection, item_id, bbox, width, height, assets)
    raw = cached_get_bytes(url, suffix=".npy", validate=validate)
    arr = _load_npy(raw)
    if arr.shape != expected:  # a cache entry from a different code version
        drop_cached(url, suffix=".npy")
        raise FetchError(f"Cached block had shape {arr.shape}, expected {expected}: {url}")
    return arr


# --------------------------------------------------------------------------
# Concurrency
# --------------------------------------------------------------------------

T = TypeVar("T")
R = TypeVar("R")


def parallel_map(
    fn: Callable[[T], R],
    items: Sequence[T],
    *,
    workers: int = 8,
    label: str | None = None,
) -> list[R | Exception]:
    """Map over items with a thread pool, preserving order.

    Network failures come back in place as the exception rather than
    aborting the run: one scene the server could not render is not a reason
    to throw away the other six hundred. The caller counts them and decides.
    """
    results: list[R | Exception] = [None] * len(items)  # type: ignore[list-item]
    if not items:
        return results
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(fn, item): i for i, item in enumerate(items)}
        for done, fut in enumerate(as_completed(futures), 1):
            i = futures[fut]
            try:
                results[i] = fut.result()
            except (FetchError, ValueError, OSError) as exc:
                results[i] = exc
            if label and (done % 100 == 0 or done == len(items)):
                print(f"    {label}: {done}/{len(items)}", file=sys.stderr, flush=True)
    return results
