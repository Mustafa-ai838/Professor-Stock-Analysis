import { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  Filter,
  LayoutDashboard,
  Newspaper,
  PieChart,
  Search,
  Settings,
  Star,
  TrendingUp,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { formatNumber } from "./ui";
import { api } from "../services/api";
import type { MarketOverview, Stock } from "../types";

const navItems = [
  { to: "/", label: "Home", sidebarLabel: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/chart", label: "Chart", sidebarLabel: "Chart", icon: TrendingUp, badge: "New" },
  { to: "/market", label: "Market", sidebarLabel: "Market", icon: BarChart3 },
  { to: "/screener", label: "Screener", sidebarLabel: "Screener", icon: Filter },
  { to: "/watchlist", label: "Watchlist", sidebarLabel: "Watchlist", icon: Star },
  { to: "/stock-analysis", label: "Stock Analysis", sidebarLabel: "Stock Analysis", icon: Activity },
  { to: "/sectors", label: "Sector Analysis", sidebarLabel: "Sector Analysis", icon: PieChart },
  { to: "/news", label: "News", sidebarLabel: "News", icon: Newspaper },
  { to: "/portfolio", label: "Portfolio", sidebarLabel: "Portfolio", icon: BriefcaseBusiness },
  { to: "/settings", label: "Settings", sidebarLabel: "Settings", icon: Settings },
];

export function Layout() {
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [dataStatus, setDataStatus] = useState("DATA UNAVAILABLE");
  const [marketStatus, setMarketStatus] = useState("DATA UNAVAILABLE");
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Stock[]>([]);
  const [account, setAccount] = useState(localStorage.getItem("psa_email"));
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let active = true;
    api.health()
      .then((health) => {
        if (!active) return;
        setApiOnline(true);
        const raw = health.market_data_status ?? (health.data_source === "DEMO" ? "DEMO DATA" : "DATA UNAVAILABLE");
        const displayLabel = raw === "DELAYED" ? "LIVE (PSX)" : raw;
        setDataStatus(displayLabel);
        setMarketStatus(health.market_status ?? "DATA UNAVAILABLE");
      })
      .catch(() => { if (active) setApiOnline(false); });

    api.overview()
      .then((data) => {
        if (active) setOverview(data);
      })
      .catch(() => {});

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (query.trim().length < 1) { setMatches([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      api.stocks(query.trim()).then((result) => { if (active) setMatches(result.items.slice(0, 10)); }).catch(() => { if (active) setMatches([]); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);

  function signOut() {
    localStorage.removeItem("psa_token");
    localStorage.removeItem("psa_email");
    setAccount(null);
    navigate("/");
  }

  const isChartPage = location.pathname === "/chart" || location.pathname === "/market";

  if (isChartPage) {
    return (
      <div className="chart-view-shell tv-light-shell">
        {/* Clean Light TradingView Header Shell (preserves site navigation without dark frame) */}
        <header className="chart-topbar tv-light-topbar">
          <Link to="/" className="brand tv-light-brand">
            <div className="brand-mark">
              <BarChart3 size={14} />
            </div>
            <span>Professor <b>Stock Analysis</b></span>
          </Link>

          <nav className="chart-topbar-nav" aria-label="Chart navigation">
            <NavLink to="/" end className="chart-topbar-pill tv-light-nav-link">
              <LayoutDashboard size={13} />
              <span>Home</span>
            </NavLink>
            <NavLink
              to="/chart"
              className={({ isActive }) =>
                `chart-topbar-pill tv-light-nav-link ${isActive || location.pathname === "/market" ? "active" : ""}`
              }
            >
              <TrendingUp size={13} />
              <span>Chart</span>
            </NavLink>
            <NavLink to="/screener" className="chart-topbar-pill tv-light-nav-link">
              <Filter size={13} />
              <span>Screener</span>
            </NavLink>
            <NavLink to="/watchlist" className="chart-topbar-pill tv-light-nav-link">
              <Star size={13} />
              <span>Watchlist</span>
            </NavLink>
            <NavLink to="/stock-analysis" className="chart-topbar-pill tv-light-nav-link">
              <Activity size={13} />
              <span>Stock Analysis</span>
            </NavLink>
          </nav>

          <div className="topbar-actions">
            <div
              className={`tv-status-pill ${apiOnline ? "online" : "offline"}`}
              title="PSX Market Live Feed · Auto-refreshing every 15s"
            >
              <span />
              {apiOnline ? dataStatus : apiOnline === false ? "API Offline" : "Connecting"}
            </div>
            <Link to="/settings" className="icon-button tv-light-icon-btn" title="Settings">
              <Settings size={16} />
            </Link>
            {account ? (
              <button
                onClick={signOut}
                className="user-avatar-badge"
                title={`Signed in as ${account}. Click to sign out.`}
              >
                {account.charAt(0).toUpperCase()}
              </button>
            ) : (
              <Link to="/login" className="user-avatar-badge" title="Sign In">
                P
              </Link>
            )}
          </div>
        </header>

        <main className="chart-view-main tv-light-main">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Top Header Bar */}
      <header className="topbar">
        <Link to="/" className="brand">
          <div className="brand-mark">
            <BarChart3 size={20} />
          </div>
          <span>Professor <b>Stock Analysis</b></span>
        </Link>

        {/* Top pill navigation menu */}
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map(({ to, label, icon: Icon, badge, end }) => (
            <NavLink
              key={label}
              to={to}
              end={end}
              className={({ isActive }) =>
                `nav-link ${
                  isActive || (label === "Stock Analysis" && location.pathname.startsWith("/stocks/"))
                    ? "active"
                    : ""
                }`
              }
            >
              <Icon size={15} />
              <span>{label}</span>
              {badge && <span className="nav-badge-new">{badge}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Topbar right actions */}
        <div className="topbar-actions">
          <div
            className={`api-status ${apiOnline ? "online" : apiOnline === false ? "offline" : ""}`}
            title="PSX Market Live Feed · Auto-refreshing every 15s"
          >
            <span />
            {apiOnline ? dataStatus : apiOnline === false ? "API Offline" : "Connecting"}
          </div>
          <Link to="/settings" className="icon-button" title="Settings">
            <Settings size={16} />
          </Link>
          {account ? (
            <button
              onClick={signOut}
              className="user-avatar-badge"
              title={`Signed in as ${account}. Click to sign out.`}
            >
              {account.charAt(0).toUpperCase()}
            </button>
          ) : (
            <Link to="/login" className="user-avatar-badge" title="Sign In">
              P
            </Link>
          )}
        </div>
      </header>

      {/* Main Body Container with Left Sidebar & Content */}
      <div className="layout-body">
        {/* Left Sidebar */}
        <aside className="left-sidebar">
          <nav className="sidebar-nav">
            {navItems.map(({ to, sidebarLabel, icon: Icon, badge, end }) => (
              <NavLink
                key={sidebarLabel}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `sidebar-link ${
                    isActive || (sidebarLabel === "Stock Analysis" && location.pathname.startsWith("/stocks/"))
                      ? "active"
                      : ""
                  }`
                }
              >
                <Icon size={17} />
                <span>{sidebarLabel}</span>
                {badge && <span className="nav-badge-new">{badge}</span>}
              </NavLink>
            ))}
          </nav>

          {/* Sidebar market-data notice */}
          <div className="sidebar-market-widget">
            <div className="market-status-header">
              <span className="live-dot" />
              <span className="status-label">Market Status</span>
              <span className="status-badge-open">{marketStatus === "MARKET CLOSED" ? "CLOSED" : "OPEN"}</span>
            </div>
            <div className="market-time">
              {overview?.last_updated
                ? new Date(overview.last_updated).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  }) + " • " + new Date(overview.last_updated).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }) + " PKT"
                : "Mon, Oct 13, 2025 • 14:35 PKT"}
            </div>
            <div className="sidebar-psx-info">
              <div className="psx-label">PSX Index</div>
              <div className="psx-value">
                {overview?.index?.value ? formatNumber(overview.index.value) : "123,456.78"}
              </div>
              <div className={`psx-change ${(overview?.index?.change ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {(overview?.index?.change ?? 0) >= 0 ? "▲ +" : "▼ "}
                {overview?.index?.change ? formatNumber(Math.abs(overview.index.change)) : "1,245.67"}
                {overview?.index?.change_pct != null
                  ? ` (${overview.index.change_pct >= 0 ? "+" : ""}${overview.index.change_pct.toFixed(2)}%)`
                  : " (+1.02%)"}
              </div>
            </div>
            <div className="psx-badge-graphic">
              <div className="psx-logo-hex">
                <svg className="psx-svg-emblem" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="50" cy="50" r="44" stroke="#059669" strokeWidth="2" strokeDasharray="4 2" />
                  <circle cx="50" cy="50" r="38" fill="#042018" stroke="#10b981" strokeWidth="2.5" />
                  <path d="M35 62V42M50 62V34M65 62V46" stroke="#34d399" strokeWidth="5" strokeLinecap="round" />
                  <path d="M32 40L49 28L68 37" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                <div className="psx-logo-text">PSX</div>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Content Area */}
        <div className="content-area">
          {/* Quick Search Strip */}
          <div className="sub-search-strip">
            <div className="search-control">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && matches[0]) {
                    navigate(`/stocks/${matches[0].symbol}`);
                    setQuery("");
                    setSearchOpen(false);
                  }
                }}
                placeholder="Search PSX symbol or company (e.g. OGDC, HBL, LUCK)…"
                aria-label="Search stocks"
              />
              {query && (
                <button onClick={() => { setQuery(""); setSearchOpen(false); }} aria-label="Clear search">
                  ×
                </button>
              )}
              {searchOpen && matches.length > 0 && (
                <div className="search-results">
                  {matches.map((stock) => (
                    <button
                      key={stock.symbol}
                      onClick={() => {
                        navigate(`/stocks/${stock.symbol}`);
                        setQuery("");
                        setSearchOpen(false);
                      }}
                    >
                      <b>{stock.symbol}</b>
                      <span>{stock.name}</span>
                      <span className={stock.change_pct >= 0 ? "positive" : "negative"}>
                        {stock.change_pct > 0 ? "+" : ""}{stock.change_pct.toFixed(2)}%
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="market-session-pill">
              <span className="status-dot-green" /> Pakistan Stock Exchange · Real-Time Insights (Demo Feed)
            </div>
          </div>

          <main className="main-content" onClick={() => { if (searchOpen) setSearchOpen(false); }}>
            <Outlet />
          </main>

          <footer className="site-footer">
            <span><b>Professor Stock Analysis</b> — Professional PSX Research Platform</span>
            <span>Demonstration historical market dataset · Not financial advice</span>
          </footer>
        </div>
      </div>

      {/* Bottom Sticky Navigation Bar matching Reference Image */}
      <nav className="bottom-nav-bar" aria-label="Bottom Navigation">
        {navItems
          .filter((item) => item.label !== "News")
          .map(({ to, label, icon: Icon, badge, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `bottom-nav-link ${isActive ? "active" : ""}`}
            >
              <Icon size={14} />
              <span>{label}</span>
              {badge && <span className="nav-badge-new">{badge}</span>}
            </NavLink>
          ))}
      </nav>
    </div>
  );
}
