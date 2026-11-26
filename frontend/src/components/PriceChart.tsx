import { useEffect, useState, type MouseEvent } from "react";
import { ApiError, api } from "../services/api";
import type { PricePoint } from "../types";
import { ErrorState, formatMarketDate, formatMarketTime, formatMarketTimestamp, LoadingState } from "./ui";

const ranges = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"];
type IndicatorKey = "volume" | "rsi" | "sma" | "macd" | "bollinger";
type ChartPoint = PricePoint & {
  rsi?: number | null;
  sma20?: number | null;
  upper?: number | null;
  lower?: number | null;
  macd?: number | null;
  macdSignal?: number | null;
};
const defaultIndicators: Record<IndicatorKey, boolean> = { volume: true, rsi: false, sma: true, macd: false, bollinger: false };
const chartWidth = 900;
const chartHeight = 320;
const plotLeft = 14;
const plotRight = 72;
const plotTop = 13;
const priceBottom = 218;
const volumeTop = 236;
const volumeBottom = 306;

function linePath(points: ChartPoint[], key: "sma20" | "upper" | "lower", xAt: (index: number) => number, yAt: (value: number) => number) {
  return points.map((point, index) => {
    const value = point[key];
    return value == null ? "" : `${index === 0 || points[index - 1][key] == null ? "M" : "L"}${xAt(index).toFixed(2)},${yAt(value).toFixed(2)}`;
  }).filter(Boolean).join(" ");
}

