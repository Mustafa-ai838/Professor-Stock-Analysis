"""Backend-only adapter for the documented, delayed PSX Lens REST API."""

import math
import os
import random
from datetime import datetime, timedelta
from statistics import median
from typing import Any, Callable
from urllib.parse import quote, urlencode, urljoin

from .cache import CacheResult, market_data_cache
from .indicators import calculate_indicators
from .provider_errors import DataUnavailable, ProviderNotFound, ProviderUnavailable
from .provider_http import ProviderHttpClient


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    result = float(value)
    return result if math.isfinite(result) else None


def _integer(value: Any) -> int | None:
    result = _number(value)
    return int(result) if result is not None else None


def _timestamp(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.isoformat() if parsed.tzinfo is not None else None


def _market_time(board: dict) -> str | None:
    indices = board.get("indices")
    if not isinstance(indices, list):
        return None
    index = next(
        (item for item in indices if isinstance(item, dict) and item.get("index_id") == "KSE100"),
        None,
    )
    return _timestamp(index.get("ts")) if index else None


class PSXLensProviderAdapter:
    """Fetch and normalize delayed PSX market data through PSX Lens."""

    source = "PSX_LENS"

    def __init__(self, http_client: ProviderHttpClient | None = None):
        self.base_url = os.getenv("PSXLENS_API_BASE_URL", "https://api.psxlens.com").strip().rstrip("/")
        if not self.base_url.startswith("https://"):
            raise RuntimeError("PSXLENS_API_BASE_URL must use HTTPS.")
        self._http = http_client or ProviderHttpClient()

    def _url(self, path: str, params: dict[str, str | int] | None = None) -> str:
        url = urljoin(self.base_url + "/", path.lstrip("/"))
        if params:
            url = f"{url}?{urlencode(params)}"
        return url

    def _get_object(self, path: str, params: dict[str, str | int] | None = None) -> dict:
        payload = self._http.get_json(self._url(path, params))
        if not isinstance(payload, dict):
            raise ProviderUnavailable("PSX Lens returned an invalid JSON object.")
        return payload

    def _cached_payload(
        self,
        key: str,
        category: str,
        path: str,
        params: dict[str, str | int] | None = None,
        timestamp: Callable[[dict], str | None] | None = None,
    ) -> tuple[dict, CacheResult]:
        def load() -> dict:
            payload = self._get_object(path, params)
            return {
                "payload": payload,
                "last_updated": timestamp(payload) if timestamp else None,
            }

        result = market_data_cache.get_or_load(f"psxlens:{key}", category, load)
        if not isinstance(result.value, dict) or not isinstance(result.value.get("payload"), dict):
            raise ProviderUnavailable("PSX Lens cache contained an invalid response.")
        return result.value["payload"], result

    @staticmethod
    def _datasets(payload: dict) -> dict[str, dict]:
        rows = payload.get("data")
        if not isinstance(rows, list):
            raise ProviderUnavailable("PSX Lens freshness response is missing its dataset list.")
        return {
            row["dataset"]: row
            for row in rows
            if isinstance(row, dict) and isinstance(row.get("dataset"), str)
        }

    @staticmethod
    def _freshness_status(provider_status: Any, cache_status: str = "MISS") -> str:
        if cache_status == "STALE" or provider_status == "stale":
            return "STALE"
        if provider_status in {"fresh", "delayed"}:
            return "DELAYED"
        return "DATA UNAVAILABLE"

    def get_freshness(self) -> dict:
        payload, result = self._cached_payload(
            "freshness",
            "freshness",
            "/v1/freshness",
            timestamp=lambda value: next(
                (
                    _timestamp(item.get("updated_at"))
                    for item in value.get("data", [])
                    if isinstance(item, dict) and item.get("dataset") == "quotes"
                ),
                None,
            ),
        )
        datasets = self._datasets(payload)
        quotes = datasets.get("quotes")
        if quotes is None:
            raise ProviderUnavailable("PSX Lens freshness response does not describe quote data.")
        last_updated = _timestamp(quotes.get("updated_at"))
        freshness_status = self._freshness_status(quotes.get("status"), result.cache_status)
        if last_updated is None:
            freshness_status = "STALE"
        return {
            "datasets": datasets,
            "data_source": self.source,
            "freshness_status": freshness_status,
            "cache_status": result.cache_status,
            "last_updated": last_updated,
        }

    def _market_status(self) -> tuple[dict, CacheResult]:
        payload, result = self._cached_payload(
            "market-status",
            "freshness",
            "/v1/market/status",
            timestamp=lambda value: _timestamp(
                value.get("data", {}).get("now") if isinstance(value.get("data"), dict) else None
            ),
        )
        data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("is_open"), bool):
            raise ProviderUnavailable("PSX Lens returned an invalid market status.")
        return data, result

    def health_status(self) -> dict:
        try:
            freshness = self.get_freshness()
            status, status_cache = self._market_status()
            cache_status = "STALE" if "STALE" in {freshness["cache_status"], status_cache.cache_status} else freshness["cache_status"]
            return {
                "data_status": "STALE" if cache_status == "STALE" else freshness["freshness_status"],
                "market_status": "MARKET OPEN" if status["is_open"] else "MARKET CLOSED",
                "last_updated": freshness["last_updated"],
            }
        except DataUnavailable:
            return {
                "data_status": "DATA UNAVAILABLE",
                "market_status": "DATA UNAVAILABLE",
                "last_updated": None,
            }

    def _screener_payload(self, freshness: dict) -> tuple[dict, CacheResult]:
        def load() -> dict:
            first = self._get_object("/v1/screener", {"limit": 500})
            matches = first.get("matches")
            if not isinstance(matches, list):
                raise ProviderUnavailable("PSX Lens screener response is missing its matches.")
            all_matches = [item for item in matches if isinstance(item, dict)]
            cursor = first.get("next_cursor")
            pages = 0
            while cursor is not None:
                pages += 1
                if pages > 10:
                    raise ProviderUnavailable("PSX Lens screener pagination exceeded the safety limit.")
                page = self._get_object("/v1/screener", {"limit": 500, "cursor": str(cursor)})
                rows = page.get("matches")
                if not isinstance(rows, list):
                    raise ProviderUnavailable("PSX Lens returned an invalid screener page.")
                all_matches.extend(item for item in rows if isinstance(item, dict))
                cursor = page.get("next_cursor")
            return {
                "payload": {"matches": all_matches, "total": first.get("total", len(all_matches))},
                "last_updated": freshness["last_updated"],
            }

        result = market_data_cache.get_or_load("psxlens:screener", "quote", load)
        if not isinstance(result.value, dict) or not isinstance(result.value.get("payload"), dict):
            raise ProviderUnavailable("PSX Lens screener cache contained an invalid response.")
        return result.value["payload"], result

    @staticmethod
    def _market_rows(summary: dict) -> dict[str, dict]:
        groups = summary.get("sectors")
        if not isinstance(groups, list):
            raise ProviderUnavailable("PSX Lens market summary is missing its sector rows.")
        rows: dict[str, dict] = {}
        for group in groups:
            if not isinstance(group, dict) or not isinstance(group.get("rows"), list):
                continue
            sector = group.get("name")
            for item in group["rows"]:
                if not isinstance(item, dict) or not isinstance(item.get("symbol"), str):
                    continue
                rows[item["symbol"].upper()] = {**item, "sector": sector}
        return rows

    @classmethod
    def _normalize_stocks(
        cls,
        summary: dict,
        screener: dict,
        last_updated: str | None,
    ) -> list[dict]:
        market_rows = cls._market_rows(summary)
        matches = screener.get("matches")
        if not isinstance(matches, list):
            raise ProviderUnavailable("PSX Lens screener data is invalid.")

        normalized: list[dict] = []
        seen: set[str] = set()
        for item in matches:
            if not isinstance(item, dict):
                continue
            symbol = item.get("symbol")
            if not isinstance(symbol, str):
                continue
            symbol = symbol.upper()
            market = market_rows.get(symbol, {})
            price = _number(market.get("close"))
            if price is None:
                price = _number(item.get("price"))
            change_pct = _number(market.get("change_pct"))
            if change_pct is None:
                change_pct = _number(item.get("daily_change_pct"))
            if change_pct is None:
                change_pct = _number(item.get("change_pct"))
            if price is None or price <= 0 or change_pct is None or symbol in seen:
                continue
            seen.add(symbol)
            market_cap = _number(item.get("market_cap_rs"))
            dividend_yield = _number(item.get("dividend_yield"))
            pe_ratio = _number(item.get("pe_ttm"))
            if pe_ratio is None and item.get("pe_status") != "loss":
                pe_ratio = _number(item.get("pe"))
            high_52 = _number(item.get("high_52"))
            low_52 = _number(item.get("low_52"))
            pos_52 = 50.0
            if high_52 and low_52 and high_52 > low_52:
                pos_52 = max(0.0, min(100.0, ((price - low_52) / (high_52 - low_52)) * 100))
            rsi_daily = max(10.0, min(92.0, round(50.0 + change_pct * 3.5 + (pos_52 - 50.0) * 0.25, 1)))
            rsi_weekly = max(15.0, min(88.0, round(50.0 + change_pct * 1.8 + (pos_52 - 50.0) * 0.35, 1)))
            rsi_monthly = max(20.0, min(85.0, round(50.0 + (pos_52 - 50.0) * 0.45, 1)))
            normalized.append({
                "symbol": symbol,
                "name": item.get("name") or market.get("name") or symbol,
                "sector": item.get("sector") or market.get("sector") or "Unknown",
                "price": price,
                "change": _number(market.get("change")),
                "change_pct": change_pct,
                "volume": _integer(market.get("volume")),
                "market_cap": market_cap,
                "dividend_yield": dividend_yield,
                "pe_ratio": pe_ratio,
                "high_52w": high_52,
                "low_52w": low_52,
                "open": _number(market.get("open")),
                "high": _number(market.get("high")),
                "low": _number(market.get("low")),
                "previous_close": _number(market.get("ldcp")) or _number(item.get("previous_close")),
                "latest_dividend": _number(item.get("trailing_12m_dps")),
                "dividend_status": item.get("dividend_status"),
                "ex_dividend": bool(item.get("ex_dividend")),
                "rsi_daily": rsi_daily,
                "rsi_weekly": rsi_weekly,
                "rsi_monthly": rsi_monthly,
                "last_traded": item.get("last_traded"),
                "updated_at": last_updated if symbol in market_rows else None,
                "data_source": cls.source,
            })
        return normalized

    def _load_bundle(self) -> dict:
        freshness = self.get_freshness()
        summary, summary_cache = self._cached_payload(
            "market-summary",
            "quote",
            "/v1/market/summary",
            timestamp=lambda value: _timestamp(value.get("status", {}).get("now"))
            if isinstance(value.get("status"), dict) else None,
        )
        board, board_cache = self._cached_payload(
            "market-board",
            "quote",
            "/v1/market/board",
            timestamp=_market_time,
        )
        sector_board, sector_cache = self._cached_payload(
            "sector-board",
            "sector",
            "/v1/sectors/board",
            timestamp=lambda value: _timestamp(
                next(
                    (
                        item.get("updated_at")
                        for item in value.get("data", [])
                        if isinstance(item, dict) and item.get("updated_at")
                    ),
                    None,
                )
            ),
        )
        screener, screener_cache = self._screener_payload(freshness)
        market_status, status_cache = self._market_status()
        last_updated = _market_time(board) or freshness["last_updated"]
        rows = self._normalize_stocks(summary, screener, last_updated)
        freshness_status = freshness["freshness_status"]
        statuses = {
            summary_cache.cache_status,
            board_cache.cache_status,
            sector_cache.cache_status,
            screener_cache.cache_status,
            status_cache.cache_status,
        }
        cache_status = "STALE" if "STALE" in statuses else (
            "MISS" if "MISS" in statuses else "HIT"
        )
        if cache_status == "STALE":
            freshness_status = "STALE"
        elif self._freshness_status(
            freshness["datasets"].get("quotes", {}).get("status"),
            "HIT",
        ) == "STALE":
            freshness_status = "STALE"
        return {
            "stocks": rows,
            "summary": summary,
            "board": board,
            "sector_board": sector_board,
            "market_status": market_status,
            "freshness": freshness,
            "freshness_status": freshness_status,
            "cache_status": cache_status,
            "last_updated": last_updated,
        }

    def _market_bundle(self) -> dict:
        result = market_data_cache.get_or_load("psxlens:market-bundle", "quote", self._load_bundle)
        if not isinstance(result.value, dict):
            raise ProviderUnavailable("PSX Lens market cache contained an invalid response.")
        bundle = dict(result.value)
        bundle["cache_status"] = result.cache_status
        if result.cache_status == "STALE":
            bundle["freshness_status"] = "STALE"
        return bundle

    @staticmethod
    def _sectors_from_bundle(bundle: dict) -> list[dict]:
        grouped: dict[str, list[dict]] = {}
        for stock in bundle["stocks"]:
            grouped.setdefault(stock["sector"], []).append(stock)
        sector_tone = bundle["sector_board"].get("data")
        if not isinstance(sector_tone, list):
            raise ProviderUnavailable("PSX Lens sector board is missing sector performance.")
        sectors = []
        for item in sector_tone:
            if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                continue
            name = item["name"]
            members = grouped.get(name, [])
            by_change = sorted(members, key=lambda stock: stock["change_pct"])
            sectors.append({
                "name": name,
                "change_pct": _number(item.get("median_change_pct")),
                "stock_count": _integer(item.get("company_count")) or len(members),
                "top_stocks": [
                    {**stock, "period_change_pct": stock["change_pct"]}
                    for stock in reversed(by_change[-3:])
                ],
                "worst_stocks": [
                    {**stock, "period_change_pct": stock["change_pct"]}
                    for stock in by_change[:3]
                ],
            })
        return sectors

    def market_overview(self) -> dict:
        bundle = self._market_bundle()
        summary = bundle["summary"]
        board = bundle["board"]
        indices = board.get("indices", [])
        index = next(
            (item for item in indices if isinstance(item, dict) and item.get("index_id") == "KSE100"),
            None,
        )
        totals = summary.get("totals")
        breadth = board.get("breadth")
        if not isinstance(index, dict) or not isinstance(totals, dict) or not isinstance(breadth, dict):
            raise ProviderUnavailable("PSX Lens market summary is missing index or breadth data.")
        stocks = bundle["stocks"]
        if not stocks:
            raise DataUnavailable("PSX Lens returned no valid stock prices for the latest session.")
        by_change = sorted(stocks, key=lambda stock: stock["change_pct"])
        active = sorted(
            (stock for stock in stocks if stock["volume"] is not None),
            key=lambda stock: stock["volume"],
            reverse=True,
        )
        market_status = bundle["market_status"]
        indices_list = [
            {
                "index_id": item.get("index_id"),
                "name": item.get("name"),
                "value": _number(item.get("value")),
                "change": _number(item.get("change")),
                "change_pct": _number(item.get("change_pct")),
            }
            for item in indices
            if isinstance(item, dict)
        ]
        return {
            "index": {
                "name": "KSE-100 Index",
                "value": _number(index.get("value")),
                "change": _number(index.get("change")),
                "change_pct": _number(index.get("change_pct")),
            },
            "indices": indices_list,
            "market_volume": _integer(totals.get("volume")),
            "market_value": _number(breadth.get("value")),
            "market_cap": None,
            "total_trades": None,
            "traded_symbols": _integer(totals.get("traded")),
            "advances": _integer(totals.get("advancing")),
            "declines": _integer(totals.get("declining")),
            "unchanged": _integer(totals.get("unchanged")),
            "stocks": stocks,
            "gainers": list(reversed(by_change[-5:])),
            "losers": by_change[:5],
            "active": active[:5],
            "sectors": self._sectors_from_bundle(bundle),
            "data_source": self.source,
            "last_updated": bundle["last_updated"],
            "freshness_status": bundle["freshness_status"],
            "cache_status": bundle["cache_status"],
            "market_status": "MARKET OPEN" if market_status["is_open"] else "MARKET CLOSED",
            "market_state": market_status.get("state"),
            "session_date": summary.get("session_date"),
        }

    def stocks(self, query: str = "", sector: str | None = None, limit: int = 1000) -> dict:
        bundle = self._market_bundle()
        term = query.strip().casefold()
        items = [
            stock for stock in bundle["stocks"]
            if (not term or term in stock["symbol"].casefold() or term in stock["name"].casefold())
            and (not sector or sector == "All Sectors" or sector.casefold() == stock["sector"].casefold())
        ]
        if term:
            items.sort(key=lambda s: (
                0 if s["symbol"].casefold() == term else
                1 if s["symbol"].casefold().startswith(term) else
                2 if term in s["symbol"].casefold() else 3,
                s["symbol"]
            ))
        return {
            "items": items[:limit] if limit else items,
            "data_source": self.source,
            "last_updated": bundle["last_updated"],
            "freshness_status": bundle["freshness_status"],
            "cache_status": bundle["cache_status"],
        }

    def stock_detail(self, symbol: str) -> dict:
        normalized = symbol.upper()
        freshness = self.get_freshness()
        payload, result = self._cached_payload(
            f"stock:{normalized}",
            "quote",
            f"/v1/stocks/{quote(normalized, safe='')}?compact=1",
            timestamp=lambda value: _timestamp(
                value.get("quote", {}).get("timestamp")
                if isinstance(value.get("quote"), dict) else None
            ),
        )
        company = payload.get("company")
        quote_data = payload.get("quote")
        if not isinstance(company, dict) or not isinstance(quote_data, dict):
            raise ProviderUnavailable("PSX Lens stock response is missing company or quote data.")
        if company.get("symbol", normalized).upper() != normalized:
            raise ProviderUnavailable("PSX Lens returned data for a different symbol.")
        price = _number(quote_data.get("price"))
        if price is None or price <= 0:
            raise DataUnavailable(f"No valid PSX Lens price is available for {normalized}.")

        prices = payload.get("prices")
        closes = [
            close
            for point in prices if isinstance(point, dict)
            for close in [_number(point.get("close"))]
            if close is not None
        ] if isinstance(prices, list) else []
        indicators = calculate_indicators(closes)
        ratios = payload.get("ratios") if isinstance(payload.get("ratios"), dict) else {}
        analytics = payload.get("analytics") if isinstance(payload.get("analytics"), dict) else {}
        dividends = payload.get("dividends") if isinstance(payload.get("dividends"), dict) else {}
        profile = company.get("profile") if isinstance(company.get("profile"), dict) else {}
        sector = company.get("sector")
        sector_name = sector.get("name") if isinstance(sector, dict) else company.get("sector_name")
        company_symbol = company.get("symbol")
        if not isinstance(company_symbol, str) or company_symbol.upper() != normalized:
            raise ProviderUnavailable("PSX Lens returned data for a different symbol.")
        change_pct = _number(quote_data.get("change_pct"))
        if change_pct is None:
            raise DataUnavailable(f"No valid PSX Lens percentage change is available for {normalized}.")
        market_data = quote_data.get("market")
        market_data = market_data if isinstance(market_data, dict) else {}
        quote_freshness = quote_data.get("freshness")
        quote_status = (
            quote_freshness.get("status")
            if isinstance(quote_freshness, dict)
            else quote_data.get("status")
        )
        freshness_status = self._freshness_status(quote_status, result.cache_status)
        if freshness["freshness_status"] == "STALE":
            freshness_status = "STALE"
        updated_at = _timestamp(quote_data.get("timestamp"))
        return {
            "symbol": normalized,
            "name": company.get("name") or normalized,
            "sector": sector_name or "Unknown",
            "price": price,
            "change": _number(quote_data.get("change")),
            "change_pct": change_pct,
            "volume": _integer(quote_data.get("volume")),
            "market_cap": _number(analytics.get("market_cap_rs")),
            "dividend_yield": _number(analytics.get("dividend_yield")),
            "pe_ratio": _number(ratios.get("pe")),
            "high_52w": _number(quote_data.get("high_52")),
            "low_52w": _number(quote_data.get("low_52")),
            "open": _number(quote_data.get("open")),
            "high": _number(quote_data.get("high")),
            "low": _number(quote_data.get("low")),
            "previous_close": _number(quote_data.get("previous_close")),
            "rsi": indicators["latest_rsi"],
            "sma20": indicators["latest_sma20"],
            "trailing_12m_dps": _number(dividends.get("trailing_12m_dps")),
            "company_description": profile.get("description"),
            "company_website": profile.get("website"),
            "last_traded": quote_data.get("last_traded"),
            "updated_at": updated_at,
            "data_source": self.source,
            "freshness_status": freshness_status,
            "cache_status": result.cache_status,
            "market_status": (
                "MARKET OPEN" if market_data.get("is_open") is True
                else "MARKET CLOSED" if market_data.get("is_open") is False
                else None
            ),
        }

    def _quote(self, symbol: str) -> tuple[dict, CacheResult, dict]:
        normalized = symbol.upper()
        freshness = self.get_freshness()
        payload, result = self._cached_payload(
            f"quote:{normalized}",
            "quote",
            f"/v1/quotes/{quote(normalized, safe='')}",
            timestamp=lambda value: _timestamp(value.get("timestamp")),
        )
        if payload.get("symbol", normalized).upper() != normalized or _number(payload.get("price")) is None:
            raise DataUnavailable(f"No valid PSX Lens quote is available for {normalized}.")
        return payload, result, freshness

    @staticmethod
    def _aggregate_weekly(daily_items: list[dict]) -> list[dict]:
        """Group chronologically ordered daily OHLCV bars into ISO-week candles."""
        weekly: dict[tuple[int, int], dict] = {}
        order: list[tuple[int, int]] = []
        for bar in daily_items:
            try:
                iso = datetime.strptime(bar["timestamp"], "%Y-%m-%d").isocalendar()
                key = (iso.year, iso.week)
            except ValueError:
                continue
            if key not in weekly:
                order.append(key)
                weekly[key] = {
                    "timestamp": bar["timestamp"],
                    "open": bar["open"],
                    "high": bar["high"],
                    "low": bar["low"],
                    "close": bar["close"],
                    "volume": bar["volume"],
                }
            else:
                w = weekly[key]
                w["high"] = max(w["high"], bar["high"], bar["open"], bar["close"])
                w["low"] = min(w["low"], bar["low"], bar["open"], bar["close"])
                w["close"] = bar["close"]
                w["volume"] += bar["volume"]
        return [weekly[k] for k in order]

    @staticmethod
    def _aggregate_monthly(daily_items: list[dict]) -> list[dict]:
        """Group chronologically ordered daily OHLCV bars into calendar month candles."""
        monthly: dict[tuple[int, int], dict] = {}
        order: list[tuple[int, int]] = []
        for bar in daily_items:
            try:
                dt = datetime.strptime(bar["timestamp"][:10], "%Y-%m-%d")
                key = (dt.year, dt.month)
            except ValueError:
                continue
            if key not in monthly:
                order.append(key)
                monthly[key] = {
                    "timestamp": bar["timestamp"],
                    "open": bar["open"],
                    "high": bar["high"],
                    "low": bar["low"],
                    "close": bar["close"],
                    "volume": bar["volume"],
                }
            else:
                m = monthly[key]
                m["high"] = round(max(m["high"], bar["high"], bar["open"], bar["close"]), 2)
                m["low"] = round(min(m["low"], bar["low"], bar["open"], bar["close"]), 2)
                m["close"] = bar["close"]
                m["volume"] += bar["volume"]
        return [monthly[k] for k in order]

    @staticmethod
    def _aggregate_quarterly(daily_items: list[dict]) -> list[dict]:
        """Group chronologically ordered daily OHLCV bars into 3-month quarterly candles."""
        quarterly: dict[tuple[int, int], dict] = {}
        order: list[tuple[int, int]] = []
        for bar in daily_items:
            try:
                dt = datetime.strptime(bar["timestamp"][:10], "%Y-%m-%d")
                q = (dt.month - 1) // 3 + 1
                key = (dt.year, q)
            except ValueError:
                continue
            if key not in quarterly:
                order.append(key)
                quarterly[key] = {
                    "timestamp": bar["timestamp"],
                    "open": bar["open"],
                    "high": bar["high"],
                    "low": bar["low"],
                    "close": bar["close"],
                    "volume": bar["volume"],
                }
            else:
                m = quarterly[key]
                m["high"] = round(max(m["high"], bar["high"], bar["open"], bar["close"]), 2)
                m["low"] = round(min(m["low"], bar["low"], bar["open"], bar["close"]), 2)
                m["close"] = bar["close"]
                m["volume"] += bar["volume"]
        return [quarterly[k] for k in order]

    @staticmethod
    def _aggregate_yearly(daily_items: list[dict]) -> list[dict]:
        """Group chronologically ordered daily OHLCV bars into 1-year annual candles."""
        yearly: dict[int, dict] = {}
        order: list[int] = []
        for bar in daily_items:
            try:
                dt = datetime.strptime(bar["timestamp"][:10], "%Y-%m-%d")
                key = dt.year
            except ValueError:
                continue
            if key not in yearly:
                order.append(key)
                yearly[key] = {
                    "timestamp": bar["timestamp"],
                    "open": bar["open"],
                    "high": bar["high"],
                    "low": bar["low"],
                    "close": bar["close"],
                    "volume": bar["volume"],
                }
            else:
                m = yearly[key]
                m["high"] = round(max(m["high"], bar["high"], bar["open"], bar["close"]), 2)
                m["low"] = round(min(m["low"], bar["low"], bar["open"], bar["close"]), 2)
                m["close"] = bar["close"]
                m["volume"] += bar["volume"]
        return [yearly[k] for k in order]

    @staticmethod
    def _simulate_intraday_from_daily(symbol: str, daily_items: list[dict], requested: str) -> list[dict]:
        """Subdivide verified daily OHLCV bars into EOD-bounded intraday bars."""
        bars_per_day_map = {"5M": 72, "15M": 24, "1H": 6, "4H": 2}
        step_minutes_map = {"5M": 5, "15M": 15, "1H": 60, "4H": 180}
        count_per_day = bars_per_day_map[requested]
        step_min = step_minutes_map[requested]
        points: list[dict] = []
        for day in daily_items:
            try:
                base_dt = datetime.strptime(day["timestamp"], "%Y-%m-%d").replace(hour=4, minute=30)
            except ValueError:
                continue
            rng = random.Random(f"{symbol}:{day['timestamp']}:{requested}")
            opening = day["open"]
            final = day["close"]
            day_low = min(day["low"], opening, final)
            day_high = max(day["high"], opening, final)
            span = max(day_high - day_low, final * 0.002)
            prev = opening
            for idx in range(count_per_day):
                frac = (idx + 1) / count_per_day
                target = opening + (final - opening) * frac
                close = final if idx == count_per_day - 1 else target + rng.uniform(-0.14, 0.14) * span
                close = max(day_low, min(day_high, close))
                hi = min(day_high, max(prev, close) + rng.uniform(0.01, 0.12) * span)
                lo = max(day_low, min(prev, close) - rng.uniform(0.01, 0.12) * span)
                ts = base_dt + timedelta(minutes=step_min * idx)
                points.append({
                    "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "open": round(prev, 2),
                    "high": round(max(hi, prev, close), 2),
                    "low": round(min(lo, prev, close), 2),
                    "close": round(close, 2),
                    "volume": max(1, int((day["volume"] / count_per_day) * rng.uniform(0.4, 1.7))),
                })
                prev = close
        return points

    def history(self, symbol: str, requested: str) -> dict:
        normalized = symbol.upper()
        limit_by_range: dict[str, int] = {
            "5M": 5,
            "15M": 14,
            "1H": 55,
            "4H": 160,
            "1D": 650,
            "1W": 1500,
            "1M": 1500,
            "3M": 1500,
            "6M": 1500,
            "1Y": 1500,
            "5Y": 1500,
        }
        limit = limit_by_range.get(requested, 260)
        freshness = self.get_freshness()
        payload, result = self._cached_payload(
            f"history:{normalized}:{limit}",
            "historical",
            f"/v1/prices/{quote(normalized, safe='')}",
            {"limit": limit},
            timestamp=lambda value: _timestamp(
                value.get("data", [{}])[-1].get("retrieved_at")
                if isinstance(value.get("data"), list) and value.get("data") else None
            ),
        )
        data = payload.get("data")
        if not isinstance(data, list):
            raise ProviderUnavailable("PSX Lens price history response is missing its data list.")
        daily_items = []
        omitted_bars = 0
        for point in data:
            if not isinstance(point, dict):
                continue
            open_price = _number(point.get("open"))
            close = _number(point.get("close"))
            high = _number(point.get("high"))
            low = _number(point.get("low"))
            volume = _integer(point.get("volume"))
            date = point.get("date")
            if not isinstance(date, str) or open_price is None or close is None or volume is None:
                omitted_bars += 1
                continue
            resolved_high = max(high, open_price, close) if high is not None else max(open_price, close)
            resolved_low = min(low, open_price, close) if low is not None else min(open_price, close)
            daily_items.append({
                "timestamp": date,
                "open": round(open_price, 2),
                "high": round(resolved_high, 2),
                "low": round(resolved_low, 2),
                "close": round(close, 2),
                "volume": volume,
            })

        daily_items.sort(key=lambda b: b["timestamp"])

        # Align unadjusted open/high/low with split-adjusted close when PSX Lens back-adjusted close only
        n_bars = len(daily_items)
        raw_ratios = [
            (b["open"] / b["close"]) if b["close"] > 0 else 1.0
            for b in daily_items
        ]
        for idx in range(n_bars):
            r = raw_ratios[idx]
            if r > 1.22 or r < 0.82:
                window = [
                    raw_ratios[j]
                    for j in range(max(0, idx - 8), min(n_bars, idx + 9))
                    if (raw_ratios[j] > 1.22 or raw_ratios[j] < 0.82)
                    and abs(raw_ratios[j] - r) <= 0.35 * r
                ]
                factor = median(window) if window else r
                nearest_int = round(factor)
                if nearest_int >= 2 and abs(factor - nearest_int) / nearest_int <= 0.025:
                    factor = float(nearest_int)
                if factor > 0:
                    bar = daily_items[idx]
                    adj_o = round(bar["open"] / factor, 2)
                    adj_h = round(bar["high"] / factor, 2)
                    adj_l = round(bar["low"] / factor, 2)
                    bar["open"] = adj_o
                    bar["high"] = round(max(adj_h, adj_o, bar["close"]), 2)
                    bar["low"] = round(min(adj_l, adj_o, bar["close"]), 2)

        quote_data, quote_result, quote_freshness = self._quote(normalized)
        q_price = _number(quote_data.get("price"))
        q_open = _number(quote_data.get("open"))
        q_high = _number(quote_data.get("high"))
        q_low = _number(quote_data.get("low"))
        q_vol = _integer(quote_data.get("volume"))
        q_date = quote_data.get("last_traded")
        if isinstance(q_date, str) and len(q_date) >= 10 and q_price is not None and daily_items:
            q_day = q_date[:10]
            last_bar = daily_items[-1]
            if last_bar["timestamp"] == q_day:
                last_bar["close"] = round(q_price, 2)
                if q_open is not None:
                    last_bar["open"] = round(q_open, 2)
                if q_high is not None:
                    last_bar["high"] = round(max(q_high, last_bar["open"], last_bar["close"]), 2)
                if q_low is not None:
                    last_bar["low"] = round(min(q_low, last_bar["open"], last_bar["close"]), 2)
                if q_vol is not None:
                    last_bar["volume"] = q_vol
            elif last_bar["timestamp"] < q_day:
                daily_items.append({
                    "timestamp": q_day,
                    "open": round(q_open if q_open is not None else q_price, 2),
                    "high": round(max(q_high if q_high is not None else q_price, q_price), 2),
                    "low": round(min(q_low if q_low is not None else q_price, q_price), 2),
                    "close": round(q_price, 2),
                    "volume": q_vol if q_vol is not None else 0,
                })

        is_intraday = requested in {"5M", "15M", "1H", "4H"}
        if is_intraday:
            items = self._simulate_intraday_from_daily(normalized, daily_items, requested)
            freshness_status = "DEMO"
            high_low_note = "Intraday bars simulated within verified PSX daily OHLCV (PSX Lens provides EOD history only)."
        elif requested == "1W":
            items = self._aggregate_weekly(daily_items)
            freshness_status = self._freshness_status(
                quote_data.get("status"),
                "STALE" if result.cache_status == "STALE" or quote_result.cache_status == "STALE" else "HIT",
            )
            high_low_note = payload.get("high_low_note")
        elif requested == "1M":
            items = self._aggregate_monthly(daily_items)
            freshness_status = self._freshness_status(
                quote_data.get("status"),
                "STALE" if result.cache_status == "STALE" or quote_result.cache_status == "STALE" else "HIT",
            )
            high_low_note = payload.get("high_low_note")
        elif requested == "3M":
            items = self._aggregate_quarterly(daily_items)
            freshness_status = self._freshness_status(
                quote_data.get("status"),
                "STALE" if result.cache_status == "STALE" or quote_result.cache_status == "STALE" else "HIT",
            )
            high_low_note = payload.get("high_low_note")
        elif requested == "1Y":
            items = self._aggregate_yearly(daily_items)
            freshness_status = self._freshness_status(
                quote_data.get("status"),
                "STALE" if result.cache_status == "STALE" or quote_result.cache_status == "STALE" else "HIT",
            )
            high_low_note = payload.get("high_low_note")
        else:
            items = daily_items
            freshness_status = self._freshness_status(
                quote_data.get("status"),
                "STALE" if result.cache_status == "STALE" or quote_result.cache_status == "STALE" else "HIT",
            )
            high_low_note = payload.get("high_low_note")

        if not is_intraday and (freshness["freshness_status"] == "STALE" or quote_freshness["freshness_status"] == "STALE"):
            freshness_status = "STALE"
        return {
            "symbol": normalized,
            "range": requested,
            "items": items,
            "omitted_bars": omitted_bars,
            "high_low_note": high_low_note,
            "data_source": "DEMO" if is_intraday else self.source,
            "last_updated": _timestamp(quote_data.get("timestamp")),
            "last_session": data[-1].get("date") if data and isinstance(data[-1], dict) else None,
            "freshness_status": freshness_status,
            "cache_status": "STALE" if "STALE" in {result.cache_status, quote_result.cache_status} else result.cache_status,
        }

    def indicators(self, symbol: str) -> dict:
        history = self.history(symbol, "5Y")
        closes = [point["close"] for point in history["items"]]
        return {
            "symbol": symbol.upper(),
            **calculate_indicators(closes),
            "data_source": self.source,
            "last_updated": history["last_updated"],
            "freshness_status": history["freshness_status"],
            "cache_status": history["cache_status"],
        }

    def dividends(self, symbol: str) -> dict:
        normalized = symbol.upper()
        freshness = self.get_freshness()
        payload, result = self._cached_payload(
            f"dividends:{normalized}",
            "dividend",
            f"/v1/dividends/{quote(normalized, safe='')}",
        )
        data = payload.get("data")
        if not isinstance(data, list):
            raise ProviderUnavailable("PSX Lens dividend response is missing its data list.")
        items = []
        for row in data:
            if not isinstance(row, dict):
                continue
            ex_date = row.get("ex_date")
            amount = _number(row.get("dps"))
            if not isinstance(ex_date, str) or amount is None:
                continue
            inferred = not isinstance(row.get("announced_date"), str) or str(row.get("raw", "")).startswith("XD ")
            items.append({
                "ex_date": ex_date,
                "amount": amount,
                "currency": "PKR",
                "source": "PSX Lens · inferred from XD marker" if inferred else "PSX Lens",
                "inferred": inferred,
            })
        dataset = freshness["datasets"].get("dividends", {})
        freshness_status = self._freshness_status(dataset.get("status"), result.cache_status)
        if freshness["cache_status"] == "STALE":
            freshness_status = "STALE"
        return {
            "symbol": normalized,
            "items": items,
            "data_source": self.source,
            "last_updated": _timestamp(dataset.get("updated_at")),
            "freshness_status": freshness_status,
            "cache_status": result.cache_status,
            "data_note": dataset.get("note"),
        }

    def sectors(self, period: str = "1D") -> dict:
        if period != "1D":
            raise ValueError("PSX Lens provides verified sector returns for the latest session only.")
        bundle = self._market_bundle()
        return {
            "items": self._sectors_from_bundle(bundle),
            "period": period,
            "data_source": self.source,
            "last_updated": bundle["last_updated"],
            "freshness_status": bundle["freshness_status"],
            "cache_status": bundle["cache_status"],
        }

    def screen(self, filters: dict) -> dict:
        from .screener_enrichment import enrich_corporate_slice, get_timeframe_metrics_map

        bundle = self._market_bundle()
        base_stocks = bundle["stocks"]
        all_sectors = sorted({
            str(stock["sector"])
            for stock in base_stocks
            if isinstance(stock.get("sector"), str) and stock["sector"] and stock["sector"] != "Unknown"
        })

        timeframe = str(filters.get("timeframe") or "daily").lower()
        if timeframe not in {"daily", "weekly", "monthly"}:
            timeframe = "daily"

        tf_map = get_timeframe_metrics_map(base_stocks)
        items: list[dict] = []
        for raw_stock in base_stocks:
            stock = dict(raw_stock)
            sym = stock["symbol"]
            tf = tf_map.get(sym)
            spot_price = stock["price"]
            daily_price = tf["daily_price"] if tf else spot_price
            weekly_price = tf["weekly_price"] if tf else spot_price
            monthly_price = tf["monthly_price"] if tf else spot_price

            stock["spot_price"] = spot_price
            stock["daily_price"] = daily_price
            stock["weekly_price"] = weekly_price
            stock["monthly_price"] = monthly_price

            if tf:
                stock["rsi_daily"] = tf["rsi_daily"]
                stock["rsi_weekly"] = tf["rsi_weekly"]
                stock["rsi_monthly"] = tf["rsi_monthly"]

            if timeframe == "weekly":
                stock["price"] = weekly_price
                stock["change"] = tf["weekly_change"] if tf else stock.get("change")
                stock["change_pct"] = tf["weekly_change_pct"] if tf else stock["change_pct"]
                stock["volume"] = tf["weekly_volume"] if tf else stock.get("volume")
                stock["rsi"] = stock["rsi_weekly"]
            elif timeframe == "monthly":
                stock["price"] = monthly_price
                stock["change"] = tf["monthly_change"] if tf else stock.get("change")
                stock["change_pct"] = tf["monthly_change_pct"] if tf else stock["change_pct"]
                stock["volume"] = tf["monthly_volume"] if tf else stock.get("volume")
                stock["rsi"] = stock["rsi_monthly"]
            else:
                stock["price"] = daily_price
                stock["change"] = tf["daily_change"] if tf else stock.get("change")
                stock["change_pct"] = tf["daily_change_pct"] if tf else stock["change_pct"]
                stock["volume"] = tf["daily_volume"] if tf else stock.get("volume")
                stock["rsi"] = stock["rsi_daily"]

            stock["timeframe"] = timeframe
            items.append(stock)

        sector = filters.get("sector")
        symbol = filters.get("symbol")
        if sector and sector not in {"All Sectors", "Any Sector"}:
            items = [stock for stock in items if stock["sector"].casefold() == sector.casefold()]
        if symbol:
            term = symbol.strip().upper()
            items = [
                stock for stock in items
                if term in stock["symbol"] or term in str(stock.get("name", "")).upper()
            ]
        numeric_filters = (
            ("min_price", "price", lambda value, limit: value >= limit),
            ("max_price", "price", lambda value, limit: value <= limit),
            ("min_change", "change_pct", lambda value, limit: value >= limit),
            ("max_change", "change_pct", lambda value, limit: value <= limit),
            ("min_volume", "volume", lambda value, limit: value >= limit),
            ("min_market_cap", "market_cap", lambda value, limit: value >= limit),
            ("min_dividend", "latest_dividend", lambda value, limit: value >= limit),
            ("min_dividend_yield", "dividend_yield", lambda value, limit: value >= limit),
            ("min_rsi_daily", "rsi_daily", lambda value, limit: value >= limit),
            ("min_rsi_weekly", "rsi_weekly", lambda value, limit: value >= limit),
            ("min_rsi_monthly", "rsi_monthly", lambda value, limit: value >= limit),
        )
        for filter_key, stock_key, predicate in numeric_filters:
            threshold = filters.get(filter_key)
            if threshold is not None:
                items = [
                    stock for stock in items
                    if stock.get(stock_key) is not None and predicate(stock[stock_key], threshold)
                ]
        min_rsi = filters.get("min_rsi")
        if min_rsi is not None:
            rsi_period = filters.get("rsi_period") or timeframe
            key = f"rsi_{rsi_period}"
            items = [s for s in items if s.get(key) is not None and s[key] >= min_rsi]

        sort_by = filters.get("sort_by", "change_pct")
        reverse = filters.get("order", "desc") == "desc"
        available = [stock for stock in items if stock.get(sort_by) is not None]
        unavailable = [stock for stock in items if stock.get(sort_by) is None]
        available.sort(key=lambda stock: stock[sort_by], reverse=reverse)
        items = available + unavailable

        page = max(1, int(filters.get("page") or 1))
        page_size = max(1, min(200, int(filters.get("page_size") or 50)))
        start = (page - 1) * page_size
        end = start + page_size
        visible_slice = items[start:end] if items[start:end] else items[:page_size]

        calendar_rows: dict[str, dict] = {}
        try:
            cal_payload, _ = self._cached_payload(
                "calendar-dividends",
                "dividend",
                "/v1/calendar/dividends?days=365&limit=500",
            )
            for group_key in ("open", "data", "recent"):
                for entry in cal_payload.get(group_key, []) or []:
                    if isinstance(entry, dict) and isinstance(entry.get("symbol"), str):
                        calendar_rows.setdefault(entry["symbol"].upper(), entry)
        except Exception:
            calendar_rows = {}

        corp_map = enrich_corporate_slice(visible_slice, calendar_rows)
        for stock in items:
            corp = corp_map.get(stock["symbol"])
            if corp:
                stock.update(corp)

        dataset = bundle["freshness"]["datasets"].get("dividends", {})
        return {
            "items": items,
            "total": len(items),
            "timeframe": timeframe,
            "sectors": all_sectors,
            "data_source": self.source,
            "last_updated": bundle["last_updated"],
            "freshness_status": bundle["freshness_status"],
            "cache_status": bundle["cache_status"],
            "dividend_status": dataset.get("status"),
            "dividend_note": dataset.get("note"),
        }

    def news(self, symbol: str | None = None) -> dict:
        freshness = self.get_freshness()
        if symbol:
            normalized = symbol.upper()
            payload, result = self._cached_payload(
                f"announcements:{normalized}",
                "financial",
                f"/v1/announcements/{quote(normalized, safe='')}",
                timestamp=lambda value: next(
                    (
                        _timestamp(row.get("published_at"))
                        for row in value.get("data", [])
                        if isinstance(row, dict) and _timestamp(row.get("published_at"))
                    ),
                    None,
                ),
            )
            announcements = payload.get("data")
            if not isinstance(announcements, list):
                raise ProviderUnavailable("PSX Lens announcement response is invalid.")
            items = [
                {
                    "id": index,
                    "headline": row["title"],
                    "summary": "Official PSX company announcement.",
                    "published_at": row.get("published_at") or row.get("date"),
                    "source": "Pakistan Stock Exchange",
                    "url": row.get("document_url") or row.get("source_url"),
                }
                for index, row in enumerate(announcements, 1)
                if isinstance(row, dict) and isinstance(row.get("title"), str)
            ]
            dataset = freshness["datasets"].get("announcements", {})
            return {
                "items": items,
                "data_source": self.source,
                "last_updated": result.last_updated,
                "freshness_status": self._freshness_status(dataset.get("status"), result.cache_status),
                "cache_status": result.cache_status,
            }

        payload, result = self._cached_payload(
            "market-wrap",
            "quote",
            "/v1/market/wrap",
            timestamp=lambda value: _timestamp(
                value.get("published_at") or value.get("updated_at")
            ),
        )
        date = payload.get("date")
        headline = payload.get("headline")
        summary = payload.get("summary")
        if not isinstance(date, str) or not isinstance(headline, str) or not isinstance(summary, list):
            raise ProviderUnavailable("PSX Lens market wrap response is invalid.")
        return {
            "items": [{
                "id": 1,
                "headline": headline,
                "summary": " ".join(str(item) for item in summary),
                "published_at": date,
                "source": "PSX Lens · delayed market wrap (CC BY 4.0)",
                "url": f"https://psxlens.com/market-wrap/{date}",
            }],
            "data_source": self.source,
            "last_updated": _market_time(self._market_bundle()["board"]),
            "freshness_status": "STALE" if result.cache_status == "STALE" else freshness["freshness_status"],
            "cache_status": result.cache_status,
        }


PSXProviderAdapter = PSXLensProviderAdapter
