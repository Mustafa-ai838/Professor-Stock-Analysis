"""DEMO data provider boundary. Replace with an authorized PSX feed when credentials exist."""

import math
import random
from datetime import datetime, timedelta, timezone


class DemoMarketDataProvider:
    source = "DEMO"
    stocks = [
        ("HBL", "Habib Bank Limited", "Banking", 142.30, 0.35, 8_900_000, 21_500_000_000, 8.5),
        ("UBL", "United Bank Limited", "Banking", 205.70, 0.12, 8_200_000, 25_000_000_000, 6.2),
        ("MCB", "MCB Bank Limited", "Banking", 293.40, -0.21, 7_100_000, 35_000_000_000, 9.0),
        ("BAFL", "Bank Alfalah Limited", "Banking", 111.20, 1.18, 4_900_000, 18_000_000_000, 6.0),
        ("MEBL", "Meezan Bank Limited", "Banking", 161.20, 0.50, 5_700_000, 20_000_000_000, 5.0),
        ("OGDC", "Oil & Gas Development Company", "Oil & Gas Exploration", 274.50, 0.88, 12_400_000, 118_000_000_000, 4.8),
        ("PPL", "Pakistan Petroleum Limited", "Oil & Gas Exploration", 189.20, -0.42, 10_800_000, 52_000_000_000, 5.5),
        ("POL", "Pakistan Oilfields Limited", "Oil & Gas Exploration", 324.75, 1.72, 3_200_000, 92_000_000_000, 7.2),
        ("MARI", "Mari Petroleum Company Limited", "Oil & Gas Exploration", 1245.00, -0.64, 2_300_000, 165_000_000_000, 3.1),
        ("PSO", "Pakistan State Oil Company Limited", "Oil & Gas Marketing", 352.10, 0.95, 5_800_000, 23_000_000_000, 0.0),
        ("LUCK", "Lucky Cement Limited", "Cement", 609.50, -0.73, 5_700_000, 190_000_000_000, 1.8),
        ("FCCL", "Fauji Cement Company Limited", "Cement", 38.70, 0.78, 3_900_000, 28_000_000_000, 4.0),
        ("FFC", "Fauji Fertilizer Company Limited", "Fertilizer", 240.90, 0.78, 6_100_000, 170_000_000_000, 8.0),
        ("EFERT", "Engro Fertilizers Limited", "Fertilizer", 239.10, 0.41, 5_500_000, 115_000_000_000, 7.5),
        ("SYS", "Systems Limited", "Technology", 460.20, 1.23, 4_300_000, 135_000_000_000, 0.8),
        ("TRG", "TRG Pakistan Limited", "Technology", 72.40, -0.27, 4_700_000, 19_000_000_000, 0.0),
        ("HUBC", "The Hub Power Company Limited", "Power", 123.60, -0.31, 4_600_000, 65_000_000_000, 5.2),
        ("ENGRO", "Engro Corporation Limited", "Fertilizer", 320.10, 1.10, 3_900_000, 150_000_000_000, 4.1),
        ("MTL", "Millat Tractors Limited", "Automobile", 610.00, 0.86, 1_800_000, 70_000_000_000, 3.2),
        ("INIL", "International Industries Limited", "Textile", 165.20, -0.45, 1_300_000, 21_000_000_000, 2.0),
        ("SEARL", "The Searle Company Limited", "Pharmaceuticals", 52.30, 0.64, 1_700_000, 10_000_000_000, 0.0),
    ]

    @classmethod
    def history(cls, symbol: str, days: int = 1825) -> list[dict]:
        definition = next((item for item in cls.stocks if item[0] == symbol), None)
        if not definition:
            return []
        current = definition[3]
        rng = random.Random(sum(map(ord, symbol)))
        previous_close = current * 0.82
        phase = sum(map(ord, symbol)) / 9
        end = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
        points = []
        point_count = min(days, 1825)
        for offset in range(point_count - 1, -1, -1):
            date = end - timedelta(days=offset)
            if date.weekday() > 4:
                continue
            progress = (point_count - 1 - offset) / max(1, point_count - 1)
            cycle = 1 + 0.035 * (math.sin((1 - progress) * 6 * math.pi + phase) - math.sin(phase))
            target = current * (0.82 + 0.18 * progress) * cycle
            opening = previous_close
            close = target * rng.uniform(0.997, 1.003)
            previous_close = close
            points.append({
                "timestamp": date,
                "open": round(opening, 2),
                "high": round(max(opening, close) * (1 + rng.uniform(0.001, 0.009)), 2),
                "low": round(min(opening, close) * (1 - rng.uniform(0.001, 0.009)), 2),
                "close": round(close, 2),
                "volume": int(definition[5] * rng.uniform(0.35, 1.55)),
            })
        if points:
            previous_close = current / (1 + definition[4] / 100)
            points[-2]["close"] = previous_close
            points[-2]["high"] = max(points[-2]["high"], previous_close)
            points[-2]["low"] = min(points[-2]["low"], previous_close)
            points[-1]["open"] = previous_close
            points[-1]["close"] = current
            points[-1]["high"] = max(points[-1]["high"], current)
            points[-1]["low"] = min(points[-1]["low"], current)
        return points

    @classmethod
    def intraday_history(cls, symbol: str, daily_bar: dict) -> list[dict]:
        """Create clearly labeled sample intraday bars bounded by a daily demo candle."""
        rng = random.Random(sum(map(ord, symbol)) + daily_bar["timestamp"].day)
        opening = daily_bar["open"]
        final = daily_bar["close"]
        daily_range = max(daily_bar["high"] - daily_bar["low"], final * 0.003)
        previous = opening
        start = daily_bar["timestamp"].replace(hour=9, minute=30, second=0, microsecond=0)
        points = []
        for index in range(24):
            progress = (index + 1) / 24
            target = opening + (final - opening) * progress
            close = target + rng.uniform(-0.08, 0.08) * daily_range
            if index == 23:
                close = final
            high = min(daily_bar["high"], max(previous, close) + rng.uniform(0.01, 0.1) * daily_range)
            low = max(daily_bar["low"], min(previous, close) - rng.uniform(0.01, 0.1) * daily_range)
            points.append({
                "timestamp": start + timedelta(minutes=15 * index),
                "open": round(previous, 2),
                "high": round(max(high, previous, close), 2),
                "low": round(min(low, previous, close), 2),
                "close": round(close, 2),
                "volume": max(1, int(daily_bar["volume"] / 24 * rng.uniform(0.45, 1.65))),
            })
            previous = close
        return points
