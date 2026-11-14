"""B1 crop-history and field-finding logic: offline tests (no network)."""

from __future__ import annotations

import math

import numpy as np
import pytest

from fallowclock import cdl
from fallowclock.cdl import CORN, SOYBEANS, CropYear


def test_albers_origin_and_central_meridian():
    x, y = cdl.albers_conus(-96.0, 23.0)
    assert abs(x) < 1e-6 and abs(y) < 1e-6
    x, _ = cdl.albers_conus(-96.0, 42.0)
    assert abs(x) < 1e-6
    x_east, _ = cdl.albers_conus(-93.0, 42.0)
    x_west, _ = cdl.albers_conus(-99.0, 42.0)
    assert x_east == pytest.approx(-x_west)


def test_albers_is_equal_area():
    """The projected area of a small cell equals its area on the ellipsoid."""
    lon, lat, d = -93.6, 42.0, 1e-3
    (x0, y0), (x1, y1), (x2, y2) = (cdl.albers_conus(lon, lat), cdl.albers_conus(lon + d, lat),
                                    cdl.albers_conus(lon, lat + d))
    projected = abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0))
    a, e2, phi = 6_378_137.0, cdl._E2, math.radians(lat)
    ellipsoid = (a * a * (1 - e2) * math.cos(phi) / (1 - e2 * math.sin(phi) ** 2) ** 2) * math.radians(d) ** 2
    assert projected == pytest.approx(ellipsoid, rel=1e-3)


def test_parse_cropscape():
    raw = b'<Result>{x: 195689.2, y: 2116718.7, value: 1, category: "Corn", color: "#FFD300"}</Result>'
    assert cdl.parse_cropscape(raw) == (1, "Corn")
    with pytest.raises(ValueError):
        cdl.parse_cropscape(b"<html>Service Unavailable</html>")


def test_majority_filter_removes_speckle_and_splits_seams():
    g = np.full((5, 5), CORN, dtype=np.uint8)
    g[2, 2] = SOYBEANS
    assert (cdl.majority_filter3(g) == CORN).all()
    assert cdl.to_rotation_classes(np.array([[1, 5, 176, 24]])).tolist() == [[1, 5, 0, 0]]


def test_segment_erode_and_rectangle():
    years = 3
    stack = np.zeros((years, 10, 12), dtype=np.uint8)
    stack[:, :, :6] = np.array([CORN, SOYBEANS, CORN])[:, None, None]   # field A
    stack[:, :, 6:] = np.array([SOYBEANS, CORN, SOYBEANS])[:, None, None]  # field B
    stack[:, 0, 11] = 0                                                  # a stray pixel
    labels = cdl.segment_fields(stack, min_pixels=20)
    assert len(np.unique(labels[labels > 0])) == 2
    eroded = cdl.erode_labels(labels)
    assert (eroded[0, :] == 0).all() and (eroded[:, 5] == 0).all()
    mask = np.zeros((6, 6), bool)
    mask[1:5, 1:5] = True
    mask[0, 1] = True  # an L-shaped spur must not enlarge the rectangle
    assert cdl.largest_rectangle(mask) == (1, 1, 4, 4, 16)
    assert cdl.largest_rectangle(np.zeros((3, 3), bool))[4] == 0


def test_rect_polygon_area():
    bbox = (-93.6, 42.0, -93.5, 42.1)
    poly = cdl.rect_polygon(bbox, 100, 100, 0, 0, 49, 49)  # a quarter of the box
    full = cdl.polygon_area_ha(cdl.rect_polygon(bbox, 100, 100, 0, 0, 99, 99))
    assert cdl.polygon_area_ha(poly) == pytest.approx(full / 4, rel=1e-3)
    assert 8_000 < full < 9_500  # ~8.3 km x 11.1 km


def _hist(codes):
    return {2017 + i: CropYear(2017 + i, c, cdl.cdl_name(c), 1.0, 5, "test") for i, c in enumerate(codes)}


def test_rotation_labels():
    alt = _hist([1, 5, 1, 5, 1, 5])
    assert cdl.infer_rotation_label(alt, {y: False for y in alt}) == "Corn-Soybean, no cover crop"
    covers = {y: (y in (2018, 2020)) for y in alt}
    assert cdl.infer_rotation_label(alt, covers) == "Corn-Soybean, cover crop in 2 of 6 winters"
    assert cdl.infer_rotation_label(_hist([1, 1, 1]), {}) == "Continuous corn, cover crop status unknown"
    assert cdl.infer_rotation_label(_hist([1, 1, 5]), {2017: None}).startswith("Corn-Soybean (2 corn, 1 soybean")
    assert cdl.crop_key(SOYBEANS) == "soybean" and cdl.cdl_name(999) == "CDL class 999"
