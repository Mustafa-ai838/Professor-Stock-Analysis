import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, Plus, Search, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import { api } from "../services/api";
import type { HistoryResponse, PricePoint, Stock, StockDetail } from "../types";
import { formatNumber, LoadingState } from "../components/ui";
import { usePolling } from "../hooks/usePolling";
import { TradingViewChart } from "../components/chart/TradingViewChart";
import {
  IndicatorSettingsModal,
  IndicatorsMenu,
  type SettingsTarget,
} from "../components/chart/IndicatorModals";
import {
  DEFAULT_INDICATORS_STATE,
  type ChartIndicatorsState,
} from "../components/chart/indicatorsMath";

const TIMEFRAMES = ["5m", "15m", "1H", "4H", "1D", "1W", "1M", "3M", "1Y"] as const;
const ALL_SECTOR_OPTIONS = [
  "Any Sector",
  "Automobile Assembler",
  "Automobile Parts & Accessories",
  "Banks",
  "Cement",
  "Chemicals",
  "E&P",
  "Fertilizer",
  "Food & Personal Care Products",
  "Glass & Ceramics",
  "Insurance",
  "Inv. Banks / Inv. Cos. / Securities",
  "Leather & Tanneries",
  "Miscellaneous",
  "Oil & Gas",
  "Oil & Gas Marketing Companies",
  "Paper & Board",
  "Pharmaceuticals",
  "Power Generation & Distribution",
  "Property",
  "Refinery",
  "Sugar & Allied Industries",
  "Synthetic & Rayon",
  "Technology & Communication",
  "Textile Composite",
  "Textile Spinning",
  "Textile Weaving",
  "Tobacco",
  "Transport",
  "Vanaspati & Allied Industries",
  "Woollen",
] as const;

const MA_PRESETS = [
  { length: 20, color: "#2962ff" },
  { length: 50, color: "#ff9800" },
  { length: 200, color: "#e11d48" },
  { length: 100, color: "#089981" },
];

function matchesWatchlistSector(stockSector: string, filter: string): boolean {
  if (filter === "All" || filter === "Any Sector") return true;
  const s = (stockSector || "").toLowerCase().trim();
  switch (filter) {
    case "Banks":
      return s.includes("commercial bank") || s === "banking" || s.includes("microfinance bank");
    case "Automobile Assembler":
      return s.includes("automobile assembler");
    case "Automobile Parts & Accessories":
      return s.includes("automobile parts");
    case "Cement":
      return s.includes("cement");
    case "Chemicals":
      return s === "chemical" || s.includes("chemical");
    case "E&P":
      return s.includes("oil & gas exploration");
    case "Fertilizer":
      return s.includes("fertilizer");
    case "Food & Personal Care Products":
      return s.includes("food");
    case "Glass & Ceramics":
      return s.includes("glass");
    case "Insurance":
      return s.includes("insurance");
    case "Inv. Banks / Inv. Cos. / Securities":
      return s.includes("inv. bank") || s.includes("securities");
    case "Leather & Tanneries":
      return s.includes("leather");
    case "Miscellaneous":
      return s.includes("miscellaneous");
    case "Oil & Gas":
      return s.includes("oil") || s.includes("gas") || s.includes("refinery");
    case "Oil & Gas Marketing Companies":
      return s.includes("oil & gas marketing");
    case "Paper & Board":
      return s.includes("paper");
    case "Pharmaceuticals":
      return s.includes("pharma");
    case "Power Generation & Distribution":
      return s.includes("power");
    case "Property":
      return s.includes("property");
    case "Refinery":
      return s.includes("refinery");
    case "Sugar & Allied Industries":
      return s.includes("sugar");
    case "Synthetic & Rayon":
      return s.includes("synthetic");
    case "Technology & Communication":
      return s.includes("technology") || s.includes("communication");
    case "Textile Composite":
      return s.includes("textile composite");
    case "Textile Spinning":
      return s.includes("textile spinning");
    case "Textile Weaving":
      return s.includes("textile weaving");
    case "Tobacco":
      return s.includes("tobacco");
    case "Transport":
      return s.includes("transport");
    case "Vanaspati & Allied Industries":
      return s.includes("vanaspati");
    case "Woollen":
      return s.includes("woollen");
    default:
      return s.includes(filter.toLowerCase());
  }
}

