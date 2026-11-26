import json
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..database.base import utc_now
from ..models import (
    DividendRecord,
    HistoricalPrice,
    PortfolioHolding,
    ScreenerSetting,
    Sector,
    Stock,
    User,
    UserPreference,
    WatchlistStock,
)
from ..schemas import AuthInput, HoldingInput, PreferenceInput, WatchlistInput
from ..services import (
    calculate_indicators,
    create_access_token,
    get_market_data_provider,
    hash_password,
    read_access_token,
    verify_password,
)
from ..services.cache import market_data_cache
from ..services.config import market_data_config
from ..services.provider_errors import DataUnavailable, ProviderNotFound

router = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)
DEMO_USER_ID = 1
DEMO_USER_EMAIL = "guest@demo.invalid"
provider = get_market_data_provider()
RANGE_DAYS = {
    "5M": 3,
    "15M": 6,
    "1H": 15,
    "4H": 45,
    "1D": 2,
    "1W": 5,
    "1M": 21,
    "3M": 63,
    "6M": 126,
    "1Y": 252,
    "5Y": 1260,
}
SECTOR_LOOKBACKS = {"1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126, "1Y": 252}


def _stock_dict(stock: Stock) -> dict:
    change = round(stock.price * (stock.change_pct / 100), 2) if stock.change_pct else 0.0
    return {
        "symbol": stock.symbol,
        "name": stock.name,
        "sector": stock.sector.name,
        "price": stock.price,
        "change": change,
        "change_pct": stock.change_pct,
        "volume": stock.volume,
        "market_cap": stock.market_cap,
        "dividend_yield": stock.dividend_yield,
        "updated_at": _utc_iso(stock.updated_at),
        "data_source": provider.source,
    }


def _utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _latest_updated(stocks: list[Stock]) -> str | None:
    return _utc_iso(max(stock.updated_at for stock in stocks)) if stocks else None


def _cached_response(key: str, category: str, loader):
    try:
        result = market_data_cache.get_or_load(key, category, loader)
    except DataUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    response = result.value
    if not isinstance(response, dict):
        raise RuntimeError(f"Cached market response for {key} must be an object.")
    upstream_cache_status = response.get("cache_status")
    response["cache_status"] = (
        "STALE"
        if result.cache_status == "STALE" or upstream_cache_status == "STALE"
        else result.cache_status
    )
    if response["cache_status"] == "STALE":
        response["freshness_status"] = "STALE"
    elif "freshness_status" not in response:
        response["freshness_status"] = result.freshness_status
    if result.last_updated is not None:
        response["last_updated"] = result.last_updated
    return response


def _uses_psx_lens() -> bool:
    return provider.source == "PSX_LENS"


def _persist_provider_stock(db: Session, stock_data: dict) -> Stock:
    sector_name = stock_data["sector"]
    sector = db.scalar(select(Sector).where(Sector.name == sector_name))
    if sector is None:
        sector = Sector(name=sector_name)
        db.add(sector)
        db.flush()
    stock = db.scalar(select(Stock).where(Stock.symbol == stock_data["symbol"]))
    if stock is None:
        stock = Stock(
            symbol=stock_data["symbol"],
            name=stock_data["name"],
            sector=sector,
            price=stock_data["price"],
            change_pct=stock_data["change_pct"],
            volume=stock_data.get("volume") or 0,
            market_cap=stock_data.get("market_cap") or 0,
            dividend_yield=stock_data.get("dividend_yield") or 0,
            updated_at=utc_now(),
        )
        db.add(stock)
    else:
        stock.name = stock_data["name"]
        stock.sector = sector
        stock.price = stock_data["price"]
        stock.change_pct = stock_data["change_pct"]
        stock.volume = stock_data.get("volume") or 0
        stock.market_cap = stock_data.get("market_cap") or 0
        stock.dividend_yield = stock_data.get("dividend_yield") or 0
        stock.updated_at = utc_now()
    db.flush()
    return stock


def _get_user(db: Session, credentials: HTTPAuthorizationCredentials | None) -> User:
    if credentials is None:
        user = db.get(User, DEMO_USER_ID)
    else:
        user_id = read_access_token(credentials.credentials)
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid or expired access token.")
        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="Account no longer exists.")
    if user is None:
        raise HTTPException(status_code=503, detail="Market database has not been initialized.")
    return user


def _rsi(closes: list[float]) -> float | None:
    return calculate_indicators(closes)["latest_rsi"]


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    if _uses_psx_lens():
        status = provider.health_status()
        return {
            "status": "ok",
            "data_source": provider.source,
            "market_data_status": status["data_status"],
            "market_status": status["market_status"],
            "last_updated": status["last_updated"],
            "frontend_poll_interval_seconds": market_data_config.frontend_poll_interval,
        }
    latest_update = db.scalar(select(func.max(Stock.updated_at)))
    return {
        "status": "ok",
        "data_source": provider.source,
        "last_updated": _utc_iso(latest_update) if latest_update is not None else None,
        "frontend_poll_interval_seconds": market_data_config.frontend_poll_interval,
    }


