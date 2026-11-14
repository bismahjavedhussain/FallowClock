"""NASA data provenance.  B2 owns this file.

ELIGIBILITY: the challenge requires at least one NASA data source from the
resources tab. This module makes our NASA sourcing explicit, machine-
readable and printable, so it can be shown rather than asserted.

    python -m fallowclock.sources

WATCH OUT: Sentinel-2 is ESA, not NASA. A pipeline built only on Sentinel-2
contributes NOTHING to eligibility. Landsat is NASA/USGS and does. B1 must
keep Landsat in the imagery stack for that reason, not only for the longer
archive.
"""

from __future__ import annotations

from .schema import Source

#: Sources that count toward the NASA-data eligibility requirement.
NASA_SOURCES: dict[str, Source] = {
    "power": Source(
        name="NASA POWER (Prediction Of Worldwide Energy Resources)",
        collection_id="power.larc.nasa.gov/api/temporal/daily/point",
        n_obs=0,
        resolution_m=55_000.0,  # ~0.5 x 0.625 deg, MERRA-2 grid
        citation=(
            "NASA Langley Research Center POWER Project, funded by NASA "
            "Applied Sciences. Daily meteorology from MERRA-2 reanalysis. "
            "https://power.larc.nasa.gov/"
        ),
    ),
    "landsat": Source(
        name="Landsat 8/9 Collection 2 Level-2 Surface Reflectance",
        collection_id="landsat-c2-l2",
        n_obs=0,
        resolution_m=30.0,
        citation=(
            "NASA/USGS Landsat Program. Accessed as COGs via Microsoft "
            "Planetary Computer. https://landsat.gsfc.nasa.gov/"
        ),
    ),
    "imerg": Source(
        name="GPM IMERG precipitation",
        collection_id="gpm-imerg-hhr",
        n_obs=0,
        resolution_m=11_000.0,
        citation=(
            "NASA Global Precipitation Measurement mission, IMERG. "
            "https://gpm.nasa.gov/data/imerg"
        ),
    ),
    "srtm": Source(
        name="NASADEM / SRTM elevation",
        collection_id="nasadem",
        n_obs=0,
        resolution_m=30.0,
        citation="NASA Shuttle Radar Topography Mission. https://www.earthdata.nasa.gov/",
    ),
}

#: Used and valuable, but they do NOT satisfy the NASA requirement.
NON_NASA_SOURCES: dict[str, Source] = {
    "sentinel2": Source(
        name="Sentinel-2 L2A surface reflectance",
        collection_id="sentinel-2-l2a",
        n_obs=0,
        resolution_m=10.0,
        citation=(
            "ESA Copernicus programme -- NOT a NASA source. Used to densify "
            "the Landsat record. Accessed via Microsoft Planetary Computer."
        ),
    ),
    "cdl": Source(
        name="USDA Cropland Data Layer",
        collection_id="usda-cdl",
        n_obs=0,
        resolution_m=30.0,
        citation="USDA NASS -- not NASA. US only.",
    ),
}


def nasa_source(key: str, n_obs: int = 0) -> Source:
    """A NASA source record with an observation count filled in."""
    base = NASA_SOURCES[key]
    return base.model_copy(update={"n_obs": n_obs})


def check_eligibility(sources: list[Source]) -> tuple[bool, list[str]]:
    """Does this bundle's source list include at least one NASA source?

    Returns (eligible, names_of_nasa_sources). Call it before shipping a
    bundle -- discovering on submission day that the whole pipeline is
    Sentinel-2 and USDA would be unrecoverable.
    """
    nasa_ids = {s.collection_id for s in NASA_SOURCES.values()}
    found = [s.name for s in sources if s.collection_id in nasa_ids]
    return bool(found), found


if __name__ == "__main__":
    print("NASA sources (satisfy the eligibility requirement)")
    for key, s in NASA_SOURCES.items():
        print(f"  [{key}] {s.name}")
        print(f"        {s.collection_id}  ~{s.resolution_m:,.0f} m")
    print("\nOther sources (do NOT satisfy it)")
    for key, s in NON_NASA_SOURCES.items():
        print(f"  [{key}] {s.name}  -- {s.collection_id}")
    print("\nCurrently wired up and returning real data: NASA POWER.")
