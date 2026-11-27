"""Seed the database with demo PSX stock data."""
import random
import math
from datetime import datetime, timedelta, date
from sqlalchemy.orm import Session
from app.models.models import Stock, HistoricalPrice, Sector, WatchlistItem


STOCKS_DATA = [
    {"symbol": "OGDC",  "name": "Oil & Gas Dev Co",        "sector": "Oil & Gas",       "price": 274.50,  "change_pct": 0.88},
    {"symbol": "PPL",   "name": "Pakistan Petroleum",      "sector": "Oil & Gas",       "price": 189.20,  "change_pct": -0.42},
    {"symbol": "POL",   "name": "Pakistan Oilfields",      "sector": "Oil & Gas",       "price": 324.75,  "change_pct": 1.72},
    {"symbol": "MARI",  "name": "Mari Petroleum",          "sector": "Oil & Gas",       "price": 1245.00, "change_pct": -0.64},
    {"symbol": "PSO",   "name": "Pakistan State Oil",      "sector": "Oil & Gas",       "price": 352.10,  "change_pct": 0.95},
    {"symbol": "HBL",   "name": "Habib Bank Limited",      "sector": "Banks",           "price": 142.30,  "change_pct": 0.35},
    {"symbol": "UBL",   "name": "United Bank Limited",     "sector": "Banks",           "price": 205.70,  "change_pct": 0.12},
    {"symbol": "MCB",   "name": "MCB Bank Limited",        "sector": "Banks",           "price": 293.40,  "change_pct": -0.21},
    {"symbol": "MEBL",  "name": "Meezan Bank Limited",     "sector": "Banks",           "price": 161.20,  "change_pct": 0.50},
    {"symbol": "BAFL",  "name": "Bank Alfalah Limited",    "sector": "Banks",           "price": 111.20,  "change_pct": 1.18},
    {"symbol": "NBP",   "name": "National Bank",           "sector": "Banks",           "price": 68.50,   "change_pct": -0.73},
    {"symbol": "FBL",   "name": "Faysal Bank Limited",     "sector": "Banks",           "price": 25.40,   "change_pct": 1.20},
    {"symbol": "LUCK",  "name": "Lucky Cement",            "sector": "Cement",          "price": 609.50,  "change_pct": -0.73},
    {"symbol": "FCCL",  "name": "Fauji Cement",            "sector": "Cement",          "price": 38.70,   "change_pct": 0.78},
    {"symbol": "PIAA",  "name": "Piaa Cement",             "sector": "Cement",          "price": 115.70,  "change_pct": -2.15},
    {"symbol": "EFERT", "name": "Engro Fertilizer",        "sector": "Fertilizer",      "price": 239.10,  "change_pct": 0.41},
    {"symbol": "FFC",   "name": "Fauji Fertilizer",        "sector": "Fertilizer",      "price": 24.85,   "change_pct": -0.60},
    {"symbol": "ENGRO", "name": "Engro Corporation",       "sector": "Fertilizer",      "price": 329.70,  "change_pct": -0.45},
    {"symbol": "SYS",   "name": "Systems Limited",         "sector": "Technology",      "price": 460.20,  "change_pct": 1.23},
    {"symbol": "TRG",   "name": "TRG Pakistan",            "sector": "Technology",      "price": 72.40,   "change_pct": -0.27},
    {"symbol": "HUBC",  "name": "Hub Power Company",       "sector": "Power",           "price": 123.60,  "change_pct": -0.31},
    {"symbol": "KEL",   "name": "K-Electric",              "sector": "Power",           "price": 5.80,    "change_pct": -2.61},
    {"symbol": "SNGP",  "name": "Sui Northern Gas",        "sector": "Oil & Gas",       "price": 78.50,   "change_pct": 7.12},
    {"symbol": "ATRL",  "name": "Attock Refinery",         "sector": "Oil & Gas",       "price": 87.90,   "change_pct": -1.98},
    {"symbol": "INDU",  "name": "Indus Motor",             "sector": "Automobile",      "price": 1650.00, "change_pct": -1.50},
    {"symbol": "SEARL", "name": "Searle Company",          "sector": "Pharmaceuticals", "price": 68.30,   "change_pct": 0.90},
]

SECTORS = [
    "Banks", "Cement", "Oil & Gas", "Fertilizer", "Technology",
    "Textile", "Power", "Pharmaceuticals", "Automobile", "Metals",
]