@router.post("/auth/register", status_code=201)
def register(payload: AuthInput, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = User(email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    db.flush()
    db.add(UserPreference(user_id=user.id))
    db.add(ScreenerSetting(user_id=user.id))
    db.commit()
    return {
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email},
    }


@router.post("/auth/login")
def login(payload: AuthInput, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    return {
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email},
    }


@router.get("/auth/me")
def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = _get_user(db, credentials)
    return {"id": user.id, "email": user.email, "is_demo": user.id == DEMO_USER_ID}


@router.get("/market/overview")
def market_overview(db: Session = Depends(get_db)):
    if _uses_psx_lens():
        try:
            return provider.market_overview()
        except DataUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    def load_overview():
        stocks = db.scalars(select(Stock).options(joinedload(Stock.sector))).all()
        if not stocks:
            raise HTTPException(status_code=503, detail="Market data is not available.")
        changes = [stock.change_pct for stock in stocks]
        return {
            "index": {"name": "KSE-100 Index", "value": 168342.75, "change": 2458.32, "change_pct": 1.48},
            "market_volume": sum(stock.volume for stock in stocks),
            "market_cap": sum(stock.market_cap for stock in stocks),
            "total_trades": 125430,
            "advances": sum(value > 0 for value in changes),
            "declines": sum(value < 0 for value in changes),
            "stocks": [_stock_dict(stock) for stock in stocks],
            "gainers": [_stock_dict(stock) for stock in sorted(stocks, key=lambda item: item.change_pct, reverse=True)[:5]],
            "losers": [_stock_dict(stock) for stock in sorted(stocks, key=lambda item: item.change_pct)[:5]],
            "active": [_stock_dict(stock) for stock in sorted(stocks, key=lambda item: item.volume, reverse=True)[:5]],
            "sectors": _sectors(db, "1D")["items"],
            "data_source": provider.source,
            "last_updated": _latest_updated(stocks),
        }

    return _cached_response("quotes:market-overview", "quote", load_overview)


@router.get("/stocks")
def list_stocks(
    q: str = "",
    query: str = "",
    sector: str | None = None,
    limit: int = Query(default=1000, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    search_term = (q or query).strip().casefold()
    if _uses_psx_lens():
        try:
            return provider.stocks(search_term, sector, limit)
        except DataUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    def load_stocks():
        statement = select(Stock).options(joinedload(Stock.sector)).order_by(Stock.symbol)
        if search_term:
            term = f"%{search_term}%"
            statement = statement.where(Stock.symbol.ilike(term) | Stock.name.ilike(term))
        if sector and sector != "All Sectors":
            statement = statement.join(Stock.sector).where(Sector.name == sector)
        items = db.scalars(statement.limit(limit)).all()
        return {
            "items": [_stock_dict(stock) for stock in items],
            "data_source": provider.source,
            "last_updated": _latest_updated(items),
        }

    return _cached_response(f"quotes:stocks:{search_term}:{sector}:{limit}", "quote", load_stocks)


@router.get("/stocks/{symbol}")
def stock_detail(symbol: str, db: Session = Depends(get_db)):
    normalized_symbol = symbol.upper()
    if _uses_psx_lens():
        try:
            return provider.stock_detail(normalized_symbol)
        except ProviderNotFound as error:
            raise HTTPException(status_code=404, detail=f"Stock symbol {normalized_symbol} was not found.") from error
        except DataUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    def load_detail():
        stock = db.scalar(select(Stock).options(joinedload(Stock.sector)).where(Stock.symbol == normalized_symbol))
        if stock is None:
            raise HTTPException(status_code=404, detail=f"Stock symbol {normalized_symbol} was not found.")
        latest = db.scalar(
            select(HistoricalPrice).where(HistoricalPrice.stock_id == stock.id)
            .order_by(HistoricalPrice.timestamp.desc()).limit(1)
        )
        closes = db.scalars(
            select(HistoricalPrice.close).where(HistoricalPrice.stock_id == stock.id)
            .order_by(HistoricalPrice.timestamp)
        ).all()
        indicators = calculate_indicators(closes)
        return {
            **_stock_dict(stock),
            "open": latest.open if latest else stock.price,
            "high": latest.high if latest else stock.price,
            "low": latest.low if latest else stock.price,
            "previous_close": stock.price / (1 + stock.change_pct / 100) if stock.change_pct else stock.price,
            "rsi": indicators["latest_rsi"],
            "sma20": indicators["latest_sma20"],
            "data_source": provider.source,
        }

    return _cached_response(f"quotes:stock:{normalized_symbol}", "quote", load_detail)


@router.get("/stocks/{symbol}/history")
def stock_history(
    symbol: str,
    range: str = "1Y",
    db: Session = Depends(get_db),
):
    requested = range.upper()
    days = RANGE_DAYS.get(requested)
    if days is None:
        raise HTTPException(
            status_code=422,
            detail="Range must be 5m, 15m, 1H, 4H, 1D, 1W, 1M, 3M, 6M, 1Y, or 5Y.",
        )
    if _uses_psx_lens():
        try:
            return provider.history(symbol.upper(), requested)
        except ProviderNotFound as error:
            raise HTTPException(status_code=404, detail=f"Stock symbol {symbol.upper()} was not found.") from error
        except DataUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    def load_history():
        stock = db.scalar(select(Stock).where(Stock.symbol == symbol.upper()))
        if stock is None:
            raise HTTPException(status_code=404, detail=f"Stock symbol {symbol.upper()} was not found.")
        points = db.scalars(
            select(HistoricalPrice).where(HistoricalPrice.stock_id == stock.id)
            .order_by(HistoricalPrice.timestamp.desc()).limit(2 if requested == "1D" else days)
        ).all()
        if requested in {"1D", "5M", "15M", "1H", "4H"} and points:
            latest = points[0]
            intraday = provider.intraday_history(stock.symbol, {
                "timestamp": latest.timestamp,
                "open": latest.open,
                "high": latest.high,
                "low": latest.low,
                "close": latest.close,
                "volume": latest.volume,
            })
            items = [
                {
                    "timestamp": _utc_iso(point["timestamp"]),
                    "open": point["open"],
                    "high": point["high"],
                    "low": point["low"],
                    "close": point["close"],
                    "volume": point["volume"],
                }
                for point in intraday
            ]
        else:
            items = [
                {
                    "timestamp": _utc_iso(point.timestamp),
                    "open": point.open,
                    "high": point.high,
                    "low": point.low,
                    "close": point.close,
                    "volume": point.volume,
                }
                for point in reversed(points)
            ]
        return {
            "symbol": stock.symbol,
            "range": requested,
            "items": items,
            "data_source": provider.source,
            "last_updated": _utc_iso(stock.updated_at),
        }

    category = "quote" if requested == "1D" else "historical"
    return _cached_response(f"history:{symbol.upper()}:{requested}", category, load_history)


@router.get("/stocks/{symbol}/indicators")
def stock_indicators(symbol: str, db: Session = Depends(get_db)):
    normalized_symbol = symbol.upper()
    if _uses_psx_lens():
        try:
            return provider.indicators(normalized_symbol)
        except ProviderNotFound as error:
            raise HTTPException(status_code=404, detail=f"Stock symbol {normalized_symbol} was not found.") from error
        except DataUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    def load_indicators():
        stock = db.scalar(select(Stock).where(Stock.symbol == normalized_symbol))
        if stock is None:
            raise HTTPException(status_code=404, detail=f"Stock symbol {normalized_symbol} was not found.")
        closes = db.scalars(
            select(HistoricalPrice.close).where(HistoricalPrice.stock_id == stock.id)
            .order_by(HistoricalPrice.timestamp)
        ).all()
        return {
            "symbol": stock.symbol,
            **calculate_indicators(closes),
            "data_source": provider.source,
            "last_updated": _utc_iso(stock.updated_at),
        }

    return _cached_response(f"indicators:{normalized_symbol}", "historical", load_indicators)


@router.get("/stocks/{symbol}/dividends")
def stock_dividends(symbol: str, db: Session = Depends(get_db)):
    normalized_symbol = symbol.upper()
    if _uses_psx_lens():
        try:
            return provider.dividends(normalized_symbol)
        except ProviderNotFound as error:
            raise HTTPException(status_code=404, detail=f"Stock symbol {normalized_symbol} was not found.") from error
        except DataUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    def load_dividends():
        stock = db.scalar(select(Stock).where(Stock.symbol == normalized_symbol))
        if stock is None:
            raise HTTPException(status_code=404, detail=f"Stock symbol {normalized_symbol} was not found.")
        records = db.scalars(
            select(DividendRecord).where(DividendRecord.stock_id == stock.id)
            .order_by(DividendRecord.ex_date.desc())
        ).all()
        return {
            "symbol": stock.symbol,
            "items": [{"ex_date": row.ex_date.date().isoformat(), "amount": row.amount, "currency": row.currency, "source": "DEMO"} for row in records],
            "data_source": provider.source,
            "last_updated": _utc_iso(stock.updated_at),
        }

    return _cached_response(f"dividends:{normalized_symbol}", "dividend", load_dividends)


def _sectors(db: Session, period: str) -> dict:
    lookback = SECTOR_LOOKBACKS[period]
    sectors = db.scalars(select(Sector).options(joinedload(Sector.stocks))).unique().all()
    result = []
    for sector in sectors:
        if not sector.stocks:
            continue
        performances: dict[int, float] = {}
        for stock in sector.stocks:
            closes = db.scalars(
                select(HistoricalPrice.close).where(HistoricalPrice.stock_id == stock.id)
                .order_by(HistoricalPrice.timestamp.desc()).limit(lookback + 1)
            ).all()
            performances[stock.id] = round((closes[0] / closes[-1] - 1) * 100, 2) if len(closes) > 1 else stock.change_pct
        members = sorted(sector.stocks, key=lambda item: performances[item.id], reverse=True)
        result.append({
            "name": sector.name,
            "change_pct": round(sum(performances[stock.id] for stock in members) / len(members), 2),
            "stock_count": len(members),
            "top_stocks": [{**_stock_dict(stock), "period_change_pct": performances[stock.id]} for stock in members[:3]],
            "worst_stocks": [{**_stock_dict(stock), "period_change_pct": performances[stock.id]} for stock in members[-3:]],
        })
    return {"items": sorted(result, key=lambda sector: sector["change_pct"], reverse=True), "period": period}


@router.get("/sectors")
def sectors(period: str = "1D", db: Session = Depends(get_db)):
    requested = period.upper()
    if requested not in SECTOR_LOOKBACKS:
        raise HTTPException(status_code=422, detail="Period must be 1D, 1W, 1M, 3M, 6M, or 1Y.")
    if _uses_psx_lens():
        try:
            return provider.sectors(requested)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except DataUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    def load_sectors():
        stocks = db.scalars(select(Stock)).all()
        return {
            **_sectors(db, requested),
            "data_source": provider.source,
            "last_updated": _latest_updated(stocks),
        }

    return _cached_response(f"sectors:{requested}", "sector", load_sectors)


@router.get("/screener")
def screen(
    sector: str = "All Sectors",
    timeframe: str = "daily",
    page: int = 1,
    page_size: int = 50,
    min_price: float | None = None,
    max_price: float | None = None,
    min_change: float | None = None,
    max_change: float | None = None,
    min_volume: int | None = None,
    min_market_cap: float | None = None,
    min_dividend: float | None = None,
    min_dividend_yield: float | None = None,
    min_rsi: float | None = None,
    rsi_period: str = "daily",
    min_rsi_daily: float | None = None,
    min_rsi_weekly: float | None = None,
    min_rsi_monthly: float | None = None,
    symbol: str | None = None,
    sort_by: str = "change_pct",
    order: str = "desc",
    db: Session = Depends(get_db),
):
    period_map = {"daily": 1, "weekly": 5, "monthly": 21}
    sortable = {"price", "change_pct", "volume", "market_cap", "symbol", "rsi"}
    timeframe_norm = timeframe.lower()
    if timeframe_norm not in period_map:
        raise HTTPException(status_code=422, detail="Timeframe must be daily, weekly, or monthly.")
    if rsi_period not in period_map:
        raise HTTPException(status_code=422, detail="RSI period must be daily, weekly, or monthly.")
    if sort_by not in sortable or order not in {"asc", "desc"}:
        raise HTTPException(status_code=422, detail="Unsupported sorting option.")
    filters = {
        "sector": sector,
        "timeframe": timeframe_norm,
        "page": max(1, page),
        "page_size": max(1, min(200, page_size)),
        "min_price": min_price,
        "max_price": max_price,
        "min_change": min_change,
        "max_change": max_change,
        "min_volume": min_volume,
        "min_market_cap": min_market_cap,
        "min_dividend": min_dividend,
        "min_dividend_yield": min_dividend_yield,
        "min_rsi": min_rsi,
        "rsi_period": rsi_period if min_rsi is None else timeframe_norm,
        "min_rsi_daily": min_rsi_daily,
        "min_rsi_weekly": min_rsi_weekly,
        "min_rsi_monthly": min_rsi_monthly,
        "symbol": symbol,
        "sort_by": sort_by,
        "order": order,
    }
    if _uses_psx_lens():
        try:
            return provider.screen(filters)
        except DataUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    def load_screen():
        stocks = db.scalars(select(Stock).options(joinedload(Stock.sector))).all()
        all_sectors = sorted({stock.sector.name for stock in stocks if stock.sector and stock.sector.name})
        result = []
        for stock in stocks:
            if sector not in {"All Sectors", "Any Sector"} and stock.sector.name != sector:
                continue
            if symbol and symbol.upper() not in stock.symbol and symbol.upper() not in stock.name.upper():
                continue
            history_rows = db.scalars(
                select(HistoricalPrice).where(HistoricalPrice.stock_id == stock.id)
                .order_by(HistoricalPrice.timestamp)
            ).all()
            closes = [row.close for row in history_rows]
            volumes = [row.volume for row in history_rows]
            daily = _rsi(closes)
            weekly = _rsi([sum(closes[index:index + 5]) / 5 for index in range(0, len(closes) - 4, 5)])
            monthly = _rsi([sum(closes[index:index + 21]) / 21 for index in range(0, len(closes) - 20, 21)])

            daily_price = round(stock.price, 2)
            weekly_price = round(sum(closes[-5:]) / len(closes[-5:]), 2) if closes else daily_price
            monthly_price = round(sum(closes[-21:]) / len(closes[-21:]), 2) if closes else daily_price

            weekly_ref = closes[-6] if len(closes) >= 6 else (closes[0] if closes else daily_price)
            monthly_ref = closes[-22] if len(closes) >= 22 else (closes[0] if closes else daily_price)
            weekly_chg_pct = round(((daily_price - weekly_ref) / weekly_ref) * 100, 2) if weekly_ref > 0 else stock.change_pct
            monthly_chg_pct = round(((daily_price - monthly_ref) / monthly_ref) * 100, 2) if monthly_ref > 0 else stock.change_pct

            weekly_vol = sum(volumes[-5:]) if volumes else stock.volume
            monthly_vol = sum(volumes[-21:]) if volumes else stock.volume

            if timeframe_norm == "weekly":
                active_price, active_chg_pct, active_vol, active_rsi = weekly_price, weekly_chg_pct, weekly_vol, weekly
            elif timeframe_norm == "monthly":
                active_price, active_chg_pct, active_vol, active_rsi = monthly_price, monthly_chg_pct, monthly_vol, monthly
            else:
                active_price, active_chg_pct, active_vol, active_rsi = daily_price, stock.change_pct, stock.volume, daily

            if min_price is not None and active_price < min_price or max_price is not None and active_price > max_price:
                continue
            if min_change is not None and active_chg_pct < min_change or max_change is not None and active_chg_pct > max_change:
                continue
            if min_volume is not None and active_vol < min_volume or min_market_cap is not None and stock.market_cap < min_market_cap:
                continue

            div_record = db.scalar(
                select(DividendRecord).where(DividendRecord.stock_id == stock.id)
                .order_by(DividendRecord.ex_date.desc()).limit(1)
            )
            latest_dividend = div_record.amount if div_record else None
            last_dividend_date = div_record.ex_date.strftime("%Y-%m-%d") if div_record and div_record.ex_date else None
            if min_dividend is not None and (latest_dividend is None or latest_dividend < min_dividend):
                continue
            if min_dividend_yield is not None and stock.dividend_yield < min_dividend_yield:
                continue

            # Multi-timeframe RSI conditions
            if min_rsi_daily is not None and (daily is None or daily < min_rsi_daily):
                continue
            if min_rsi_weekly is not None and (weekly is None or weekly < min_rsi_weekly):
                continue
            if min_rsi_monthly is not None and (monthly is None or monthly < min_rsi_monthly):
                continue

            if min_rsi is not None:
                if active_rsi is None or active_rsi < min_rsi:
                    continue

            result.append({
                **_stock_dict(stock),
                "price": active_price,
                "spot_price": daily_price,
                "daily_price": daily_price,
                "weekly_price": weekly_price,
                "monthly_price": monthly_price,
                "change_pct": active_chg_pct,
                "volume": active_vol,
                "rsi": active_rsi,
                "timeframe": timeframe_norm,
                "rsi_daily": daily,
                "rsi_weekly": weekly,
                "rsi_monthly": monthly,
                "latest_dividend": latest_dividend,
                "last_dividend_amount": latest_dividend,
                "last_dividend_date": last_dividend_date,
                "next_dividend_amount": None,
                "next_dividend_date": None,
                "last_earning_date": None,
                "next_earning_date": None,
            })
        available = [item for item in result if item.get(sort_by) is not None]
        unavailable = [item for item in result if item.get(sort_by) is None]
        available.sort(key=lambda stock: stock[sort_by], reverse=order == "desc")
        result = available + unavailable
        return {
            "items": result,
            "total": len(result),
            "timeframe": timeframe_norm,
            "sectors": all_sectors,
            "data_source": provider.source,
            "last_updated": _latest_updated(stocks),
        }

    return _cached_response(
        f"screener:{json.dumps(filters, sort_keys=True, separators=(',', ':'))}",
        "quote",
        load_screen,
    )


@router.get("/screener/settings")
def get_screener_settings(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = _get_user(db, credentials)
    record = db.scalar(select(ScreenerSetting).where(ScreenerSetting.user_id == user.id))
    return {"settings": json.loads(record.settings_json) if record else {}}


@router.put("/screener/settings")
def save_screener_settings(
    settings: dict,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = _get_user(db, credentials)
    record = db.scalar(select(ScreenerSetting).where(ScreenerSetting.user_id == user.id))
    if record is None:
        record = ScreenerSetting(user_id=user.id)
        db.add(record)
    record.settings_json = json.dumps(settings)
    db.commit()
    return {"message": "Screener settings saved."}


@router.get("/watchlist")
def get_watchlist(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = _get_user(db, credentials)
    entries = db.scalars(
        select(WatchlistStock)
        .options(joinedload(WatchlistStock.stock).joinedload(Stock.sector))
        .where(WatchlistStock.user_id == user.id)
        .order_by(WatchlistStock.is_favorite.desc(), WatchlistStock.added_at)
    ).all()
    if _uses_psx_lens():
        try:
            catalog = provider.stocks(limit=500)
            by_symbol = {stock["symbol"]: stock for stock in catalog["items"]}
            items = []
            unavailable_symbols = []
            for entry in entries:
                symbol = entry.stock.symbol
                stock = by_symbol.get(symbol)
                if stock is None:
                    try:
                        stock = provider.stock_detail(symbol)
                    except ProviderNotFound:
                        unavailable_symbols.append(symbol)
                        continue
                items.append({**stock, "is_favorite": bool(entry.is_favorite)})
            return {
                "items": items,
                "unavailable_symbols": unavailable_symbols,
                "data_source": provider.source,
                "account": user.email,
                "last_updated": catalog.get("last_updated"),
                "freshness_status": catalog.get("freshness_status"),
                "cache_status": catalog.get("cache_status"),
            }
        except DataUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    stocks = [entry.stock for entry in entries]
    last_updated = _latest_updated(stocks)
    freshness_status = "DEMO" if last_updated is None else "STALE"
    if last_updated is not None:
        updated_at = datetime.fromisoformat(last_updated)
        age = (datetime.now(timezone.utc) - updated_at).total_seconds()
        freshness_status = "STALE" if age > market_data_config.freshness_cache_ttl else "FRESH"
    return {
        "items": [{**_stock_dict(entry.stock), "is_favorite": bool(entry.is_favorite)} for entry in entries],
        "data_source": provider.source,
        "account": user.email,
        "last_updated": last_updated,
        "freshness_status": freshness_status,
        "cache_status": "BYPASS",
    }


@router.post("/watchlist", status_code=201)
def add_watchlist(
    payload: WatchlistInput,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = _get_user(db, credentials)
    if _uses_psx_lens():
        try:
            stock_data = provider.stock_detail(payload.symbol.upper())
        except ProviderNotFound as error:
            raise HTTPException(status_code=404, detail=f"Stock symbol {payload.symbol.upper()} was not found.") from error
        except DataUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        stock = _persist_provider_stock(db, stock_data)
        existing = db.scalar(
            select(WatchlistStock).where(WatchlistStock.user_id == user.id, WatchlistStock.stock_id == stock.id)
        )
        if existing:
            raise HTTPException(status_code=409, detail=f"{stock.symbol} is already in your watchlist.")
        db.add(WatchlistStock(user_id=user.id, stock_id=stock.id))
        db.commit()
        return {"message": f"{stock.symbol} added to watchlist.", "symbol": stock.symbol}

    stock = db.scalar(select(Stock).where(Stock.symbol == payload.symbol.upper()))
    if stock is None:
        raise HTTPException(status_code=404, detail=f"Stock symbol {payload.symbol.upper()} was not found.")
    existing = db.scalar(
        select(WatchlistStock).where(WatchlistStock.user_id == user.id, WatchlistStock.stock_id == stock.id)
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"{stock.symbol} is already in your watchlist.")
    db.add(WatchlistStock(user_id=user.id, stock_id=stock.id))
    db.commit()
    return {"message": f"{stock.symbol} added to watchlist.", "symbol": stock.symbol}


class WatchlistFavoriteInput(BaseModel):
    is_favorite: bool | None = None


@router.patch("/watchlist/{symbol}/favorite")
def set_watchlist_favorite(
    symbol: str,
    payload: WatchlistFavoriteInput | None = Body(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = _get_user(db, credentials)
    stock = db.scalar(select(Stock).where(Stock.symbol == symbol.upper()))
    if stock is None:
        raise HTTPException(status_code=404, detail=f"Stock symbol {symbol.upper()} was not found.")
    entry = db.scalar(
        select(WatchlistStock).where(WatchlistStock.user_id == user.id, WatchlistStock.stock_id == stock.id)
    )
    if entry is None:
        raise HTTPException(status_code=404, detail=f"{stock.symbol} is not in your watchlist.")
    next_value = payload.is_favorite if (payload is not None and payload.is_favorite is not None) else not bool(entry.is_favorite)
    entry.is_favorite = bool(next_value)
    db.commit()
    return {
        "symbol": stock.symbol,
        "is_favorite": bool(entry.is_favorite),
        "message": f"{stock.symbol} {'added to' if entry.is_favorite else 'removed from'} favourites.",
    }


@router.delete("/watchlist/{symbol}")
def remove_watchlist(
    symbol: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = _get_user(db, credentials)
    stock = db.scalar(select(Stock).where(Stock.symbol == symbol.upper()))
    if stock is None:
        raise HTTPException(status_code=404, detail=f"Stock symbol {symbol.upper()} was not found.")
    entry = db.scalar(
        select(WatchlistStock).where(WatchlistStock.user_id == user.id, WatchlistStock.stock_id == stock.id)
    )
    if entry is None:
        raise HTTPException(status_code=404, detail=f"{stock.symbol} is not in your watchlist.")
    db.delete(entry)
    db.commit()
    return {"message": f"{stock.symbol} removed from watchlist."}


@router.get("/portfolio")
def get_portfolio(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = _get_user(db, credentials)
    holdings = db.scalars(
        select(PortfolioHolding)
        .options(joinedload(PortfolioHolding.stock).joinedload(Stock.sector))
        .where(PortfolioHolding.user_id == user.id)
        .order_by(PortfolioHolding.id)
    ).all()
    if _uses_psx_lens():
        try:
            items = []
            for holding in holdings:
                stock = provider.stock_detail(holding.stock.symbol)
                items.append({
                    **stock,
                    "shares": holding.shares,
                    "average_cost": holding.average_cost,
                    "invested": round(holding.shares * holding.average_cost, 2),
                    "current_value": round(holding.shares * stock["price"], 2),
                })
        except (DataUnavailable, ProviderNotFound) as error:
            raise HTTPException(status_code=503, detail="A current portfolio quote is unavailable.") from error
        invested = sum(item["invested"] for item in items)
        current_value = sum(item["current_value"] for item in items)
        updated_times = [item["updated_at"] for item in items if item.get("updated_at")]
        return {
            "items": items,
            "invested": invested,
            "current_value": current_value,
            "return_pct": round((current_value / invested - 1) * 100, 2) if invested else 0,
            "data_source": provider.source,
            "last_updated": max(updated_times) if updated_times else None,
            "freshness_status": (
                "DATA UNAVAILABLE" if not items
                else "STALE" if any(item["freshness_status"] == "STALE" for item in items)
                else "DELAYED"
            ),
        }

    items = [{
        **_stock_dict(holding.stock),
        "shares": holding.shares,
        "average_cost": holding.average_cost,
        "invested": round(holding.shares * holding.average_cost, 2),
        "current_value": round(holding.shares * holding.stock.price, 2),
    } for holding in holdings]
    invested = sum(item["invested"] for item in items)
    current_value = sum(item["current_value"] for item in items)
    return {
        "items": items,
        "invested": invested,
        "current_value": current_value,
        "return_pct": round((current_value / invested - 1) * 100, 2) if invested else 0,
        "data_source": provider.source,
    }


@router.post("/portfolio", status_code=201)
def add_holding(
    payload: HoldingInput,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = _get_user(db, credentials)
    if _uses_psx_lens():
        try:
            stock_data = provider.stock_detail(payload.symbol.upper())
        except ProviderNotFound as error:
            raise HTTPException(status_code=404, detail=f"Stock symbol {payload.symbol.upper()} was not found.") from error
        except DataUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        stock = _persist_provider_stock(db, stock_data)
        holding = db.scalar(
            select(PortfolioHolding).where(PortfolioHolding.user_id == user.id, PortfolioHolding.stock_id == stock.id)
        )
        if holding:
            shares = holding.shares + payload.shares
            holding.average_cost = (
                holding.shares * holding.average_cost + payload.shares * payload.average_cost
            ) / shares
            holding.shares = shares
        else:
            db.add(PortfolioHolding(
                user_id=user.id,
                stock_id=stock.id,
                shares=payload.shares,
                average_cost=payload.average_cost,
            ))
        db.commit()
        return {"message": f"{stock.symbol} holding saved."}

    stock = db.scalar(select(Stock).where(Stock.symbol == payload.symbol.upper()))
    if stock is None:
        raise HTTPException(status_code=404, detail=f"Stock symbol {payload.symbol.upper()} was not found.")
    holding = db.scalar(
        select(PortfolioHolding).where(PortfolioHolding.user_id == user.id, PortfolioHolding.stock_id == stock.id)
    )
    if holding:
        shares = holding.shares + payload.shares
        holding.average_cost = (holding.shares * holding.average_cost + payload.shares * payload.average_cost) / shares
        holding.shares = shares
    else:
        db.add(PortfolioHolding(
            user_id=user.id,
            stock_id=stock.id,
            shares=payload.shares,
            average_cost=payload.average_cost,
        ))
    db.commit()
    return {"message": f"{stock.symbol} holding saved."}


@router.delete("/portfolio/{symbol}")
def remove_holding(
    symbol: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = _get_user(db, credentials)
    stock = db.scalar(select(Stock).where(Stock.symbol == symbol.upper()))
    holding = db.scalar(
        select(PortfolioHolding).where(PortfolioHolding.user_id == user.id, PortfolioHolding.stock_id == stock.id)
    ) if stock else None
    if holding is None:
        raise HTTPException(status_code=404, detail=f"{symbol.upper()} is not in your portfolio.")
    db.delete(holding)
    db.commit()
    return {"message": f"{symbol.upper()} removed from portfolio."}


@router.get("/preferences")
def get_preferences(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = _get_user(db, credentials)
    pref = db.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
    return {
        "currency": pref.currency if pref else "PKR",
        "email_alerts": pref.email_alerts if pref else False,
        "chart_settings": pref.chart_settings if pref and pref.chart_settings else "{}",
    }


@router.put("/preferences")
def save_preferences(
    payload: PreferenceInput,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    user = _get_user(db, credentials)
    pref = db.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
    if pref is None:
        pref = UserPreference(user_id=user.id)
        db.add(pref)
    pref.currency = payload.currency
    pref.email_alerts = payload.email_alerts
    if payload.chart_settings is not None:
        pref.chart_settings = payload.chart_settings
    db.commit()
    return {
        "currency": pref.currency,
        "email_alerts": pref.email_alerts,
        "chart_settings": pref.chart_settings,
        "message": "Preferences saved.",
    }


@router.get("/news")
def news(symbol: str | None = None):
    if _uses_psx_lens():
        try:
            return provider.news(symbol.upper() if symbol else None)
        except ProviderNotFound as error:
            raise HTTPException(status_code=404, detail=f"Stock symbol {symbol.upper()} was not found.") from error
        except DataUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    published = datetime.now(timezone.utc).isoformat()
    return {
        "items": [
            {"id": 1, "headline": "PSX market overview — demo headline", "summary": "Example market news content for the demonstration dashboard.", "published_at": published, "source": "DEMO"},
            {"id": 2, "headline": "Banking sector watch — demo headline", "summary": "Sample sector update. Connect a licensed news provider for current reporting.", "published_at": published, "source": "DEMO"},
            {"id": 3, "headline": "Energy market briefing — demo headline", "summary": "Illustrative news content only; this is not a current market report.", "published_at": published, "source": "DEMO"},
        ],
        "data_source": provider.source,
    }


def initialize_database(db: Session):
    cols = {row[1] for row in db.execute(text("PRAGMA table_info(watchlist_stocks)"))}
    if "is_favorite" not in cols:
        db.execute(text("ALTER TABLE watchlist_stocks ADD COLUMN is_favorite BOOLEAN NOT NULL DEFAULT 0"))
        db.commit()
    if db.scalar(select(Stock.id).limit(1)) is not None:
        guest_user = db.get(User, DEMO_USER_ID)
        if guest_user is not None:
            guest_user.email = DEMO_USER_EMAIL
            guest_user.password_hash = hash_password(secrets.token_urlsafe(32))
            db.commit()
        return
    if _uses_psx_lens():
            if db.get(User, DEMO_USER_ID) is None:
                local_user = User(email=DEMO_USER_EMAIL, password_hash=hash_password(secrets.token_urlsafe(32)))
                db.add(local_user)
                db.flush()
                db.add(UserPreference(user_id=local_user.id))
                db.add(ScreenerSetting(user_id=local_user.id))
                db.commit()
            return
    sectors_by_name: dict[str, Sector] = {}
    for definition in provider.stocks:
        sector_name = definition[2]
        if sector_name not in sectors_by_name:
            sectors_by_name[sector_name] = Sector(name=sector_name)
            db.add(sectors_by_name[sector_name])
    db.flush()

    demo_user = User(email=DEMO_USER_EMAIL, password_hash=hash_password(secrets.token_urlsafe(32)))
    db.add(demo_user)
    db.flush()
    db.add(UserPreference(user_id=demo_user.id))
    db.add(ScreenerSetting(user_id=demo_user.id))
    default_watchlist = {"OGDC", "PPL", "POL", "HBL", "UBL", "MCB", "LUCK", "FCCL", "FFC", "EFERT", "SYS", "TRG", "PSO", "HUBC"}
    current_time = utc_now()
    for definition in provider.stocks:
        symbol, name, sector_name, price, change_pct, volume, market_cap, dividend_yield = definition
        stock = Stock(
            symbol=symbol,
            name=name,
            sector=sectors_by_name[sector_name],
            price=price,
            change_pct=change_pct,
            volume=volume,
            market_cap=market_cap,
            dividend_yield=dividend_yield,
            updated_at=current_time,
        )
        db.add(stock)
        db.flush()
        history = provider.history(symbol)
        db.add_all([
            HistoricalPrice(
                stock_id=stock.id,
                timestamp=point["timestamp"],
                open=point["open"],
                high=point["high"],
                low=point["low"],
                close=point["close"],
                volume=point["volume"],
            )
            for point in history
        ])
        if dividend_yield > 0:
            db.add(DividendRecord(
                stock_id=stock.id,
                ex_date=current_time.replace(year=current_time.year - 1),
                amount=round(price * dividend_yield / 100 / 4, 2),
            ))
        if symbol in default_watchlist:
            db.add(WatchlistStock(user_id=demo_user.id, stock_id=stock.id))
    db.commit()
