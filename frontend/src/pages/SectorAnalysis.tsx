import { useEffect, useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpWideNarrow, PieChart as PieChartIcon, Tags } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link, useSearchParams } from "react-router-dom";
import { DataFreshness, ErrorState, LoadingState, PageHeading, Panel } from "../components/ui";
import { api } from "../services/api";
import type { Sector } from "../types";

const periods = ["1D"];
const PIE_COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

export function SectorAnalysis() {
  const [searchParams] = useSearchParams();
  const selectedName = searchParams.get("sector");
  const [period, setPeriod] = useState("1D");
  const [rows, setRows] = useState<Sector[]>([]);
  const [dataSource, setDataSource] = useState("PSX_LENS");
  const [freshnessStatus, setFreshnessStatus] = useState("DATA UNAVAILABLE");
  const [lastUpdated, setLastUpdated] = useState("");
  const [descending, setDescending] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.sectors(period)
      .then((result) => {
        if (active) {
          setRows(result.items);
          if (result.data_source) setDataSource(result.data_source);
          if (result.freshness_status) setFreshnessStatus(result.freshness_status);
          if (result.last_updated) setLastUpdated(result.last_updated);
        }
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [period, refreshKey]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (descending ? -1 : 1) * (a.change_pct - b.change_pct)),
    [rows, descending]
  );

  const topSectors = useMemo(() => {
    return [...rows].sort((a, b) => b.change_pct - a.change_pct).slice(0, 5);
  }, [rows]);

  const worstSectors = useMemo(() => {
    return [...rows].sort((a, b) => a.change_pct - b.change_pct).slice(0, 3);
  }, [rows]);

  const pieData = useMemo(() => {
    return rows.map((sector) => ({
      name: sector.name,
      value: sector.stock_count || 1,
    }));
  }, [rows]);

  const selected = rows.find((sector) => sector.name === selectedName);

  return (
    <>
      <PageHeading
        title="Sector Performance"
        description="Latest-session performance of sectors reported by the delayed PSX Lens feed."
        action={
          <div className="range-switcher">
            {periods.map((item) => (
              <button
                key={item}
                className={period === item ? "selected" : ""}
                onClick={() => setPeriod(item)}
              >
                {item}
              </button>
            ))}
          </div>
        }
      />

      <DataFreshness
        source={error && rows.length === 0 ? "UNAVAILABLE" : dataSource}
        status={error || loading ? (rows.length ? "STALE" : "UNAVAILABLE") : freshnessStatus}
        lastUpdated={lastUpdated}
      />

      {error && rows.length === 0 ? (
        <ErrorState message={error} retry={() => setRefreshKey((key) => key + 1)} />
      ) : loading && rows.length === 0 ? (
        <LoadingState label={`Calculating ${period} sector performance…`} />
      ) : (
        <>
          {error && (
            <ErrorState message={`Showing previously loaded sector data. Latest refresh failed: ${error}`} />
          )}
          {selected && (
            <Panel title={`${selected.name} · Sector Detail`}>
              <div className="sector-focus">
                <div>
                  <span className="muted">{selected.stock_count} listed stocks · {period} return</span>
                  <strong className={selected.change_pct >= 0 ? "positive" : "negative"}>
                    {selected.change_pct > 0 ? "+" : ""}{selected.change_pct.toFixed(2)}%
                  </strong>
                </div>
                <div className="sector-focus-stocks">
                  {selected.top_stocks.map((stock) => (
                    <Link key={stock.symbol} to={`/stocks/${stock.symbol}`}>
                      <b>{stock.symbol}</b>
                      <span>{stock.name}</span>
                      <strong className={(stock.period_change_pct ?? stock.change_pct) >= 0 ? "positive" : "negative"}>
                        {(stock.period_change_pct ?? stock.change_pct).toFixed(2)}%
                      </strong>
                    </Link>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          <div className="dashboard-grid">
            <Panel
              title={`Sector Performance Bar Chart · ${period}`}
              action={
                <button
                  className="icon-button"
                  title="Toggle sort order"
                  onClick={() => setDescending((val) => !val)}
                >
                  {descending ? <ArrowDownWideNarrow size={16} /> : <ArrowUpWideNarrow size={16} />}
                </button>
              }
            >
              <div className="sector-chart">
                <ResponsiveContainer width="100%" height={290}>
                  <BarChart data={sorted} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#1b2a3d" vertical={false} />
                    <XAxis
                      dataKey="name"
                      stroke="#526176"
                      tick={{ fill: "#8290a4", fontSize: 10 }}
                      interval={0}
                      angle={-15}
                      textAnchor="end"
                      height={55}
                    />
                    <YAxis
                      stroke="#526176"
                      tick={{ fill: "#8290a4", fontSize: 10 }}
                      tickFormatter={(value: number) => `${value}%`}
                    />
                    <Tooltip
                      contentStyle={{ background: "#0d1929", border: "1px solid #26384d", borderRadius: 8 }}
                      formatter={(value) => [`${Number(value).toFixed(2)}%`, "Change"]}
                    />
                    <Bar dataKey="change_pct" radius={[4, 4, 0, 0]}>
                      {sorted.map((sector) => (
                        <Cell
                          key={sector.name}
                          fill={sector.change_pct >= 0 ? "#10b981" : "#ef4444"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Sector Comparison · Stock Weight" action={<PieChartIcon size={16} className="muted" />}>
              <div className="sector-chart" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ResponsiveContainer width="100%" height={290}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                    >
                      {pieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "#0d1929", border: "1px solid #26384d", borderRadius: 8 }}
                      formatter={(val, name) => [`${val} stocks`, String(name)]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <div className="dashboard-grid">
            <Panel title="Top Sectors (Top 5)">
              <div className="rank-list">
                {topSectors.map((sector, index) => (
                  <div className="rank-row" key={sector.name}>
                    <span className="rank-number">{index + 1}</span>
                    <span className="rank-name">
                      {sector.name}
                      <small>{sector.stock_count} constituents</small>
                    </span>
                    <strong className="positive">
                      {sector.change_pct > 0 ? "+" : ""}{sector.change_pct.toFixed(2)}%
                    </strong>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Worst Sectors (Bottom 3)">
              <div className="rank-list">
                {worstSectors.map((sector, index) => (
                  <div className="rank-row" key={sector.name}>
                    <span className="rank-number">{index + 1}</span>
                    <span className="rank-name">
                      {sector.name}
                      <small>{sector.stock_count} constituents</small>
                    </span>
                    <strong className="negative">
                      {sector.change_pct > 0 ? "+" : ""}{sector.change_pct.toFixed(2)}%
                    </strong>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Sector Constituents" action={<span className="result-count">{sorted.length} sectors</span>}>
            <div className="sector-card-grid">
              {sorted.map((sector) => (
                <article className="sector-card" key={sector.name}>
                  <div className="sector-card-head">
                    <span className="sector-icon"><Tags size={16} /></span>
                    <span>{sector.name}</span>
                    <b className={sector.change_pct >= 0 ? "positive" : "negative"}>
                      {sector.change_pct > 0 ? "+" : ""}{sector.change_pct.toFixed(2)}%
                    </b>
                  </div>
                  <div className="sector-card-meta">
                    {sector.stock_count} listed stocks · {period} return
                  </div>
                  <div className="sector-constituents">
                    <div>
                      <small>Leading</small>
                      {sector.top_stocks.slice(0, 2).map((stock) => (
                        <Link key={stock.symbol} to={`/stocks/${stock.symbol}`}>
                          <b>{stock.symbol}</b>
                          <span className={(stock.period_change_pct ?? stock.change_pct) >= 0 ? "positive" : "negative"}>
                            {(stock.period_change_pct ?? stock.change_pct).toFixed(2)}%
                          </span>
                        </Link>
                      ))}
                    </div>
                    <div>
                      <small>Lagging</small>
                      {sector.worst_stocks.slice(-2).reverse().map((stock) => (
                        <Link key={stock.symbol} to={`/stocks/${stock.symbol}`}>
                          <b>{stock.symbol}</b>
                          <span className={(stock.period_change_pct ?? stock.change_pct) >= 0 ? "positive" : "negative"}>
                            {(stock.period_change_pct ?? stock.change_pct).toFixed(2)}%
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        </>
      )}
    </>
  );
}

export default SectorAnalysis;