DEFAULT_WATCHLIST = ["OGDC", "PPL", "HBL", "MCB", "LUCK"]


def _generate_historical(current_price: float, days: int = 365) -> list[dict]:
    """Generate realistic OHLCV data by random-walking backwards from current price."""
    random.seed()  # fresh seed each call
    records = []
    price = current_price
    today = date.today()

    # Walk backwards – day 0 is today, day 364 is oldest
    daily_prices = []
    for i in range(days):
        daily_volatility = price * random.uniform(0.005, 0.025)
        direction = random.choice([-1, 1])
        change = direction * random.uniform(0, daily_volatility)
        price = max(price + change, 1.0)  # never below 1
        daily_prices.append(price)

    # Reverse so index 0 = oldest
    daily_prices.reverse()
    # Last element should land near current_price; rescale
    scale = current_price / daily_prices[-1] if daily_prices[-1] != 0 else 1
    daily_prices = [p * scale for p in daily_prices]

    for i, close_price in enumerate(daily_prices):
        d = today - timedelta(days=days - 1 - i)
        intraday_range = close_price * random.uniform(0.005, 0.03)
        open_p = close_price + random.uniform(-intraday_range / 2, intraday_range / 2)
        high_p = max(open_p, close_price) + random.uniform(0, intraday_range / 2)
        low_p = min(open_p, close_price) - random.uniform(0, intraday_range / 2)
        low_p = max(low_p, 0.5)
        volume = int(random.uniform(50_000, 5_000_000))
        records.append({
            "date": d,
            "open": round(open_p, 2),
            "high": round(high_p, 2),
            "low": round(low_p, 2),
            "close": round(close_price, 2),
            "volume": volume,
        })

    return records


def seed_database(db: Session) -> None:
    """Seed the database if it is empty."""
    if db.query(Stock).count() > 0:
        return  # Already seeded

    # ── Sectors ───────────────────────────────────────
    sector_map: dict[str, Sector] = {}
    for name in SECTORS:
        sector = Sector(name=name, change_pct=0.0, stock_count=0)
        db.add(sector)
        sector_map[name] = sector
    db.flush()

    # ── Stocks + Historical Data ──────────────────────
    for sd in STOCKS_DATA:
        change = round(sd["price"] * sd["change_pct"] / 100, 2)
        prev_close = round(sd["price"] - change, 2)
        volume = random.randint(100_000, 10_000_000)
        market_cap = round(sd["price"] * random.randint(50_000_000, 500_000_000), 2)
        pe = round(random.uniform(4, 30), 2)
        div_yield = round(random.uniform(0, 8), 2)
        intra = sd["price"] * 0.02
        day_high = round(sd["price"] + random.uniform(0, intra), 2)
        day_low = round(sd["price"] - random.uniform(0, intra), 2)
        open_price = round(prev_close + random.uniform(-intra / 2, intra / 2), 2)

        # 52-week range from historical will be overwritten below
        stock = Stock(
            symbol=sd["symbol"],
            name=sd["name"],
            sector=sd["sector"],
            price=sd["price"],
            change=change,
            change_pct=sd["change_pct"],
            volume=volume,
            market_cap=market_cap,
            pe_ratio=pe,
            dividend_yield=div_yield,
            high_52w=0,
            low_52w=0,
            day_high=day_high,
            day_low=day_low,
            open_price=open_price,
            previous_close=prev_close,
            data_source="DEMO",
        )
        db.add(stock)
        db.flush()

        # Historical
        hist_records = _generate_historical(sd["price"])
        highs = []
        lows = []
        for rec in hist_records:
            hp = HistoricalPrice(stock_id=stock.id, **rec)
            db.add(hp)
            highs.append(rec["high"])
            lows.append(rec["low"])

        stock.high_52w = round(max(highs), 2)
        stock.low_52w = round(min(lows), 2)

        # Update sector count
        if sd["sector"] in sector_map:
            sector_map[sd["sector"]].stock_count += 1

    # ── Sector change_pct = average of its stocks ─────
    for name, sector in sector_map.items():
        stocks_in = [s for s in STOCKS_DATA if s["sector"] == name]
        if stocks_in:
            sector.change_pct = round(
                sum(s["change_pct"] for s in stocks_in) / len(stocks_in), 2
            )

    # ── Default watchlist (anonymous user_id=None) ────
    for sym in DEFAULT_WATCHLIST:
        db.add(WatchlistItem(user_id=None, symbol=sym))

    db.commit()
