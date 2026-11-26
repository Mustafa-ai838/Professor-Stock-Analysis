import copy
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from .config import MarketDataConfig, market_data_config
from .provider_errors import DataUnavailable, ProviderUnavailable


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CacheResult:
    value: Any
    cache_status: str
    freshness_status: str
    last_updated: str | None


@dataclass(frozen=True)
class _CacheEntry:
    value: Any
    expires_at: float
    cached_at: float
    last_updated: str | None


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if timestamp.tzinfo is None:
        return None
    return timestamp.astimezone(timezone.utc)


def _find_timestamp(value: Any) -> datetime | None:
    if isinstance(value, dict):
        for key in ("last_updated", "updated_at"):
            timestamp = _parse_timestamp(value.get(key))
            if timestamp is not None:
                return timestamp
        candidates = [
            timestamp
            for key in ("items", "stocks", "gainers", "losers", "active", "sectors")
            if key in value
            for timestamp in [_find_timestamp(value[key])]
            if timestamp is not None
        ]
        return max(candidates) if candidates else None
    if isinstance(value, list):
        candidates = [timestamp for item in value if (timestamp := _find_timestamp(item)) is not None]
        return max(candidates) if candidates else None
    return None


class MarketDataCache:
    """Thread-safe per-process cache shared by all requests and users."""

    def __init__(self, config: MarketDataConfig = market_data_config, max_entries: int = 2048):
        self._config = config
        self._max_entries = max_entries
        self._entries: dict[str, _CacheEntry] = {}
        self._locks = tuple(threading.RLock() for _ in range(64))
        self._failure_counts: dict[str, int] = {}
        self._failure_until: dict[str, float] = {}
        self._guard = threading.RLock()

    def _key_lock(self, key: str) -> threading.RLock:
        return self._locks[hash(key) % len(self._locks)]

    def _freshness_status(self, last_updated: str | None, force_stale: bool = False) -> str:
        if force_stale or last_updated is None:
            return "STALE"
        timestamp = _parse_timestamp(last_updated)
        if timestamp is None:
            return "STALE"
        age_seconds = (datetime.now(timezone.utc) - timestamp).total_seconds()
        return "STALE" if age_seconds < 0 or age_seconds > self._config.freshness_cache_ttl else "FRESH"

    def get_or_load(
        self,
        key: str,
        category: str,
        loader: Callable[[], Any],
    ) -> CacheResult:
        lock = self._key_lock(key)
        with lock:
            now = time.monotonic()
            with self._guard:
                entry = self._entries.get(key)
                retry_until = self._failure_until.get(key, 0)
            if entry is not None and entry.expires_at > now:
                return CacheResult(
                    value=copy.deepcopy(entry.value),
                    cache_status="HIT",
                    freshness_status=self._freshness_status(entry.last_updated),
                    last_updated=entry.last_updated,
                )

            if retry_until > now:
                if entry is not None:
                    return CacheResult(
                        value=copy.deepcopy(entry.value),
                        cache_status="STALE",
                        freshness_status="STALE",
                        last_updated=entry.last_updated,
                    )
                raise DataUnavailable("Market data is not available; provider retry is deferred.")

            try:
                value = loader()
            except ProviderUnavailable as error:
                with self._guard:
                    failures = self._failure_counts.get(key, 0) + 1
                    self._failure_counts[key] = failures
                    self._failure_until[key] = time.monotonic() + min(2 ** (failures - 1), 60)
                delay = min(2 ** (failures - 1), 60)
                if entry is None:
                    logger.error("Market data unavailable for cache key %s: %s", key, error)
                    raise DataUnavailable("Market data is not available.") from error
                logger.warning("Serving stale market data for cache key %s: %s", key, error)
                return CacheResult(
                    value=copy.deepcopy(entry.value),
                    cache_status="STALE",
                    freshness_status="STALE",
                    last_updated=entry.last_updated,
                )

            with self._guard:
                self._failure_counts.pop(key, None)
                self._failure_until.pop(key, None)
            timestamp = _find_timestamp(value)
            last_updated = timestamp.isoformat() if timestamp is not None else None
            entry = _CacheEntry(
                value=copy.deepcopy(value),
                expires_at=now + self._config.ttl_for(category),
                cached_at=now,
                last_updated=last_updated,
            )
            with self._guard:
                self._entries[key] = entry
                self._evict_if_needed()
            return CacheResult(
                value=copy.deepcopy(value),
                cache_status="MISS",
                freshness_status=self._freshness_status(last_updated),
                last_updated=last_updated,
            )

    def set(self, key: str, category: str, value: Any, last_updated: str | None = None) -> None:
        """Store a normalized provider update, for example a future websocket tick."""
        timestamp = _parse_timestamp(last_updated) or _find_timestamp(value)
        timestamp_text = timestamp.isoformat() if timestamp is not None else None
        now = time.monotonic()
        with self._key_lock(key):
            with self._guard:
                self._entries[key] = _CacheEntry(
                    value=copy.deepcopy(value),
                    expires_at=now + self._config.ttl_for(category),
                    cached_at=now,
                    last_updated=timestamp_text,
                )
                self._failure_counts.pop(key, None)
                self._failure_until.pop(key, None)
                self._evict_if_needed()

    def invalidate(self, key: str) -> None:
        with self._key_lock(key):
            with self._guard:
                self._entries.pop(key, None)
                self._failure_counts.pop(key, None)
                self._failure_until.pop(key, None)

    def _evict_if_needed(self) -> None:
        if len(self._entries) <= self._max_entries:
            return
        oldest_keys = sorted(self._entries, key=lambda key: self._entries[key].cached_at)
        for key in oldest_keys[:len(self._entries) - self._max_entries]:
            self._entries.pop(key, None)
            self._failure_counts.pop(key, None)
            self._failure_until.pop(key, None)


market_data_cache = MarketDataCache()
