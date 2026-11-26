import type { PricePoint } from "../../types";

export type PriceSource = "close" | "open" | "high" | "low" | "hl2" | "hlc3" | "ohlc4";
export type MaType = "SMA" | "EMA" | "WMA";
export type LineDashStyle = "solid" | "dashed" | "dotted";

export interface MaConfig {
  id: string;
  length: number;
  source: PriceSource;
  type: MaType;
  offset: number;
  color: string;
  lineWidth: number;
  lineStyle: LineDashStyle;
  visible: boolean;
}

export interface BollingerConfig {
  enabled: boolean;
  length: number;
  source: PriceSource;
  basisType: MaType;
  stdDev: number;
  offset: number;
  basisColor: string;
  basisLineWidth?: number;
  basisLineStyle?: LineDashStyle;
  bandColor: string;
  upperColor?: string;
  upperLineWidth?: number;
  upperLineStyle?: LineDashStyle;
  lowerColor?: string;
  lowerLineWidth?: number;
  lowerLineStyle?: LineDashStyle;
  fillColor: string;
  fillOpacity: number;
  lineWidth: number;
  lineStyle: LineDashStyle;
  showBasis: boolean;
  showUpper?: boolean;
  showLower?: boolean;
  showFill: boolean;
  visible: boolean;
}

export interface RsiConfig {
  enabled: boolean;
  length: number;
  source: PriceSource;
  maType: "None" | "SMA" | "EMA";
  maLength: number;
  color: string;
  maColor: string;
  lineWidth: number;
  lineStyle: LineDashStyle;
  upperLevel: number;
  lowerLevel: number;
  middleLevel: number;
  upperColor: string;
  lowerColor: string;
  middleColor?: string;
  upperLineStyle?: LineDashStyle;
  lowerLineStyle?: LineDashStyle;
  middleLineStyle?: LineDashStyle;
  showUpper?: boolean;
  showLower?: boolean;
  showMiddle: boolean;
  showFill: boolean;
  fillOpacity: number;
  visible: boolean;
}

export interface VolumeConfig {
  enabled: boolean;
  showMa: boolean;
  maLength: number;
  upColor: string;
  downColor: string;
  maColor: string;
  opacity: number;
  colorMode: "candle" | "prevClose";
  visible: boolean;
}

export interface ChartIndicatorsState {
  mas: MaConfig[];
  bollinger: BollingerConfig;
  rsi: RsiConfig;
  volume: VolumeConfig;
}

export const DEFAULT_INDICATORS_STATE: ChartIndicatorsState = {
  mas: [
    {
      id: "ma-1",
      length: 20,
      source: "close",
      type: "SMA",
      offset: 0,
      color: "#2962ff",
      lineWidth: 2,
      lineStyle: "solid",
      visible: true,
    },
    {
      id: "ma-2",
      length: 50,
      source: "close",
      type: "SMA",
      offset: 0,
      color: "#ff9800",
      lineWidth: 2,
      lineStyle: "solid",
      visible: true,
    },
    {
      id: "ma-3",
      length: 200,
      source: "close",
      type: "SMA",
      offset: 0,
      color: "#e11d48",
      lineWidth: 2,
      lineStyle: "solid",
      visible: true,
    },
  ],
  bollinger: {
    enabled: true,
    length: 20,
    source: "close",
    basisType: "SMA",
    stdDev: 2,
    offset: 0,
    basisColor: "#ff6d00",
    basisLineWidth: 1,
    basisLineStyle: "solid",
    bandColor: "#2196f3",
    upperColor: "#2196f3",
    upperLineWidth: 1,
    upperLineStyle: "solid",
    lowerColor: "#2196f3",
    lowerLineWidth: 1,
    lowerLineStyle: "solid",
    fillColor: "#2196f3",
    fillOpacity: 0.08,
    lineWidth: 1,
    lineStyle: "solid",
    showBasis: true,
    showUpper: true,
    showLower: true,
    showFill: true,
    visible: true,
  },
  rsi: {
    enabled: true,
    length: 14,
    source: "close",
    maType: "None",
    maLength: 14,
    color: "#7e57c2",
    maColor: "#ff9800",
    lineWidth: 2,
    lineStyle: "solid",
    upperLevel: 60,
    lowerLevel: 40,
    middleLevel: 50,
    upperColor: "#089981",
    lowerColor: "#089981",
    middleColor: "#787b86",
    upperLineStyle: "dashed",
    lowerLineStyle: "dashed",
    middleLineStyle: "dotted",
    showUpper: true,
    showLower: true,
    showMiddle: false,
    showFill: true,
    fillOpacity: 0.06,
    visible: true,
  },
  volume: {
    enabled: true,
    showMa: false,
    maLength: 20,
    upColor: "#089981",
    downColor: "#f23645",
    maColor: "#2962ff",
    opacity: 0.6,
    colorMode: "candle",
    visible: true,
  },
};

