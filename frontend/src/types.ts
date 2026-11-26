export type FreshnessStatus =
  | "LIVE"
  | "DELAYED"
  | "STALE"
  | "MARKET CLOSED"
  | "DATA UNAVAILABLE"
  | "UNAVAILABLE"
  | "FRESH"
  | "DEMO";

export interface Stock {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change?: number | null;
  change_pct: number;
  volume: number | null;
  market_cap: number | null;
  dividend_yield: number | null;
  pe_ratio?: number | null;
  high_52w?: number | null;
  low_52w?: number | null;
  updated_at?: string | null;
  last_traded?: string | null;
  freshness_status?: FreshnessStatus;
  cache_status?: string;
  period_change_pct?: number;
  rsi_daily?: number | null;
  rsi_weekly?: number | null;
  rsi_monthly?: number | null;
  rsi?: number | null;
  timeframe?: "daily" | "weekly" | "monthly" | string;
  spot_price?: number;
  daily_price?: number;
  weekly_price?: number;
  monthly_price?: number;
  latest_dividend?: number | null;
  trailing_12m_dps?: number | null;
  last_dividend_amount?: number | null;
  last_dividend_date?: string | null;
  last_dividend_note?: string | null;
  next_dividend_amount?: number | null;
  next_dividend_date?: string | null;
  next_dividend_note?: string | null;
  last_earning_date?: string | null;
  last_earning_note?: string | null;
  next_earning_date?: string | null;
  next_earning_note?: string | null;
  is_favorite?: boolean;
  data_source: string;
}

export interface PricePoint {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Sector {
  name: string;
  change_pct: number;
  stock_count: number;
  top_stocks: Stock[];
  worst_stocks: Stock[];
}

export interface MarketOverview {
  index: { name: string; value: number | null; change: number | null; change_pct: number | null };
  indices?: { index_id: string; name: string; value: number | null; change: number | null; change_pct: number | null }[];
  market_volume: number | null;
  market_value: number | null;
  market_cap: number | null;
  total_trades: number | null;
  traded_symbols: number | null;
  advances: number | null;
  declines: number | null;
  unchanged?: number;
  stocks: Stock[];
  gainers: Stock[];
  losers: Stock[];
  active: Stock[];
  sectors: Sector[];
  data_source: string;
  last_updated: string | null;
  freshness_status?: FreshnessStatus;
  cache_status?: string;
  market_status?: string;
  market_state?: string | null;
  session_date?: string | null;
}

export interface HistoryResponse {
  symbol: string;
  range: string;
  data_source: string;
  last_updated: string | null;
  last_session?: string | null;
  omitted_bars?: number;
  high_low_note?: string | null;
  freshness_status?: FreshnessStatus;
  cache_status?: string;
  items: PricePoint[];
}

export interface StockDetail extends Stock {
  open: number | null;
  high: number | null;
  low: number | null;
  previous_close: number | null;
  rsi: number | null;
  sma20: number | null;
  change: number | null;
  company_description?: string | null;
  company_website?: string | null;
  market_status?: string | null;
}

export interface ScreenerResponse {
  items: Stock[];
  total: number;
  timeframe?: "daily" | "weekly" | "monthly" | string;
  sectors?: string[];
  data_source: string;
  last_updated?: string;
  freshness_status?: FreshnessStatus;
  cache_status?: string;
  dividend_status?: string;
  dividend_note?: string | null;
  unsupported_filters?: string[];
}
