"""USDA Cropland Data Layer: what each field grew, year by year.  B1 owns this file.

CDL is 30 m, annual, US-only, and USDA NASS -- not NASA (sources.py says so).
It answers two questions the satellite alone cannot:

  1. Which years were corn and which soybean? That splits the cover record
     into rotation phases. gaps.phase_averaged_exposed_erosivity needs one
     curve per phase; averaging the phases first understates erosion.
  2. Which neighbouring fields are row crops at all? Cover-crop detection
     only means something on corn/soy ground -- a pasture is green in April
     too.

CDL does NOT label cover crops. The satellite does (imagery.py).

TWO ROUTES, because no single anonymous one covers every year
-------------------------------------------------------------
  * 2008-2021: Planetary Computer `usda-cdl` COGs, read with the same
    server-side crop as the imagery. Whole grids, ~1 s each.
  * 2022 onward: USDA NASS CropScape `GetCDLValue`, a point query in CONUS
    Albers (EPSG:5070). ~5 s per call, so we sample a few points inside a
    field, never a grid, and cache every answer forever.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date

import numpy as np
from scipy import ndimage

from .cache import IMAGERY_CACHE_DIR, cached_get_bytes
from .stac_client import (
    M_PER_DEG_LAT,
    Bbox,
    bbox_of,
    bbox_polygon,
    geometry_mask,
    grid_shape,
    m_per_deg_lon,
    pixel_area_m2,
    pixel_centres,
    polygons_of,
    read_block,
    search,
)

CORN = 1
SOYBEANS = 5
ROW_CROPS = (CORN, SOYBEANS)

#: Planetary Computer's usda-cdl collection ends here (checked 2026-11).
PC_LAST_YEAR = 2021

#: USDA releases a year's CDL the following January/February, so the
#: current year never exists yet. Asking CropScape for it costs four slow
#: timeouts per point and nothing is cached, because failures never are.
CROPSCAPE_LAST_YEAR = date.today().year - 1

CDL_CACHE_DIR = IMAGERY_CACHE_DIR / "cdl"
CROPSCAPE_URL = "https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue"

#: CDL class names (USDA NASS legend), the classes that occur in Iowa plus
#: the common land covers. Unlisted codes print as "CDL class N".
CDL_CLASSES: dict[int, str] = {
    1: "Corn", 2: "Cotton", 3: "Rice", 4: "Sorghum", 5: "Soybeans",
    6: "Sunflower", 12: "Sweet Corn", 13: "Pop or Orn Corn", 21: "Barley",
    22: "Durum Wheat", 23: "Spring Wheat", 24: "Winter Wheat",
    25: "Other Small Grains", 26: "Dbl Crop WinWht/Soybeans", 27: "Rye",
    28: "Oats", 29: "Millet", 31: "Canola", 36: "Alfalfa",
    37: "Other Hay/Non Alfalfa", 42: "Dry Beans", 43: "Potatoes",
    44: "Other Crops", 47: "Misc Vegs & Fruits", 58: "Clover/Wildflowers",
    59: "Sod/Grass Seed", 60: "Switchgrass", 61: "Fallow/Idle Cropland",
    63: "Forest", 64: "Shrubland", 65: "Barren", 81: "Clouds/No Data",
    82: "Developed", 83: "Water", 87: "Wetlands", 88: "Nonag/Undefined",
    111: "Open Water", 121: "Developed/Open Space",
    122: "Developed/Low Intensity", 123: "Developed/Med Intensity",
    124: "Developed/High Intensity", 131: "Barren", 141: "Deciduous Forest",
    142: "Evergreen Forest", 143: "Mixed Forest", 152: "Shrubland",
    176: "Grassland/Pasture", 190: "Woody Wetlands",
    195: "Herbaceous Wetlands", 205: "Triticale",
    225: "Dbl Crop WinWht/Corn", 226: "Dbl Crop Oats/Corn",
    228: "Dbl Crop Triticale/Corn", 236: "Dbl Crop WinWht/Sorghum",
    237: "Dbl Crop Barley/Corn", 240: "Dbl Crop Soybeans/Oats",
    241: "Dbl Crop Corn/Soybeans", 254: "Dbl Crop Barley/Soybeans",
}


def cdl_name(code: int) -> str:
    return CDL_CLASSES.get(int(code), f"CDL class {int(code)}")


def crop_key(code: int) -> str:
    """Stable lowercase key for a CDL code: 'corn', 'soybean', or the name."""
    if code == CORN:
        return "corn"
    if code == SOYBEANS:
        return "soybean"
    return cdl_name(code).lower()


# --------------------------------------------------------------------------
# CONUS Albers (EPSG:5070), forward only
# --------------------------------------------------------------------------
# GRS80 ellipsoid, standard parallels 29.5 N and 45.5 N, origin 23 N 96 W, no
# false easting/northing. Ellipsoidal Albers from Snyder (1987), "Map
# Projections -- A Working Manual", USGS Prof. Paper 1395, eqs. 14-3 to 14-6
# and 3-12. Our lon/lat are WGS84; the NAD83 difference is ~1 m, far below a
# 30 m CDL pixel.

_A = 6_378_137.0
_F = 1.0 / 298.257222101
_E2 = 2.0 * _F - _F * _F
_E = math.sqrt(_E2)


def _albers_q(phi: float) -> float:
    s = math.sin(phi)
    return (1.0 - _E2) * (
        s / (1.0 - _E2 * s * s) - (1.0 / (2.0 * _E)) * math.log((1.0 - _E * s) / (1.0 + _E * s))
    )


def _albers_m(phi: float) -> float:
    s = math.sin(phi)
    return math.cos(phi) / math.sqrt(1.0 - _E2 * s * s)


_P1, _P2, _P0, _L0 = (math.radians(v) for v in (29.5, 45.5, 23.0, -96.0))
_M1, _M2 = _albers_m(_P1), _albers_m(_P2)
_Q1, _Q2, _Q0 = _albers_q(_P1), _albers_q(_P2), _albers_q(_P0)
_N = (_M1 * _M1 - _M2 * _M2) / (_Q2 - _Q1)
_C = _M1 * _M1 + _N * _Q1
_RHO0 = _A * math.sqrt(_C - _N * _Q0) / _N


def albers_conus(lon: float, lat: float) -> tuple[float, float]:
    """WGS84 lon/lat -> EPSG:5070 (x, y) metres."""
    rho = _A * math.sqrt(_C - _N * _albers_q(math.radians(lat))) / _N
    theta = _N * (math.radians(lon) - _L0)
    return rho * math.sin(theta), _RHO0 - rho * math.cos(theta)


# --------------------------------------------------------------------------
# Data access
# --------------------------------------------------------------------------

_CROPSCAPE_VALUE = re.compile(r"value:\s*(-?\d+)")
_CROPSCAPE_CATEGORY = re.compile(r'category:\s*"([^"]*)"')


def parse_cropscape(raw: bytes) -> tuple[int, str]:
    """Parse a GetCDLValue reply. Raises ValueError on anything else, so an
    error page is never cached as if it were an answer."""
    text = raw.decode("utf-8", errors="replace")
    value = _CROPSCAPE_VALUE.search(text)
    if not value:
        raise ValueError(f"Not a CropScape GetCDLValue reply: {text[:200]!r}")
    category = _CROPSCAPE_CATEGORY.search(text)
    code = int(value.group(1))
    return code, (category.group(1) if category else cdl_name(code))


def cropscape_value(year: int, lon: float, lat: float) -> tuple[int, str]:
    """The CDL class at one point in one year, from USDA NASS CropScape."""
    x, y = albers_conus(lon, lat)
    url = f"{CROPSCAPE_URL}?year={year}&x={x:.1f}&y={y:.1f}"
    raw = cached_get_bytes(
        url, CDL_CACHE_DIR, suffix=".xml", validate=parse_cropscape,
        timeout=60, retries=4, backoff=3.0,
    )
    return parse_cropscape(raw)


def pc_cdl_items(year: int, bbox: Bbox) -> list[str]:
    if year > PC_LAST_YEAR:
        raise ValueError(f"Planetary Computer CDL ends at {PC_LAST_YEAR}; use CropScape for {year}")
    feats = search("usda-cdl", bbox_polygon(bbox), f"{year}-01-01", f"{year}-12-31")
    return sorted(f["id"] for f in feats if f["id"].startswith(f"cropland_{year}_"))


def cdl_grid(year: int, bbox: Bbox, width: int, height: int) -> np.ndarray:
    """CDL codes on a width x height lon/lat grid over bbox (0 = no data).

    A box can straddle two CDL tiles; every intersecting tile is read and
    each fills the pixels the others left empty."""
    out = np.zeros((height, width), dtype=np.uint8)
    for item_id in pc_cdl_items(year, bbox):
        block = read_block("usda-cdl", item_id, bbox, width, height, ["cropland"])
        data, mask = block[0], block[-1]
        fill = (out == 0) & (mask > 0) & (data > 0)
        out[fill] = data[fill].astype(np.uint8)
    return out


# --------------------------------------------------------------------------
# One field's history
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class CropYear:
    year: int
    code: int
    name: str
    purity: float  # share of the field's samples that agree with `code`
    n_samples: int
    source: str  # "planetary-computer" | "cropscape"

    @property
    def key(self) -> str:
        return crop_key(self.code)


def sample_points(geometry: dict, n_extra: int = 4) -> list[tuple[float, float]]:
    """A few well-spread points inside a field for point-query sources:
    the most central pixel, plus the pixels nearest the four points 30% of
    the way to each corner. Deterministic, so the cache keys are stable."""
    bbox = bbox_of(geometry)
    w, h = grid_shape(bbox, 30.0)
    inside = geometry_mask(geometry, bbox, w, h)
    if not inside.any():
        raise ValueError("Field geometry contains no 30 m pixel centres")
    lon, lat = pixel_centres(bbox, w, h)
    plon, plat = lon[inside], lat[inside]
    cx, cy = float(plon.mean()), float(plat.mean())
    hx, hy = (bbox[2] - bbox[0]) / 2.0, (bbox[3] - bbox[1]) / 2.0
    targets = [(cx, cy)] + [
        (cx + sx * 0.3 * hx, cy + sy * 0.3 * hy)
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))
    ][:n_extra]
    chosen: list[tuple[float, float]] = []
    for tx, ty in targets:
        i = int(np.argmin((plon - tx) ** 2 + (plat - ty) ** 2))
        pt = (round(float(plon[i]), 6), round(float(plat[i]), 6))
        if pt not in chosen:
            chosen.append(pt)
    return chosen


def field_crop_history(geometry: dict, years: list[int]) -> dict[int, CropYear]:
    """Majority CDL class inside the field for each year.

    Years CropScape cannot answer (not released yet, or the service is down)
    are left out rather than guessed; the caller treats them as unknown."""
    bbox = bbox_of(geometry)
    w, h = grid_shape(bbox, 30.0)
    inside = geometry_mask(geometry, bbox, w, h)
    points: list[tuple[float, float]] | None = None
    out: dict[int, CropYear] = {}

    for year in years:
        if year <= PC_LAST_YEAR:
            grid = cdl_grid(year, bbox, w, h)
            vals = grid[inside & (grid > 0)]
            if vals.size == 0:
                continue
            counts = Counter(int(v) for v in vals)
            source = "planetary-computer"
        else:
            if year > CROPSCAPE_LAST_YEAR:
                continue
            if points is None:
                points = sample_points(geometry)
            codes = []
            for lon, lat in points:
                try:
                    codes.append(cropscape_value(year, lon, lat)[0])
                except Exception:  # noqa: BLE001 - one failed point is not fatal
                    continue
            if not codes:
                continue
            counts = Counter(codes)
            source = "cropscape"
        code, n = counts.most_common(1)[0]
        total = sum(counts.values())
        out[year] = CropYear(year, code, cdl_name(code), n / total, total, source)
    return out


def infer_rotation_label(history: dict[int, CropYear], cover_winters: dict[int, bool]) -> str:
    """e.g. 'Corn-Soybean, no cover crop' or 'Corn-Soybean, cover crop in 2 of 8 winters'."""
    codes = [history[y].code for y in sorted(history)]
    if not codes:
        base = "Unknown rotation"
    else:
        n_corn = codes.count(CORN)
        n_soy = codes.count(SOYBEANS)
        if n_corn + n_soy == len(codes) and n_corn and n_soy:
            alternating = all(a != b for a, b in zip(codes, codes[1:]))
            base = "Corn-Soybean" if alternating else (
                f"Corn-Soybean ({n_corn} corn, {n_soy} soybean years)"
            )
        elif n_corn == len(codes):
            base = "Continuous corn"
        elif n_soy == len(codes):
            base = "Continuous soybean"
        else:
            names = [cdl_name(c) for c, _ in Counter(codes).most_common()]
            base = " / ".join(names)

    known = [v for v in cover_winters.values() if v is not None]
    k = sum(1 for v in known if v)
    if not known:
        cover = "cover crop status unknown"
    elif k == 0:
        cover = "no cover crop"
    else:
        cover = f"cover crop in {k} of {len(known)} winters"
    return f"{base}, {cover}"


# --------------------------------------------------------------------------
# Fields from crop sequences (pure)
# --------------------------------------------------------------------------
# CDL has no field boundaries. But two neighbouring fields almost never share
# eight years of identical crops, so a connected run of pixels with one
# identical multi-year sequence is a very good field proxy -- the idea behind
# USDA's own Crop Sequence Boundaries product.


def to_rotation_classes(grid: np.ndarray) -> np.ndarray:
    """Collapse CDL to 3 classes: CORN, SOYBEANS, 0 (everything else)."""
    return np.where(np.isin(grid, ROW_CROPS), grid, 0).astype(np.uint8)


def majority_filter3(classes: np.ndarray) -> np.ndarray:
    """3x3 majority over {0, CORN, SOYBEANS}, removing CDL salt-and-pepper.

    Ties go to 0 ("other"), which is what you want at the seam between a corn
    field and a soybean field: it separates them instead of merging them."""
    order = np.array([0, CORN, SOYBEANS], dtype=np.uint8)
    shares = np.stack(
        [ndimage.uniform_filter((classes == c).astype(np.float32), size=3, mode="nearest") for c in order]
    )
    return order[np.argmax(shares, axis=0)]


def sequence_code(class_stack: np.ndarray) -> np.ndarray:
    """(years, H, W) of {0, CORN, SOYBEANS} -> one base-3 integer per pixel."""
    digit = {0: 0, CORN: 1, SOYBEANS: 2}
    code = np.zeros(class_stack.shape[1:], dtype=np.int64)
    for layer in class_stack:
        d = np.zeros(layer.shape, dtype=np.int64)
        for k, v in digit.items():
            d[layer == k] = v
        code = code * 3 + d
    return code


def segment_fields(class_stack: np.ndarray, min_pixels: int) -> np.ndarray:
    """Label connected runs of identical crop sequence (4-connected).

    Only sequences with at least one row-crop year are labelled; runs
    smaller than `min_pixels` are dropped. 0 = not a field."""
    code = sequence_code(class_stack)
    rowcrop = (class_stack != 0).any(axis=0)
    labels = np.zeros(code.shape, dtype=np.int32)
    next_id = 1
    for value in np.unique(code[rowcrop]):
        comp, n = ndimage.label(code == value)
        if n == 0:
            continue
        sizes = np.bincount(comp.ravel(), minlength=n + 1)
        keep = np.nonzero(sizes >= min_pixels)[0]
        keep = keep[keep != 0]
        if keep.size == 0:
            continue
        mapping = np.zeros(n + 1, dtype=np.int32)
        mapping[keep] = np.arange(next_id, next_id + keep.size, dtype=np.int32)
        next_id += int(keep.size)
        mapped = mapping[comp]
        labels = np.where(mapped > 0, mapped, labels)
    return labels


def erode_labels(labels: np.ndarray) -> np.ndarray:
    """Drop every pixel whose 4-neighbours are not all the same field --
    one pixel in from every edge, away from roads, fences and mixed pixels."""
    p = np.pad(labels, 1, constant_values=0)
    c = p[1:-1, 1:-1]
    same = (p[:-2, 1:-1] == c) & (p[2:, 1:-1] == c) & (p[1:-1, :-2] == c) & (p[1:-1, 2:] == c)
    return np.where(same, labels, 0)


def field_majority(labels: np.ndarray, grid: np.ndarray, field_id: int) -> tuple[int, float]:
    """(majority CDL code, purity) of one labelled field in one year's grid."""
    vals = grid[(labels == field_id) & (grid > 0)]
    if vals.size == 0:
        return 0, 0.0
    counts = np.bincount(vals.astype(np.int64))
    code = int(np.argmax(counts))
    return code, float(counts[code] / vals.size)


