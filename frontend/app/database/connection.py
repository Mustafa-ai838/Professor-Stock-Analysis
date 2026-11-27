"""Database connection and session management."""
import os
from .session import DATABASE_URL, engine, SessionLocal, get_db
from .base import Base


def init_db():
    """Create all tables."""
    from app.models.models import (
        User, Stock, HistoricalPrice, Sector,
        WatchlistItem, PortfolioHolding, UserPreference,
    )
    Base.metadata.create_all(bind=engine)
