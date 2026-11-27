import asyncio
import os
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class MarketTick:
    symbol: str
    price: float
    timestamp: datetime
    volume: int | None = None


class MarketTickBroadcaster:
    def __init__(self):
        self._subscribers: set[asyncio.Queue[MarketTick]] = set()

    def subscribe(self) -> asyncio.Queue[MarketTick]:
        queue: asyncio.Queue[MarketTick] = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[MarketTick]) -> None:
        self._subscribers.discard(queue)

    async def publish(self, tick: MarketTick) -> None:
        for queue in tuple(self._subscribers):
            await queue.put(tick)


class CapitalStakeWebSocketAdapter:
    """Separate, disabled adapter boundary for a licensed Capital Stake feed."""

    def __init__(self):
        self.endpoint = os.getenv("CAPITAL_STAKE_WS_URL", "").strip()
        self.token = os.getenv("CAPITAL_STAKE_API_TOKEN", "").strip()
        if not self.endpoint or not self.token:
            raise RuntimeError(
                "Capital Stake streaming is disabled until an authorized WebSocket endpoint, "
                "credentials, and message contract are supplied."
            )

    async def connect(self) -> None:
        raise RuntimeError(
            "Capital Stake WebSocket message parsing and connection lifecycle require the licensed feed contract."
        )
