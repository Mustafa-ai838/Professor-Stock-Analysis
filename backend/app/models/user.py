from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database.base import Base, utc_now


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    watchlist: Mapped[list["WatchlistStock"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    preferences: Mapped["UserPreference | None"] = relationship(back_populates="user", cascade="all, delete-orphan", uselist=False)
    screener_settings: Mapped["ScreenerSetting | None"] = relationship(back_populates="user", cascade="all, delete-orphan", uselist=False)
    portfolio: Mapped[list["PortfolioHolding"]] = relationship(back_populates="user", cascade="all, delete-orphan")
