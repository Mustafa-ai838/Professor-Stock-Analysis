from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database.base import Base, utc_now


class Sector(Base):
    __tablename__ = "sectors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    stocks: Mapped[list["Stock"]] = relationship(back_populates="sector")


class Stock(Base):
    __tablename__ = "stocks"

    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    sector_id: Mapped[int] = mapped_column(ForeignKey("sectors.id"))
    price: Mapped[float] = mapped_column(Float)
    change_pct: Mapped[float] = mapped_column(Float)
    volume: Mapped[int] = mapped_column(Integer)
    market_cap: Mapped[float] = mapped_column(Float)
    dividend_yield: Mapped[float] = mapped_column(Float, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    sector: Mapped[Sector] = relationship(back_populates="stocks")
    history: Mapped[list["HistoricalPrice"]] = relationship(back_populates="stock", cascade="all, delete-orphan")
    dividends: Mapped[list["DividendRecord"]] = relationship(back_populates="stock", cascade="all, delete-orphan")
    watchlist_entries: Mapped[list["WatchlistStock"]] = relationship(back_populates="stock", cascade="all, delete-orphan")
    portfolio_entries: Mapped[list["PortfolioHolding"]] = relationship(back_populates="stock", cascade="all, delete-orphan")


class HistoricalPrice(Base):
    __tablename__ = "historical_prices"
    __table_args__ = (UniqueConstraint("stock_id", "timestamp"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    stock_id: Mapped[int] = mapped_column(ForeignKey("stocks.id"), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[int] = mapped_column(Integer)

    stock: Mapped[Stock] = relationship(back_populates="history")


class DividendRecord(Base):
    __tablename__ = "dividend_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    stock_id: Mapped[int] = mapped_column(ForeignKey("stocks.id"), index=True)
    ex_date: Mapped[datetime] = mapped_column(DateTime)
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="PKR")
    stock: Mapped[Stock] = relationship(back_populates="dividends")
