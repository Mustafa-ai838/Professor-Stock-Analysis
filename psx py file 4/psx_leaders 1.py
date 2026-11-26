"""
PSX sector ke badshah (sab se bari company) - VERSION 2 (jaanch ke saath)

Chalane ka tareeqa (CMD, usi folder mein):
  python psx_leaders.py

Banne wali files (dono mujhe bhej dein):
  sector_leaders.csv   -> har sector ki top 5 companies
  leaders_debug.txt    -> script ne kya dekha (column ke naam waghera), taake koi masla ho to foran theek ho sake
"""
import re
import sys

import numpy as np
import pandas as pd

TOP_N = 5
LOG = []


def log(msg=""):
    print(msg)
    LOG.append(str(msg))


def find_col(df, candidates):
    lower = {str(c).lower().strip(): c for c in df.columns}
    for cand in candidates:
        if cand in lower:
            return lower[cand]
    for key, orig in lower.items():
        for cand in candidates:
            if cand in key:
                return orig
    return None


def find_cap_col(df):
    """Market cap wala column: naam mein 'cap' ho (capital nahi)."""
    for c in df.columns:
        k = str(c).lower()
        if "cap" in k and "capital" not in k:
            return c
    return None


def parse_mcap(x):
    s = str(x).replace(",", "").replace("PKR", "").replace("Rs.", "").replace("Rs", "").strip().upper()
    if not s or s in ("NAN", "NONE", "-", "N/A"):
        return np.nan
    mult = 1.0
    for suf, m in (("T", 1e12), ("B", 1e9), ("M", 1e6), ("K", 1e3)):
        if s.endswith(suf):
            mult, s = m, s[:-1].strip()
            break
    try:
        return float(s) * mult
    except ValueError:
        return np.nan



def safe_save(write_fn, name):
    """Agar file kisi aur program mein khuli ho (Permission denied) to naye naam se save karta hai."""
    import os, time
    base, ext = os.path.splitext(name)
    for attempt in (name, f"{base}_{time.strftime('%H%M%S')}{ext}"):
        try:
            write_fn(attempt)
            return attempt
        except PermissionError:
            print(f"   (File '{attempt}' khuli hui hai, naye naam se save kar raha hoon...)")
    return None

def is_temporary(sym):
    """XD / XB / XR waghera = dividend, bonus, right ke arzi codes - asli company nahi."""
    return bool(re.search(r"(XD|XB|XR|XA|XDB|XBR)$", sym)) and len(sym) > 4


def build(scr, meta, kse100):
    log(f"screener: {len(scr)} rows, columns = {list(scr.columns)}")
    log(f"symbols : {len(meta)} rows, columns = {list(meta.columns)}")
    log("screener ki pehli 3 qatarein:")
    log(scr.head(3).to_string())

    sym_col = find_col(scr, ["symbol", "ticker", "scrip"])
    cap_col = find_cap_col(scr)
    log(f"symbol column = {sym_col} | market cap column = {cap_col}")
    if sym_col is None or cap_col is None:
        log("ERROR: screener mein symbol ya market cap column nahi mila.")
        return None

    ms = find_col(meta, ["symbol", "ticker", "scrip"])
    mc = find_col(meta, ["sector_name", "sector"])
    log(f"symbols: symbol column = {ms} | sector column = {mc}")
    sector_of = {str(r[ms]).strip(): str(r[mc]).strip() for _, r in meta.iterrows()}

    df = pd.DataFrame({"symbol": scr[sym_col].astype(str).str.strip(),
                       "market_cap_raw": scr[cap_col].astype(str)})
    df["market_cap"] = scr[cap_col].map(parse_mcap).values
    log(f"market cap parse hui: {int(df['market_cap'].notna().sum())} / {len(df)}")
    df = df[~df["symbol"].map(is_temporary)]
    df["sector"] = df["symbol"].map(sector_of)
    log(f"sector mila: {int(df['sector'].notna().sum())} / {len(df)}")
    df = df.dropna(subset=["market_cap", "sector"])
    df = df[df["market_cap"] > 0].drop_duplicates(subset="symbol")
    df = df[~df["sector"].str.upper().str.contains("FUND|EXCHANGE TRADED|DEBT|GEM", regex=True)]
    log(f"filter ke baad baqi companies: {len(df)}")
    if df.empty:
        return None
    df["sector_total"] = df.groupby("sector")["market_cap"].transform("sum")
    df["share_of_sector_pct"] = (df["market_cap"] / df["sector_total"] * 100).round(1)
    df = df.sort_values(["sector", "market_cap"], ascending=[True, False])
    df["rank"] = df.groupby("sector").cumcount() + 1
    df["in_kse100"] = df["symbol"].isin(kse100)
    out = df[df["rank"] <= TOP_N]
    return out[["sector", "rank", "symbol", "market_cap", "market_cap_raw",
                "share_of_sector_pct", "in_kse100"]].reset_index(drop=True)


def main():
    import psxdata
    log("PSX se screener aur symbols ki list le raha hoon...")
    scr = psxdata.screener()
    meta = psxdata.symbols()
    idx = psxdata.indices("KSE100")
    ic = find_col(idx, ["symbol", "ticker", "scrip"])
    kse100 = {str(s).strip() for s in idx[ic].dropna().unique()}
    log(f"KSE-100 list: {len(kse100)} companies")
    out = build(scr, meta, kse100)
    if out is None:
        log("\nSector leaders nahi ban sake. leaders_debug.txt mujhe bhej dein.")
    else:
        saved_csv = safe_save(lambda p: out.to_csv(p, index=False), "sector_leaders.csv")
        log("\nSector ke badshah (sab se bari company):")
        for _, r in out[out["rank"] == 1].iterrows():
            log(f"  {str(r['sector'])[:42]:42s} {str(r['symbol']):8s} {str(r['market_cap_raw']):>14s}  ({r['share_of_sector_pct']}%)")
        log(f"\nHo gaya! '{saved_csv}' aur leaders_debug.txt isi folder mein hain - dono bhej dein.")
    def _w(p):
        with open(p, "w", encoding="utf-8") as f:
            f.write("\n".join(LOG))
    safe_save(_w, "leaders_debug.txt")


if __name__ == "__main__":
    main()
