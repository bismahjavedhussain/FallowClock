"""Disk cache for HTTP responses.

Every outbound call in this project goes through here. Two reasons:

  1. The demo must never hit a live endpoint (see the plan). Once a response
     is on disk the pipeline reproduces offline, which is also what makes the
     airplane-mode test pass.
  2. Re-running a script during development should not re-hit NASA. It is
     slow, it is rude, and on a bad conference wifi it is the difference
     between a 2-second iteration and a 40-second one.

Cache keys are a hash of the full URL, so changing any parameter misses
cleanly rather than silently serving the wrong years.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_CACHE_DIR = Path(__file__).resolve().parents[1] / "cache"

# Be a good citizen but do not identify the user. Never put a personal email
# or project name in an outbound header.
USER_AGENT = "FallowClock/0.1 (NASA Space Apps 2026; research prototype)"


class FetchError(RuntimeError):
    """Raised when a URL could not be retrieved after retries."""


def cache_key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]


def cached_get(
    url: str,
    cache_dir: Path | str = DEFAULT_CACHE_DIR,
    *,
    timeout: int = 90,
    retries: int = 3,
    backoff: float = 2.0,
    refresh: bool = False,
) -> str:
    """GET `url`, returning the body as text, caching it on disk forever.

    No TTL on purpose: these are historical climate records that do not
    change. Pass `refresh=True` to force a re-fetch.
    """
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{cache_key(url)}.json"

    if path.exists() and not refresh:
        return path.read_text(encoding="utf-8")

    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8")
            path.write_text(body, encoding="utf-8")
            # Keep the URL beside the payload so a human can tell what a
            # hash-named file actually is.
            (cache_dir / f"{cache_key(url)}.url.txt").write_text(url, encoding="utf-8")
            return body
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt < retries - 1:
                time.sleep(backoff * (2**attempt))

    raise FetchError(f"Failed after {retries} attempts: {url}\n  last error: {last_error}")


def cached_get_json(url: str, cache_dir: Path | str = DEFAULT_CACHE_DIR, **kw) -> dict:
    raw = cached_get(url, cache_dir, **kw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        # A cached error page is worse than no cache -- drop it so the next
        # run retries instead of failing identically forever.
        bad = Path(cache_dir) / f"{cache_key(url)}.json"
        bad.unlink(missing_ok=True)
        raise FetchError(f"Response was not JSON (cache entry dropped): {url}") from exc


def cache_stats(cache_dir: Path | str = DEFAULT_CACHE_DIR) -> dict:
    cache_dir = Path(cache_dir)
    if not cache_dir.exists():
        return {"entries": 0, "bytes": 0}
    files = [p for p in cache_dir.glob("*.json")]
    return {"entries": len(files), "bytes": sum(p.stat().st_size for p in files)}


# --------------------------------------------------------------------------
# B1 additions: binary pixel blocks and POSTed STAC searches.
#
# Everything above this line is the text/JSON cache that weather.py and the
# API already use. It is deliberately left exactly as it was. The imagery
# pipeline needs two things it does not do:
#
#   * cache BINARY bodies (.npy pixel blocks from the Planetary Computer
#     data API) without a UTF-8 round trip, and
#   * cache POST requests (STAC search), keyed on URL + canonical body.
#
# Both validate a body BEFORE it is written (a cached error page is served
# forever) and write atomically, because the imagery pipeline fetches scenes
# from several threads at once and a half-written file would also be served
# forever.
# --------------------------------------------------------------------------

import os  # noqa: E402
import random  # noqa: E402
import tempfile  # noqa: E402
from collections.abc import Callable  # noqa: E402

IMAGERY_CACHE_DIR = DEFAULT_CACHE_DIR / "imagery"

#: Statuses worth retrying. Anything else (400, 404) is a real answer and
#: retrying it only burns the provider's patience.
RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=path.suffix)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _fetch_bytes(
    make_request: Callable[[], urllib.request.Request],
    label: str,
    *,
    timeout: int,
    retries: int,
    backoff: float,
) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries):
        wait = backoff * (2**attempt)
        try:
            with urllib.request.urlopen(make_request(), timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:  # before URLError: it is a subclass
            last_error = exc
            if exc.code not in RETRYABLE_STATUS:
                break
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
            if retry_after and retry_after.strip().isdigit():
                wait = max(wait, float(retry_after))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        if attempt < retries - 1:
            # Jitter, so a pool of threads that all got a 429 together does
            # not come back together and get another one.
            time.sleep(wait + random.uniform(0.0, backoff))
    raise FetchError(f"Failed after {retries} attempt(s): {label}\n  last error: {last_error}")


def cached_get_bytes(
    url: str,
    cache_dir: Path | str = IMAGERY_CACHE_DIR,
    *,
    suffix: str = ".bin",
    validate: Callable[[bytes], object] | None = None,
    timeout: int = 120,
    retries: int = 5,
    backoff: float = 2.0,
    refresh: bool = False,
) -> bytes:
    """GET `url` as raw bytes, cached on disk forever.

    `validate` is called on a fresh body before it is cached; if it raises,
    nothing is written and the error propagates. A cached body that later
    turns out to be unusable can be removed with `drop_cached`.
    """
    cache_dir = Path(cache_dir)
    path = cache_dir / f"{cache_key(url)}{suffix}"
    if path.exists() and not refresh:
        return path.read_bytes()

    body = _fetch_bytes(
        lambda: urllib.request.Request(url, headers={"User-Agent": USER_AGENT}),
        url,
        timeout=timeout,
        retries=retries,
        backoff=backoff,
    )
    if validate is not None:
        validate(body)
    _atomic_write(path, body)
    _atomic_write(cache_dir / f"{cache_key(url)}.url.txt", url.encode("utf-8"))
    return body


def cached_post_json(
    url: str,
    body: dict,
    cache_dir: Path | str = IMAGERY_CACHE_DIR,
    *,
    timeout: int = 120,
    retries: int = 5,
    backoff: float = 2.0,
    refresh: bool = False,
) -> dict:
    """POST a JSON body and cache the JSON reply, keyed on URL + body.

    The body is serialised canonically (sorted keys), so two dicts that are
    equal hit the same cache entry regardless of key order.
    """
    cache_dir = Path(cache_dir)
    payload = json.dumps(body, sort_keys=True, separators=(",", ":"))
    signature = f"POST {url}\n{payload}"
    key = cache_key(signature)
    path = cache_dir / f"{key}.json"

    if path.exists() and not refresh:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            path.unlink(missing_ok=True)  # corrupt entry: refetch below

    raw = _fetch_bytes(
        lambda: urllib.request.Request(
            url,
            data=payload.encode("utf-8"),
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
            method="POST",
        ),
        signature[:300],
        timeout=timeout,
        retries=retries,
        backoff=backoff,
    )
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise FetchError(f"POST response was not JSON (not cached): {url}") from exc
    _atomic_write(path, raw)
    _atomic_write(cache_dir / f"{key}.url.txt", signature.encode("utf-8"))
    return parsed


def drop_cached(url: str, cache_dir: Path | str = IMAGERY_CACHE_DIR, *, suffix: str = ".bin") -> None:
    """Delete one cached GET entry, for a caller that found it unusable."""
    cache_dir = Path(cache_dir)
    (cache_dir / f"{cache_key(url)}{suffix}").unlink(missing_ok=True)
    (cache_dir / f"{cache_key(url)}.url.txt").unlink(missing_ok=True)
