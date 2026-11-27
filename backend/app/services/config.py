import os
from dataclasses import dataclass


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be a positive integer.") from error
    if value < 1:
        raise RuntimeError(f"{name} must be a positive integer.")
    return value


def _nonnegative_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be a non-negative integer.") from error
    if value < 0:
        raise RuntimeError(f"{name} must be a non-negative integer.")
    return value


def _positive_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be a positive number.") from error
    if value <= 0:
        raise RuntimeError(f"{name} must be a positive number.")
    return value


@dataclass(frozen=True)
class MarketDataConfig:
    frontend_poll_interval: int
    quote_cache_ttl: int
    freshness_cache_ttl: int
    historical_cache_ttl: int
    dividend_cache_ttl: int
    financial_cache_ttl: int
    sector_cache_ttl: int
    api_timeout: float
    max_retries: int

    @classmethod
    def from_environment(cls) -> "MarketDataConfig":
        return cls(
            frontend_poll_interval=_positive_int("FRONTEND_POLL_INTERVAL", 15),
            quote_cache_ttl=_positive_int("QUOTE_CACHE_TTL", 15),
            freshness_cache_ttl=_positive_int("FRESHNESS_CACHE_TTL", 60),
            historical_cache_ttl=_positive_int("HISTORICAL_CACHE_TTL", 30),
            dividend_cache_ttl=_positive_int("DIVIDEND_CACHE_TTL", 86400),
            financial_cache_ttl=_positive_int("FINANCIAL_CACHE_TTL", 86400),
            sector_cache_ttl=_positive_int("SECTOR_CACHE_TTL", 300),
            api_timeout=_positive_float("API_TIMEOUT", 15),
            max_retries=_nonnegative_int("MAX_RETRIES", 2),
        )

    def ttl_for(self, category: str) -> int:
        values = {
            "quote": self.quote_cache_ttl,
            "freshness": self.freshness_cache_ttl,
            "historical": self.historical_cache_ttl,
            "dividend": self.dividend_cache_ttl,
            "financial": self.financial_cache_ttl,
            "sector": self.sector_cache_ttl,
        }
        try:
            return values[category]
        except KeyError as error:
            raise ValueError(f"Unknown market cache category: {category}") from error


market_data_config = MarketDataConfig.from_environment()
