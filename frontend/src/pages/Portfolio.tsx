import { useEffect, useState, type FormEvent } from "react";
import { BriefcaseBusiness, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { DataFreshness, ErrorState, formatCompact, formatNumber, LoadingState, MetricCard, PageHeading, Panel } from "../components/ui";
import { api } from "../services/api";
import type { Stock } from "../types";

type Holding = Stock & { shares: number; average_cost: number; invested: number; current_value: number };

export function Portfolio() {
  const [items, setItems] = useState<Holding[]>([]);
  const [totals, setTotals] = useState({ invested: 0, current_value: 0, return_pct: 0 });
  const [symbol, setSymbol] = useState("");
  const [shares, setShares] = useState("");
  const [cost, setCost] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dataSource, setDataSource] = useState("PSX_LENS");
  const [freshnessStatus, setFreshnessStatus] = useState("DATA UNAVAILABLE");
  const [lastUpdated, setLastUpdated] = useState("");

  function load() {
    setLoading(true);
    api.portfolio().then((data) => {
      setItems(data.items);
      setTotals({ invested: data.invested, current_value: data.current_value, return_pct: data.return_pct });
      setDataSource(data.data_source ?? "PSX_LENS");
      setFreshnessStatus(data.freshness_status ?? "DELAYED");
      setLastUpdated(data.last_updated ?? "");
    }).catch((cause: Error) => setError(cause.message)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function addPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage("");
    try {
      const result = await api.addHolding({ symbol: symbol.trim().toUpperCase(), shares: Number(shares), average_cost: Number(cost) });
      setMessage(result.message);
      setSymbol(""); setShares(""); setCost("");
      load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this holding."); }
  }

  async function remove(symbolToRemove: string) {
    setError("");
    try { setMessage((await api.removeHolding(symbolToRemove)).message); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove this position."); }
  }

  return (
    <>
      <PageHeading title="My Portfolio" description="Track saved positions using the same delayed PSX Lens quotes as other pages." />
      <DataFreshness source={dataSource} status={error && items.length ? "STALE" : error ? "DATA UNAVAILABLE" : freshnessStatus} lastUpdated={lastUpdated} />
      {message && <div className="success-message">{message}</div>}
      {error && <ErrorState message={error} />}
      {loading ? <LoadingState label="Loading your portfolio…" /> : <>
        <div className="metric-grid">
          <MetricCard label="Total invested" value={`PKR ${formatCompact(totals.invested)}`} icon={<BriefcaseBusiness size={18} />} />
          <MetricCard label="Current value" value={`PKR ${formatCompact(totals.current_value)}`} icon={<BriefcaseBusiness size={18} />} />
          <div className="metric-card"><span className="metric-top">Total return</span><strong className={totals.return_pct >= 0 ? "positive" : "negative"}>{totals.return_pct > 0 ? "+" : ""}{totals.return_pct.toFixed(2)}%</strong><span className="muted">Calculated from delayed quotes</span></div>
          <div className="metric-card"><span className="metric-top">Unrealized P/L</span><strong className={totals.current_value >= totals.invested ? "positive" : "negative"}>PKR {formatCompact(totals.current_value - totals.invested)}</strong><span className="muted">Current value − invested</span></div>
        </div>
        <Panel title="Add a position">
          <form className="holding-form" onSubmit={addPosition}>
            <label>Stock symbol<input required maxLength={16} value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="e.g. HBL" /></label>
            <label>Shares<input required min="0.01" step="any" type="number" value={shares} onChange={(event) => setShares(event.target.value)} placeholder="Quantity" /></label>
            <label>Average cost (PKR)<input required min="0.01" step="any" type="number" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="Per share" /></label>
            <button type="submit" className="button"><Plus size={15} /> Add position</button>
          </form>
        </Panel>
        <Panel title={`Holdings · ${items.length}`}>
          {items.length === 0 ? <div className="empty-panel">No positions yet. Add a stock above to track its value.</div> : <div className="table-scroll"><table><thead><tr><th>Symbol</th><th>Company</th><th className="number">Shares</th><th className="number">Avg. cost</th><th className="number">Last price</th><th className="number">Invested</th><th className="number">Current value</th><th className="number">P/L</th><th className="number">Action</th></tr></thead><tbody>{items.map((item) => { const profit = item.current_value - item.invested; return <tr key={item.symbol}><td><Link className="symbol-link" to={`/stocks/${item.symbol}`}>{item.symbol}</Link></td><td className="company-cell">{item.name}</td><td className="number">{formatNumber(item.shares, 2)}</td><td className="number">{formatNumber(item.average_cost)}</td><td className="number">{formatNumber(item.price)}</td><td className="number">{formatCompact(item.invested)}</td><td className="number">{formatCompact(item.current_value)}</td><td className={`number ${profit >= 0 ? "positive" : "negative"}`}>{profit >= 0 ? "+" : ""}{formatCompact(profit)}</td><td className="number"><button className="icon-button danger-action" title={`Remove ${item.symbol}`} onClick={() => remove(item.symbol)}><Trash2 size={15} /></button></td></tr>; })}</tbody></table></div>}
        </Panel>
      </>}
    </>
  );
}
