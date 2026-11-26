"""Timeframe OHLCV metrics and corporate announcement/dividend enrichment for the Screener."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from .indicators import calculate_indicators

logger = logging.getLogger(__name__)

_PKT = timezone(timedelta(hours=5))
_CACHE_DIR = Path(__file__).resolve().parents[2]
_TF_CACHE_FILE = _CACHE_DIR / ".screener_tf_cache.json"
_CORP_CACHE_FILE = _CACHE_DIR / ".screener_corp_cache.json"

_TF_TTL_SECONDS = 4 * 3600
_CORP_TTL_SECONDS = 12 * 3600

_tf_lock = threading.RLock()
_corp_lock = threading.RLock()
_memory_tf_cache: dict[str, Any] | None = None
_memory_corp_cache: dict[str, dict[str, Any]] | None = None
_warm_started = False


def _pkt_today() -> str:
    return datetime.now(_PKT).strftime("%Y-%m-%d")


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _integer(value: Any) -> int | None:
    num = _number(value)
    return None if num is None else int(round(num))


def _base_url() -> str:
    return os.getenv("PSX_LENS_BASE_URL", "https://api.psxlens.com").rstrip("/")


def _client() -> httpx.Client:
    return httpx.Client(
        base_url=_base_url(),
        headers={"User-Agent": "ProfessorStocks/1.0"},
        timeout=25.0,
    )


def _compute_symbol_timeframes(
    bars: list[dict[str, Any]],
    spot_price: float,
    spot_change: float | None,
    spot_change_pct: float,
    spot_volume: int | None,
    last_traded: str | None,
) -> dict[str, Any]:
    """Compute genuine Daily, Weekly, and Monthly metrics from historical OHLCV bars."""
    cleaned: list[dict[str, Any]] = []
    for point in bars:
        if not isinstance(point, dict):
            continue
        date = point.get("date")
        close = _number(point.get("close"))
        vol = _integer(point.get("volume"))
        if not isinstance(date, str) or close is None or close <= 0:
            continue
        cleaned.append({
            "date": date[:10],
            "close": round(close, 2),
            "volume": max(0, vol or 0),
        })

    cleaned.sort(key=lambda b: b["date"])

    # Ensure the latest session aligns with the live/delayed quote snapshot
    day_str = last_traded[:10] if isinstance(last_traded, str) and len(last_traded) >= 10 else None
    if day_str:
        if cleaned and cleaned[-1]["date"] == day_str:
            cleaned[-1]["close"] = round(spot_price, 2)
            if spot_volume is not None:
                cleaned[-1]["volume"] = max(0, spot_volume)
        elif not cleaned or day_str > cleaned[-1]["date"]:
            cleaned.append({
                "date": day_str,
                "close": round(spot_price, 2),
                "volume": max(0, spot_volume or 0),
            })

    dc = [b["close"] for b in cleaned]
    dv = [b["volume"] for b in cleaned]

    daily_price = round(spot_price, 2)
    daily_change = (
        round(spot_change, 2)
        if spot_change is not None
        else (round(dc[-1] - dc[-2], 2) if len(dc) >= 2 else None)
    )
    daily_change_pct = round(spot_change_pct, 2)
    daily_volume = spot_volume if spot_volume is not None else (dv[-1] if dv else None)
    rsi_daily = calculate_indicators(dc)["latest_rsi"] if len(dc) >= 15 else None

    if len(dc) >= 5:
        w_slice = dc[-5:]
        w_vol_slice = dv[-5:]
        weekly_price = round(sum(w_slice) / len(w_slice), 2)
        w_ref = dc[-6] if len(dc) >= 6 else dc[0]
        weekly_change = round(dc[-1] - w_ref, 2)
        weekly_change_pct = round(((dc[-1] - w_ref) / w_ref) * 100, 2) if w_ref > 0 else 0.0
        weekly_volume = sum(w_vol_slice)
    else:
        weekly_price = daily_price
        weekly_change = daily_change
        weekly_change_pct = daily_change_pct
        weekly_volume = daily_volume

    weekly_map: dict[tuple[int, int], float] = {}
    weekly_order: list[tuple[int, int]] = []
    for bar in cleaned:
        try:
            iso = datetime.strptime(bar["date"], "%Y-%m-%d").isocalendar()
            key = (iso.year, iso.week)
        except ValueError:
            continue
        if key not in weekly_map:
            weekly_order.append(key)
        weekly_map[key] = bar["close"]
    weekly_closes = [weekly_map[k] for k in weekly_order]
    rsi_weekly = calculate_indicators(weekly_closes)["latest_rsi"] if len(weekly_closes) >= 15 else None

    if len(dc) >= 10:
        m_slice = dc[-21:]
        m_vol_slice = dv[-21:]
        monthly_price = round(sum(m_slice) / len(m_slice), 2)
        m_ref = dc[-22] if len(dc) >= 22 else dc[0]
        monthly_change = round(dc[-1] - m_ref, 2)
        monthly_change_pct = round(((dc[-1] - m_ref) / m_ref) * 100, 2) if m_ref > 0 else 0.0
        monthly_volume = sum(m_vol_slice)
    else:
        monthly_price = daily_price
        monthly_change = daily_change
        monthly_change_pct = daily_change_pct
        monthly_volume = daily_volume

    monthly_map: dict[str, float] = {}
    monthly_order: list[str] = []
    for bar in cleaned:
        ym = bar["date"][:7]
        if ym not in monthly_map:
            monthly_order.append(ym)
        monthly_map[ym] = bar["close"]
    monthly_closes = [monthly_map[k] for k in monthly_order]
    rsi_monthly = calculate_indicators(monthly_closes)["latest_rsi"] if len(monthly_closes) >= 15 else None

    return {
        "daily_price": daily_price,
        "daily_change": daily_change,
        "daily_change_pct": daily_change_pct,
        "daily_volume": daily_volume,
        "rsi_daily": rsi_daily,
        "weekly_price": weekly_price,
        "weekly_change": weekly_change,
        "weekly_change_pct": weekly_change_pct,
        "weekly_volume": weekly_volume,
        "rsi_weekly": rsi_weekly,
        "monthly_price": monthly_price,
        "monthly_change": monthly_change,
        "monthly_change_pct": monthly_change_pct,
        "monthly_volume": monthly_volume,
        "rsi_monthly": rsi_monthly,
    }


def _read_disk_json(path: Path) -> dict[str, Any] | None:
    try:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return None


def _write_disk_json(path: Path, payload: dict[str, Any]) -> None:
    try:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        tmp.replace(path)
    except Exception as exc:
        logger.debug("Could not write cache file %s: %s", path.name, exc)


def get_timeframe_metrics_map(stocks: list[dict[str, Any]], blocking: bool = True) -> dict[str, dict[str, Any]]:
    """Return cached timeframe metrics per symbol, loading batched /v1/prices once per session."""
    global _memory_tf_cache
    now = time.time()
    today = _pkt_today()

    with _tf_lock:
        if _memory_tf_cache is None:
            disk = _read_disk_json(_TF_CACHE_FILE)
            if disk and isinstance(disk.get("symbols"), dict):
                _memory_tf_cache = disk

        cache_ok = (
            _memory_tf_cache is not None
            and (now - float(_memory_tf_cache.get("fetched_at", 0))) < _TF_TTL_SECONDS
            and _memory_tf_cache.get("session_date") == today
        )
        if cache_ok and _memory_tf_cache is not None:
            return _memory_tf_cache["symbols"]

        if not blocking and _memory_tf_cache and isinstance(_memory_tf_cache.get("symbols"), dict):
            return _memory_tf_cache["symbols"]

        by_sym = {s["symbol"]: s for s in stocks if isinstance(s.get("symbol"), str)}
        symbols = list(by_sym.keys())
        if not symbols:
            return {}

        chunks = [symbols[i:i + 25] for i in range(0, len(symbols), 25)]
        bars_by_symbol: dict[str, list[dict[str, Any]]] = {}

        try:
            with _client() as client:
                def fetch_chunk(chunk: list[str]) -> dict[str, Any]:
                    resp = client.get(
                        "/v1/prices",
                        params={"symbols": ",".join(chunk), "limit": 500},
                    )
                    resp.raise_for_status()
                    return resp.json()

                with ThreadPoolExecutor(max_workers=6) as pool:
                    for payload in pool.map(fetch_chunk, chunks):
                        data_map = payload.get("data") if isinstance(payload, dict) else None
                        if not isinstance(data_map, dict):
                            continue
                        for sym, item in data_map.items():
                            if isinstance(item, dict) and isinstance(item.get("data"), list):
                                bars_by_symbol[sym.upper()] = item["data"]
        except Exception as exc:
            logger.warning("Screener batched price enrichment fell back cleanly: %s", exc)
            if _memory_tf_cache and isinstance(_memory_tf_cache.get("symbols"), dict):
                return _memory_tf_cache["symbols"]
            return {}

        metrics_map: dict[str, dict[str, Any]] = {}
        for sym, stock in by_sym.items():
            bars = bars_by_symbol.get(sym, [])
            if not bars:
                continue
            metrics_map[sym] = _compute_symbol_timeframes(
                bars=bars,
                spot_price=float(stock["price"]),
                spot_change=_number(stock.get("change")),
                spot_change_pct=float(stock["change_pct"]),
                spot_volume=_integer(stock.get("volume")),
                last_traded=stock.get("last_traded"),
            )

        _memory_tf_cache = {
            "fetched_at": now,
            "session_date": today,
            "symbols": metrics_map,
        }
        _write_disk_json(_TF_CACHE_FILE, _memory_tf_cache)
        return metrics_map


def _is_financial_results_title(title: str) -> bool:
    tl = title.lower()
    if any(bad in tl for bad in ("revoked", "other than financial", "rescheduled", "postponed", "board meeting")):
        return False
    return any(
        kw in tl
        for kw in (
            "financial result",
            "financial results",
            "quarterly report",
            "annual report",
            "half year ended",
            "nine months ended",
            "quarter ended",
            "year ended",
            "condensed interim",
            "accounts for the",
        )
    )


def _is_upcoming_dividend_declaration(title: str) -> bool:
    tl = title.lower()
    if any(bad in tl for bad in ("credit of", "unclaimed", "revoked", "advertisement", "despatch", "dispatch", "physical")):
        return False
    return any(
        kw in tl
        for kw in (
            "interim cash dividend",
            "final cash dividend",
            "cash dividend",
            "declaration of dividend",
            "book closure",
        )
    )


def _is_upcoming_results_bm(title: str) -> bool:
    tl = title.lower()
    if any(bad in tl for bad in ("other than financial", "revoked", "postponed", "in progress")):
        return False
    return "board meeting" in tl or "closed period" in tl


def extract_corporate_info(
    symbol: str,
    dividends_payload: dict[str, Any] | None,
    announcements: list[dict[str, Any]],
    calendar_row: dict[str, Any] | None,
    stock: dict[str, Any],
    today_str: str | None = None,
) -> dict[str, Any]:
    """Build exact Last/Next Dividend and Last/Next Earning Date fields without guessing."""
    today = today_str or _pkt_today()
    history = dividends_payload.get("history") if isinstance(dividends_payload, dict) else []
    history = [row for row in (history or []) if isinstance(row, dict)]
    history.sort(key=lambda r: str(r.get("ex_date") or r.get("announced_date") or ""), reverse=True)

    last_div_amount: float | None = None
    last_div_date: str | None = None
    last_div_note: str | None = None
    next_div_amount: float | None = None
    next_div_date: str | None = None
    next_div_note: str | None = None

    # Calendar upcoming payout (highest authority when scheduled)
    if isinstance(calendar_row, dict):
        cal_date = calendar_row.get("ex_date") or calendar_row.get("last_buy_date")
        if isinstance(cal_date, str) and cal_date >= today:
            next_div_date = cal_date
            next_div_amount = _number(calendar_row.get("dps"))
            next_div_note = "Ex-Date"

    past_divs = []
    future_divs = []
    for row in history:
        ex_d = row.get("ex_date")
        ann_d = row.get("announced_date")
        d = ex_d if isinstance(ex_d, str) else (ann_d if isinstance(ann_d, str) else "")
        if d and d > today:
            future_divs.append((d, row))
        else:
            past_divs.append((d, row))

    if not next_div_date and future_divs:
        d, row = future_divs[-1]
        next_div_date = d
        next_div_amount = _number(row.get("dps"))
        next_div_note = "Upcoming Ex-Date"

    if past_divs:
        d, latest = past_divs[0]
        last_div_date = d or None
        last_div_amount = _number(latest.get("dps"))
        last_div_note = latest.get("raw") if isinstance(latest.get("raw"), str) else None
        if last_div_amount is None:
            for _, older in past_divs:
                cand = _number(older.get("dps"))
                if cand is not None:
                    last_div_amount = cand
                    break
            if last_div_amount is None:
                last_div_amount = _number((dividends_payload or {}).get("trailing_12m_dps")) or _number(stock.get("latest_dividend"))
                if last_div_amount is not None and not last_div_note:
                    last_div_note = "12M DPS"
    else:
        t12 = _number(stock.get("latest_dividend"))
        if t12 is not None and t12 > 0:
            last_div_amount = t12
            last_div_note = "Trailing 12M"

    clean_anns = [a for a in announcements if isinstance(a, dict) and isinstance(a.get("title"), str)]
    clean_anns.sort(key=lambda a: str(a.get("date") or a.get("published_at") or ""), reverse=True)

    # Check recently declared dividend announcement if not already slated above
    if not next_div_date:
        cutoff_14d = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=14)).strftime("%Y-%m-%d")
        for ann in clean_anns:
            adate = str(ann.get("date") or "")[:10]
            if adate >= cutoff_14d and _is_upcoming_dividend_declaration(ann["title"]):
                if not last_div_date or adate > last_div_date:
                    next_div_date = adate
                    next_div_note = "Declared"
                    break

    last_earning_date: str | None = None
    last_earning_note: str | None = None
    for ann in clean_anns:
        adate = str(ann.get("date") or ann.get("published_at") or "")[:10]
        if adate and adate <= today and _is_financial_results_title(ann["title"]):
            last_earning_date = adate
            last_earning_note = ann["title"]
            break

    next_earning_date: str | None = None
    next_earning_note: str | None = None
    cutoff_14d = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=14)).strftime("%Y-%m-%d")
    for ann in clean_anns:
        ev = ann.get("event_date")
        adate = str(ann.get("date") or "")[:10]
        title = ann["title"]
        if isinstance(ev, str) and ev[:10] >= today and ("board" in title.lower() or "financial" in title.lower() or "result" in title.lower()):
            next_earning_date = ev[:10]
            next_earning_note = title
            break
        if adate >= cutoff_14d and (not last_earning_date or adate > last_earning_date) and _is_upcoming_results_bm(title):
            next_earning_date = adate
            next_earning_note = "Board Meeting Notice"
            break

    return {
        "last_dividend_amount": last_div_amount,
        "last_dividend_date": last_div_date,
        "last_dividend_note": last_div_note,
        "next_dividend_amount": next_div_amount,
        "next_dividend_date": next_div_date,
        "next_dividend_note": next_div_note,
        "last_earning_date": last_earning_date,
        "last_earning_note": last_earning_note,
        "next_earning_date": next_earning_date,
        "next_earning_note": next_earning_note,
    }


def enrich_corporate_slice(
    target_stocks: list[dict[str, Any]],
    calendar_rows: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """Enrich visible screener stocks with real announcements and dividends, cached on disk."""
    global _memory_corp_cache
    now = time.time()

    with _corp_lock:
        if _memory_corp_cache is None:
            disk = _read_disk_json(_CORP_CACHE_FILE)
            _memory_corp_cache = disk.get("symbols", {}) if disk and isinstance(disk.get("symbols"), dict) else {}

        missing = [
            s for s in target_stocks
            if isinstance(s.get("symbol"), str)
            and (
                s["symbol"] not in _memory_corp_cache
                or (now - float(_memory_corp_cache[s["symbol"]].get("_fetched_at", 0))) >= _CORP_TTL_SECONDS
            )
        ]

    if missing:
        cal_map = calendar_rows or {}
        fetched: dict[str, dict[str, Any]] = {}
        try:
            with _client() as client:
                def load_one(stock: dict[str, Any]) -> tuple[str, dict[str, Any]]:
                    sym = stock["symbol"]
                    ann_resp = client.get(f"/v1/announcements/{sym}", params={"limit": 15})
                    anns = ann_resp.json().get("data", []) if ann_resp.status_code == 200 else []
                    div_payload = None
                    if stock.get("latest_dividend") is not None or stock.get("dividend_yield") is not None or stock.get("ex_dividend"):
                        div_resp = client.get(f"/v1/dividends/{sym}")
                        if div_resp.status_code == 200:
                            div_payload = div_resp.json()
                    info = extract_corporate_info(
                        symbol=sym,
                        dividends_payload=div_payload,
                        announcements=anns if isinstance(anns, list) else [],
                        calendar_row=cal_map.get(sym),
                        stock=stock,
                    )
                    info["_fetched_at"] = now
                    return sym, info

                with ThreadPoolExecutor(max_workers=10) as pool:
                    for sym, info in pool.map(load_one, missing):
                        fetched[sym] = info
        except Exception as exc:
            logger.warning("Corporate screener enrichment degraded cleanly: %s", exc)

        if fetched:
            with _corp_lock:
                if _memory_corp_cache is None:
                    _memory_corp_cache = {}
                _memory_corp_cache.update(fetched)
                _write_disk_json(_CORP_CACHE_FILE, {"symbols": _memory_corp_cache})

    with _corp_lock:
        cache = _memory_corp_cache or {}
        return {
            s["symbol"]: {k: v for k, v in cache[s["symbol"]].items() if not k.startswith("_")}
            for s in target_stocks
            if s.get("symbol") in cache
        }


def warm_screener_background(stocks: list[dict[str, Any]]) -> None:
    """Warm full-market OHLCV screener cache once in the background without blocking startup."""
    global _warm_started
    if _warm_started or not stocks:
        return
    _warm_started = True

    def runner() -> None:
        try:
            get_timeframe_metrics_map(stocks, blocking=True)
        except Exception as exc:
            logger.debug("Background screener warm skipped: %s", exc)

    threading.Thread(target=runner, daemon=True, name="screener-warm").start()
