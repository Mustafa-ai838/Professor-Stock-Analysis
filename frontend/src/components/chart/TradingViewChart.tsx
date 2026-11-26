import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Maximize2, RotateCcw, Settings, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineWidth,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { PricePoint } from "../../types";
import { BandFillPrimitive } from "./BandFillPrimitive";
import {
  computeBollingerBands,
  computeMaArray,
  computeMovingAverage,
  computeRsi,
  hexToRgba,
  type ChartIndicatorsState,
  type LineDashStyle,
} from "./indicatorsMath";
import type { SettingsTarget } from "./IndicatorModals";

interface TradingViewChartProps {
  symbol: string;
  timeframe: string;
  bars: PricePoint[];
  indicators: ChartIndicatorsState;
  onUpdateIndicators: (next: ChartIndicatorsState) => void;
  onOpenSettings: (target: SettingsTarget) => void;
  onRemoveMa: (id: string) => void;
  onToggleIndicator: (kind: "bollinger" | "rsi" | "volume", enabled: boolean) => void;
}

interface HoveredReadout {
  index: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePct: number;
}

function toChartTime(ts: string, isIntraday: boolean): Time {
  if (isIntraday) {
    return Math.floor(Date.parse(ts) / 1000) as UTCTimestamp;
  }
  return ts.slice(0, 10) as Time;
}

function toLineStyle(style: LineDashStyle): LineStyle {
  if (style === "dashed") return LineStyle.Dashed;
  if (style === "dotted") return LineStyle.Dotted;
  return LineStyle.Solid;
}

function toLineWidth(w: number): LineWidth {
  return Math.max(1, Math.min(4, Math.round(w))) as LineWidth;
}

function formatCompactVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(2)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(2)}K`;
  return String(vol);
}

function initialVisibleCount(timeframe: string, total: number): number {
  const tf = timeframe.toUpperCase();
  if (tf === "1D") return Math.min(total, 250); // ~1 full trading year
  if (tf === "1W") return Math.min(total, 120); // ~2.5 years weekly candles
  if (tf === "1M") return Math.min(total, 64);  // Show all available months (~5.5 years) on 1M
  if (tf === "3M") return Math.min(total, 24);  // ~6 years quarterly
  if (tf === "1Y") return Math.min(total, 12);
  if (tf === "4H") return Math.min(total, 160);
  if (tf === "1H") return Math.min(total, 160);
  if (tf === "15M") return Math.min(total, 140);
  if (tf === "5M") return Math.min(total, 120);
  return Math.min(total, 100);
}

export function TradingViewChart({
  symbol,
  timeframe,
  bars,
  indicators,
  onUpdateIndicators,
  onOpenSettings,
  onRemoveMa,
  onToggleIndicator,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lastViewKeyRef = useRef<string>("");
  const savedLogicalRangeRef = useRef<{ from: number; to: number } | null>(null);

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [paneOffsets, setPaneOffsets] = useState<{ rsiTop: number }>({
    rsiTop: 450,
  });

  const isIntraday = useMemo(
    () => bars.some((b) => b.timestamp.includes("T")) || ["5m", "15m", "1H", "4H"].includes(timeframe),
    [bars, timeframe],
  );

  // Deduplicate and ensure strict ascending order for lightweight-charts
  const normalizedData = useMemo(() => {
    const seen = new Set<string | number>();
    const cleanBars: PricePoint[] = [];
    const chartTimes: Time[] = [];

    const sorted = [...bars].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (const bar of sorted) {
      const t = toChartTime(bar.timestamp, isIntraday);
      const key = typeof t === "object" ? JSON.stringify(t) : t;
      if (seen.has(key)) continue;
      if (isIntraday && Number.isNaN(t)) continue;
      seen.add(key);
      cleanBars.push(bar);
      chartTimes.push(t);
    }
    return { cleanBars, chartTimes };
  }, [bars, isIntraday]);

  const { cleanBars, chartTimes } = normalizedData;

  // Compute all indicator series arrays aligned 1:1 with cleanBars
  const computed = useMemo(() => {
    const maArrays = indicators.mas.map((ma) => ({
      config: ma,
      values: computeMovingAverage(cleanBars, ma.length, ma.source, ma.type, ma.offset),
    }));

    const bb = indicators.bollinger.enabled
      ? computeBollingerBands(
          cleanBars,
          indicators.bollinger.length,
          indicators.bollinger.source,
          indicators.bollinger.basisType,
          indicators.bollinger.stdDev,
          indicators.bollinger.offset,
        )
      : null;

    const rsiData = indicators.rsi.enabled
      ? computeRsi(cleanBars, indicators.rsi.length, indicators.rsi.source, indicators.rsi.maType, indicators.rsi.maLength)
      : null;

    const volMa =
      indicators.volume.enabled && indicators.volume.showMa
        ? computeMaArray(
            cleanBars.map((b) => b.volume),
            indicators.volume.maLength,
            "SMA",
          )
        : null;

    return { maArrays, bb, rsiData, volMa };
  }, [cleanBars, indicators]);

  // Active readout for OHLC + indicator legend values
  const activeIdx = hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < cleanBars.length
    ? hoveredIdx
    : cleanBars.length - 1;

  const activeReadout = useMemo<HoveredReadout | null>(() => {
    if (activeIdx < 0 || !cleanBars[activeIdx]) return null;
    const bar = cleanBars[activeIdx];
    const prevClose = activeIdx > 0 ? cleanBars[activeIdx - 1].close : bar.open;
    const change = bar.close - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    return {
      index: activeIdx,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      change,
      changePct,
    };
  }, [cleanBars, activeIdx]);

  // Create & manage TradingView Lightweight Chart + Panes + Series
  useEffect(() => {
    const container = containerRef.current;
    if (!container || cleanBars.length === 0) return;

    const viewKey = `${symbol}:${timeframe}`;
    const isSameView = lastViewKeyRef.current === viewKey;
    if (isSameView && chartRef.current) {
      const range = chartRef.current.timeScale().getVisibleLogicalRange();
      if (range) savedLogicalRangeRef.current = { from: range.from, to: range.to };
    } else {
      savedLogicalRangeRef.current = null;
    }

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#787b86",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
        fontSize: 11,
        panes: {
          enableResize: true,
          separatorColor: "#e0e3eb",
          separatorHoverColor: "#2962ff",
        },
      },
      grid: {
        vertLines: { color: "#f2f4f8", style: LineStyle.Solid },
        horzLines: { color: "#f2f4f8", style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "#9598a1",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#2962ff",
        },
        horzLine: {
          color: "#9598a1",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#2962ff",
        },
      },
      rightPriceScale: {
        borderColor: "#e0e3eb",
        autoScale: true,
        scaleMargins: { top: 0.04, bottom: 0.12 },
        alignLabels: true,
      },
      timeScale: {
        borderColor: "#e0e3eb",
        timeVisible: isIntraday,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 5.5,
        minBarSpacing: 0.2,
        lockVisibleTimeRangeOnResize: true,
        shiftVisibleRangeOnNewBar: false,
      },
      kineticScroll: {
        mouse: false,
        touch: true,
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
    });
    chartRef.current = chart;

    // --- PANE 0: Main Candlestick Chart ---
    const candleSeries = chart.addSeries(
      CandlestickSeries,
      {
        upColor: "#089981",
        downColor: "#f23645",
        borderVisible: false,
        wickUpColor: "#089981",
        wickDownColor: "#f23645",
        priceLineVisible: true,
        priceLineColor: "#2962ff",
        priceLineStyle: LineStyle.Dashed,
        priceLineWidth: 1,
        lastValueVisible: true,
      },
      0,
    );

    candleSeries.setData(
      cleanBars.map((b, i) => ({
        time: chartTimes[i],
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );

    // Bollinger Bands Overlay on Pane 0
    if (indicators.bollinger.enabled && computed.bb && indicators.bollinger.visible) {
      const bbCfg = indicators.bollinger;
      const bbUpperData = cleanBars
        .map((_, i) => (computed.bb!.upper[i] != null ? { time: chartTimes[i], value: computed.bb!.upper[i]! } : null))
        .filter((x): x is { time: Time; value: number } => x !== null);
      const bbBasisData = cleanBars
        .map((_, i) => (computed.bb!.basis[i] != null ? { time: chartTimes[i], value: computed.bb!.basis[i]! } : null))
        .filter((x): x is { time: Time; value: number } => x !== null);
      const bbLowerData = cleanBars
        .map((_, i) => (computed.bb!.lower[i] != null ? { time: chartTimes[i], value: computed.bb!.lower[i]! } : null))
        .filter((x): x is { time: Time; value: number } => x !== null);

      let upperSeries: ISeriesApi<"Line", Time> | null = null;
      if (bbCfg.showUpper !== false) {
        upperSeries = chart.addSeries(
          LineSeries,
          {
            color: bbCfg.upperColor || bbCfg.bandColor,
            lineWidth: toLineWidth(bbCfg.upperLineWidth ?? bbCfg.lineWidth),
            lineStyle: toLineStyle(bbCfg.upperLineStyle || bbCfg.lineStyle),
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          },
          0,
        );
        upperSeries.setData(bbUpperData);
      }

      if (bbCfg.showLower !== false) {
        const lowerSeries = chart.addSeries(
          LineSeries,
          {
            color: bbCfg.lowerColor || bbCfg.bandColor,
            lineWidth: toLineWidth(bbCfg.lowerLineWidth ?? bbCfg.lineWidth),
            lineStyle: toLineStyle(bbCfg.lowerLineStyle || bbCfg.lineStyle),
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          },
          0,
        );
        lowerSeries.setData(bbLowerData);
      }

      if (bbCfg.showBasis) {
        const basisSeries = chart.addSeries(
          LineSeries,
          {
            color: bbCfg.basisColor,
            lineWidth: toLineWidth(bbCfg.basisLineWidth ?? Math.max(1.5, bbCfg.lineWidth)),
            lineStyle: toLineStyle(bbCfg.basisLineStyle || bbCfg.lineStyle),
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          },
          0,
        );
        basisSeries.setData(bbBasisData);
      }

      if (bbCfg.showFill && bbCfg.showUpper !== false && bbCfg.showLower !== false && upperSeries) {
        const fillPrimitive = new BandFillPrimitive(hexToRgba(bbCfg.fillColor, bbCfg.fillOpacity));
        upperSeries.attachPrimitive(fillPrimitive);
        const cloudPoints = cleanBars
          .map((_, i) => {
            const up = computed.bb!.upper[i];
            const lo = computed.bb!.lower[i];
            return up != null && lo != null ? { time: chartTimes[i], upper: up, lower: lo } : null;
          })
          .filter((x): x is { time: Time; upper: number; lower: number } => x !== null);
        fillPrimitive.setData(cloudPoints);
      }
    }

    // Moving Averages Overlay on Pane 0 — single continuous solid lines
    for (const ma of computed.maArrays) {
      if (!ma.config.visible) continue;
      const maSeries = chart.addSeries(
        LineSeries,
        {
          color: ma.config.color,
          lineWidth: toLineWidth(ma.config.lineWidth),
          lineStyle: LineStyle.Solid,
          lineVisible: true,
          pointMarkersVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: true,
        },
        0,
      );
      const pts = cleanBars
        .map((_, i) => (ma.values[i] != null ? { time: chartTimes[i], value: ma.values[i]! } : null))
        .filter((x): x is { time: Time; value: number } => x !== null);
      maSeries.setData(pts);
    }

    // --- Volume Histogram (Overlaid at bottom of Pane 0, like TradingView) ---
    if (indicators.volume.enabled) {
      const vCfg = indicators.volume;
      const volSeries = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          priceLineVisible: false,
          lastValueVisible: false,
        },
        0,
      );

      if (vCfg.visible) {
        volSeries.setData(
          cleanBars.map((b, i) => {
            const isUp =
              vCfg.colorMode === "prevClose"
                ? b.close >= (i > 0 ? cleanBars[i - 1].close : b.open)
                : b.close >= b.open;
            return {
              time: chartTimes[i],
              value: b.volume,
              color: hexToRgba(isUp ? vCfg.upColor : vCfg.downColor, vCfg.opacity),
            };
          }),
        );

        if (vCfg.showMa && computed.volMa) {
          const volMaSeries = chart.addSeries(
            LineSeries,
            {
              color: vCfg.maColor,
              lineWidth: 1,
              priceScaleId: "volume",
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            },
            0,
          );
          volMaSeries.setData(
            cleanBars
              .map((_, i) => (computed.volMa![i] != null ? { time: chartTimes[i], value: computed.volMa![i]! } : null))
              .filter((x): x is { time: Time; value: number } => x !== null),
          );
        }
      }
      const volScale = chart.panes()[0]?.priceScale("volume") ?? chart.priceScale("volume", 0);
      volScale?.applyOptions({
        scaleMargins: { top: 0.88, bottom: 0 },
      });
    }

    // --- PANE 1 (optional): RSI Oscillator — single continuous solid line ---
    let rsiPaneIdx: number | null = null;
    if (indicators.rsi.enabled && computed.rsiData) {
      rsiPaneIdx = 1;
      const rCfg = indicators.rsi;
      const rsiSeries = chart.addSeries(
        LineSeries,
        {
          color: rCfg.visible ? rCfg.color : "transparent",
          lineWidth: toLineWidth(rCfg.lineWidth),
          lineStyle: toLineStyle(rCfg.lineStyle || "solid"),
          lineVisible: rCfg.visible,
          pointMarkersVisible: false,
          priceLineVisible: false,
          lastValueVisible: rCfg.visible,
          crosshairMarkerVisible: true,
          autoscaleInfoProvider: () => ({
            priceRange: { minValue: 0, maxValue: 100 },
          }),
        },
        rsiPaneIdx,
      );

      if (rCfg.visible) {
        rsiSeries.setData(
          cleanBars
            .map((_, i) => (computed.rsiData!.rsi[i] != null ? { time: chartTimes[i], value: computed.rsiData!.rsi[i]! } : null))
            .filter((x): x is { time: Time; value: number } => x !== null),
        );

        if (rCfg.showUpper !== false) {
          rsiSeries.createPriceLine({
            price: rCfg.upperLevel,
            color: rCfg.upperColor || "#089981",
            lineWidth: 1,
            lineStyle: toLineStyle(rCfg.upperLineStyle || "dashed"),
            axisLabelVisible: true,
            title: "",
          });
        }

        if (rCfg.showLower !== false) {
          rsiSeries.createPriceLine({
            price: rCfg.lowerLevel,
            color: rCfg.lowerColor || "#089981",
            lineWidth: 1,
            lineStyle: toLineStyle(rCfg.lowerLineStyle || "dashed"),
            axisLabelVisible: true,
            title: "",
          });
        }

        if (rCfg.showMiddle) {
          rsiSeries.createPriceLine({
            price: rCfg.middleLevel ?? 50,
            color: rCfg.middleColor || "#787b86",
            lineWidth: 1,
            lineStyle: toLineStyle(rCfg.middleLineStyle || "dotted"),
            axisLabelVisible: true,
            title: "",
          });
        }

        if (rCfg.showFill && rCfg.showUpper !== false && rCfg.showLower !== false) {
          const rsiFill = new BandFillPrimitive(hexToRgba(rCfg.upperColor || rCfg.color, rCfg.fillOpacity));
          rsiSeries.attachPrimitive(rsiFill);
          const bandPts = cleanBars
            .map((_, i) =>
              computed.rsiData!.rsi[i] != null
                ? { time: chartTimes[i], upper: rCfg.upperLevel, lower: rCfg.lowerLevel }
                : null,
            )
            .filter((x): x is { time: Time; upper: number; lower: number } => x !== null);
          rsiFill.setData(bandPts);
        }

        if (rCfg.maType !== "None") {
          const rsiMaSeries = chart.addSeries(
            LineSeries,
            {
              color: rCfg.maColor,
              lineWidth: 1,
              lineStyle: LineStyle.Solid,
              lineVisible: true,
              pointMarkersVisible: false,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            },
            rsiPaneIdx,
          );
          rsiMaSeries.setData(
            cleanBars
              .map((_, i) => (computed.rsiData!.ma[i] != null ? { time: chartTimes[i], value: computed.rsiData!.ma[i]! } : null))
              .filter((x): x is { time: Time; value: number } => x !== null),
          );
        }
      }
      chart.panes()[rsiPaneIdx]?.priceScale("right").applyOptions({
        scaleMargins: { top: 0.08, bottom: 0.08 },
      });
    }

    // Apply balanced TradingView pane stretch proportions (85% Candlesticks+Vol, 15% RSI thin ~80-90px)
    const panes = chart.panes();
    if (panes.length >= 2) {
      panes[0].setStretchFactor(0.85);
      panes[1].setStretchFactor(0.15);
    } else if (panes.length === 1) {
      panes[0].setStretchFactor(1.0);
    }

    // Restore pan/zoom if merely adjusting indicators; fit neatly for new symbol/timeframe
    if (isSameView && savedLogicalRangeRef.current) {
      chart.timeScale().setVisibleLogicalRange(savedLogicalRangeRef.current);
    } else {
      const visibleCount = initialVisibleCount(timeframe, cleanBars.length);
      if (cleanBars.length > visibleCount) {
        chart.timeScale().setVisibleLogicalRange({
          from: cleanBars.length - visibleCount - 0.5,
          to: cleanBars.length + 2.5,
        });
      } else {
        chart.timeScale().fitContent();
      }
    }
    lastViewKeyRef.current = viewKey;

    // Crosshair hover lookup
    const timeKeyToIndex = new Map<string, number>();
    chartTimes.forEach((t, i) => {
      timeKeyToIndex.set(typeof t === "object" ? JSON.stringify(t) : String(t), i);
    });

    const handleCrosshair = (param: { time?: Time }) => {
      if (!param.time) {
        setHoveredIdx(null);
        return;
      }
      const key = typeof param.time === "object" ? JSON.stringify(param.time) : String(param.time);
      const idx = timeKeyToIndex.get(key);
      setHoveredIdx(idx ?? null);
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    // Sync floating sub-pane labels directly with actual lightweight-charts pane heights
    const syncPanePositions = () => {
      const currentPanes = chart.panes();
      const h0 = currentPanes[0]?.getHeight() ?? 380;
      const nextRsi = Math.round(h0 + 6);
      setPaneOffsets((prev) =>
        prev.rsiTop === nextRsi ? prev : { rsiTop: nextRsi },
      );
    };

    const rafId = requestAnimationFrame(syncPanePositions);
    const resizeObs = new ResizeObserver(() => syncPanePositions());
    resizeObs.observe(container);

    // Prevent outer window scroll while mouse wheel zooms over chart canvas
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    container.addEventListener("wheel", handleWheel, { passive: false });

    // Double click to reset view
    const handleDblClick = () => {
      resetZoom();
    };
    container.addEventListener("dblclick", handleDblClick);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("dblclick", handleDblClick);
      cancelAnimationFrame(rafId);
      resizeObs.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.remove();
      chartRef.current = null;
    };
  }, [cleanBars, chartTimes, computed, indicators, isIntraday, symbol, timeframe]);

  const zoomStep = (factor: number) => {
    const chart = chartRef.current;
    if (!chart) return;
    const range = chart.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const span = range.to - range.from;
    const nextSpan = Math.max(12, Math.min(cleanBars.length + 10, span * factor));
    const rightAnchor = range.to;
    chart.timeScale().setVisibleLogicalRange({
      from: rightAnchor - nextSpan,
      to: rightAnchor,
    });
  };

  const resetZoom = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const visibleCount = initialVisibleCount(timeframe, cleanBars.length);
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(-1, cleanBars.length - visibleCount - 0.5),
      to: cleanBars.length + 2.5,
    });
    chart.panes()[0]?.priceScale("right")?.applyOptions({ autoScale: true });
    if (chart.panes().length > 1) {
      chart.panes()[1]?.priceScale("right")?.applyOptions({ autoScale: true });
    }
  };

  const toggleMaVisibility = (id: string) => {
    onUpdateIndicators({
      ...indicators,
      mas: indicators.mas.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)),
    });
  };

  return (
    <div className="tv-chart-stage">
      {/* Main TradingView Canvas Host */}
      <div ref={containerRef} className="tv-chart-canvas" />

      {/* Top-Left Legend Overlay: OHLC + Active Price Indicators (Pane 0) */}
      <div className="tv-legend-stack">
        {activeReadout && (
          <div className="tv-ohlc-bar">
            <span>
              O <b className={activeReadout.close >= activeReadout.open ? "tv-up" : "tv-down"}>{activeReadout.open.toFixed(2)}</b>
            </span>
            <span>
              H <b className={activeReadout.close >= activeReadout.open ? "tv-up" : "tv-down"}>{activeReadout.high.toFixed(2)}</b>
            </span>
            <span>
              L <b className={activeReadout.close >= activeReadout.open ? "tv-up" : "tv-down"}>{activeReadout.low.toFixed(2)}</b>
            </span>
            <span>
              C <b className={activeReadout.close >= activeReadout.open ? "tv-up" : "tv-down"}>{activeReadout.close.toFixed(2)}</b>
            </span>
            <span className={activeReadout.change >= 0 ? "tv-up" : "tv-down"}>
              {activeReadout.change >= 0 ? "+" : ""}
              {activeReadout.change.toFixed(2)} ({activeReadout.changePct >= 0 ? "+" : ""}
              {activeReadout.changePct.toFixed(2)}%)
            </span>
          </div>
        )}

        {/* Volume Legend Pill (Pane 0 overlaid at bottom) */}
        {indicators.volume.enabled && (
          <div className={`tv-legend-pill ${!indicators.volume.visible ? "muted" : ""}`}>
            <button
              type="button"
              className="tv-legend-label"
              onClick={() => onOpenSettings({ kind: "volume" })}
              title="Click to open Volume settings"
            >
              <span>Vol</span>
              {activeReadout && <b className="tv-legend-val">{formatCompactVolume(activeReadout.volume)}</b>}
            </button>
            <div className="tv-legend-tools">
              <button
                type="button"
                title={indicators.volume.visible ? "Hide" : "Show"}
                onClick={() =>
                  onUpdateIndicators({
                    ...indicators,
                    volume: { ...indicators.volume, visible: !indicators.volume.visible },
                  })
                }
              >
                {indicators.volume.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button type="button" title="Settings" onClick={() => onOpenSettings({ kind: "volume" })}>
                <Settings size={12} />
              </button>
              <button type="button" title="Remove" onClick={() => onToggleIndicator("volume", false)}>
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Active Moving Averages */}
        {computed.maArrays.map(({ config, values }) => {
          const val = activeIdx >= 0 ? values[activeIdx] : null;
          return (
            <div key={config.id} className={`tv-legend-pill ${!config.visible ? "muted" : ""}`}>
              <button
                type="button"
                className="tv-legend-label"
                onClick={() => onOpenSettings({ kind: "ma", id: config.id })}
                title="Click to open settings"
              >
                <span
                  className="tv-legend-line"
                  style={{ backgroundColor: config.color, height: `${Math.max(2, Math.min(4, config.lineWidth))}px` }}
                />
                <span>
                  {config.type} {config.length} {config.source}
                </span>
                {val != null && (
                  <b className="tv-legend-val" style={{ color: config.color }}>
                    {val.toFixed(2)}
                  </b>
                )}
              </button>
              <div className="tv-legend-tools">
                <button
                  type="button"
                  title={config.visible ? "Hide" : "Show"}
                  onClick={() => toggleMaVisibility(config.id)}
                >
                  {config.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <button
                  type="button"
                  title="Settings"
                  onClick={() => onOpenSettings({ kind: "ma", id: config.id })}
                >
                  <Settings size={12} />
                </button>
                <button type="button" title="Remove" onClick={() => onRemoveMa(config.id)}>
                  <X size={12} />
                </button>
              </div>
            </div>
          );
        })}

        {/* Active Bollinger Bands */}
        {indicators.bollinger.enabled && computed.bb && (
          <div className={`tv-legend-pill ${!indicators.bollinger.visible ? "muted" : ""}`}>
            <button
              type="button"
              className="tv-legend-label"
              onClick={() => onOpenSettings({ kind: "bollinger" })}
              title="Click to open Bollinger Bands settings"
            >
              <span className="tv-legend-line" style={{ backgroundColor: indicators.bollinger.basisColor }} />
              <span>
                BB {indicators.bollinger.length} {indicators.bollinger.source} {indicators.bollinger.stdDev}
              </span>
              {activeIdx >= 0 && computed.bb.upper[activeIdx] != null && (
                <b className="tv-legend-val" style={{ color: indicators.bollinger.basisColor }}>
                  {computed.bb.upper[activeIdx]!.toFixed(2)} / {computed.bb.lower[activeIdx]!.toFixed(2)}
                </b>
              )}
            </button>
            <div className="tv-legend-tools">
              <button
                type="button"
                title={indicators.bollinger.visible ? "Hide" : "Show"}
                onClick={() =>
                  onUpdateIndicators({
                    ...indicators,
                    bollinger: { ...indicators.bollinger, visible: !indicators.bollinger.visible },
                  })
                }
              >
                {indicators.bollinger.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button type="button" title="Settings" onClick={() => onOpenSettings({ kind: "bollinger" })}>
                <Settings size={12} />
              </button>
              <button type="button" title="Remove" onClick={() => onToggleIndicator("bollinger", false)}>
                <X size={12} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* RSI Pane Legend Overlay */}
      {indicators.rsi.enabled && computed.rsiData && (
        <div className="tv-subpane-legend" style={{ top: `${paneOffsets.rsiTop}px` }}>
          <div className={`tv-legend-pill ${!indicators.rsi.visible ? "muted" : ""}`}>
            <button
              type="button"
              className="tv-legend-label"
              onClick={() => onOpenSettings({ kind: "rsi" })}
              title="Click to open RSI settings"
            >
              <span
                className="tv-legend-line"
                style={{
                  backgroundColor: indicators.rsi.color,
                  height: `${Math.max(2, Math.min(4, indicators.rsi.lineWidth))}px`,
                }}
              />
              <span>
                RSI {indicators.rsi.length} {indicators.rsi.source}
              </span>
              {activeIdx >= 0 && computed.rsiData.rsi[activeIdx] != null && (
                <b className="tv-legend-val" style={{ color: indicators.rsi.color }}>
                  {computed.rsiData.rsi[activeIdx]!.toFixed(2)}
                </b>
              )}
            </button>
            <div className="tv-legend-tools">
              <button
                type="button"
                title={indicators.rsi.visible ? "Hide" : "Show"}
                onClick={() =>
                  onUpdateIndicators({
                    ...indicators,
                    rsi: { ...indicators.rsi, visible: !indicators.rsi.visible },
                  })
                }
              >
                {indicators.rsi.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button type="button" title="Settings" onClick={() => onOpenSettings({ kind: "rsi" })}>
                <Settings size={12} />
              </button>
              <button type="button" title="Remove" onClick={() => onToggleIndicator("rsi", false)}>
                <X size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subtle Floating TradingView Bottom Zoom Controls */}
      <div className="tv-zoom-controls">
        <button type="button" onClick={() => zoomStep(1.25)} title="Zoom Out">
          <ZoomOut size={13} />
        </button>
        <button type="button" onClick={() => zoomStep(0.8)} title="Zoom In">
          <ZoomIn size={13} />
        </button>
        <button type="button" onClick={resetZoom} title="Reset Chart View">
          <RotateCcw size={13} />
        </button>
        <button
          type="button"
          onClick={() => chartRef.current?.timeScale().fitContent()}
          title="Fit All Loaded History"
        >
          <Maximize2 size={13} />
        </button>
      </div>
    </div>
  );
}
