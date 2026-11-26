import os
import time
import unittest
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import httpx

from app.services.cache import MarketDataCache
from app.services.config import MarketDataConfig
from app.services.provider_errors import DataUnavailable, ProviderUnavailable
from app.services.provider_http import ProviderHttpClient


def test_config() -> MarketDataConfig:
    return MarketDataConfig(
        frontend_poll_interval=30,
        quote_cache_ttl=1,
        freshness_cache_ttl=300,
        historical_cache_ttl=3600,
        dividend_cache_ttl=86400,
        financial_cache_ttl=86400,
        sector_cache_ttl=300,
        api_timeout=5,
        max_retries=2,
    )


class MarketDataCacheTests(unittest.TestCase):
    def test_same_key_is_shared_and_loader_runs_once(self):
        cache = MarketDataCache(test_config())
        calls = 0

        def load():
            nonlocal calls
            calls += 1
            return {"last_updated": datetime.now(timezone.utc).isoformat(), "price": 42}

        first = cache.get_or_load("quote:ABC", "quote", load)
        second = cache.get_or_load("quote:ABC", "quote", load)

        self.assertEqual(calls, 1)
        self.assertEqual(first.cache_status, "MISS")
        self.assertEqual(second.cache_status, "HIT")
        self.assertEqual(second.value["price"], 42)

    def test_future_timestamps_are_never_marked_fresh(self):
        cache = MarketDataCache(test_config())
        future = {
            "last_updated": (datetime.now(timezone.utc) + timedelta(days=365)).isoformat(),
            "price": 42,
        }

        result = cache.get_or_load("quote:future", "quote", lambda: future)

        self.assertEqual(result.freshness_status, "STALE")

    def test_concurrent_requests_for_same_key_use_one_loader(self):
        cache = MarketDataCache(test_config())
        calls = 0

        def load():
            nonlocal calls
            calls += 1
            time.sleep(0.05)
            return {"last_updated": datetime.now(timezone.utc).isoformat(), "price": 42}

        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(lambda _: cache.get_or_load("quote:ABC", "quote", load), range(8)))

        self.assertEqual(calls, 1)
        self.assertEqual(sum(result.cache_status == "MISS" for result in results), 1)

    def test_expired_cache_falls_back_to_stale_value(self):
        cache = MarketDataCache(test_config())
        old = {"last_updated": "2020-01-01T00:00:00+00:00", "price": 42}
        cache.get_or_load("quote:ABC", "quote", lambda: old)
        time.sleep(1.05)

        result = cache.get_or_load(
            "quote:ABC",
            "quote",
            lambda: (_ for _ in ()).throw(ProviderUnavailable("offline")),
        )

        self.assertEqual(result.cache_status, "STALE")
        self.assertEqual(result.freshness_status, "STALE")
        self.assertEqual(result.value["price"], 42)
        self.assertEqual(result.last_updated, old["last_updated"])

    def test_provider_failure_without_cache_is_unavailable(self):
        cache = MarketDataCache(test_config())
        calls = 0

        def fail():
            nonlocal calls
            calls += 1
            raise ProviderUnavailable("offline")

        with self.assertRaises(DataUnavailable):
            cache.get_or_load("quote:ABC", "quote", fail)
        with self.assertRaises(DataUnavailable):
            cache.get_or_load("quote:ABC", "quote", fail)
        self.assertEqual(calls, 1)

    def test_environment_values_configure_cache_and_polling(self):
        with patch.dict(os.environ, {
            "FRONTEND_POLL_INTERVAL": "45",
            "QUOTE_CACHE_TTL": "90",
            "API_TIMEOUT": "3.5",
            "MAX_RETRIES": "0",
        }):
            config = MarketDataConfig.from_environment()
        self.assertEqual(config.frontend_poll_interval, 45)
        self.assertEqual(config.quote_cache_ttl, 90)
        self.assertEqual(config.api_timeout, 3.5)
        self.assertEqual(config.max_retries, 0)

    def test_rate_limit_retry_after_suppresses_requests_during_cooldown(self):
        client = ProviderHttpClient(test_config())
        response = httpx.Response(429, headers={"Retry-After": "60"})
        with patch.object(client._client, "get", return_value=response) as get:
            with self.assertRaises(ProviderUnavailable):
                client.get_json("https://provider.example/quotes")
            with self.assertRaises(ProviderUnavailable):
                client.get_json("https://provider.example/quotes")
        self.assertEqual(get.call_count, 1)
        client.close()

    def test_transient_server_error_uses_bounded_retry(self):
        client = ProviderHttpClient(test_config())
        responses = [
            httpx.Response(503),
            httpx.Response(200, json={"items": []}),
        ]
        with patch.object(client._client, "get", side_effect=responses) as get:
            with patch("app.services.provider_http.time.sleep") as sleep:
                self.assertEqual(client.get_json("https://provider.example/quotes"), {"items": []})
        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once()
        client.close()

    def test_psx_lens_freshness_endpoint_classifies_quotes_as_delayed(self):
        from app.services.psx_provider import PSXLensProviderAdapter

        class FakeHttpClient:
            def get_json(self, url, headers=None):
                return {"data": [{
                    "dataset": "quotes",
                    "status": "delayed",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }]}

        with patch.dict(os.environ, {"PSXLENS_API_BASE_URL": "https://provider.example/"}):
            with patch("app.services.psx_provider.market_data_cache", MarketDataCache(test_config())):
                result = PSXLensProviderAdapter(FakeHttpClient()).get_freshness()
        self.assertEqual(result["freshness_status"], "DELAYED")
        self.assertIsNotNone(result["last_updated"])

    def test_psx_lens_never_marks_naive_freshness_timestamp_as_delayed(self):
        from app.services.psx_provider import PSXLensProviderAdapter

        class FakeHttpClient:
            def get_json(self, url, headers=None):
                return {"data": [{
                    "dataset": "quotes",
                    "status": "delayed",
                    "updated_at": "2026-11-15T12:00:00",
                }]}

        with patch.dict(os.environ, {"PSXLENS_API_BASE_URL": "https://provider.example/"}):
            with patch("app.services.psx_provider.market_data_cache", MarketDataCache(test_config())):
                result = PSXLensProviderAdapter(FakeHttpClient()).get_freshness()
        self.assertEqual(result["freshness_status"], "STALE")
        self.assertIsNone(result["last_updated"])


if __name__ == "__main__":
    unittest.main()
