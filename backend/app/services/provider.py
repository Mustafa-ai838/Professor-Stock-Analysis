from typing import Protocol

from .market_data import DemoMarketDataProvider
from .psx_provider import PSXLensProviderAdapter


class MarketDataProvider(Protocol):
    source: str
    stocks: list[tuple]

    def history(self, symbol: str, days: int = 1825) -> list[dict]:
        ...


def get_market_data_provider() -> MarketDataProvider:
    """Select the configured backend-only market data source."""
    import os

    provider = os.getenv("DATA_PROVIDER", "psxlens").strip().lower()
    if provider in {"psx_lens", "psxlens"}:
        return PSXLensProviderAdapter()
    if provider == "demo":
        return DemoMarketDataProvider()
    raise RuntimeError("DATA_PROVIDER must be 'psxlens' or the explicitly selected offline 'demo' provider.")