function getFirstActiveSettingsTarget(ind: ChartIndicatorsState): SettingsTarget | null {
  if (ind.mas.length > 0) return { kind: "ma", id: ind.mas[0].id };
  if (ind.bollinger.enabled) return { kind: "bollinger" };
  if (ind.volume.enabled) return { kind: "volume" };
  if (ind.rsi.enabled) return { kind: "rsi" };
  return null;
}

const CHART_SETTINGS_STORAGE_KEY = "psa_chart_settings";

interface PersistedChartSettings {
  indicators?: ChartIndicatorsState;
  timeframe?: string;
}

function normalizeLoadedIndicators(raw?: Partial<ChartIndicatorsState>): ChartIndicatorsState {
  if (!raw) return structuredClone(DEFAULT_INDICATORS_STATE);
  const ind: ChartIndicatorsState = {
    ...DEFAULT_INDICATORS_STATE,
    ...raw,
    rsi: { ...DEFAULT_INDICATORS_STATE.rsi, ...(raw.rsi || {}) },
    volume: { ...DEFAULT_INDICATORS_STATE.volume, ...(raw.volume || {}) },
    bollinger: { ...DEFAULT_INDICATORS_STATE.bollinger, ...(raw.bollinger || {}) },
    mas: Array.isArray(raw.mas) ? raw.mas : DEFAULT_INDICATORS_STATE.mas,
  };
  // Automatically migrate legacy 70/30 defaults to requested 60/40 defaults
  if (ind.rsi.upperLevel === 70 && ind.rsi.lowerLevel === 30) {
    ind.rsi.upperLevel = 60;
    ind.rsi.lowerLevel = 40;
    if (ind.rsi.upperColor === "#f23645") {
      ind.rsi.upperColor = "#089981";
    }
  }
  if (!ind.rsi.upperLineStyle) ind.rsi.upperLineStyle = "dashed";
  if (!ind.rsi.lowerLineStyle) ind.rsi.lowerLineStyle = "dashed";
  if (!ind.rsi.middleLineStyle) ind.rsi.middleLineStyle = "dotted";
  if (!ind.rsi.lineStyle) ind.rsi.lineStyle = "solid";
  if (ind.rsi.showUpper === undefined) ind.rsi.showUpper = true;
  if (ind.rsi.showLower === undefined) ind.rsi.showLower = true;
  if (!ind.rsi.upperColor) ind.rsi.upperColor = "#089981";
  if (!ind.rsi.lowerColor) ind.rsi.lowerColor = "#089981";
  if (!ind.bollinger.upperColor) ind.bollinger.upperColor = ind.bollinger.bandColor || "#2196f3";
  if (!ind.bollinger.lowerColor) ind.bollinger.lowerColor = ind.bollinger.bandColor || "#2196f3";
  if (!ind.bollinger.fillColor) ind.bollinger.fillColor = ind.bollinger.upperColor || "#2196f3";
  if (!ind.bollinger.basisLineStyle) ind.bollinger.basisLineStyle = "solid";
  if (!ind.bollinger.upperLineStyle) ind.bollinger.upperLineStyle = "solid";
  if (!ind.bollinger.lowerLineStyle) ind.bollinger.lowerLineStyle = "solid";
  if (ind.bollinger.showUpper === undefined) ind.bollinger.showUpper = true;
  if (ind.bollinger.showLower === undefined) ind.bollinger.showLower = true;
  return ind;
}

function loadCachedChartSettings(): { indicators: ChartIndicatorsState; timeframe: string } {
  try {
    const raw = localStorage.getItem(CHART_SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          indicators: normalizeLoadedIndicators(parsed.indicators),
          timeframe: typeof parsed.timeframe === "string" ? parsed.timeframe : "1W",
        };
      }
    }
  } catch {
    // fallback
  }
  return {
    indicators: structuredClone(DEFAULT_INDICATORS_STATE),
    timeframe: "1W",
  };
}

