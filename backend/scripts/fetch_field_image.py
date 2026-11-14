"""Save a real Sentinel-2 RGB chip of each farm, for the opening zoom.

    python scripts/fetch_field_image.py

Writes frontend/public/scene/field-<farm>.webp plus a .json sidecar giving
the bbox, the scene date and the field's pixel position, so the UI can zoom
to the right spot instead of guessing.

WHY A COMMITTED ASSET, NOT A MAP TILE AT RUNTIME: the demo has to survive
airplane mode. Anything fetched while a judge is watching is a thing that
can fail while a judge is watching.

HONEST LIMIT ON THE ZOOM: Sentinel-2 is 10 m per pixel. A 700 m field is
about 70 pixels across. You cannot zoom from orbit to ground truth on this
imagery -- so the UI uses this as an establishing shot and hands off to the
ring, rather than pretending to dive all the way in.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from fallowclock.imagery import s2_offset  # noqa: E402
from fallowclock.stac_client import bbox_around, read_block, search  # noqa: E402
from scripts.build_bundle import FARMS  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "scene"

#: 10 km across at 1024 px is 9.8 m/px -- Sentinel-2's native resolution.
#: Asking for more pixels would only invent detail the sensor never saw.
HALF_KM = 5.0
SIZE = 1024

#: Peak season, so the field pattern is legible: green crops against bare soil.
WINDOW = ("2024-06-01", "2024-08-31")
MAX_CLOUD = 8.0


def stretch_rgb(bands: np.ndarray, lo_pct=2.0, hi_pct=98.0, gamma=1.15) -> np.ndarray:
    """True-colour stretch to 8-bit, with ONE scale shared by all three bands.

    Stretching each band to its own percentiles independently is the obvious
    thing to do and it is wrong: it normalises away the ratios BETWEEN the
    bands, which is precisely what colour is. June corn came out magenta,
    because healthy vegetation is dark in red and blue and a per-band stretch
    hauls those two up to meet the green.

    A shared scale keeps the ratios, so vegetation reads green and bare soil
    reads brown -- which is the whole point of showing a farmer their field.
    """
    finite = bands[np.isfinite(bands)]
    if finite.size == 0:
        return np.zeros((*bands.shape[1:], 3), dtype=np.uint8)
    lo, hi = np.percentile(finite, [lo_pct, hi_pct])
    if hi <= lo:
        hi = lo + 1.0
    out = np.clip((bands - lo) / (hi - lo), 0, 1) ** (1.0 / gamma)
    return (np.moveaxis(out, 0, -1) * 255).astype(np.uint8)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for fid, farm in FARMS.items():
        lon, lat = farm.centroid
        bbox = bbox_around(lon, lat, HALF_KM)
        geom = {
            "type": "Polygon",
            "coordinates": [[
                [bbox[0], bbox[1]], [bbox[2], bbox[1]],
                [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]],
            ]],
        }
        print(f"\n=== {fid}: searching Sentinel-2 {WINDOW[0]}..{WINDOW[1]}")
        items = search(
            "sentinel-2-l2a", geom, WINDOW[0], WINDOW[1],
            query={"eo:cloud_cover": {"lt": MAX_CLOUD}},
        )
        if not items:
            print("  no clear scene found; skipping")
            continue
        items.sort(key=lambda it: it["properties"].get("eo:cloud_cover", 100))
        item = items[0]
        cloud = item["properties"].get("eo:cloud_cover")
        day = item["properties"]["datetime"][:10]
        print(f"  {len(items)} candidates; using {item['id']} ({day}, {cloud}% cloud)")

        block = read_block("sentinel-2-l2a", item["id"], bbox, SIZE, SIZE, ("B04", "B03", "B02"))
        off = s2_offset(item["properties"])
        rgb = stretch_rgb(np.stack([block[i].astype(np.float32) + off for i in range(3)]))

        img = Image.fromarray(rgb)
        path = OUT / f"field-{fid}.webp"
        img.save(path, "WEBP", quality=86, method=5)

        # Where the field sits inside the chip, 0-1, so the UI zooms to the
        # right place rather than assuming dead centre.
        ring = farm.polygon_geojson["coordinates"][0]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        meta = {
            "farm": fid,
            "scene": item["id"],
            "date": day,
            "cloud_cover": cloud,
            "bbox": list(bbox),
            "resolution_m": round(HALF_KM * 2000 / SIZE, 2),
            "field": {
                "x0": (min(xs) - bbox[0]) / (bbox[2] - bbox[0]),
                "x1": (max(xs) - bbox[0]) / (bbox[2] - bbox[0]),
                # y is flipped: image row 0 is the TOP, which is max latitude.
                "y0": (bbox[3] - max(ys)) / (bbox[3] - bbox[1]),
                "y1": (bbox[3] - min(ys)) / (bbox[3] - bbox[1]),
            },
            "credit": "Contains modified Copernicus Sentinel data, processed by ESA.",
        }
        (OUT / f"field-{fid}.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        print(f"  -> {path.name} ({path.stat().st_size // 1024} KB), {meta['resolution_m']} m/px")
        print(f"     field occupies x {meta['field']['x0']:.3f}-{meta['field']['x1']:.3f}, "
              f"y {meta['field']['y0']:.3f}-{meta['field']['y1']:.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
