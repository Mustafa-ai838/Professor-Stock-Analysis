import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Building2,
  DollarSign,
  Landmark,
  Newspaper,
  Plus,
  Tags,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { PriceChart } from "../components/PriceChart";
import {
  DataFreshness,
  ErrorState,
  formatCompact,
  formatMarketTimestamp,
  formatNumber,
  LoadingState,
  Panel,
} from "../components/ui";
import { api } from "../services/api";
import type { StockDetail as StockInfo } from "../types";
import { usePolling } from "../hooks/usePolling";

type Tab = "Overview" | "Technical Analysis" | "Financials" | "News" | "Company Info";

export function StockDetail() {
  const { symbol = "" } = useParams();
  const [stock, setStock] = useState<StockInfo | null>(null);
  const [dividends, setDividends] = useState<Array<{ ex_date: string; amount: number; currency: string; source?: string; inferred?: boolean }>>([]);
  const [newsList, setNewsList] = useState<Array<{ id: number; headline: string; summary: string; published_at: string; source: string }>>([]);
  const [dividendNote, setDividendNote] = useState("");
  const [tab, setTab] = useState<Tab>("Overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dividendError, setDividendError] = useState("");
  const [newsError, setNewsError] = useState("");
  const [message, setMessage] = useState("");
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    if (!symbol) return;
    const sequence = ++requestSequence.current;
    try {
      const result = await api.stock(symbol);
      if (requestSequence.current === sequence) {
        setStock(result);
        setError("");
      }
    } catch (cause) {
      if (requestSequence.current === sequence) {
        setError(cause instanceof Error ? cause.message : "Could not refresh stock data.");
      }
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  }, [symbol]);

  usePolling(load, Boolean(symbol));

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setDividendError("");
    setDividends([]);

    api.dividends(symbol).then((data) => {
      if (active) {
        setDividends(data.items);
        setDividendNote(data.data_note ?? "");
      }
    }).catch((cause: Error) => {
      if (active) setDividendError(cause.message);
    });
    api.news(symbol).then((data) => {
      if (active) setNewsList(data.items);
    }).catch((cause: Error) => {
      if (active) setNewsError(cause.message);
    });

    return () => {
      active = false;
    };
  }, [symbol]);

  async function addWatchlist() {
    setMessage("");
    try {
      const res = await api.addWatchlist(symbol);
      setMessage(res.message);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not update your watchlist.");
    }
  }

  const hasCurrentStock = stock?.symbol === symbol.toUpperCase();
  if (loading && !hasCurrentStock) return <LoadingState label={`Loading ${symbol.toUpperCase()} analysis…`} />;
  if (error && !hasCurrentStock)
    return (
      <>
        <DataFreshness source="UNAVAILABLE" status="UNAVAILABLE" />
        <ErrorState message={error || "Stock not found."} retry={load} />
      </>
    );
  if (!hasCurrentStock || !stock) return <LoadingState label={`Loading ${symbol.toUpperCase()} analysis…`} />;

  return (
    <>
      {/* Stock Heading */}
      <div className="stock-detail-heading">
        <div className="stock-symbol-icon">{stock.symbol.slice(0, 2)}</div>
        <div className="stock-name-block">
          <div className="stock-title-line">
            <h1>{stock.name}</h1>
            <span className="sector-tag">{stock.sector}</span>
          </div>
          <span className="muted">
            {stock.symbol} · Pakistan Stock Exchange
          </span>
        </div>
        <div className="stock-price-block">
          <strong>PKR {formatNumber(stock.price)}</strong>
          <span className={stock.change_pct >= 0 ? "positive" : "negative"}>
            {stock.change_pct > 0 ? "+" : ""}{stock.change_pct.toFixed(2)}% today
          </span>
        </div>
      </div>

      <DataFreshness
        source={stock.data_source}
        status={error ? "STALE" : stock.freshness_status}
        lastUpdated={stock.updated_at}
      />

      {error && <ErrorState message={`Refresh failed; showing previous quote. ${error}`} retry={load} />}
      {message && <div className={message.includes("already") ? "notice-banner" : "success-message"}>{message}</div>}

      {/* Stats Row */}
      <div className="metric-grid compact-grid" style={{ marginBottom: "16px" }}>
        <MetricCard label="Volume" value={stock.volume == null ? "—" : formatCompact(stock.volume)} icon={<TrendingUp size={15} />} />
        <MetricCard label="Day High" value={optionalPrice(stock.high)} icon={<TrendingUp size={15} />} />
        <MetricCard label="Day Low" value={optionalPrice(stock.low)} icon={<TrendingDown size={15} />} />
        <MetricCard label="52W High" value={optionalPrice(stock.high_52w)} icon={<TrendingUp size={15} />} />
        <MetricCard label="52W Low" value={optionalPrice(stock.low_52w)} icon={<TrendingDown size={15} />} />
      </div>

      {/* Tab Navigation */}
      <div className="tab-bar">
        {(["Overview", "Technical Analysis", "Financials", "News", "Company Info"] as Tab[]).map((item) => (
          <button
            key={item}
            className={tab === item ? "selected" : ""}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
        <button className="button button-small watch-add" onClick={addWatchlist}>
          <Plus size={14} /> Add to Watchlist
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {tab === "Overview" && (
        <>
          <div className="detail-grid">
            <Panel title={`${stock.symbol} · Price Trend & Volume`}>
              <PriceChart symbol={stock.symbol} />
            </Panel>

            <Panel title="Key Metrics" className="key-info-panel">
              <KeyValue label="P/E Ratio" value={stock.pe_ratio == null ? "—" : `${stock.pe_ratio.toFixed(2)}x`} />
              <KeyValue label="Dividend Yield" value={stock.dividend_yield == null ? "—" : `${stock.dividend_yield.toFixed(2)}%`} />
              <KeyValue label="Market Cap" value={stock.market_cap == null ? "—" : `PKR ${formatCompact(stock.market_cap)}`} />
              <KeyValue label="Sector" value={stock.sector} />
              <KeyValue label="RSI (14)" value={stock.rsi == null ? "—" : stock.rsi.toFixed(2)} />
              <KeyValue label="Open" value={optionalPrice(stock.open)} />
              <KeyValue label="Previous Close" value={optionalPrice(stock.previous_close)} />
              <KeyValue label="20-Day SMA" value={stock.sma20 == null ? "—" : `PKR ${formatNumber(stock.sma20)}`} />
            </Panel>
          </div>

          <Panel title="About Company">
            <p style={{ color: "#94a3b8", fontSize: "13px", lineHeight: "1.7", margin: 0 }}>
              {stock.company_description || `A company profile description for ${stock.name} is not available from PSX Lens.`}
            </p>
          </Panel>
        </>
      )}

      {/* TAB 2: TECHNICAL ANALYSIS */}
      {tab === "Technical Analysis" && (
        <>
          <div className="metric-grid compact-grid">
            <Metric
              label="RSI (14)"
              value={stock.rsi == null ? "—" : stock.rsi.toFixed(2)}
              description={stock.rsi == null ? "Unavailable" : stock.rsi > 70 ? "Overbought condition" : stock.rsi < 30 ? "Oversold condition" : "Neutral range (30-70)"}
            />
            <Metric
              label="SMA (20)"
              value={stock.sma20 == null ? "—" : `PKR ${formatNumber(stock.sma20)}`}
              description={stock.sma20 == null ? "Moving average unavailable" : stock.price >= stock.sma20 ? "Trading above 20-day trend" : "Trading below 20-day trend"}
            />
            <Metric
              label="Intraday Spread"
              value={stock.high == null || stock.low == null ? "—" : `PKR ${formatNumber(stock.high - stock.low)}`}
              description={stock.high == null || stock.low == null || stock.low === 0 ? "High/low data unavailable" : `${(((stock.high - stock.low) / stock.low) * 100).toFixed(2)}% daily range`}
            />
            <Metric
              label="Volume Momentum"
              value={stock.volume == null ? "—" : formatCompact(stock.volume)}
              description="Daily aggregate shares"
            />
          </div>
          <Panel title="Technical Indicators Chart · Interactive">
            <PriceChart symbol={stock.symbol} />
          </Panel>
        </>
      )}

      {/* TAB 3: FINANCIALS */}
      {tab === "Financials" && (
        <>
          <div className="metric-grid compact-grid">
            <Metric label="Earnings Multiple (P/E)" value={stock.pe_ratio == null ? "—" : `${stock.pe_ratio.toFixed(2)}x`} description={stock.pe_ratio == null ? "Not provided by the source" : "Reported by PSX Lens"} />
            <Metric label="Dividend Yield" value={stock.dividend_yield == null ? "—" : `${stock.dividend_yield.toFixed(2)}%`} description={stock.dividend_yield == null ? "Not provided by the source" : "Reported by PSX Lens"} />
            <Metric label="Market Cap" value={stock.market_cap == null ? "—" : `PKR ${formatCompact(stock.market_cap)}`} description={stock.market_cap == null ? "Not provided by the source" : "Reported by PSX Lens"} />
            <Metric label="Book Value" value="—" description="Not provided by PSX Lens" />
          </div>

          <Panel title="Dividend Distribution History">
            {dividendError ? (
              <ErrorState message={dividendError} />
            ) : (
              <>
              {dividendNote && <div className="notice-banner stale"><span className="notice-dot" /><span>{dividendNote}</span></div>}
              {dividends.length > 0 ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Ex-Dividend Date</th>
                      <th>Amount Per Share</th>
                      <th>Currency</th>
                      <th>Type</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dividends.map((dividend) => (
                      <tr key={dividend.ex_date}>
                        <td>{dividend.ex_date}</td>
                        <td className="number">PKR {dividend.amount.toFixed(2)}</td>
                        <td>{dividend.currency}</td>
                        <td>Cash Dividend</td>
                        <td>{dividend.inferred ? "Inferred from PSX XD marker" : dividend.source || "PSX Lens"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              ) : <div className="empty-panel">No dividend records are available from the provider for {stock.symbol}.</div>}
              </>
            )}
          </Panel>
        </>
      )}

      {/* TAB 4: NEWS */}
      {tab === "News" && (
        <Panel title={`${stock.symbol} Corporate Announcements`}>
          {newsError ? <ErrorState message={newsError} /> : newsList.length ? <div className="news-list">
            {newsList.map((item) => (
              <article className="news-card" key={item.id}>
                <div className="news-icon"><Newspaper size={20} /></div>
                <div className="news-body">
                  <div className="news-meta">
                    <span className="muted">{item.source}</span>
                    <time>{formatMarketTimestamp(item.published_at)} PKT</time>
                  </div>
                  <h2>{item.headline}</h2>
                  <p>{item.summary}</p>
                </div>
              </article>
            ))}
          </div> : <div className="empty-panel">No corporate announcements are available from the provider.</div>}
        </Panel>
      )}

      {/* TAB 5: COMPANY INFO */}
      {tab === "Company Info" && (
        <Panel title="Company Profile & Corporate Information">
          <div className="company-info-grid">
            <InfoBlock icon={<Building2 size={18} />} label="Company Name" value={stock.name} />
            <InfoBlock
              icon={<Tags size={18} />}
              label="Sector"
              value={<Link to={`/sectors?sector=${encodeURIComponent(stock.sector)}`}>{stock.sector}</Link>}
            />
            <InfoBlock icon={<Landmark size={18} />} label="Listing Exchange" value="Pakistan Stock Exchange (PSX)" />
            <InfoBlock
              icon={<DollarSign size={18} />}
              label="Market Capitalization"
              value={stock.market_cap == null ? "—" : `PKR ${formatCompact(stock.market_cap)}`}
            />
          </div>
          <p className="disclaimer-paragraph" style={{ marginTop: "16px" }}>
            Company and financial details are shown only when supplied by PSX Lens. Missing fields are unavailable rather than estimated.
          </p>
        </Panel>
      )}
    </>
  );
}

function optionalPrice(value: number | null | undefined) {
  return value == null ? "—" : `PKR ${formatNumber(value)}`;
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="key-value">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Metric({ label, value, description }: { label: string; value: string; description: string }) {
  return (
    <div className="metric-card">
      <span className="metric-top">{label}</span>
      <strong>{value}</strong>
      <small className="muted">{description}</small>
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function InfoBlock({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="info-block">
      <span>{icon}</span>
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

export default StockDetail;
