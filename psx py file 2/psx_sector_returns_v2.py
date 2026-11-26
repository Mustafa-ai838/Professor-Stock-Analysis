"""
PSX sector returns - VERSION 2

Pehle wale script se farq:
  1. KSE-100 ki companies ke saath wo bari companies bhi leta hai jo pehli bar nahi aayin
     (OGDC, PPL, HUBC, SNGP, ENGRO, EPCL, PRL, DAWH, FCEPL, CHCC, NETSOL ...).
  2. Har company ke liye 3 baar koshish karta hai, aur jo fail ho uska sabab likhta hai.
  3. Stock split / bonus shares ko khud pakarta hai (ek din mein qeemat 20% se zyada
     gir jaye ya 25% se zyada barh jaye) aur purani qeematein theek (adjust) karta hai.

Chalane ka tareeqa (CMD, usi folder mein):
  python psx_sector_returns_v2.py

Nayi files banengi:
  company_returns_v2.csv   <- ye mujhe bhejein
  sector_returns_v2.csv    <- ye bhi bhejein
  corporate_actions.csv    <- jahan split/bonus pakra gaya (jaanch ke liye) - ye bhi bhejein
  failed_symbols.csv       <- jo companies download nahi hui (agar koi hui) - ye bhi bhejein
"""

import sys
import time
from datetime import date

import numpy as np
import pandas as pd

START_YEAR = 2017
END_DATE = date.today()
FETCH_FROM = "2015-12-01"

DROP_LIMIT = 0.80   # ek din mein 20% se zyada girawat = split/bonus
JUMP_LIMIT = 1.25   # ek din mein 25% se zyada izafa = reverse split
MAX_GAP_DAYS = 10   # itne din se zyada ke waqfe wali tabdeeli ko asli maana jaye

# Wo bari companies jo pehli bar nahi aayin (agar KSE-100 list mein pehle se hon to doobara nahi li jayengi)
EXTRA = [
    "OGDC", "PPL", "HUBC", "SNGP", "ENGRO", "EPCL", "PRL", "DAWH", "FCEPL",
    "CHCC", "NETSOL", "SNBL", "JSBL", "TPLP", "SPWL", "GATM", "JLICL", "IGIBL",
    "PAEL", "MEBL", "LUCK", "MARI", "PSO", "ATRL", "FFC", "UBL", "HBL", "MCB",
]
# Agar psxdata ki list mein sector na mile to ye istemal hoga
EXTRA_SECTOR = {
    "OGDC": "OIL & GAS EXPLORATION COMPANIES", "PPL": "OIL & GAS EXPLORATION COMPANIES",
    "HUBC": "POWER GENERATION & DISTRIBUTION", "SNGP": "OIL & GAS MARKETING COMPANIES",
    "ENGRO": "FERTILIZER", "EPCL": "CHEMICAL", "PRL": "REFINERY",
    "DAWH": "INV. BANKS / INV. COS. / SECURITIES COS.", "FCEPL": "FOOD & PERSONAL CARE PRODUCTS",
    "CHCC": "CEMENT", "NETSOL": "TECHNOLOGY & COMMUNICATION",
}


def find_col(df, candidates, label):
    """Column ka naam dhoondta hai (capital/small letters se farq nahi)."""
    lower = {str(c).lower().strip(): c for c in df.columns}
    for cand in candidates:
        if cand in lower:
            return lower[cand]
    for key, orig in lower.items():
        for cand in candidates:
            if cand in key:
                return orig
    print(f"\nERROR: '{label}' column nahi mila. Maujooda columns: {list(df.columns)}")
    sys.exit(1)


def adjust_for_splits(dates, closes):
    """
    dates: sorted pandas Series (datetime), closes: numpy array
    Wapas: (adjusted_closes, events) - events = [(date, ratio), ...]
    Purani qeematon ko isi tarah scale kiya jata hai ke split wale din ka farq khatam ho jaye.
    """
    n = len(closes)
    f = np.ones(n)
    events = []
    gaps = dates.diff().dt.days.fillna(0).to_numpy()
    for i in range(1, n):
        if closes[i - 1] <= 0 or closes[i] <= 0:
            continue
        r = closes[i] / closes[i - 1]
        if (r < DROP_LIMIT or r > JUMP_LIMIT) and gaps[i] <= MAX_GAP_DAYS:
            f[i] = r
            events.append((dates.iloc[i], r))
    # adj[j] = close[j] * (f[i] ka product, jahan i > j)
    rev = np.cumprod(f[::-1])[::-1]          # product of f[i..end]
    after = np.append(rev[1:], 1.0)           # product of f[j+1..end]
    return closes * after, events


