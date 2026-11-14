"""Save a FALSE-COLOUR infrared chip of each farm, for the page background.

    python scripts/fetch_false_colour.py

Writes frontend/public/scene/field-<farm>-falsecolour.webp.

WHAT FALSE COLOUR IS, AND WHY IT IS NOT A FILTER. This maps three real
Sentinel-2 bands to the screen's three channels:

    red   <- B08, near infrared, 842 nm
    green <- B04, red,           665 nm
    blue  <- B03, green,         560 nm

Chlorophyll absorbs red light and scatters near infrared hard -- that gap
is what every vegetation index in this project is built on. Put NIR in the
red channel and a healthy canopy, which is the brightest thing in the
scene at 842 nm, comes out vivid red or pink; bare soil, which reflects
NIR and red about equally, stays tan; water goes near black. So the pinks
are not a styling choice, they are the crop's infrared signature, and the
image is showing the same physics the bare-soil model runs on.

THE SAME SCENE AS THE ESTABLISHING SHOT. The scene id is read from the
sidecar fetch_field_image.py already wrote, not searched for again, so the
background and the opening zoom are the same day over the same ground --
Story County on 9 June 2024, 0.06% cloud. Re-running this is reproducible
rather than "whatever is cloud-free today".

SENTINEL-2 IS ESA, NOT NASA. It must be credited as such wherever it is
shown. The NASA sources in this project are POWER and Landsat.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from fallowclock.imagery import s2_offset  # noqa: E402
from fallowclock.stac_client import read_block, search  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "scene"

SIZE = 1024
#: NIR, red, green -> R, G, B. Standard false-colour infrared.
BANDS = ("B08", "B04", "B03")


def stretch(bands: np.ndarray, valid: np.ndarray, gamma: float = 1.12) -> np.ndarray:
    """8-bit stretch with ONE scale shared by all three channels.

    Per-band percentiles would normalise away the ratios BETWEEN the bands,
    and in false colour those ratios are the entire signal -- NIR being far
    brighter than red is what makes a canopy glow. Stretch each channel to
    its own range and every surface drifts to mid-grey. This bug already
    cost this project once, in true colour, where June corn came out
    magenta.
    """
    sample = bands[:, valid]
    if sample.size == 0:
        return np.zeros((*bands.shape[1:], 3), dtype=np.uint8)
    lo = float(np.percentile(sample, 2.0))
    hi = float(np.percentile(sample, 98.0))
    if hi <= lo:
        return np.zeros((*bands.shape[1:], 3), dtype=np.uint8)
    out = np.clip((bands - lo) / (hi - lo), 0, 1) ** (1.0 / gamma)
    return (np.moveaxis(out, 0, -1) * 255).astype(np.uint8)


def main() -> int:
    sidecars = sorted(p for p in OUT.glob("field-*.json"))
    if not sidecars:
        print("No field-*.json sidecars. Run fetch_field_image.py first.")
        return 1

    wrote = 0
    for sidecar in sidecars:
        meta = json.loads(sidecar.read_text(encoding="utf-8"))
        fid = meta["farm"]
        scene_id = meta["scene"]
        bbox = tuple(meta["bbox"])
        print(f"\n=== {fid}: {scene_id} ({meta['date']})")

        # The sidecar carries the id but not the full item, and s2_offset
        # needs the properties. One search over that day recovers it.
        day = meta["date"]
        geom = {
            "type": "Polygon",
            "coordinates": [[
                [bbox[0], bbox[1]], [bbox[2], bbox[1]],
                [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]],
            ]],
        }
        # A one-day window can miss the scene depending on how the API
        # treats the range bounds, so bracket the date by a day each side
        # and pick the id out of the results.
        from datetime import date, timedelta
        d = date.fromisoformat(day)
        items = search(
            "sentinel-2-l2a", geom,
            (d - timedelta(days=1)).isoformat(),
            (d + timedelta(days=1)).isoformat(),
        )
        item = next((it for it in items if it["id"] == scene_id), None)
        if item is None:
            print(f"  could not re-find {scene_id}; skipping")
            continue

        block = read_block("sentinel-2-l2a", scene_id, bbox, SIZE, SIZE, BANDS)
        valid = block[-1] > 0
        covered = float(valid.mean())
        if covered < 0.99:
            print(f"  only {covered * 100:.1f}% of the frame has data; skipping")
            continue

        off = s2_offset(item["properties"])
        bands = np.stack([block[i].astype(np.float32) + off for i in range(3)])
        img = Image.fromarray(stretch(bands, valid))

        path = OUT / f"field-{fid}-falsecolour.webp"
        img.save(path, "WEBP", quality=84, method=5)
        print(f"  -> {path.name} ({path.stat().st_size // 1024} KB)")

        meta["false_colour"] = {
            "file": path.name,
            "bands": {"red": "B08 (NIR 842nm)", "green": "B04 (red 665nm)", "blue": "B03 (green 560nm)"},
            "note": "Healthy canopy scatters near infrared, so vegetation reads red.",
        }
        sidecar.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        wrote += 1

    print(f"\n{wrote} false-colour chip(s) written.")
    return 0 if wrote else 1


if __name__ == "__main__":
    raise SystemExit(main())