def largest_rectangle(mask: np.ndarray) -> tuple[int, int, int, int, int]:
    """Largest axis-aligned all-True rectangle in a boolean mask.

    Returns (row0, col0, row1, col1, area) with inclusive corners, or
    (0, 0, -1, -1, 0) for an empty mask. Classic histogram-stack method,
    O(rows x cols)."""
    rows, cols = mask.shape
    heights = np.zeros(cols, dtype=np.int64)
    best = (0, 0, -1, -1, 0)
    for r in range(rows):
        heights = np.where(mask[r], heights + 1, 0)
        stack: list[tuple[int, int]] = []  # (start_col, height)
        for c in range(cols + 1):
            h = int(heights[c]) if c < cols else 0
            start = c
            while stack and stack[-1][1] >= h:
                s, sh = stack.pop()
                area = sh * (c - s)
                if area > best[4]:
                    best = (r - sh + 1, s, r, c - 1, area)
                start = s
            stack.append((start, h))
    return best


@dataclass(frozen=True)
class FieldCandidate:
    polygon: dict
    centroid: tuple[float, float]
    area_ha: float
    component_ha: float
    sequence: str
    distance_km: float


def rect_polygon(bbox: Bbox, width: int, height: int, r0: int, c0: int, r1: int, c1: int) -> dict:
    """Pixel-edge lon/lat polygon of an inclusive pixel rectangle."""
    x0, _, x1, y1 = bbox
    dx = (x1 - x0) / width
    dy = (bbox[3] - bbox[1]) / height
    lon0, lon1 = x0 + c0 * dx, x0 + (c1 + 1) * dx
    lat1, lat0 = y1 - r0 * dy, y1 - (r1 + 1) * dy
    ring = [[round(lon0, 6), round(lat0, 6)], [round(lon1, 6), round(lat0, 6)],
            [round(lon1, 6), round(lat1, 6)], [round(lon0, 6), round(lat1, 6)],
            [round(lon0, 6), round(lat0, 6)]]
    return {"type": "Polygon", "coordinates": [ring]}