export function extractSource(bar: PricePoint, source: PriceSource): number {
  switch (source) {
    case "open":
      return bar.open;
    case "high":
      return bar.high;
    case "low":
      return bar.low;
    case "hl2":
      return (bar.high + bar.low) / 2;
    case "hlc3":
      return (bar.high + bar.low + bar.close) / 3;
    case "ohlc4":
      return (bar.open + bar.high + bar.low + bar.close) / 4;
    case "close":
    default:
      return bar.close;
  }
}

export function computeMaArray(values: number[], length: number, type: MaType): Array<number | null> {
  const n = Math.max(1, Math.min(500, Math.round(length)));
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < n) return out;

  if (type === "SMA") {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  if (type === "WMA") {
    const denom = (n * (n + 1)) / 2;
    for (let i = n - 1; i < values.length; i++) {
      let weighted = 0;
      for (let j = 0; j < n; j++) {
        weighted += values[i - n + 1 + j] * (j + 1);
      }
      out[i] = weighted / denom;
    }
    return out;
  }

  // EMA seeded with first N-bar SMA (TradingView ta.ema formula)
  const k = 2 / (n + 1);
  let seedSum = 0;
  for (let i = 0; i < n; i++) seedSum += values[i];
  let prev = seedSum / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function applyOffset(values: Array<number | null>, offset: number): Array<number | null> {
  const shift = Math.round(offset);
  if (shift === 0) return values;
  const out: Array<number | null> = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const target = i + shift;
    if (target >= 0 && target < values.length) {
      out[target] = values[i];
    }
  }
  return out;
}

export function computeMovingAverage(
  bars: PricePoint[],
  length: number,
  source: PriceSource,
  type: MaType,
  offset = 0,
): Array<number | null> {
  const values = bars.map((b) => extractSource(b, source));
  return applyOffset(computeMaArray(values, length, type), offset);
}

export function computeBollingerBands(
  bars: PricePoint[],
  length: number,
  source: PriceSource,
  basisType: MaType,
  stdDevMult: number,
  offset = 0,
): {
  upper: Array<number | null>;
  basis: Array<number | null>;
  lower: Array<number | null>;
} {
  const n = Math.max(2, Math.min(500, Math.round(length)));
  const values = bars.map((b) => extractSource(b, source));
  const basisRaw = computeMaArray(values, n, basisType);
  const upperRaw: Array<number | null> = new Array(values.length).fill(null);
  const lowerRaw: Array<number | null> = new Array(values.length).fill(null);

  for (let i = n - 1; i < values.length; i++) {
    const mean = basisRaw[i];
    if (mean == null) continue;
    let sqSum = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const diff = values[j] - mean;
      sqSum += diff * diff;
    }
    // Population StdDev matching TradingView ta.stdev
    const sd = Math.sqrt(sqSum / n) * stdDevMult;
    upperRaw[i] = mean + sd;
    lowerRaw[i] = mean - sd;
  }

  return {
    upper: applyOffset(upperRaw, offset),
    basis: applyOffset(basisRaw, offset),
    lower: applyOffset(lowerRaw, offset),
  };
}

export function computeRsi(
  bars: PricePoint[],
  length: number,
  source: PriceSource,
  maType: "None" | "SMA" | "EMA" = "None",
  maLength = 14,
): { rsi: Array<number | null>; ma: Array<number | null> } {
  const n = Math.max(2, Math.min(200, Math.round(length)));
  const values = bars.map((b) => extractSource(b, source));
  const rsi: Array<number | null> = new Array(values.length).fill(null);
  if (values.length <= n) return { rsi, ma: new Array(values.length).fill(null) };

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= n; i++) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) avgGain += delta;
    else avgLoss += -delta;
  }
  avgGain /= n;
  avgLoss /= n;
  rsi[n] = avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - 100 / (1 + avgGain / avgLoss);

  // Wilder's RMA smoothing (TradingView ta.rsi)
  for (let i = n + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (n - 1) + gain) / n;
    avgLoss = (avgLoss * (n - 1) + loss) / n;
    rsi[i] = avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  const ma: Array<number | null> = new Array(values.length).fill(null);
  if (maType !== "None") {
    const validStart = rsi.findIndex((v) => v != null);
    if (validStart !== -1) {
      const slice = rsi.slice(validStart).map((v) => v ?? 50);
      const computed = computeMaArray(slice, maLength, maType);
      for (let j = 0; j < computed.length; j++) {
        ma[validStart + j] = computed[j];
      }
    }
  }

  return { rsi, ma };
}

export function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "").trim();
  if (cleaned.length !== 6) return `rgba(41, 98, 255, ${alpha})`;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}
