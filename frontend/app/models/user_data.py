from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database.base import Base, utc_now


class WatchlistStock(Base):
    __tablename__ = "watchlist_stocks"
    __table_args__ = (UniqueConstraint("user_id", "stock_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    stock_id: Mapped[int] = mapped_column(ForeignKey("stocks.id"))
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    user: Mapped["User"] = relationship(back_populates="watchlist")
    stock: Mapped["Stock"] = relationship(back_populates="watchlist_entries")


class PortfolioHolding(Base):
    __tablename__ = "portfolio_holdings"
    __table_args__ = (UniqueConstraint("user_id", "stock_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    stock_id: Mapped[int] = mapped_column(ForeignKey("stocks.id"))
    shares: Mapped[float] = mapped_column(Float)
    average_cost: Mapped[float] = mapped_column(Float)

    user: Mapped["User"] = relationship(back_populates="portfolio")
    stock: Mapped["Stock"] = relationship(back_populates="portfolio_entries")


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    currency: Mapped[str] = mapped_column(String(8), default="PKR")
    email_alerts: Mapped[bool] = mapped_column(Boolean, default=False)
    chart_settings: Mapped[str | None] = mapped_column(String(4000), default="{}", nullable=True)

    user: Mapped["User"] = relationship(back_populates="preferences")


class ScreenerSetting(Base):
    __tablename__ = "screener_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    settings_json: Mapped[str] = mapped_column(String(4000), default="{}")

    user: Mapped["User"] = relationship(back_populates="screener_settings")