def fetch_with_retry(psxdata, sym):
    last = None
    for attempt in range(3):
        try:
            df = psxdata.stocks(sym, start=FETCH_FROM, end=END_DATE.isoformat())
            if df is not None and len(df) > 0:
                return df, None
            last = "koi data nahi"
        except Exception as e:  # noqa: BLE001
            last = str(e)[:150]
        time.sleep(2 * (attempt + 1))
    return None, last


def main():
    import psxdata

    print("Step 1/4: Companies aur sectors nikal raha hoon...")
    idx = psxdata.indices("KSE100")
    idx_sym_col = find_col(idx, ["symbol", "ticker", "scrip"], "symbol (KSE100)")
    kse100 = [str(s).strip() for s in idx[idx_sym_col].dropna().unique()]
    symbols = list(dict.fromkeys(kse100 + EXTRA))

    meta = psxdata.symbols()
    meta_sym_col = find_col(meta, ["symbol", "ticker", "scrip"], "symbol (symbols)")
    meta_sec_col = find_col(meta, ["sector"], "sector")
    sector_of = {
        str(r[meta_sym_col]).strip(): str(r[meta_sec_col]).strip()
        for _, r in meta.iterrows()
    }
    for k, v in EXTRA_SECTOR.items():
        sector_of.setdefault(k, v)
    print(f"   KSE-100 se {len(kse100)} + extra mila kar kul {len(symbols)} companies.")

    print("Step 2/4: Price history download ho rahi hai (5 se 15 minute lag sakte hain)...")
    year_end, actions, failed = {}, [], []
    for i, sym in enumerate(symbols, 1):
        df, err = fetch_with_retry(psxdata, sym)
        if df is None:
            print(f"   [{i}/{len(symbols)}] {sym}: FAIL ({err})")
            failed.append({"symbol": sym, "reason": err})
            continue
        try:
            dcol = find_col(df, ["date", "time"], "date")
            ccol = find_col(df, ["close"], "close")
            d = df[[dcol, ccol]].copy()
            d[dcol] = pd.to_datetime(d[dcol], errors="coerce")
            d[ccol] = pd.to_numeric(d[ccol].astype(str).str.replace(",", ""), errors="coerce")
            d = d.dropna().drop_duplicates(subset=dcol).sort_values(dcol).reset_index(drop=True)
            adj, events = adjust_for_splits(d[dcol], d[ccol].to_numpy(dtype=float))
            for dt, r in events:
                actions.append({"symbol": sym, "date": dt.date().isoformat(), "price_ratio": round(r, 4)})
            d["adj"] = adj
            d["year"] = d[dcol].dt.year
            year_end[sym] = d.groupby("year")["adj"].last().to_dict()
            note = f" (split/bonus pakre gaye: {len(events)})" if events else ""
            print(f"   [{i}/{len(symbols)}] {sym}: ok{note}")
        except Exception as e:  # noqa: BLE001
            print(f"   [{i}/{len(symbols)}] {sym}: SKIP ({e})")
            failed.append({"symbol": sym, "reason": str(e)[:150]})

    print("Step 3/4: Saalana returns nikal raha hoon...")
    rows = []
    for sym, closes in year_end.items():
        for y in range(START_YEAR, END_DATE.year + 1):
            if y in closes and (y - 1) in closes and closes[y - 1] > 0:
                rows.append(
                    {
                        "symbol": sym,
                        "sector": sector_of.get(sym, "Unknown"),
                        "year": y if y < END_DATE.year else f"{y} YTD",
                        "return_pct": round((closes[y] / closes[y - 1] - 1) * 100, 1),
                    }
                )
    if not rows:
        print("ERROR: koi return nahi nikla. Internet ya PSX site check karein.")
        sys.exit(1)

    stock_ret = pd.DataFrame(rows)
    stock_ret.to_csv("company_returns_v2.csv", index=False)
    pd.DataFrame(actions, columns=["symbol", "date", "price_ratio"]).to_csv("corporate_actions.csv", index=False)
    pd.DataFrame(failed, columns=["symbol", "reason"]).to_csv("failed_symbols.csv", index=False)

    print("Step 4/4: Sector table bana raha hoon...")
    sec = (
        stock_ret.groupby(["sector", "year"])["return_pct"]
        .agg(["median", "count"])
        .reset_index()
    )
    wide = sec.pivot(index="sector", columns="year", values="median").round(1)
    wide.to_csv("sector_returns_v2.csv")

    print("\nHo gaya! Ye 4 files isi folder mein ban gayi hain:")
    print("   company_returns_v2.csv, sector_returns_v2.csv, corporate_actions.csv, failed_symbols.csv")
    print(f"   Split/bonus pakre gaye: {len(actions)}   |   Fail hui companies: {len(failed)}")
    print("   Ye sab 4 files mujhe bhej dein.")


if __name__ == "__main__":
    main()
