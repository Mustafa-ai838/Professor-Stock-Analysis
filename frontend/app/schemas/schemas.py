"""Pydantic schemas for request/response validation."""
from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, EmailStr


# ── Auth ──────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserResponse(BaseModel):
    id: int
    email: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Stock ─────────────────────────────────────────────
class StockResponse(BaseModel):
    id: int
    symbol: str
    name: str
    sector: str
    price: float
    change: float
    change_pct: float
    volume: int
    market_cap: float
    pe_ratio: Optional[float] = None
    dividend_yield: Optional[float] = None
    high_52w: Optional[float] = None
    low_52w: Optional[float] = None
    day_high: Optional[float] = None
    day_low: Optional[float] = None
    open_price: Optional[float] = None
    previous_close: Optional[float] = None
    data_source: str = "DEMO"
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class HistoricalPriceResponse(BaseModel):
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: int

    class Config:
        from_attributes = True


# ── Sector ────────────────────────────────────────────
class SectorResponse(BaseModel):
    id: int
    name: str
    change_pct: float
    stock_count: int

    class Config:
        from_attributes = True


# ── Watchlist ─────────────────────────────────────────
class WatchlistAddRequest(BaseModel):
    symbol: str

class WatchlistItemResponse(BaseModel):
    id: int
    symbol: str
    created_at: datetime
    stock: Optional[StockResponse] = None

    class Config:
        from_attributes = True


# ── Portfolio ─────────────────────────────────────────
class PortfolioAddRequest(BaseModel):
    symbol: str
    shares: float
    average_cost: float

class PortfolioHoldingResponse(BaseModel):
    id: int
    symbol: str
    shares: float
    average_cost: float
    created_at: datetime
    current_price: Optional[float] = None
    market_value: Optional[float] = None
    gain_loss: Optional[float] = None
    gain_loss_pct: Optional[float] = None

    class Config:
        from_attributes = True


# ── Preferences ───────────────────────────────────────
class PreferencesRequest(BaseModel):
    currency: Optional[str] = "PKR"
    email_alerts: Optional[bool] = False

class PreferencesResponse(BaseModel):
    currency: str
    email_alerts: bool

    class Config:
        from_attributes = True


# ── Market Overview ───────────────────────────────────
class MarketOverviewResponse(BaseModel):
    total_stocks: int
    advancing: int
    declining: int
    unchanged: int
    total_volume: int
    total_market_cap: float
    top_gainers: List[StockResponse]
    top_losers: List[StockResponse]
    most_active: List[StockResponse]
    data_source: str = "DEMO"


# ── News ──────────────────────────────────────────────
class NewsItem(BaseModel):
    id: int
    title: str
    summary: str
    source: str
    date: str
    category: str
    url: Optional[str] = None
    data_source: str = "DEMO"


# ── Screener ──────────────────────────────────────────
class ScreenerRequest(BaseModel):
    sector: Optional[str] = None
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    min_change: Optional[float] = None
    max_change: Optional[float] = None
    min_volume: Optional[int] = None
    sort_by: Optional[str] = "symbol"
    sort_order: Optional[str] = "asc"


# ── Indicators ────────────────────────────────────────
class IndicatorResponse(BaseModel):
    symbol: str
    rsi: List[Optional[float]]
    sma_20: List[Optional[float]]
    macd_line: List[Optional[float]]
    macd_signal: List[Optional[float]]
    macd_histogram: List[Optional[float]]
    bollinger_upper: List[Optional[float]]
    bollinger_middle: List[Optional[float]]
    bollinger_lower: List[Optional[float]]
    dates: List[str]


# ── Health ────────────────────────────────────────────
class HealthResponse(BaseModel):
    status: str
    version: str
    data_source: str
