"""Gap detection and cover-weighted erosivity.

Pure functions over 365-length arrays. No network, no GEE, no I/O -- which
means this is the part of the pipeline that can be unit-tested properly and
is therefore the part that should carry the load-bearing logic.

THE WRAP BUG: the biggest bare gap in a corn-soybean rotation runs from
October harvest through May planting -- straight through 31 December. Any
code here that treats the year as a line rather than a circle is wrong in
exactly the case the whole project is about. Every function below is
wrap-aware and the tests cover it explicitly.
"""

from __future__ import annotations

import math

from .schema import BARE_THRESHOLD, DOY_LEN, RUSLE_B_DEFAULT, Gap


def rusle_c_factor(soil_cover: float, b: float = RUSLE_B_DEFAULT) -> float:
    """RUSLE surface-cover subfactor.

        C = exp(-b * cover_percent)

    Bare soil (cover=0) gives C=1.0; fully covered gives C -> 0. `b` is
    exposed in the UI as a tunable with its citation so a judge can see how
    sensitive the ranking is to it.

    Args:
        soil_cover: fraction, 0-1 (NOT percent).
        b: decay coefficient. RUSLE2 residue tables support roughly
           0.025-0.050; 0.035 is our default.
    """
    if not 0.0 <= soil_cover <= 1.0:
        raise ValueError(f"soil_cover must be a 0-1 fraction, got {soil_cover}")
    return math.exp(-b * soil_cover * 100.0)


def exposed_erosivity(
    soil_cover: list[float],
    erosivity_r: list[float],
    b: float = RUSLE_B_DEFAULT,
) -> float:
    """The headline metric: cover-weighted annual erosivity.

        sum over DOY of  R(doy) * C(doy)

    Units follow R (MJ.mm/ha/h). This is the single number that ranks
    rotations against each other. Lower is better.
    """
    _check_len(soil_cover, "soil_cover")
    _check_len(erosivity_r, "erosivity_r")
    return sum(
        r * rusle_c_factor(sc, b) for sc, r in zip(soil_cover, erosivity_r)
    )


def phase_averaged_exposed_erosivity(
    phase_covers: list[list[float]],
    erosivity_r: list[float],
    b: float = RUSLE_B_DEFAULT,
) -> float:
    """Average exposed erosivity across the phases of a rotation, the right
    way round.

    JENSEN'S INEQUALITY, and it is not a nitpick. A corn-soybean field is in
    corn one year and soybean the next. The tempting shortcut is to average
    the two cover curves and run the C-factor on the mean:

        WRONG:  exp(-b * mean(cover))
        RIGHT:  mean(exp(-b * cover_corn), exp(-b * cover_soy))

    Because exp(-bx) is convex, the shortcut always gives a SMALLER C factor
    than the truth -- i.e. it understates erosion, and it understates it most
    where the two phases differ most, which is exactly the fall window this
    project is about. Averaging the cover also invents days that belong to
    no real year: a corn canopy standing while soybean stubble sits bare
    averages to a spurious "marginal" day that never happened.

    Pass one cover array per rotation phase. For a 2-year corn-soy rotation
    that is two arrays; for corn-soy-oat it is three.
    """
    if not phase_covers:
        raise ValueError("Need at least one phase")
    for i, cover in enumerate(phase_covers):
        _check_len(cover, f"phase_covers[{i}]")
    _check_len(erosivity_r, "erosivity_r")
    return sum(
        exposed_erosivity(cover, erosivity_r, b) for cover in phase_covers
    ) / len(phase_covers)


def find_bare_runs(
    soil_cover: list[float], threshold: float = BARE_THRESHOLD
) -> list[tuple[int, int]]:
    """Contiguous runs where soil_cover < threshold, as 0-based inclusive
    (start_idx, end_idx) pairs on the DOY axis.

    Wrap handling: if the year both starts and ends bare, the final run and
    the first run are merged into a single run whose start_idx > end_idx.

    Returns [] if nothing is bare, and a single (0, 364) run if the whole
    year is bare.
    """
    _check_len(soil_cover, "soil_cover")

    bare = [v < threshold for v in soil_cover]

    if not any(bare):
        return []
    if all(bare):
        return [(0, DOY_LEN - 1)]

    runs: list[tuple[int, int]] = []
    start: int | None = None
    for i, is_bare in enumerate(bare):
        if is_bare and start is None:
            start = i
        elif not is_bare and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, DOY_LEN - 1))

    # Merge across the new year. Guarded by len(runs) > 1 so a single run
    # that happens to span the whole array is not merged with itself.
    if len(runs) > 1 and bare[0] and bare[-1]:
        first = runs.pop(0)
        last = runs.pop(-1)
        runs.insert(0, (last[0], first[1]))  # start > end signals the wrap

    return runs