export function Market() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSymbol = searchParams.get("symbol")?.toUpperCase() || "MTL";

  const initialSettings = useMemo(() => loadCachedChartSettings(), []);
  const [selectedSymbol, setSelectedSymbol] = useState(initialSymbol);
  const [timeframe, setTimeframe] = useState<string>(initialSettings.timeframe);
  const [selectedDetail, setSelectedDetail] = useState<StockDetail | null>(null);
  const [historyMeta, setHistoryMeta] = useState<Omit<HistoryResponse, "items"> | null>(null);
  const [bars, setBars] = useState<PricePoint[]>([]);
  const [loadingChart, setLoadingChart] = useState(true);
  const [chartError, setChartError] = useState("");

  // Synced SQLite Watchlist state (shared with Main Watchlist)
  const [watchlistStocks, setWatchlistStocks] = useState<Stock[]>([]);
  const [loadingWatchlist, setLoadingWatchlist] = useState(true);
  const [selectedSector, setSelectedSector] = useState<string>("Any Sector");
  const [sectorMenuOpen, setSectorMenuOpen] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const sectorPickerRef = useRef<HTMLDivElement | null>(null);
  const [addQuery, setAddQuery] = useState("");
  const [addSuggestions, setAddSuggestions] = useState<Stock[]>([]);
  const [addingBusy, setAddingBusy] = useState(false);
  const [wlNotice, setWlNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // TradingView Indicators & Modals state (cached in localStorage & synced with SQLite)
  const [indicators, setIndicators] = useState<ChartIndicatorsState>(initialSettings.indicators);
  const [showIndicatorsMenu, setShowIndicatorsMenu] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<SettingsTarget | null>(null);

  const persistChartSettings = useCallback(
    (nextIndicators: ChartIndicatorsState, nextTf: string) => {
      const payload: PersistedChartSettings = {
        indicators: nextIndicators,
        timeframe: nextTf,
      };
      const json = JSON.stringify(payload);
      try {
        localStorage.setItem(CHART_SETTINGS_STORAGE_KEY, json);
      } catch {
        // ignore
      }
      api.savePreferences({ chart_settings: json }).catch(() => {
        // silent sync
      });
    },
    [],
  );

  // Load database preferences on mount to sync device/user settings
  useEffect(() => {
    let active = true;
    api
      .preferences()
      .then((res) => {
        if (!active || !res.chart_settings || res.chart_settings === "{}") return;
        try {
          const parsed = JSON.parse(res.chart_settings);
          if (parsed && typeof parsed === "object") {
            if (parsed.indicators) {
              setIndicators((prev) => normalizeLoadedIndicators({
                ...prev,
                ...parsed.indicators,
              }));
            }
            if (typeof parsed.timeframe === "string") {
              setTimeframe(parsed.timeframe);
            }
            localStorage.setItem(CHART_SETTINGS_STORAGE_KEY, res.chart_settings);
          }
        } catch {
          // ignore parse error
        }
      })
      .catch(() => {
        // demo / offline
      });
    return () => {
      active = false;
    };
  }, []);

  const loadWatchlist = useCallback(async () => {
    try {
      const data = await api.watchlist();
      setWatchlistStocks(data.items ?? []);
    } catch {
      // keep previous watchlist items if polling momentarily fails
    } finally {
      setLoadingWatchlist(false);
    }
  }, []);

  // Polled live refresh (15s): updates watchlist quotes, active stock quote, and chart candles live
  const pollLiveData = useCallback(async () => {
    try {
      const data = await api.watchlist();
      setWatchlistStocks(data.items ?? []);
    } catch {
      // keep previous watchlist items
    } finally {
      setLoadingWatchlist(false);
    }

    try {
      const detail = await api.stock(selectedSymbol);
      setSelectedDetail(detail);
    } catch {
      // keep previous detail
    }

    try {
      const res = await api.history(selectedSymbol, timeframe.toUpperCase());
      if (res.items && res.items.length > 0) {
        setBars(res.items);
        setHistoryMeta((prev) => (prev ? { ...prev, last_updated: res.last_updated } : null));
      }
    } catch {
      // keep existing bars
    }
  }, [selectedSymbol, timeframe]);

  usePolling(pollLiveData);

  // Debounced market-wide search suggestions strictly for adding to Watchlist
  useEffect(() => {
    const q = addQuery.trim();
    if (!q) {
      setAddSuggestions([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api
        .stocks(q, "", 8)
        .then((res) => {
          if (active) setAddSuggestions(res.items ?? []);
        })
        .catch(() => {
          if (active) setAddSuggestions([]);
        });
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [addQuery]);

  // Auto-dismiss add/remove feedback banner
  useEffect(() => {
    if (!wlNotice) return;
    const t = window.setTimeout(() => setWlNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [wlNotice]);

  // Close sector dropdown when clicking outside
  useEffect(() => {
    if (!sectorMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (sectorPickerRef.current && !sectorPickerRef.current.contains(e.target as Node)) {
        setSectorMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [sectorMenuOpen]);

  // Load selected stock header detail + historical chart bars
  const loadSelectedDetail = useCallback(async () => {
    try {
      const detail = await api.stock(selectedSymbol);
      setSelectedDetail(detail);
    } catch {
      setSelectedDetail(null);
    }
  }, [selectedSymbol]);

  useEffect(() => {
    void loadSelectedDetail();
  }, [loadSelectedDetail]);

  const loadHistory = useCallback(async () => {
    setLoadingChart(true);
    setChartError("");
    try {
      const res = await api.history(selectedSymbol, timeframe.toUpperCase());
      setBars(res.items ?? []);
      setHistoryMeta({
        symbol: res.symbol,
        range: res.range,
        data_source: res.data_source,
        last_updated: res.last_updated,
        last_session: res.last_session,
        omitted_bars: res.omitted_bars,
        high_low_note: res.high_low_note,
        freshness_status: res.freshness_status,
        cache_status: res.cache_status,
      });
    } catch (err) {
      setChartError(err instanceof Error ? err.message : `Failed to load chart data for ${selectedSymbol}.`);
      setBars([]);
    } finally {
      setLoadingChart(false);
    }
  }, [selectedSymbol, timeframe]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const selectStock = (sym: string) => {
    const upper = sym.toUpperCase();
    setSelectedSymbol(upper);
    setSearchParams({ symbol: upper }, { replace: true });
  };

  const savedSymbolSet = useMemo(
    () => new Set(watchlistStocks.map((s) => s.symbol.toUpperCase())),
    [watchlistStocks],
  );

  async function handleAddWatchlist(symbolToAdd: string) {
    const normalized = symbolToAdd.trim().toUpperCase();
    if (!normalized || addingBusy) return;
    setAddingBusy(true);
    setWlNotice(null);
    try {
      const res = await api.addWatchlist(normalized);
      setWlNotice({ kind: "success", text: res.message || `${normalized} added to watchlist.` });
      setAddQuery("");
      setAddSuggestions([]);
      await loadWatchlist();
    } catch (err) {
      setWlNotice({
        kind: "error",
        text: err instanceof Error ? err.message : `Could not add ${normalized}.`,
      });
    } finally {
      setAddingBusy(false);
    }
  }

  async function handleRemoveWatchlist(symbolToRemove: string) {
    setWlNotice(null);
    try {
      const res = await api.removeWatchlist(symbolToRemove);
      setWlNotice({ kind: "success", text: res.message || `${symbolToRemove} removed.` });
      await loadWatchlist();
    } catch (err) {
      setWlNotice({
        kind: "error",
        text: err instanceof Error ? err.message : `Could not remove ${symbolToRemove}.`,
      });
    }
  }

  async function handleToggleFavorite(symbolToToggle: string, currentFavorite: boolean) {
    const nextFav = !currentFavorite;
    setWatchlistStocks((prev) =>
      prev.map((s) => (s.symbol === symbolToToggle ? { ...s, is_favorite: nextFav } : s)),
    );
    try {
      const res = await api.toggleWatchlistFavorite(symbolToToggle, nextFav);
      setWatchlistStocks((prev) =>
        prev.map((s) => (s.symbol === symbolToToggle ? { ...s, is_favorite: res.is_favorite } : s)),
      );
    } catch (err) {
      setWatchlistStocks((prev) =>
        prev.map((s) => (s.symbol === symbolToToggle ? { ...s, is_favorite: currentFavorite } : s)),
      );
      setWlNotice({
        kind: "error",
        text: err instanceof Error ? err.message : `Could not update favourite for ${symbolToToggle}.`,
      });
    }
  }

  const favoritesCount = useMemo(
    () => watchlistStocks.filter((stk) => Boolean(stk.is_favorite)).length,
    [watchlistStocks],
  );

  const sectorSavedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const sec of ALL_SECTOR_OPTIONS) {
      counts[sec] =
        sec === "Any Sector"
          ? watchlistStocks.length
          : watchlistStocks.filter((stk) => matchesWatchlistSector(stk.sector, sec)).length;
    }
    return counts;
  }, [watchlistStocks]);

  // Filter strictly inside saved SQLite Watchlist; Favourites always sort ON TOP inside each sector
  const filteredWatchlist = useMemo(() => {
    const matching = watchlistStocks.filter((stk) => {
      if (showFavoritesOnly && !stk.is_favorite) return false;
      return matchesWatchlistSector(stk.sector, selectedSector);
    });
    return [...matching].sort((a, b) => Number(Boolean(b.is_favorite)) - Number(Boolean(a.is_favorite)));
  }, [watchlistStocks, selectedSector, showFavoritesOnly]);

  // Resolve current stock header quote + change
  const activeStock = useMemo(() => {
    if (selectedDetail && selectedDetail.symbol === selectedSymbol) {
      const chg =
        selectedDetail.change ?? round2(selectedDetail.price * (selectedDetail.change_pct / 100));
      return {
        symbol: selectedDetail.symbol,
        name: selectedDetail.name,
        price: selectedDetail.price,
        change: chg,
        change_pct: selectedDetail.change_pct,
      };
    }
    const inWl = watchlistStocks.find((s) => s.symbol === selectedSymbol);
    if (inWl) {
      const chg = inWl.change ?? round2(inWl.price * (inWl.change_pct / 100));
      return {
        symbol: inWl.symbol,
        name: inWl.name,
        price: inWl.price,
        change: chg,
        change_pct: inWl.change_pct,
      };
    }
    const lastBar = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2];
    const close = lastBar?.close ?? 0;
    const prev = prevBar?.close ?? lastBar?.open ?? close;
    const diff = close - prev;
    const pct = prev > 0 ? (diff / prev) * 100 : 0;
    return {
      symbol: selectedSymbol,
      name: selectedSymbol === "MTL" ? "Millat Tractors Limited" : selectedSymbol,
      price: close,
      change: diff,
      change_pct: pct,
    };
  }, [selectedDetail, watchlistStocks, selectedSymbol, bars]);

  const handleAddMa = () => {
    const usedLengths = new Set(indicators.mas.map((m) => m.length));
    const nextPreset = MA_PRESETS.find((p) => !usedLengths.has(p.length)) ?? {
      length: 10 + indicators.mas.length * 10,
      color: MA_PRESETS[indicators.mas.length % MA_PRESETS.length].color,
    };
    const id = `ma-${Date.now()}`;
    const next: ChartIndicatorsState = {
      ...indicators,
      mas: [
        ...indicators.mas,
        {
          id,
          length: nextPreset.length,
          source: "close",
          type: "SMA",
          offset: 0,
          color: nextPreset.color,
          lineWidth: 2,
          lineStyle: "solid",
          visible: true,
        },
      ],
    };
    setIndicators(next);
    persistChartSettings(next, timeframe);
  };

  const handleRemoveMa = (id: string) => {
    const next: ChartIndicatorsState = {
      ...indicators,
      mas: indicators.mas.filter((m) => m.id !== id),
    };
    setIndicators(next);
    persistChartSettings(next, timeframe);
  };

  const handleToggleIndicator = (kind: "bollinger" | "rsi" | "volume", enabled: boolean) => {
    const next: ChartIndicatorsState = {
      ...indicators,
      [kind]: { ...indicators[kind], enabled },
    };
    setIndicators(next);
    persistChartSettings(next, timeframe);
  };

  const handleSelectTimeframe = (tf: string) => {
    setTimeframe(tf);
    persistChartSettings(indicators, tf);
  };

  const handleUpdateIndicators = (next: ChartIndicatorsState) => {
    setIndicators(next);
    persistChartSettings(next, timeframe);
  };

  const handleOpenGlobalSettings = () => {
    const first = getFirstActiveSettingsTarget(indicators);
    if (first) {
      setSettingsTarget(first);
    } else {
      setShowIndicatorsMenu(true);
    }
  };

  const isPositive = activeStock.change >= 0;
  const isSimulatedIntraday =
    historyMeta?.data_source === "DEMO" || ["5m", "15m", "1H", "4H"].includes(timeframe);

  return (
    <div className="tv-workspace">
      {/* Main Chart Column (Left) */}
      <section className="tv-main-column">
        {/* Top Toolbar matching TradingView Light Theme - Single Compact Line (max 38px) */}
        <header className="tv-toolbar">
          <div className="tv-toolbar-left">
            <h1 className="tv-sym-h1">{activeStock.symbol}</h1>
            <span className="tv-company-meta">
              {activeStock.name} · {timeframe} · PSX
            </span>
            <div className="tv-price-inline">
              <strong className="tv-live-price">{formatNumber(activeStock.price)}</strong>
              <span className={`tv-price-change ${isPositive ? "tv-up" : "tv-down"}`}>
                {isPositive ? "+" : ""}
                {activeStock.change.toFixed(2)} ({isPositive ? "+" : ""}
                {activeStock.change_pct.toFixed(2)}%)
              </span>
            </div>
            {isSimulatedIntraday && (
              <span
                className="tv-simulated-badge"
                title={
                  historyMeta?.high_low_note || "Simulated intraday bars derived from PSX daily OHLCV"
                }
              >
                Simulated
              </span>
            )}
          </div>

          <div className="tv-toolbar-right">
            <nav className="tv-timeframe-bar" aria-label="Chart timeframes">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  className={`tv-tf-btn ${timeframe === tf ? "active" : ""}`}
                  onClick={() => handleSelectTimeframe(tf)}
                >
                  {tf}
                </button>
              ))}
            </nav>

            <div className="tv-toolbar-actions">
              <button
                type="button"
                className={`tv-action-btn ${showIndicatorsMenu ? "active" : ""}`}
                onClick={() => setShowIndicatorsMenu(true)}
              >
                <span>Indicators</span>
                <ChevronDown size={12} />
              </button>
              <button
                type="button"
                className="tv-action-btn"
                onClick={handleOpenGlobalSettings}
                title="Open Indicator Settings"
              >
                <SlidersHorizontal size={12} />
                <span>Settings</span>
              </button>
            </div>
          </div>
        </header>

        {/* Chart Body */}
        <div className="tv-chart-host-wrap">
          {loadingChart && bars.length === 0 ? (
            <div className="tv-chart-state">
              <LoadingState label={`Loading ${selectedSymbol} ${timeframe} market chart…`} />
            </div>
          ) : chartError && bars.length === 0 ? (
            <div className="tv-chart-state">
              <p className="tv-error-msg">{chartError}</p>
              <button type="button" className="tv-btn-primary" onClick={() => void loadHistory()}>
                Retry
              </button>
            </div>
          ) : (
            <TradingViewChart
              symbol={selectedSymbol}
              timeframe={timeframe}
              bars={bars}
              indicators={indicators}
              onUpdateIndicators={handleUpdateIndicators}
              onOpenSettings={setSettingsTarget}
              onRemoveMa={handleRemoveMa}
              onToggleIndicator={handleToggleIndicator}
            />
          )}
        </div>
      </section>

      {/* Watchlist Sidebar (Right — Synced to SQLite My Watchlist) */}
      <aside className="tv-watchlist-sidebar" aria-label="My Watchlist">
        <div className="tv-wl-header">
          <span className="tv-wl-title">WATCHLIST</span>
          <span className="tv-wl-count">
            {selectedSector === "Any Sector" && !showFavoritesOnly
              ? watchlistStocks.length
              : `${filteredWatchlist.length} / ${watchlistStocks.length}`}
          </span>
        </div>

        {/* Find & Add Stock Bar (works identically to Main Watchlist) */}
        <div className="tv-wl-add-wrap">
          <div className="tv-wl-add-bar">
            <div className="tv-wl-search">
              <Search size={14} className="tv-wl-search-icon" />
              <input
                type="text"
                placeholder="Find stock to add..."
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const candidate = addSuggestions[0]?.symbol ?? addQuery.trim();
                    if (candidate) void handleAddWatchlist(candidate);
                  } else if (e.key === "Escape") {
                    setAddQuery("");
                    setAddSuggestions([]);
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="tv-wl-add-btn"
              disabled={!addQuery.trim() || addingBusy}
              onClick={() => {
                const candidate = addSuggestions[0]?.symbol ?? addQuery.trim();
                if (candidate) void handleAddWatchlist(candidate);
              }}
              title="Add stock to Watchlist"
            >
              <Plus size={13} />
              <span>Add</span>
            </button>
          </div>

          {addQuery.trim() && addSuggestions.length > 0 && (
            <div className="tv-wl-suggestions">
              {addSuggestions.map((stk) => {
                const alreadySaved = savedSymbolSet.has(stk.symbol.toUpperCase());
                return (
                  <button
                    key={stk.symbol}
                    type="button"
                    className="tv-wl-suggestion-item"
                    onClick={() => {
                      if (alreadySaved) {
                        selectStock(stk.symbol);
                        setAddQuery("");
                        setAddSuggestions([]);
                      } else {
                        void handleAddWatchlist(stk.symbol);
                      }
                    }}
                  >
                    <span className="tv-wl-sugg-left">
                      <b>{stk.symbol}</b>
                      <small>{stk.name}</small>
                    </span>
                    <span className={`tv-wl-sugg-tag ${alreadySaved ? "saved" : "add"}`}>
                      {alreadySaved ? "Saved" : "+ Add"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {wlNotice && (
          <div className={`tv-wl-notice ${wlNotice.kind}`}>
            <span>{wlNotice.text}</span>
          </div>
        )}

        {/* Watchlist Filters: All tab + Any Sector dropdown + Favourites */}
        <div className="tv-wl-filter-row" ref={sectorPickerRef}>
          <button
            type="button"
            className={`tv-wl-filter-btn ${selectedSector === "Any Sector" && !showFavoritesOnly ? "active" : ""}`}
            onClick={() => {
              setSelectedSector("Any Sector");
              setShowFavoritesOnly(false);
              setSectorMenuOpen(false);
            }}
          >
            All
          </button>

          <div className="tv-wl-sector-picker">
            <button
              type="button"
              className={`tv-wl-filter-btn tv-wl-sector-trigger ${
                selectedSector !== "Any Sector" || sectorMenuOpen ? "active" : ""
              }`}
              onClick={() => setSectorMenuOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={sectorMenuOpen}
            >
              <span>{selectedSector}</span>
              <ChevronDown size={12} />
            </button>

            {sectorMenuOpen && (
              <div className="tv-wl-sector-menu" role="listbox" aria-label="Filter by sector">
                {ALL_SECTOR_OPTIONS.map((sec) => {
                  const cnt = sectorSavedCounts[sec] ?? 0;
                  return (
                    <button
                      key={sec}
                      type="button"
                      role="option"
                      aria-selected={selectedSector === sec}
                      className={`tv-wl-sector-option ${selectedSector === sec ? "active" : ""}`}
                      onClick={() => {
                        setSelectedSector(sec);
                        setSectorMenuOpen(false);
                      }}
                    >
                      <span>{sec}</span>
                      <small>{cnt}</small>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            className={`tv-wl-filter-btn tv-wl-fav-pill ${showFavoritesOnly ? "active" : ""}`}
            onClick={() => setShowFavoritesOnly((prev) => !prev)}
            title="Show Favourite stocks only"
          >
            <Star size={12} fill={showFavoritesOnly || favoritesCount > 0 ? "#eab308" : "none"} color="#eab308" />
            <span>{favoritesCount}</span>
          </button>
        </div>

        <div className="tv-wl-col-head">
          <span>Symbol</span>
          <span>Last</span>
          <span>Chg %</span>
          <span />
        </div>

        <div className="tv-wl-rows">
          {loadingWatchlist && watchlistStocks.length === 0 ? (
            <div className="tv-wl-empty">Loading saved watchlist…</div>
          ) : (
            filteredWatchlist.map((stk) => {
              const active = stk.symbol === selectedSymbol;
              const pos = stk.change_pct >= 0;
              const isFav = Boolean(stk.is_favorite);
              return (
                <div
                  key={stk.symbol}
                  role="button"
                  tabIndex={0}
                  className={`tv-wl-row ${active ? "active" : ""}`}
                  onClick={() => selectStock(stk.symbol)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectStock(stk.symbol);
                    }
                  }}
                  title={`${stk.name} (${stk.sector})`}
                >
                  <span className="tv-wl-sym-cell">
                    <button
                      type="button"
                      className={`tv-wl-star-btn ${isFav ? "is-fav" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleToggleFavorite(stk.symbol, isFav);
                      }}
                      title={isFav ? `Remove ${stk.symbol} from Favourites` : `Add ${stk.symbol} to Favourites`}
                      aria-label={isFav ? `Remove ${stk.symbol} from Favourites` : `Add ${stk.symbol} to Favourites`}
                    >
                      <Star size={11} fill={isFav ? "#eab308" : "none"} />
                    </button>
                    <span className="tv-wl-sym">{stk.symbol}</span>
                  </span>
                  <span className="tv-wl-last">{formatNumber(stk.price)}</span>
                  <span className={`tv-wl-chg ${pos ? "tv-up" : "tv-down"}`}>
                    {pos ? "+" : ""}
                    {stk.change_pct.toFixed(2)}%
                  </span>
                  <button
                    type="button"
                    className="tv-wl-remove-btn"
                    title={`Remove ${stk.symbol} from watchlist`}
                    aria-label={`Remove ${stk.symbol} from watchlist`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRemoveWatchlist(stk.symbol);
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })
          )}
          {!loadingWatchlist && filteredWatchlist.length === 0 && (
            <div className="tv-wl-empty">
              {watchlistStocks.length === 0
                ? "Your watchlist is empty. Search above to add PSX stocks."
                : showFavoritesOnly
                ? `No Favourite stocks${selectedSector !== "Any Sector" ? ` in ${selectedSector}` : ""}. Click the star beside a stock.`
                : `No saved ${selectedSector} stocks in your watchlist.`}
            </div>
          )}
        </div>

        <div className="tv-wl-footer-hint">
          Synced with My Watchlist · Add or remove stocks in either place.
        </div>
      </aside>

      {/* Indicators Dropdown / Manager Modal (4 Supported Indicators Only) */}
      <IndicatorsMenu
        open={showIndicatorsMenu}
        state={indicators}
        onClose={() => setShowIndicatorsMenu(false)}
        onAddMa={handleAddMa}
        onToggleIndicator={handleToggleIndicator}
        onRemoveMa={handleRemoveMa}
        onOpenSettings={setSettingsTarget}
      />

      {/* TradingView-style Full Indicator Settings Modal */}
      <IndicatorSettingsModal
        target={settingsTarget}
        state={indicators}
        onSelectTarget={setSettingsTarget}
        onUpdateState={handleUpdateIndicators}
        onRemoveMa={handleRemoveMa}
        onClose={() => setSettingsTarget(null)}
      />
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
