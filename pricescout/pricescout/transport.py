"""HTTP transport built on Scrapling, with polite-crawling built in.

Scrapling's `Fetcher` (curl_cffi + TLS impersonation) is the primary transport.
Some environments sit behind a TLS-terminating egress proxy that resets
curl_cffi's impersonated ClientHello; in that case we transparently fall back to
`requests` so the pipeline still runs. Parsing is always Scrapling's `Selector`.
"""

from __future__ import annotations

import os
import time
import random
import threading
import urllib.robotparser as robotparser
from urllib.parse import urlparse
from typing import Optional, Dict, Any

import logging

from scrapling import Selector

# Scrapling logs a stack-trace-level ERROR for every failed fetch. The fallback
# path handles that, so keep its logger at CRITICAL to avoid flooding the run log.
logging.getLogger("scrapling").setLevel(logging.CRITICAL)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


class Response:
    """Uniform response wrapper regardless of which backend fetched it."""

    def __init__(self, status: int, text: str, url: str, headers=None, backend: str = ""):
        self.status = status
        self.text = text
        self.url = url
        self.headers = headers or {}
        self.backend = backend
        self._sel: Optional[Selector] = None

    @property
    def selector(self) -> Selector:
        """Scrapling Selector over the response body (lazily built)."""
        if self._sel is None:
            self._sel = Selector(self.text, url=self.url)
        return self._sel

    def json(self):
        import json
        return json.loads(self.text)


class RateLimiter:
    """Per-host minimum delay, so we never hammer a single retailer."""

    def __init__(self, min_delay: float = 1.5, jitter: float = 0.7):
        self.min_delay = min_delay
        self.jitter = jitter
        self._last: Dict[str, float] = {}
        self._lock = threading.Lock()

    def wait(self, url: str):
        host = urlparse(url).netloc
        with self._lock:
            now = time.monotonic()
            last = self._last.get(host, 0.0)
            delay = self.min_delay + random.uniform(0, self.jitter)
            sleep_for = max(0.0, last + delay - now)
            self._last[host] = now + sleep_for
        if sleep_for > 0:
            time.sleep(sleep_for)


class RobotsCache:
    """robots.txt lookups, cached per host. Fails open on fetch errors."""

    def __init__(self, session, enabled: bool = True):
        self.session = session
        self.enabled = enabled
        self._cache: Dict[str, Any] = {}
        self._lock = threading.Lock()

    def allowed(self, url: str, agent: str = "*") -> bool:
        if not self.enabled:
            return True
        parts = urlparse(url)
        root = f"{parts.scheme}://{parts.netloc}"
        with self._lock:
            rp = self._cache.get(root, "missing")
        if rp == "missing":
            rp = robotparser.RobotFileParser()
            try:
                r = self.session.get(root + "/robots.txt", timeout=15)
                if r.status_code == 200 and len(r.text) < 500_000:
                    rp.parse(r.text.splitlines())
                else:
                    rp = None
            except Exception:
                rp = None
            with self._lock:
                self._cache[root] = rp
        if rp is None:
            return True
        try:
            return rp.can_fetch(agent, url)
        except Exception:
            return True


class Transport:
    """Fetches pages, preferring Scrapling's impersonating Fetcher."""

    def __init__(self, min_delay: float = 1.5, respect_robots: bool = True,
                 timeout: int = 30, force_backend: Optional[str] = None):
        import requests
        self.requests_session = requests.Session()
        self.requests_session.headers.update({
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
        })
        self.limiter = RateLimiter(min_delay=min_delay)
        self.robots = RobotsCache(self.requests_session, enabled=respect_robots)
        self.timeout = timeout
        self.proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        self.force_backend = force_backend
        self._scrapling_ok: Optional[bool] = None
        self._probe_lock = threading.Lock()

    # -- backends ---------------------------------------------------------
    def _try_scrapling(self, url: str, headers: Optional[Dict[str, str]]) -> Optional[Response]:
        from scrapling.fetchers import Fetcher
        try:
            r = Fetcher.get(url, impersonate="chrome", timeout=self.timeout,
                            retries=1, headers=headers or {},
                            proxy=self.proxy, stealthy_headers=True)
            body = r.body if isinstance(r.body, str) else (r.body or b"").decode("utf-8", "replace")
            return Response(r.status, body, url, dict(getattr(r, "headers", {}) or {}), "scrapling")
        except Exception:
            return None

    def _requests_get(self, url: str, headers: Optional[Dict[str, str]]) -> Response:
        r = self.requests_session.get(url, timeout=self.timeout, headers=headers or {})
        return Response(r.status_code, r.text, r.url, dict(r.headers), "requests")

    def get(self, url: str, headers: Optional[Dict[str, str]] = None,
            check_robots: bool = True) -> Response:
        if check_robots and not self.robots.allowed(url):
            return Response(999, "", url, backend="robots-disallowed")

        self.limiter.wait(url)

        if self.force_backend != "requests":
            with self._probe_lock:
                probe = self._scrapling_ok
            if probe is not False:
                resp = self._try_scrapling(url, headers)
                if resp is not None:
                    with self._probe_lock:
                        self._scrapling_ok = True
                    return resp
                # First failure decides: this environment cannot run curl_cffi
                # (typically a TLS-terminating egress proxy resetting the
                # impersonated ClientHello). Stop paying for the retry.
                with self._probe_lock:
                    self._scrapling_ok = False
            if self.force_backend == "scrapling":
                raise RuntimeError("Scrapling backend unavailable in this environment")

        return self._requests_get(url, headers)

    def post_json(self, url: str, payload: dict, headers: Optional[Dict[str, str]] = None) -> Response:
        self.limiter.wait(url)
        # Force a JSON Accept header: several retailer APIs content-negotiate and
        # will hand back XML if they see the session's default HTML Accept.
        hdrs = {"Accept": "application/json", "Content-Type": "application/json"}
        hdrs.update(headers or {})
        r = self.requests_session.post(url, json=payload, timeout=self.timeout, headers=hdrs)
        return Response(r.status_code, r.text, r.url, dict(r.headers), "requests")