def polygon_area_ha(geometry: dict) -> float:
    """Planar area of a small lon/lat polygon (shoelace on local metres)."""
    total = 0.0
    for poly in polygons_of(geometry):
        for k, ring in enumerate(poly):
            lat0 = sum(p[1] for p in ring) / len(ring)
            kx, ky = m_per_deg_lon(lat0), M_PER_DEG_LAT
            pts = [(p[0] * kx, p[1] * ky) for p in ring]
            a = 0.5 * abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1])))
            total += a if k == 0 else -a
    return total / 10_000.0


def find_corn_soy_fields(
    region: Bbox,
    years: list[int],
    target: tuple[float, float],
    *,
    min_ha: float = 20.0,
    res_m: float = 30.0,
) -> list[FieldCandidate]:
    """Strict corn/soybean-alternating fields in `region`, nearest first.

    A field qualifies if every year in `years` is corn or soybean and the
    crop changes every year. Each is returned as the largest rectangle that
    fits inside it, one pixel in from its edges."""
    w, h = grid_shape(region, res_m)
    grids = [cdl_grid(y, region, w, h) for y in years]
    classes = np.stack([majority_filter3(to_rotation_classes(g)) for g in grids])
    px_ha = pixel_area_m2(region, w, h) / 10_000.0
    labels = erode_labels(segment_fields(classes, max(4, int(min_ha / px_ha))))

    out: list[FieldCandidate] = []
    for fid in np.unique(labels[labels > 0]):
        mask = labels == fid
        r, c = np.nonzero(mask)
        seq = [int(classes[k][r[0], c[0]]) for k in range(len(years))]
        if not all(s in ROW_CROPS for s in seq) or any(a == b for a, b in zip(seq, seq[1:])):
            continue
        r0, c0, r1, c1, area = largest_rectangle(mask[r.min():r.max() + 1, c.min():c.max() + 1])
        if area * px_ha < min_ha:
            continue
        r0, r1, c0, c1 = r0 + r.min(), r1 + r.min(), c0 + c.min(), c1 + c.min()
        poly = rect_polygon(region, w, h, r0, c0, r1, c1)
        ring = poly["coordinates"][0]
        cx = (ring[0][0] + ring[1][0]) / 2.0
        cy = (ring[0][1] + ring[2][1]) / 2.0
        dist = math.hypot((cx - target[0]) * m_per_deg_lon(cy), (cy - target[1]) * M_PER_DEG_LAT) / 1000.0
        out.append(
            FieldCandidate(
                polygon=poly,
                centroid=(round(float(cx), 6), round(float(cy), 6)),
                area_ha=round(polygon_area_ha(poly), 1),
                component_ha=round(float(mask.sum()) * px_ha, 1),
                sequence="-".join("C" if s == CORN else "S" for s in seq),
                distance_km=round(dist, 2),
            )
        )
    return sorted(out, key=lambda f: f.distance_km)
