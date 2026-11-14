"""Save NASA's night-lights view of North America for the title card.

    python scripts/fetch_night_lights.py

Writes frontend/public/scene/night-lights-north-america.webp

SOURCE: NASA GIBS, layer VIIRS_Black_Marble -- the Suomi-NPP VIIRS
Day/Night Band composite, "Earth at Night". This is a NASA product, which
matters: Sentinel-2 is ESA, so the imagery elsewhere in this project has
to be credited to ESA. This one is NASA's.

WHY A COMMITTED ASSET, NOT A LIVE TILE REQUEST: the demo has to survive
airplane mode. Anything fetched while a judge is watching is a thing that
can fail while a judge is watching -- the same rule the Sentinel-2 chips
follow.

THE FRAME: 18-56 N, 129-61 W. That is the lower 48 plus southern Canada
and northern Mexico, at roughly 16:9 so it fills a landing page without
cropping the continent. Iowa lands near the centre, inside the dense
Midwest grid, which is the point -- the field this tool analyses is
somewhere in those lights.

NO TIME DIMENSION: VIIRS_Black_Marble is a fixed annual composite, so the
request is reproducible. Re-running this gives the same picture.
"""

from __future__ import annotations

import io
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "scene"
NAME = "night-lights-north-america.webp"

WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
LAYER = "VIIRS_Black_Marble"
#: WMS 1.3.0 with EPSG:4326 takes BBOX as min_lat,min_lon,max_lat,max_lon.
BBOX = "18,-129,56,-61"
WIDTH, HEIGHT = 1920, 1073
TIMEOUT = 120


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    query = urllib.parse.urlencode({
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": "1.3.0",
        "LAYERS": LAYER,
        "CRS": "EPSG:4326",
        "BBOX": BBOX,
        "WIDTH": WIDTH,
        "HEIGHT": HEIGHT,
        "FORMAT": "image/jpeg",
    })
    url = f"{WMS}?{query}"
    print(f"GIBS {LAYER}  {BBOX}  {WIDTH}x{HEIGHT}")

    # A generic client name: nothing about the user or the project goes to
    # an outside service.
    req = urllib.request.Request(url, headers={"User-Agent": "fallowclock-asset-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:  # noqa: S310 - fixed NASA host
        raw = r.read()

    img = Image.open(io.BytesIO(raw)).convert("RGB")
    if img.size != (WIDTH, HEIGHT):
        print(f"  unexpected size {img.size}; refusing to write")
        return 1

    path = OUT / NAME
    img.save(path, "WEBP", quality=82, method=5)
    print(f"  -> {path.name} ({path.stat().st_size // 1024} KB)")
    print("  credit: NASA Earth Observatory / Suomi NPP VIIRS (Black Marble)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
