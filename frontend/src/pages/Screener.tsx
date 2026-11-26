import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Info,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import { ErrorState, LoadingState, formatNumber } from "../components/ui";
import { api, ApiError } from "../services/api";
import type { ScreenerResponse, Stock } from "../types";

type TimeframeOption = "daily" | "weekly" | "monthly";

type ScreenerFilters = {
  timeframe: TimeframeOption;
  minRsi: string;
  sector: string;
  dividend: string;
  minPrice: string;
  maxPrice: string;
  volume: string;
  percentChange: string;
  symbol: string;
};

type SortKey = "symbol" | "price" | "change_pct" | "volume" | "rsi";

const DEFAULT_FILTERS: ScreenerFilters = {
  timeframe: "daily",
  minRsi: "60",
  sector: "All Sectors",
  dividend: "Any",
  minPrice: "",
  maxPrice: "",
  volume: "Any",
  percentChange: "Any",
  symbol: "",
};

const TIMEFRAME_META: Record<
  TimeframeOption,
  { label: string; priceLabel: string; shortNote: string; description: string }
> = {
  monthly: {
    label: "Monthly",
    priceLabel: "Monthly Price",
    shortNote: "1M Avg Price · 1M Chg · Monthly RSI",
    description: "21-session Monthly Price, 1M Return, 1M Volume & 14M RSI",
  },
  weekly: {
    label: "Weekly",
    priceLabel: "Weekly Price",
    shortNote: "1W Avg Price · 1W Chg · Weekly RSI",
    description: "5-session Weekly Price, 1W Return, 1W Volume & 14W RSI",
  },
  daily: {
    label: "Daily",
    priceLabel: "Daily Price",
    shortNote: "Daily Close · 1D Chg · Daily RSI",
    description: "Latest Daily Close, 1D Return, Daily Volume & 14D RSI",
  },
};

const TIMEFRAME_CHOICES: TimeframeOption[] = ["monthly", "weekly", "daily"];

const FALLBACK_SECTORS = [
  "Automobile Assembler",
  "Automobile Parts & Accessories",
  "Cable & Electrical Goods",
  "Cement",
  "Chemical",
  "Commercial Banks",
  "Engineering",
  "Fertilizer",
  "Food & Personal Care Products",
  "Glass & Ceramics",
  "Insurance",
  "Inv. Banks / Inv. Cos. / Securities Cos.",
  "Leather & Tanneries",
  "Miscellaneous",
  "Oil & Gas Exploration Companies",
  "Oil & Gas Marketing Companies",
  "Paper, Board & Packaging",
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
];

function formatVolumeShort(vol: number | null | undefined): string {
  if (vol === null || vol === undefined) return "—";
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return String(vol);
}

function formatShortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const iso = value.slice(0, 10);
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function resolveRowRsi(stock: Stock, timeframe: TimeframeOption): number | null {
  if (stock.rsi !== undefined && stock.rsi !== null) return stock.rsi;
  if (timeframe === "weekly") return stock.rsi_weekly ?? null;
  if (timeframe === "monthly") return stock.rsi_monthly ?? null;
  return stock.rsi_daily ?? null;
}

