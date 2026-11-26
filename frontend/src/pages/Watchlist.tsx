import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { api } from "../services/api";
import type { Stock } from "../types";
import { DataFreshness, ErrorState, LoadingState, PageHeading, Panel, StockTable } from "../components/ui";
import { usePolling } from "../hooks/usePolling";

export function Watchlist() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("All Sectors");
  const [suggestions, setSuggestions] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [freshnessStatus, setFreshnessStatus] = useState("DATA UNAVAILABLE");
  const [dataSource, setDataSource] = useState("PSX_LENS");
  const [unavailableSymbols, setUnavailableSymbols] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await api.watchlist();
      setStocks(data.items);
      setUnavailableSymbols(data.unavailable_symbols ?? []);
      setLastUpdated(data.last_updated ?? "");
      setFreshnessStatus(data.freshness_status ?? "DATA UNAVAILABLE");
      setDataSource(data.data_source);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh your watchlist.");
    } finally {
      setLoading(false);
    }
  }, []);
  usePolling(load);
  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); return; }
    let active = true;
    api.stocks(query.trim()).then((data) => { if (active) setSuggestions(data.items.slice(0, 5)); }).catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [query]);
  const sectors = useMemo(() => Array.from(new Set(stocks.map((stock) => stock.sector))).sort(), [stocks]);
  const visibleStocks = useMemo(() => sector === "All Sectors" ? stocks : stocks.filter((stock) => stock.sector === sector), [stocks, sector]);

  async function add(symbol: string) {
    setError(""); setMessage("");
    try { const result = await api.addWatchlist(symbol); setMessage(result.message); setQuery(""); setSuggestions([]); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add this stock."); }
  }

  async function remove(symbol: string) {
    setError(""); setMessage("");
    try { const result = await api.removeWatchlist(symbol); setMessage(result.message); load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove this stock."); }
  }

  return (
    <>
      <PageHeading title="My Watchlist" description="Track saved PSX symbols using delayed market quotes." action={<div className="add-stock-field"><label className="field-control"><Search size={15} /><input placeholder="Find a stock…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>{query && suggestions.length > 0 && <div className="suggestion-list">{suggestions.map((stock) => <button key={stock.symbol} onClick={() => add(stock.symbol)}><span><b>{stock.symbol}</b><small>{stock.name}</small></span><Plus size={16} /></button>)}</div>}</div>} />
      <DataFreshness source={error && !stocks.length ? "UNAVAILABLE" : dataSource} status={error && !loading ? (stocks.length ? "STALE" : "UNAVAILABLE") : freshnessStatus} lastUpdated={lastUpdated} />
      <div className="notice-banner"><span className="notice-dot" /><span>Watchlist symbols are saved in SQLite and quotes are refreshed from the shared PSX Lens cache.</span></div>
      {unavailableSymbols.length > 0 && <div className="notice-banner stale"><span className="notice-dot" /><span>Quotes unavailable for: {unavailableSymbols.join(", ")}</span></div>}
      {message && <div className="success-message">{message}</div>}
      {error && <ErrorState message={stocks.length ? `Refresh failed; showing the previous watchlist. ${error}` : error} retry={load} />}
      <Panel title={`${visibleStocks.length} of ${stocks.length} stocks`} className="watchlist-panel" action={<select aria-label="Filter watchlist by sector" value={sector} onChange={(event) => setSector(event.target.value)}><option>All Sectors</option>{sectors.map((item) => <option key={item}>{item}</option>)}</select>}>
        {loading ? <LoadingState label="Loading saved watchlist…" /> :
          <StockTable stocks={visibleStocks} action={(stock) => <button className="icon-button danger-action" title={`Remove ${stock.symbol}`} aria-label={`Remove ${stock.symbol}`} onClick={() => remove(stock.symbol)}><Trash2 size={15} /></button>} />}
      </Panel>
    </>
  );
}
