"""
PSX sector-wise yearly returns (2016 -> 2026 YTD)

Kya karta hai:
  1. KSE-100 ki companies aur unke sectors nikalta hai (psxdata library se)
  2. Har company ki daily price history download karta hai
  3. Har saal ka price return nikalta hai
  4. Har sector ka equal-weighted average return banata hai
  5. sector_returns.csv (aur company_returns.csv) save karta hai

Chalane ka tareeqa (CMD):
  pip install psxdata pandas
  python psx_sector_returns.py
"""

import sys
from datetime import date

import pandas as pd
import psxdata

START_YEAR = 2016          # 2016 ka return nikalne ke liye 2015 ka end price chahiye
END_DATE = date.today()
FETCH_FROM = "2015-12-01"


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


def main():
    print("Step 1/4: KSE-100 companies aur sectors nikal raha hoon...")
    idx = psxdata.indices("KSE100")
    idx_sym_col = find_col(idx, ["symbol", "ticker", "scrip"], "symbol (KSE100)")
    kse100 = [str(s).strip() for s in idx[idx_sym_col].dropna().unique()]

    meta = psxdata.symbols()
    meta_sym_col = find_col(meta, ["symbol", "ticker", "scrip"], "symbol (symbols)")
    meta_sec_col = find_col(meta, ["sector"], "sector")
    sector_of = {
        str(r[meta_sym_col]).strip(): str(r[meta_sec_col]).strip()
        for _, r in meta.iterrows()
    }
    print(f"   {len(kse100)} companies mili.")

    print("Step 2/4: Price history download ho rahi hai (kuch minute lag sakte hain)...")
    year_end = {}  # symbol -> {year: last close}
    for i, sym in enumerate(kse100, 1):
        try:
            df = psxdata.stocks(sym, start=FETCH_FROM, end=END_DATE.isoformat())
            if df is None or len(df) == 0:
                print(f"   [{i}/{len(kse100)}] {sym}: koi data nahi")
                continue
            dcol = find_col(df, ["date", "time"], "date")
            ccol = find_col(df, ["close"], "close")
            d = df[[dcol, ccol]].copy()
            d[dcol] = pd.to_datetime(d[dcol], errors="coerce")
            d[ccol] = pd.to_numeric(d[ccol].astype(str).str.replace(",", ""), errors="coerce")
            d = d.dropna().sort_values(dcol)
            d["year"] = d[dcol].dt.year
            year_end[sym] = d.groupby("year")[ccol].last().to_dict()
            print(f"   [{i}/{len(kse100)}] {sym}: ok")
        except Exception as e:  # ek company fail ho to baqi chalti rahein
            print(f"   [{i}/{len(kse100)}] {sym}: SKIP ({e})")

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
    stock_ret.to_csv("company_returns.csv", index=False)

    print("Step 4/4: Sector table bana raha hoon...")
    sector_tbl = (
        stock_ret.groupby(["sector", "year"])["return_pct"]
        .agg(["mean", "count"])
        .reset_index()
    )
    sector_tbl["mean"] = sector_tbl["mean"].round(1)
    wide = sector_tbl.pivot(index="sector", columns="year", values="mean")
    counts = sector_tbl.groupby("sector")["count"].max().rename("max_companies")
    wide = wide.join(counts)
    wide.to_csv("sector_returns.csv")

    print("\nHo gaya! Ye 2 files isi folder mein ban gayi hain:")
    print("   sector_returns.csv   <- ye mujhe bhejein")
    print("   company_returns.csv  <- ye bhi bhej dein (checking ke liye)")


if __name__ == "__main__":
    main()