def doys_in_run(start_idx: int, end_idx: int) -> list[int]:
    """Expand an inclusive 0-based run into its DOY indices, wrap-aware."""
    if start_idx <= end_idx:
        return list(range(start_idx, end_idx + 1))
    return list(range(start_idx, DOY_LEN)) + list(range(0, end_idx + 1))


def build_gaps(
    soil_cover: list[float],
    erosivity_r: list[float],
    threshold: float = BARE_THRESHOLD,
    b: float = RUSLE_B_DEFAULT,
) -> list[Gap]:
    """Detect bare gaps and score each one.

    `exposed_r` is cover-weighted (R * C) so it is comparable with
    `exposed_erosivity()`. `share_of_annual_r` deliberately uses RAW R, not
    the weighted value, because the headline sentence we want is "61% of the
    year's erosive rain falls while this field is bare" -- which is a
    statement about the rain, not about the cover.
    """
    runs = find_bare_runs(soil_cover, threshold)
    annual_r = sum(erosivity_r)

    gaps: list[Gap] = []
    for start_idx, end_idx in runs:
        idxs = doys_in_run(start_idx, end_idx)
        gap_exposed = sum(
            erosivity_r[i] * rusle_c_factor(soil_cover[i], b) for i in idxs
        )
        gap_raw_r = sum(erosivity_r[i] for i in idxs)
        gaps.append(
            Gap(
                start_doy=start_idx + 1,
                end_doy=end_idx + 1,
                n_days=len(idxs),
                exposed_r=gap_exposed,
                share_of_annual_r=(gap_raw_r / annual_r) if annual_r > 0 else 0.0,
                wraps_year=start_idx > end_idx,
            )
        )

    gaps.sort(key=lambda g: g.exposed_r, reverse=True)
    return gaps


def accumulate_gdd(
    gdd_daily: list[float], start_doy: int, end_doy: int
) -> float:
    """Sum daily GDD between two DOYs inclusive, wrap-aware.

    Used to answer "can this species reach establishment before the frost
    that kills it", where the window routinely crosses the new year.
    """
    _check_len(gdd_daily, "gdd_daily")
    _check_doy(start_doy)
    _check_doy(end_doy)
    return sum(gdd_daily[i] for i in doys_in_run(start_doy - 1, end_doy - 1))


def bare_days(
    soil_cover: list[float], threshold: float = BARE_THRESHOLD
) -> int:
    _check_len(soil_cover, "soil_cover")
    return sum(1 for v in soil_cover if v < threshold)


#: Daily frost probability at which we call a stand killed.
#:
#: NOT 0.5. Calibrated empirically against Story County 2000-2024: the day
#: a specific date reaches 50% frost probability is far later in autumn
#: than the date most years actually see their first frost. Thresholding at
#: 0.5 put first fall frost at DOY 314 when the true median is 288 -- a
#: 47-day overstatement of the frost-free season once both ends are summed,
#: which would hand every cover crop a month of growth it never gets.
#:
#:   threshold   last spring   first fall      true (per-year median)
#:       0.50       DOY  90      DOY 314        DOY 111 / 288
#:       0.20       DOY 110      DOY 294
#:       0.10       DOY 116      DOY 284        <- closest, and matches
#:                                                 published station normals
KILLING_FROST_PROB = 0.10


def first_killing_frost_doy(
    frost_prob: list[float],
    after_doy: int,
    prob_threshold: float = KILLING_FROST_PROB,
    search_days: int = 200,
) -> int | None:
    """First DOY after `after_doy` where P(frost) crosses the threshold.

    Searches forward with wrap. Returns None if no such day inside
    `search_days` -- which is the correct answer for a frost-free climate,
    not an error.
    """
    _check_len(frost_prob, "frost_prob")
    _check_doy(after_doy)
    for step in range(1, search_days + 1):
        idx = (after_doy - 1 + step) % DOY_LEN
        if frost_prob[idx] >= prob_threshold:
            return idx + 1
    return None


def _check_len(values: list, name: str) -> None:
    if len(values) != DOY_LEN:
        raise ValueError(f"{name} must have length {DOY_LEN}, got {len(values)}")


def _check_doy(doy: int) -> None:
    if not 1 <= doy <= DOY_LEN:
        raise ValueError(f"DOY must be 1-{DOY_LEN}, got {doy}")
