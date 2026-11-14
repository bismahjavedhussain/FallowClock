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