export function Screener() {
  const [filters, setFilters] = useState<ScreenerFilters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<ScreenerFilters>(DEFAULT_FILTERS);
  const [sortBy, setSortBy] = useState<SortKey>("change_pct");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [tfMenuOpen, setTfMenuOpen] = useState(false);
  const tfMenuRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<ScreenerResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");

  const navigate = useNavigate();

  // Close timeframe dropdown on outside click or Escape
  useEffect(() => {
    if (!tfMenuOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (tfMenuRef.current && !tfMenuRef.current.contains(event.target as Node)) {
        setTfMenuOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTfMenuOpen(false);
    };
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [tfMenuOpen]);

  // Restore saved strategy if logged in
  useEffect(() => {
    if (!localStorage.getItem("psa_token")) return;
    api
      .screenerSettings()
      .then((res) => {
        if (res.settings && Object.keys(res.settings).length > 0) {
          const s = res.settings;
          const validTf: TimeframeOption =
            s.timeframe === "weekly" || s.timeframe === "monthly" || s.timeframe === "daily"
              ? s.timeframe
              : DEFAULT_FILTERS.timeframe;
          const restored: ScreenerFilters = {
            timeframe: validTf,
            minRsi: s.minRsi ?? DEFAULT_FILTERS.minRsi,
            sector: s.sector ?? DEFAULT_FILTERS.sector,
            dividend: s.dividend ?? DEFAULT_FILTERS.dividend,
            minPrice: s.minPrice ?? "",
            maxPrice: s.maxPrice ?? "",
            volume: s.volume ?? DEFAULT_FILTERS.volume,
            percentChange: s.percentChange ?? DEFAULT_FILTERS.percentChange,
            symbol: s.symbol ?? "",
          };
          setFilters(restored);
          setApplied(restored);
        }
      })
      .catch(() => {});
  }, []);

  const buildQueryParams = useCallback(
    (source: ScreenerFilters, activeSort: SortKey, activeOrder: "asc" | "desc", page: number, size: number) => {
      const params = new URLSearchParams();
      params.set("timeframe", source.timeframe);
      params.set("page", String(page));
      params.set("page_size", String(size));
      params.set("sort_by", activeSort);
      params.set("order", activeOrder);

      if (source.sector && source.sector !== "All Sectors" && source.sector !== "Any Sector") {
        params.set("sector", source.sector);
      }
      if (source.symbol.trim()) {
        params.set("symbol", source.symbol.trim());
      }
      if (source.minPrice.trim()) {
        params.set("min_price", source.minPrice.trim());
      }
      if (source.maxPrice.trim()) {
        params.set("max_price", source.maxPrice.trim());
      }
      if (source.minRsi) {
        params.set("min_rsi", source.minRsi);
        params.set("rsi_period", source.timeframe);
      }
      if (source.dividend === "Paid") {
        params.set("min_dividend", "0.01");
      } else if (source.dividend === "HighYield") {
        params.set("min_dividend_yield", "3");
      } else if (source.dividend === "Over5") {
        params.set("min_dividend", "5");
      } else if (source.dividend === "Over10") {
        params.set("min_dividend", "10");
      }
      if (source.volume === "Over100K") params.set("min_volume", "100000");
      else if (source.volume === "Over500K") params.set("min_volume", "500000");
      else if (source.volume === "Over1M") params.set("min_volume", "1000000");
      else if (source.volume === "Over5M") params.set("min_volume", "5000000");

      if (source.percentChange === "Positive") params.set("min_change", "0.01");
      else if (source.percentChange === "Over2") params.set("min_change", "2");
      else if (source.percentChange === "Over5") params.set("min_change", "5");
      else if (source.percentChange === "Negative") params.set("max_change", "-0.01");

      return params;
    },
    [],
  );

  const runScreener = useCallback(
    async (source: ScreenerFilters, activeSort: SortKey, activeOrder: "asc" | "desc", page: number, size: number) => {
      setLoading(true);
      setError("");
      try {
        const params = buildQueryParams(source, activeSort, activeOrder, page, size);
        const result = await api.screener(params);
        setData(result);
      } catch (err) {
        setData(null);
        setError(err instanceof ApiError ? err.message : "Failed to load screener data.");
      } finally {
        setLoading(false);
      }
    },
    [buildQueryParams],
  );

  useEffect(() => {
    void runScreener(applied, sortBy, order, currentPage, pageSize);
  }, [applied, sortBy, order, currentPage, pageSize, runScreener]);

  const handleTimeframeSelect = (nextTf: TimeframeOption) => {
    setTfMenuOpen(false);
    const updated: ScreenerFilters = { ...filters, timeframe: nextTf };
    setFilters(updated);
    setApplied(updated);
    setCurrentPage(1);
    setStatusMessage("");
  };

  const handleApply = () => {
    setApplied({ ...filters });
    setCurrentPage(1);
    setStatusMessage("");
  };

  const handleReset = () => {
    const cleanReset: ScreenerFilters = { ...DEFAULT_FILTERS, minRsi: "" };
    setFilters(cleanReset);
    setApplied(cleanReset);
    setSortBy("change_pct");
    setOrder("desc");
    setCurrentPage(1);
    setPageSize(50);
    setStatusMessage("Filters cleared.");
  };

  const handleSaveStrategy = async () => {
    if (!localStorage.getItem("psa_token")) {
      navigate("/login?next=/screener");
      return;
    }
    try {
      await api.saveScreenerSettings(filters as unknown as Record<string, string>);
      setStatusMessage("Screener strategy saved to your account.");
    } catch {
      setStatusMessage("Could not save strategy right now.");
    }
  };

  const handleExportCsv = () => {
    const items = data?.items ?? [];
    if (!items.length) return;
    const tfMeta = TIMEFRAME_META[applied.timeframe];
    const headers = [
      "Symbol",
      "Stock Name",
      "Sectors",
      tfMeta.priceLabel,
      "Change %",
      "Volume",
      `RSI (${tfMeta.label})`,
      "Last Dividend Amount",
      "Last Dividend Date",
      "Next Dividend",
      "Last Earning Date",
      "Next Earning Date",
    ];
    const rows = items.map((s) => [
      s.symbol,
      `"${(s.name || "").replace(/"/g, '""')}"`,
      `"${(s.sector || "").replace(/"/g, '""')}"`,
      s.price,
      s.change_pct,
      s.volume ?? "",
      resolveRowRsi(s, applied.timeframe) ?? "",
      s.last_dividend_amount ?? s.latest_dividend ?? "",
      s.last_dividend_date ?? "",
      s.next_dividend_date ? `${s.next_dividend_date}${s.next_dividend_amount != null ? ` (${s.next_dividend_amount})` : ""}` : "Not Announced",
      s.last_earning_date ?? "",
      s.next_earning_date ?? "Not Announced",
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `psx_screener_${applied.timeframe}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSortClick = (key: SortKey) => {
    if (sortBy === key) {
      setOrder((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(key);
      setOrder(key === "symbol" ? "asc" : "desc");
    }
    setCurrentPage(1);
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortBy !== key) return <ArrowUpDown size={12} className="screener-sort-idle" />;
    return order === "asc" ? <ArrowUp size={12} className="screener-sort-active" /> : <ArrowDown size={12} className="screener-sort-active" />;
  };

  const sectorOptions = useMemo(() => {
    if (data?.sectors && data.sectors.length > 0) return data.sectors;
    return FALLBACK_SECTORS;
  }, [data]);

  const items = data?.items ?? [];
  const totalItems = data?.total ?? items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedItems = useMemo(() => {
    const startIdx = (safePage - 1) * pageSize;
    return items.slice(startIdx, startIdx + pageSize);
  }, [items, safePage, pageSize]);

  const startNum = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endNum = Math.min(safePage * pageSize, totalItems);

  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, safePage - 2);
    const end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start < maxVisible - 1) {
      start = Math.max(1, end - maxVisible + 1);
    }
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }, [safePage, totalPages]);

  const activeTfMeta = TIMEFRAME_META[applied.timeframe];

  const activeSummaryText = useMemo(() => {
    const parts: string[] = [`Timeframe: ${activeTfMeta.label} (${activeTfMeta.shortNote})`];
    if (applied.minRsi) parts.push(`${activeTfMeta.label} RSI ≥ ${applied.minRsi}`);
    if (applied.sector !== "All Sectors") parts.push(`Sector: ${applied.sector}`);
    if (applied.symbol.trim()) parts.push(`Search: "${applied.symbol.trim().toUpperCase()}"`);
    if (applied.dividend !== "Any") parts.push("Dividend Active");
    if (applied.volume !== "Any") parts.push(`Volume Filter Active`);
    if (applied.percentChange !== "Any") parts.push(`% Change Active`);
    return parts.join(" · ");
  }, [activeTfMeta, applied]);

  return (
    <div className="screener-page-container">
      {/* Top Header */}
      <div className="screener-header-row">
        <div className="screener-title-flex">
          <div className="screener-icon-wrap">
            <Search size={22} color="#10b981" />
          </div>
          <div>
            <h1 className="screener-title">Stock Screener</h1>
            <p className="screener-subtitle">Filter PSX equities across selectable timeframe metrics, dividends & earnings dates</p>
          </div>
        </div>

        <div className="screener-actions-flex">
          <button type="button" className="screener-btn-reset" onClick={handleReset}>
            <RotateCcw size={14} /> Reset Filters
          </button>
          <button type="button" className="screener-btn-apply" onClick={handleApply}>
            <Filter size={14} /> Apply Filters
          </button>
          <button type="button" className="screener-btn-save-strategy" onClick={handleSaveStrategy} title="Save filters to profile">
            <Bookmark size={14} /> Save Strategy
          </button>
          <button type="button" className="screener-btn-reset" onClick={handleExportCsv} title="Download CSV">
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Top Filter Panel */}
      <section className="filter-options-card">
        <div className="filter-card-heading">
          <Filter size={16} color="#10b981" />
          <span className="filter-card-title">Filter Options</span>
          {statusMessage && <span className="screener-status-inline">{statusMessage}</span>}
        </div>

        <div className="filter-columns-grid screener-filters-four-col">
          {/* 1. Real Clickable Timeframe Dropdown (NOT static plain text) */}
          <div className="filter-field-group" ref={tfMenuRef}>
            <label className="filter-label">
              Timeframe
              <span title="Click to open Monthly, Weekly, or Daily timeframe selector">
                <Info size={12} className="info-icon" />
              </span>
            </label>
            <div className="screener-tf-dropdown">
              <button
                type="button"
                id="screener-timeframe-trigger"
                className={`screener-tf-trigger ${tfMenuOpen ? "open" : ""}`}
                aria-haspopup="listbox"
                aria-expanded={tfMenuOpen}
                onClick={() => setTfMenuOpen((open) => !open)}
              >
                <span className="screener-tf-trigger-text">
                  <strong>{TIMEFRAME_META[filters.timeframe].label}</strong>
                  <small>{TIMEFRAME_META[filters.timeframe].priceLabel}</small>
                </span>
                <ChevronDown size={16} className={`screener-tf-chevron ${tfMenuOpen ? "rotated" : ""}`} />
              </button>

              {tfMenuOpen && (
                <div className="screener-tf-menu" role="listbox" aria-label="Select Timeframe">
                  {TIMEFRAME_CHOICES.map((choice) => {
                    const meta = TIMEFRAME_META[choice];
                    const selected = filters.timeframe === choice;
                    return (
                      <button
                        key={choice}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        data-timeframe={choice}
                        className={`screener-tf-option ${selected ? "selected" : ""}`}
                        onClick={() => handleTimeframeSelect(choice)}
                      >
                        <div className="screener-tf-option-main">
                          <span className="screener-tf-option-title">{meta.label}</span>
                          <span className="screener-tf-option-sub">{meta.description}</span>
                        </div>
                        {selected && <Check size={15} color="#10b981" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 2. RSI 60 Filter (applies to selected timeframe) */}
          <div className="filter-field-group">
            <label className="filter-label" htmlFor="screener-rsi-select">
              RSI 60 Filter
              <span title="Filters stocks using RSI for your selected timeframe">
                <Info size={12} className="info-icon" />
              </span>
            </label>
            <select
              id="screener-rsi-select"
              className="filter-select"
              value={filters.minRsi}
              onChange={(e) => {
                const next = { ...filters, minRsi: e.target.value };
                setFilters(next);
                setApplied(next);
                setCurrentPage(1);
              }}
            >
              <option value="60">RSI 60+ (Above 60)</option>
              <option value="">All RSI Levels</option>
              <option value="50">RSI 50+ (Above 50)</option>
              <option value="70">Overbought (Above 70)</option>
            </select>
          </div>

          {/* 3. Sector Dropdown */}
          <div className="filter-field-group">
            <label className="filter-label" htmlFor="screener-sector-select">
              Sectors
            </label>
            <select
              id="screener-sector-select"
              className="filter-select"
              value={filters.sector}
              onChange={(e) => {
                const next = { ...filters, sector: e.target.value };
                setFilters(next);
                setApplied(next);
                setCurrentPage(1);
              }}
            >
              <option value="All Sectors">Any Sector</option>
              {sectorOptions.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Dividend Filter */}
          <div className="filter-field-group">
            <label className="filter-label" htmlFor="screener-dividend-select">
              Dividend
            </label>
            <select
              id="screener-dividend-select"
              className="filter-select"
              value={filters.dividend}
              onChange={(e) => setFilters({ ...filters, dividend: e.target.value })}
            >
              <option value="Any">Any</option>
              <option value="Paid">Has Dividend (&gt; 0)</option>
              <option value="HighYield">High Yield (&gt; 3%)</option>
              <option value="Over5">&gt; Rs. 5</option>
              <option value="Over10">&gt; Rs. 10</option>
            </select>
          </div>

          {/* 5. Price Range */}
          <div className="filter-field-group">
            <label className="filter-label">Price Range (PKR)</label>
            <div className="dual-input-range">
              <input
                type="number"
                className="range-input"
                placeholder="Min Price"
                value={filters.minPrice}
                onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })}
              />
              <span className="range-sep">-</span>
              <input
                type="number"
                className="range-input"
                placeholder="Max Price"
                value={filters.maxPrice}
                onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
              />
            </div>
          </div>

          {/* 6. Volume */}
          <div className="filter-field-group">
            <label className="filter-label" htmlFor="screener-volume-select">
              Volume
            </label>
            <select
              id="screener-volume-select"
              className="filter-select"
              value={filters.volume}
              onChange={(e) => setFilters({ ...filters, volume: e.target.value })}
            >
              <option value="Any">Any</option>
              <option value="Over100K">&gt; 100K</option>
              <option value="Over500K">&gt; 500K</option>
              <option value="Over1M">&gt; 1M</option>
              <option value="Over5M">&gt; 5M</option>
            </select>
          </div>

          {/* 7. % Change */}
          <div className="filter-field-group">
            <label className="filter-label" htmlFor="screener-change-select">
              % Change
            </label>
            <select
              id="screener-change-select"
              className="filter-select"
              value={filters.percentChange}
              onChange={(e) => setFilters({ ...filters, percentChange: e.target.value })}
            >
              <option value="Any">Any</option>
              <option value="Positive">Positive (&gt; 0%)</option>
              <option value="Over2">Gainers (&gt; +2%)</option>
              <option value="Over5">Big Gainers (&gt; +5%)</option>
              <option value="Negative">Negative (&lt; 0%)</option>
            </select>
          </div>

          {/* 8. Search Stock */}
          <div className="filter-field-group">
            <label className="filter-label" htmlFor="screener-symbol-search">
              Search Stock
            </label>
            <input
              id="screener-symbol-search"
              type="text"
              className="range-input"
              placeholder="Symbol or company..."
              value={filters.symbol}
              onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleApply();
              }}
            />
          </div>
        </div>

        {/* Single active timeframe banner */}
        <div className="filter-info-banner">
          <Info size={16} color="#10b981" />
          <span>{activeSummaryText}</span>
        </div>
      </section>

      {/* Bottom Results Panel */}
      <section className="screener-results-card">
        <div className="results-header-bar">
          <div className="results-count-title">
            <Filter size={16} color="#10b981" />
            <h2>Search Results ({totalItems} Stocks)</h2>
            <span className="screener-active-tf-pill">{activeTfMeta.priceLabel}</span>
          </div>
          <div className="results-meta-timestamp">
            <span>
              Last Updated:{" "}
              {data?.last_updated
                ? new Intl.DateTimeFormat("en-PK", { timeStyle: "medium", timeZone: "Asia/Karachi" }).format(
                    new Date(data.last_updated),
                  )
                : "PSX Lens"}
            </span>
            <button
              type="button"
              className="refresh-icon-btn"
              onClick={() => runScreener(applied, sortBy, order, safePage, pageSize)}
              title="Refresh screener"
            >
              <RefreshCw size={14} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>

        {loading && !data ? (
          <div className="screener-state-box">
            <LoadingState label={`Loading ${activeTfMeta.label} screener data...`} />
          </div>
        ) : error ? (
          <div className="screener-state-box">
            <ErrorState message={error} retry={() => runScreener(applied, sortBy, order, safePage, pageSize)} />
          </div>
        ) : paginatedItems.length === 0 ? (
          <div className="screener-state-box">
            <p className="muted-note">No stocks matched your current filter criteria.</p>
            <button type="button" className="screener-btn-reset" style={{ marginTop: 12 }} onClick={handleReset}>
              Clear All Filters
            </button>
          </div>
        ) : (
          <div className="screener-table-scroll">
            <table className="screener-main-table screener-wide-table">
              <thead>
                <tr>
                  <th className="screener-th-sortable" onClick={() => handleSortClick("symbol")}>
                    <span className="screener-th-inner">Stock Name {renderSortIcon("symbol")}</span>
                  </th>
                  <th>Sectors</th>
                  <th className="screener-th-sortable" onClick={() => handleSortClick("price")}>
                    <span className="screener-th-inner">{activeTfMeta.priceLabel} {renderSortIcon("price")}</span>
                  </th>
                  <th className="screener-th-sortable" onClick={() => handleSortClick("volume")}>
                    <span className="screener-th-inner">Volume {renderSortIcon("volume")}</span>
                  </th>
                  <th className="screener-th-sortable" onClick={() => handleSortClick("rsi")}>
                    <span className="screener-th-inner">RSI 60 {renderSortIcon("rsi")}</span>
                  </th>
                  <th>Last Dividend</th>
                  <th>Next Dividend</th>
                  <th>Last Earning Date</th>
                  <th>Next Earning Date</th>
                  <th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedItems.map((stock) => {
                  const rsiVal = resolveRowRsi(stock, applied.timeframe);
                  const lastDivAmt = stock.last_dividend_amount ?? stock.latest_dividend ?? null;
                  const lastDivDate = formatShortDate(stock.last_dividend_date);
                  const nextDivDate = formatShortDate(stock.next_dividend_date);
                  const lastEarnDate = formatShortDate(stock.last_earning_date);
                  const nextEarnDate = formatShortDate(stock.next_earning_date);
                  const positive = (stock.change_pct ?? 0) >= 0;

                  return (
                    <tr key={stock.symbol} className="screener-row-hover">
                      {/* 1. Stock Name */}
                      <td>
                        <div className="screener-stock-cell" onClick={() => navigate(`/stocks/${stock.symbol}`)}>
                          <span className="symbol-cell-strong">{stock.symbol}</span>
                          <span className="screener-company-sub" title={stock.name}>
                            {stock.name}
                          </span>
                        </div>
                      </td>

                      {/* 2. Sectors */}
                      <td>
                        <span className="screener-sector-badge" title={stock.sector}>
                          {stock.sector}
                        </span>
                      </td>

                      {/* 3. Stock Price (Monthly / Weekly / Daily responsive) */}
                      <td>
                        <div className="screener-price-cell-wrap">
                          <span className="price-cell">Rs. {formatNumber(stock.price)}</span>
                          <span className={`screener-chg-sub ${positive ? "pos" : "neg"}`}>
                            {positive ? "+" : ""}
                            {stock.change_pct.toFixed(2)}%
                          </span>
                        </div>
                      </td>

                      {/* 4. Volume */}
                      <td className="volume-cell">{formatVolumeShort(stock.volume)}</td>

                      {/* 5. RSI 60 (single value for active timeframe) */}
                      <td>
                        {rsiVal !== null ? (
                          <span className={`screener-rsi-pill ${rsiVal >= 60 ? "above60" : "below60"}`}>
                            {rsiVal.toFixed(1)}
                          </span>
                        ) : (
                          <span className="screener-muted-cell">—</span>
                        )}
                      </td>

                      {/* 6. Last Dividend (how much / when) */}
                      <td>
                        {lastDivAmt !== null && lastDivAmt > 0 ? (
                          <div className="screener-corp-cell">
                            <span className="screener-corp-primary">Rs. {formatNumber(lastDivAmt)}</span>
                            <span className="screener-corp-secondary">
                              {lastDivDate ?? stock.last_dividend_note ?? "Trailing 12M"}
                            </span>
                          </div>
                        ) : (
                          <span className="screener-muted-cell">—</span>
                        )}
                      </td>

                      {/* 7. Next Dividend (when / how much) */}
                      <td>
                        {nextDivDate ? (
                          <div className="screener-corp-cell">
                            <span className="screener-corp-primary screener-upcoming-text">{nextDivDate}</span>
                            <span className="screener-corp-secondary">
                              {stock.next_dividend_amount != null
                                ? `Rs. ${formatNumber(stock.next_dividend_amount)}`
                                : stock.next_dividend_note ?? "Announced"}
                            </span>
                          </div>
                        ) : (
                          <span className="screener-muted-cell">Not Announced</span>
                        )}
                      </td>

                      {/* 8. Last Earning Date */}
                      <td>
                        {lastEarnDate ? (
                          <div className="screener-corp-cell" title={stock.last_earning_note ?? undefined}>
                            <span className="screener-corp-primary">{lastEarnDate}</span>
                            <span className="screener-corp-secondary">Results Filed</span>
                          </div>
                        ) : (
                          <span className="screener-muted-cell">—</span>
                        )}
                      </td>

                      {/* 9. Next Earning Date */}
                      <td>
                        {nextEarnDate ? (
                          <div className="screener-corp-cell" title={stock.next_earning_note ?? undefined}>
                            <span className="screener-corp-primary screener-upcoming-text">{nextEarnDate}</span>
                            <span className="screener-corp-secondary">{stock.next_earning_note ?? "Scheduled"}</span>
                          </div>
                        ) : (
                          <span className="screener-muted-cell">Not Announced</span>
                        )}
                      </td>

                      {/* 10. Action */}
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="screener-view-btn"
                          onClick={() => navigate(`/stocks/${stock.symbol}`)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar — 50 stocks per page */}
        <div className="screener-pagination-bar">
          <div className="pagination-info-text">
            Showing {startNum} to {endNum} of {totalItems} stocks ({pageSize} per page)
          </div>

          <div className="pagination-numbers-wrap">
            <button
              type="button"
              className="page-nav-arrow"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              aria-label="Previous Page"
            >
              <ChevronLeft size={14} />
            </button>

            {pageNumbers.map((num) => (
              <button
                key={num}
                type="button"
                className={`page-num-btn ${safePage === num ? "active-green" : ""}`}
                onClick={() => setCurrentPage(num)}
              >
                {num}
              </button>
            ))}

            <button
              type="button"
              className="page-nav-arrow"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next Page"
            >
              <ChevronRight size={14} />
            </button>

            <div className="page-size-selector">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                aria-label="Rows per page"
              >
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
                <option value={25}>25 / page</option>
              </select>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
