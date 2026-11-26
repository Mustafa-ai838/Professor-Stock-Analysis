import logging
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

import httpx

from .config import MarketDataConfig, market_data_config
from .provider_errors import ProviderNotFound, ProviderUnavailable


logger = logging.getLogger(__name__)


def _retry_after_seconds(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
        except (TypeError, ValueError, OverflowError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())


class ProviderHttpClient:
    def __init__(self, config: MarketDataConfig = market_data_config):
        self._config = config
        self._client = httpx.Client(timeout=config.api_timeout)
        self._rate_limited_until: dict[str, float] = {}

    def get_json(self, url: str, headers: dict[str, str] | None = None) -> object:
        host = urlparse(url).netloc
        now = time.monotonic()
        blocked_until = self._rate_limited_until.get(host, 0)
        if blocked_until > now:
            raise ProviderUnavailable(f"Provider rate limit is active for {blocked_until - now:.1f} more seconds.")

        for attempt in range(self._config.max_retries + 1):
            try:
                response = self._client.get(url, headers=headers)
            except (httpx.TimeoutException, httpx.NetworkError) as error:
                if attempt < self._config.max_retries:
                    time.sleep(min(0.25 * (2 ** attempt), 2.0))
                    continue
                raise ProviderUnavailable("Provider request timed out or the connection failed.") from error

            if response.status_code == 429:
                delay = _retry_after_seconds(response.headers.get("Retry-After"))
                if delay is None:
                    delay = min(0.25 * (2 ** attempt), 2.0)
                self._rate_limited_until[host] = time.monotonic() + delay
                logger.warning("Provider rate limited requests for %s; retry deferred for %.1f seconds.", host, delay)
                if attempt < self._config.max_retries and delay <= self._config.api_timeout:
                    time.sleep(delay)
                    continue
                raise ProviderUnavailable(f"Provider rate limited requests; retry deferred for {delay:.1f} seconds.")

            if response.status_code >= 500 and attempt < self._config.max_retries:
                time.sleep(min(0.25 * (2 ** attempt), 2.0))
                continue
            if response.status_code == 404:
                raise ProviderNotFound("The requested market data resource was not found.")
            if response.status_code >= 400:
                raise ProviderUnavailable(f"Provider returned HTTP {response.status_code}.")
            try:
                return response.json()
            except ValueError as error:
                raise ProviderUnavailable("Provider returned invalid JSON.") from error

        raise ProviderUnavailable("Provider request failed after the configured retries.")

    def close(self) -> None:
        self._client.close()
