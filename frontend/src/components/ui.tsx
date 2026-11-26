import { AlertCircle, ArrowDownRight, ArrowUpRight, LoaderCircle, Search } from "lucide-react";
import { Link } from "react-router-dom";
import type { PropsWithChildren, ReactNode } from "react";
import type { Stock } from "../types";

export function formatMarketTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

export function formatMarketDate(value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("en-PK", { ...options, timeZone: "Asia/Karachi" }).format(new Date(value));
}

export function formatMarketTime(value: string) {
  return new Intl.DateTimeFormat("en-PK", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" }).format(new Date(value));
}

export function DataFreshness({
  source,
  status,
  lastUpdated,
  marketStatus,
}: {
  source: string;
  status?: string;
  lastUpdated?: string | null;
  marketStatus?: string | null;
}) {
  const freshness = status ?? (source === "DEMO" ? "DEMO" : "DATA UNAVAILABLE");
  const labels: Record<string, string> = {
    LIVE: "LIVE",
    DELAYED: "DELAYED",
    STALE: "STALE",
    "MARKET CLOSED": "MARKET CLOSED",
    "DATA UNAVAILABLE": "DATA UNAVAILABLE",
    UNAVAILABLE: "DATA UNAVAILABLE",
    FRESH: "FRESH",
    DEMO: "DEMO DATA",
  };
  const sourceLabel = source === "PSX_LENS" ? "PSX Lens" : source;
  const label = labels[freshness] ?? "DATA UNAVAILABLE";
  return (
    <div className={`notice-banner ${freshness === "STALE" ? "stale" : ""}`}>
      <span className="notice-dot" />
      <span><b>{label}</b>{source && ` · Source: ${sourceLabel}`}{marketStatus && ` · ${marketStatus}`}</span>
      <time>{lastUpdated ? `Last updated ${formatMarketTimestamp(lastUpdated)} PKT` : "Source timestamp unavailable"}</time>
    </div>
  );
}

export function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className = "" }: PropsWithChildren<{ title?: string; action?: ReactNode; className?: string }>) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && <div className="panel-heading">{title && <h2>{title}</h2>}{action}</div>}
      {children}
    </section>
  );
}

export function MetricCard({ label, value, change, icon }: { label: string; value: string; change?: number; icon: ReactNode }) {
  return (
    <div className="metric-card">
      <div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div>
      <strong>{value}</strong>
      {change !== undefined && <span className={`metric-change ${change >= 0 ? "positive" : "negative"}`}>{change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(change).toFixed(2)}%</span>}
    </div>
  );
}

export function DemoBadge() {
  return <span className="demo-badge"><span /> DEMO DATA</span>;
}

export function LoadingState({ label = "Loading market data…" }: { label?: string }) {
  return <div className="state-box"><LoaderCircle className="spin" size={19} />{label}</div>;
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="state-box error-state"><AlertCircle size={18} /><span>{message}</span>{retry && <button className="text-button" onClick={retry}>Retry</button>}</div>;
}

export function EmptyState({ message }: { message: string }) {
  return <div className="state-box"><Search size={18} />{message}</div>;
}

export function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("en-PK", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function formatCompact(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("en-PK");
}

export function StockTable({ stocks, action }: { stocks: Stock[]; action?: (stock: Stock) => ReactNode }) {
  if (!stocks.length) return <EmptyState message="No stocks match this view." />;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Symbol</th><th>Company</th><th>Sector</th><th className="number">Price (PKR)</th><th className="number">Change</th><th className="number">Volume</th><th className="number">Market cap</th>{action && <th className="number">Action</th>}</tr></thead>
        <tbody>
          {stocks.map((stock) => (
            <tr key={stock.symbol}>
              <td><Link className="symbol-link" to={`/stocks/${stock.symbol}`}>{stock.symbol}</Link></td>
              <td className="company-cell">{stock.name}</td>
              <td><span className="sector-tag">{stock.sector}</span></td>
              <td className="number">{formatNumber(stock.price)}</td>
              <td className={`number ${stock.change_pct >= 0 ? "positive" : "negative"}`}>{stock.change_pct >= 0 ? "+" : ""}{stock.change_pct.toFixed(2)}%</td>
              <td className="number">{stock.volume == null ? "—" : formatCompact(stock.volume)}</td>
              <td className="number">{stock.market_cap == null ? "—" : formatCompact(stock.market_cap)}</td>
              {action && <td className="number">{action(stock)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