function MiniLine({ values, min, max, color }: { values: Array<number | null | undefined>; min: number; max: number; color: string }) {
  const width = 900;
  const height = 118;
  const left = 32;
  const right = 18;
  const top = 8;
  const bottom = 105;
  const path = values.map((value, index) => {
    if (value == null) return "";
    const x = left + index / Math.max(1, values.length - 1) * (width - left - right);
    const y = bottom - (value - min) / Math.max(0.0001, max - min) * (bottom - top);
    return `${index === 0 || values[index - 1] == null ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).filter(Boolean).join(" ");
  return <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"><path className="indicator-band" d={`M${left},${top} H${width - right} V${bottom} H${left} Z`} /><path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}

export function PriceChart({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const [range, setRange] = useState("1M");
  const [indicatorsOn, setIndicatorsOn] = useState(defaultIndicators);
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [lastUpdated, setLastUpdated] = useState("");
  const [dataSource, setDataSource] = useState("PSX_LENS");
  const [freshnessStatus, setFreshnessStatus] = useState("DATA UNAVAILABLE");
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([api.history(symbol, range), api.indicators(symbol)])
      .then(([history, indicators]) => {
        if (!active) return;
        const arrays = indicators as {
          rsi?: Array<number | null>;
          sma20?: Array<number | null>;
          bollinger?: { upper?: Array<number | null>; lower?: Array<number | null> };
          macd?: Array<number | null>;
          macd_signal?: Array<number | null>;
        };
        const offset = Math.max(0, (arrays.rsi?.length ?? 0) - history.items.length);
        const mapped = history.items.map((point, index) => {
          const indicatorIndex = index + offset;
          return {
            ...point,
            rsi: arrays.rsi?.[indicatorIndex] ?? null,
            sma20: arrays.sma20?.[indicatorIndex] ?? null,
            upper: arrays.bollinger?.upper?.[indicatorIndex] ?? null,
            lower: arrays.bollinger?.lower?.[indicatorIndex] ?? null,
            macd: arrays.macd?.[indicatorIndex] ?? null,
            macdSignal: arrays.macd_signal?.[indicatorIndex] ?? null,
          };
        });
        setPoints(mapped);
        setLastUpdated(history.last_updated ?? "");
        setDataSource(history.data_source);
        setFreshnessStatus(history.freshness_status ?? "DELAYED");
        setActiveIndex(Math.max(0, mapped.length - 1));
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : "Could not load chart data."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [symbol, range]);

  const toggle = (name: IndicatorKey) => setIndicatorsOn((current) => ({ ...current, [name]: !current[name] }));

  if (loading) return <LoadingState label="Loading historical chart…" />;
  if (error) return <ErrorState message={error} />;
  if (!points.length) return <div className="state-box">No historical data is available for this range.</div>;

  const active = points[activeIndex] ?? points[points.length - 1];
  const minPrice = Math.min(...points.map((point) => point.low));
  const maxPrice = Math.max(...points.map((point) => point.high));
  const priceRange = Math.max(maxPrice - minPrice, maxPrice * 0.02);
  const domainMin = minPrice - priceRange * 0.04;
  const domainMax = maxPrice + priceRange * 0.04;
  const plotWidth = chartWidth - plotLeft - plotRight;
  const xAt = (index: number) => plotLeft + (points.length <= 1 ? 0 : index / (points.length - 1) * plotWidth);
  const yAt = (value: number) => priceBottom - (value - domainMin) / (domainMax - domainMin) * (priceBottom - plotTop);
  const maxVolume = Math.max(...points.map((point) => point.volume), 1);
  const macdValues = points.flatMap((point) => [point.macd, point.macdSignal]).filter((value): value is number => value != null);
  const macdMin = Math.min(...macdValues, -0.01);
  const macdMax = Math.max(...macdValues, 0.01);

  function moveCursor(event: MouseEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width * chartWidth;
    const position = Math.max(0, Math.min(1, (x - plotLeft) / plotWidth));
    setActiveIndex(Math.round(position * (points.length - 1)));
  }

  return (
    <div className="chart-wrap">
      {!compact && <div className="chart-toolbar">
        <div className="range-switcher">{ranges.map((item) => <button key={item} className={range === item ? "selected" : ""} onClick={() => setRange(item)}>{item}</button>)}</div>
        <div className="indicator-switcher">{(["volume", "rsi", "sma", "macd", "bollinger"] as IndicatorKey[]).map((item) => <label key={item} className="check-label"><input type="checkbox" checked={indicatorsOn[item]} onChange={() => toggle(item)} />{item === "sma" ? "Moving avg" : item === "bollinger" ? "Bollinger" : item.toUpperCase()}</label>)}</div>
      </div>}
      <div className="chart-readout"><b>{range === "1D" ? formatMarketTime(active.timestamp) : formatMarketDate(active.timestamp, { year: "numeric", month: "short", day: "numeric" })}</b><span>O {active.open.toFixed(2)}</span><span>H {active.high.toFixed(2)}</span><span>L {active.low.toFixed(2)}</span><span>C {active.close.toFixed(2)}</span><span>Vol {active.volume.toLocaleString()}</span></div>
      <div className={`price-chart ${compact ? "compact-chart" : ""}`}>
        <svg className="candlestick-svg" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label={`${symbol} ${range} candlestick chart`} onMouseMove={moveCursor} onMouseLeave={() => setActiveIndex(points.length - 1)}>
          {[0, 1, 2, 3, 4].map((step) => {
            const value = domainMin + (domainMax - domainMin) * step / 4;
            const y = yAt(value);
            return <g key={step}><line x1={plotLeft} x2={chartWidth - plotRight} y1={y} y2={y} stroke="#1b2a3d" strokeWidth="1" vectorEffect="non-scaling-stroke" /><text x={chartWidth - plotRight + 8} y={y + 3} fill="#8290a4" fontSize="10">{value.toFixed(0)}</text></g>;
          })}
          {points.map((point, index) => {
            const x = xAt(index);
            const up = point.close >= point.open;
            const color = up ? "#18b885" : "#ef5968";
            const width = Math.max(1, Math.min(9, plotWidth / points.length * 0.62));
            const bodyY = Math.min(yAt(point.open), yAt(point.close));
            const bodyHeight = Math.max(1, Math.abs(yAt(point.open) - yAt(point.close)));
            const volumeHeight = point.volume / maxVolume * (volumeBottom - volumeTop);
            return <g key={point.timestamp} className={index === activeIndex ? "candle-active" : ""}><line x1={x} x2={x} y1={yAt(point.high)} y2={yAt(point.low)} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" /><rect x={x - width / 2} y={bodyY} width={width} height={bodyHeight} fill={color} rx=".5" />{indicatorsOn.volume && <rect x={x - width / 2} y={volumeBottom - volumeHeight} width={width} height={volumeHeight} fill={color} opacity=".42" />}<title>{`${formatMarketDate(point.timestamp, { year: "numeric", month: "short", day: "numeric" })} · O ${point.open} H ${point.high} L ${point.low} C ${point.close} · Volume ${point.volume.toLocaleString()}`}</title></g>;
          })}
          {indicatorsOn.bollinger && <><path d={linePath(points, "upper", xAt, yAt)} fill="none" stroke="#416a93" strokeWidth="1.1" vectorEffect="non-scaling-stroke" /><path d={linePath(points, "lower", xAt, yAt)} fill="none" stroke="#416a93" strokeWidth="1.1" vectorEffect="non-scaling-stroke" /></>}
          {indicatorsOn.sma && <path d={linePath(points, "sma20", xAt, yAt)} fill="none" stroke="#f3b84b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
          <line x1={xAt(activeIndex)} x2={xAt(activeIndex)} y1={plotTop} y2={volumeBottom} stroke="#7387a0" strokeDasharray="3 4" opacity=".48" vectorEffect="non-scaling-stroke" />
          {points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 5)) === 0).map((point) => <text key={`date-${point.timestamp}`} x={xAt(points.indexOf(point))} y="318" fill="#8290a4" fontSize="10" textAnchor="middle">{range === "1D" ? formatMarketTime(point.timestamp) : formatMarketDate(point.timestamp)}</text>)}
        </svg>
      </div>
      {indicatorsOn.volume && <div className="chart-legend"><span className="volume-key" />Volume <span className="muted">{active.volume.toLocaleString()}</span></div>}
      {!compact && indicatorsOn.rsi && <div className="indicator-chart"><div className="indicator-caption">RSI (14) <b>{active.rsi == null ? "—" : active.rsi.toFixed(2)}</b></div><MiniLine values={points.map((point) => point.rsi)} min={0} max={100} color="#36c8bd" /></div>}
      {!compact && indicatorsOn.macd && <div className="indicator-chart"><div className="indicator-caption">MACD (12, 26, 9) <b>{active.macd == null ? "—" : active.macd.toFixed(2)}</b></div><div className="macd-legend"><span>MACD</span><span>Signal</span></div><MiniLine values={points.map((point) => point.macd)} min={macdMin} max={macdMax} color="#af85ff" /><MiniLine values={points.map((point) => point.macdSignal)} min={macdMin} max={macdMax} color="#ee9c57" /></div>}
      <div className="chart-disclaimer">{freshnessStatus} · Source: {dataSource === "PSX_LENS" ? "PSX Lens" : dataSource} · {lastUpdated ? `Last updated ${formatMarketTimestamp(lastUpdated)} PKT` : "Source timestamp unavailable"}</div>
    </div>
  );
}
