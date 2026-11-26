import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle,
  Layers,
  LineChart,
  Plus,
  Search,
  Sliders,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { PriceChart } from "../components/PriceChart";
import {
  DataFreshness,
  ErrorState,
  formatCompact,
  formatNumber,
  LoadingState,
  PageHeading,
  Panel,
} from "../components/ui";
import { api } from "../services/api";
import { usePolling } from "../hooks/usePolling";
import type { Stock, StockDetail } from "../types";

type AnalysisTab = "Chart" | "Indicators" | "Compare" | "Add to Watchlist";

const popularSymbols = ["OGDC", "PPL", "HBL", "MCB", "LUCK", "SYS", "ENGRO", "FFC", "HUBC"];

export function StockAnalysis() {
  const [symbol, setSymbol] = useState("OGDC");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Stock[]>([]);
  const [stock, setStock] = useState<StockDetail | null>(null);
  const [indicators, setIndicators] = useState<Record<string, unknown> | null>(null);
  const [activeTab, setActiveTab] = useState<AnalysisTab>("Chart");
  const [compareSymbol, setCompareSymbol] = useState("PPL");
  const [compareStock, setCompareStock] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [watchlistMessage, setWatchlistMessage] = useState("");
  const requestId = useRef(0);

  // Search autocomplete
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      api.stocks(query.trim())
        .then((res) => {
          if (active) setSuggestions(res.items.slice(0, 6));
        })
        .catch(() => {
          if (active) setSuggestions([]);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const loadSelectedStock = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    try {
      const [stockData, indicatorData] = await Promise.all([
        api.stock(symbol),
        api.indicators(symbol),
      ]);
      if (currentRequestId !== requestId.current) return;
      setStock(stockData);
      setIndicators(indicatorData);
      setError("");
    } catch (cause) {
      if (currentRequestId === requestId.current) {
        setError(cause instanceof Error ? cause.message : "Could not load stock data.");
      }
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    requestId.current += 1;
    setLoading(true);
    setError("");
    setWatchlistMessage("");
    setStock(null);
    setIndicators(null);
  }, [symbol]);

  usePolling(loadSelectedStock);

  // Load comparison stock if Compare tab active
  useEffect(() => {
    if (activeTab === "Compare" && compareSymbol) {
      api.stock(compareSymbol)
        .then(setCompareStock)
        .catch(() => setCompareStock(null));
    }
  }, [activeTab, compareSymbol]);

  async function handleAddWatchlist() {
    setWatchlistMessage("");
    try {
      const res = await api.addWatchlist(symbol);
      setWatchlistMessage(res.message);
    } catch (cause) {
      setWatchlistMessage(cause instanceof Error ? cause.message : "Failed to add to watchlist.");
    }
  }

  const latestRsi = indicators?.latest_rsi as number | null | undefined;
  const sma20 = stock?.sma20;
  const rsiSignal =
    latestRsi == null
      ? "Unavailable"
      : latestRsi > 70
      ? "Overbought (>70)"
      : latestRsi < 30
      ? "Oversold (<30)"
      : "Neutral (30–70)";

  const smaSignal =
    !stock || sma20 == null
      ? "Unavailable"
      : stock.price > sma20
      ? "Bullish (Above SMA20)"
      : "Bearish (Below SMA20)";

  return (
    <>
      <PageHeading
        title="Stock Analysis"
        description="Comprehensive technical indicators, oscillators, and multi-symbol comparison for PSX equities."
      />

      {/* Stock Selection Bar */}
      <div className="panel" style={{ marginBottom: "18px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", justifyContent: "space-between" }}>
          <div style={{ position: "relative", minWidth: "260px", maxWidth: "420px", flex: 1 }}>
            <div className="search-control" style={{ width: "100%" }}>
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search PSX symbol or company name…"
              />
            </div>
            {suggestions.length > 0 && (
              <div className="search-results" style={{ width: "100%" }}>
                {suggestions.map((item) => (
                  <button
                    key={item.symbol}
                    onClick={() => {
                      setSymbol(item.symbol);
                      setQuery("");
                      setSuggestions([]);
                    }}
                  >
                    <b>{item.symbol}</b>
                    <span>{item.name}</span>
                    <span className={item.change_pct >= 0 ? "positive" : "negative"}>
                      {item.change_pct > 0 ? "+" : ""}{item.change_pct.toFixed(2)}%
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: "11px" }}>Popular:</span>
            {popularSymbols.map((item) => (
              <button
                key={item}
                className={`button button-small ${symbol === item ? "" : "button-outline"}`}
                onClick={() => setSymbol(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && !stock ? (
        <LoadingState label={`Analyzing technical indicators for ${symbol}…`} />
      ) : error && !stock ? (
        <ErrorState message={error} retry={() => setSymbol(symbol)} />
      ) : stock ? (
        <>
          <div className="stock-detail-heading">
            <div className="stock-symbol-icon">{stock.symbol.slice(0, 2)}</div>
            <div className="stock-name-block">
              <div className="stock-title-line">
                <h1>{stock.name} ({stock.symbol})</h1>
                <span className="sector-tag">{stock.sector}</span>
              </div>
              <span className="muted">
                PSX Listed · delayed data from PSX Lens
              </span>
            </div>
            <div className="stock-price-block">
              <strong>PKR {formatNumber(stock.price)}</strong>
              <span className={stock.change_pct >= 0 ? "positive" : "negative"}>
                {stock.change_pct >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {stock.change_pct > 0 ? "+" : ""}{stock.change_pct.toFixed(2)}%
              </span>
            </div>
          </div>

          <DataFreshness
            source={stock.data_source}
            status={error ? "STALE" : stock.freshness_status ?? "DATA UNAVAILABLE"}
            lastUpdated={stock.updated_at}
          />
          {error && (
            <ErrorState
              message={`Showing the last available ${stock.symbol} data. Latest refresh failed: ${error}`}
              retry={() => void loadSelectedStock()}
            />
          )}

          {watchlistMessage && (
            <div className="success-message" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <CheckCircle size={16} /> {watchlistMessage}
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="tab-bar">
            {(["Chart", "Indicators", "Compare", "Add to Watchlist"] as AnalysisTab[]).map((tab) => (
              <button
                key={tab}
                className={activeTab === tab ? "selected" : ""}
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === "Add to Watchlist") {
                    handleAddWatchlist();
                  }
                }}
              >
                {tab === "Chart" && <LineChart size={14} style={{ marginRight: "5px", verticalAlign: "middle" }} />}
                {tab === "Indicators" && <Sliders size={14} style={{ marginRight: "5px", verticalAlign: "middle" }} />}
                {tab === "Compare" && <Layers size={14} style={{ marginRight: "5px", verticalAlign: "middle" }} />}
                {tab === "Add to Watchlist" && <Plus size={14} style={{ marginRight: "5px", verticalAlign: "middle" }} />}
                {tab}
              </button>
            ))}
          </div>

          {/* Tab 1: Chart */}
          {activeTab === "Chart" && (
            <Panel title={`${stock.symbol} · Technical Price & Indicator Chart`}>
              <PriceChart symbol={stock.symbol} />
            </Panel>
          )}

          {/* Tab 2: Indicators */}
          {activeTab === "Indicators" && (
            <>
              <div className="metric-grid">
                <div className="metric-card">
                  <span className="metric-top">Relative Strength Index (RSI 14)</span>
                  <strong>{latestRsi == null ? "—" : latestRsi.toFixed(2)}</strong>
                  <span className={latestRsi != null && latestRsi > 70 ? "negative" : latestRsi != null && latestRsi < 30 ? "positive" : "muted"}>
                    {rsiSignal}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-top">20-day Simple Moving Average (SMA 20)</span>
                  <strong>{sma20 == null ? "—" : `PKR ${formatNumber(sma20)}`}</strong>
                  <span className={sma20 == null ? "muted" : stock.price >= sma20 ? "positive" : "negative"}>
                    {smaSignal}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-top">Day High / Day Low</span>
                  <strong>{stock.high == null || stock.low == null ? "—" : `PKR ${formatNumber(stock.high)} / ${formatNumber(stock.low)}`}</strong>
                  <span className="muted">{stock.high == null || stock.low == null ? "High/low data unavailable" : `Range: PKR ${formatNumber(stock.high - stock.low)}`}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-top">Trading Volume</span>
                  <strong>{stock.volume == null ? "—" : formatCompact(stock.volume)}</strong>
                  <span className="muted">Total shares exchanged</span>
                </div>
              </div>

              <div className="dashboard-grid">
                <Panel title="Oscillator & Momentum Breakdown">
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div className="key-value">
                      <span>RSI (14) Momentum:</span>
                      <b>{latestRsi == null ? "—" : latestRsi.toFixed(2)} ({rsiSignal})</b>
                    </div>
                    <div className="key-value">
                      <span>Trend Bias (Price vs SMA 20):</span>
                      <b className={sma20 == null ? "muted" : stock.price >= sma20 ? "positive" : "negative"}>
                        {sma20 == null ? "Unavailable" : stock.price >= sma20 ? "Bullish Momentum" : "Bearish Momentum"}
                      </b>
                    </div>
                    <div className="key-value">
                      <span>Previous Close:</span>
                      <b>{stock.previous_close == null ? "—" : `PKR ${formatNumber(stock.previous_close)}`}</b>
                    </div>
                    <div className="key-value">
                      <span>Opening Price:</span>
                      <b>{stock.open == null ? "—" : `PKR ${formatNumber(stock.open)}`}</b>
                    </div>
                    <div className="key-value">
                      <span>Dividend Yield:</span>
                      <b>{stock.dividend_yield == null ? "—" : `${stock.dividend_yield.toFixed(2)}%`}</b>
                    </div>
                    <div className="key-value">
                      <span>Market Capitalization:</span>
                      <b>{stock.market_cap == null ? "—" : `PKR ${formatCompact(stock.market_cap)}`}</b>
                    </div>
                  </div>
                </Panel>

                <Panel title="Chart Overlay with Selected Indicators">
                  <PriceChart symbol={stock.symbol} compact />
                </Panel>
              </div>
            </>
          )}

          {/* Tab 3: Compare */}
          {activeTab === "Compare" && (
            <Panel title={`Compare ${stock.symbol} with Another PSX Stock`}>
              <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
                <span className="muted" style={{ fontSize: "12px" }}>Select Benchmark / Peer:</span>
                <select
                  value={compareSymbol}
                  onChange={(e) => setCompareSymbol(e.target.value)}
                  style={{
                    background: "#0c1828",
                    color: "#e4ebf5",
                    border: "1px solid #203249",
                    borderRadius: "6px",
                    padding: "6px 12px",
                    fontSize: "12px",
                  }}
                >
                  {popularSymbols
                    .filter((s) => s !== stock.symbol)
                    .map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                </select>
              </div>

              {compareStock ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th className="number">{stock.symbol} (Primary)</th>
                        <th className="number">{compareStock.symbol} (Peer)</th>
                        <th>Comparison</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Current Price (PKR)</td>
                        <td className="number"><b>{formatNumber(stock.price)}</b></td>
                        <td className="number"><b>{formatNumber(compareStock.price)}</b></td>
                        <td>{stock.price > compareStock.price ? `${stock.symbol} trades higher` : `${compareStock.symbol} trades higher`}</td>
                      </tr>
                      <tr>
                        <td>Daily Change %</td>
                        <td className={`number ${stock.change_pct >= 0 ? "positive" : "negative"}`}>
                          {stock.change_pct > 0 ? "+" : ""}{stock.change_pct.toFixed(2)}%
                        </td>
                        <td className={`number ${compareStock.change_pct >= 0 ? "positive" : "negative"}`}>
                          {compareStock.change_pct > 0 ? "+" : ""}{compareStock.change_pct.toFixed(2)}%
                        </td>
                        <td>
                          {stock.change_pct >= compareStock.change_pct ? (
                            <span className="positive"><TrendingUp size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: "4px" }} />{stock.symbol} leading today</span>
                          ) : (
                            <span className="negative"><TrendingDown size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: "4px" }} />{compareStock.symbol} leading today</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>Sector</td>
                        <td className="number"><span className="sector-tag">{stock.sector}</span></td>
                        <td className="number"><span className="sector-tag">{compareStock.sector}</span></td>
                        <td>{stock.sector === compareStock.sector ? "Same sector peers" : "Cross-sector comparison"}</td>
                      </tr>
                      <tr>
                        <td>Market Cap</td>
                        <td className="number">{stock.market_cap == null ? "—" : `PKR ${formatCompact(stock.market_cap)}`}</td>
                        <td className="number">{compareStock.market_cap == null ? "—" : `PKR ${formatCompact(compareStock.market_cap)}`}</td>
                        <td>{stock.market_cap == null || compareStock.market_cap == null ? "Comparison unavailable" : stock.market_cap > compareStock.market_cap ? `${stock.symbol} larger market cap` : `${compareStock.symbol} larger market cap`}</td>
                      </tr>
                      <tr>
                        <td>Dividend Yield</td>
                        <td className="number">{stock.dividend_yield == null ? "—" : `${stock.dividend_yield.toFixed(2)}%`}</td>
                        <td className="number">{compareStock.dividend_yield == null ? "—" : `${compareStock.dividend_yield.toFixed(2)}%`}</td>
                        <td>{stock.dividend_yield == null || compareStock.dividend_yield == null ? "Comparison unavailable" : stock.dividend_yield >= compareStock.dividend_yield ? `${stock.symbol} higher yield` : `${compareStock.symbol} higher yield`}</td>
                      </tr>
                      <tr>
                        <td>Volume</td>
                        <td className="number">{stock.volume == null ? "—" : formatCompact(stock.volume)}</td>
                        <td className="number">{compareStock.volume == null ? "—" : formatCompact(compareStock.volume)}</td>
                        <td>{stock.volume == null || compareStock.volume == null ? "Comparison unavailable" : stock.volume >= compareStock.volume ? `${stock.symbol} more liquid` : `${compareStock.symbol} more liquid`}</td>
                      </tr>
                      <tr>
                        <td>RSI (14)</td>
                        <td className="number">{stock.rsi == null ? "—" : stock.rsi.toFixed(2)}</td>
                        <td className="number">{compareStock.rsi == null ? "—" : compareStock.rsi.toFixed(2)}</td>
                        <td className="muted">Technical relative strength</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <LoadingState label={`Loading comparative data for ${compareSymbol}…`} />
              )}
            </Panel>
          )}

          {/* Tab 4: Add to Watchlist */}
          {activeTab === "Add to Watchlist" && (
            <Panel title="Watchlist Management">
              <div style={{ padding: "16px 0" }}>
                <p style={{ color: "#94a3b8", fontSize: "13px", marginBottom: "16px" }}>
                  Add <b>{stock.symbol}</b> ({stock.name}) to your tracked portfolio watchlist. Changes are persisted to your local SQLite database account.
                </p>
                <button className="button" onClick={handleAddWatchlist}>
                  <Plus size={16} /> Add {stock.symbol} to Watchlist Now
                </button>
              </div>
            </Panel>
          )}
        </>
      ) : null}
    </>
  );
}

export default StockAnalysis;
