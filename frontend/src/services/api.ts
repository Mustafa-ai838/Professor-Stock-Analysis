import type {
  HistoryResponse,
  MarketOverview,
  ScreenerResponse,
  Sector,
  Stock,
  StockDetail,
} from "../types";

const API_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? "http://localhost:8000/api" : "/api");
const inFlightGets = new Map<string, Promise<unknown>>();

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function performRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = localStorage.getItem("psa_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers, cache: "no-store" });
  } catch {
    throw new ApiError("Cannot connect to the API. Start the backend and try again.", 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new ApiError(body.detail ?? `Request failed (${response.status}).`, response.status);
  }
  return response.json() as Promise<T>;
}

function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  if (method !== "GET") return performRequest<T>(path, options);

  const token = localStorage.getItem("psa_token") ?? "";
  const key = `${method}:${API_URL}${path}:${token}`;
  const existing = inFlightGets.get(key);
  if (existing) return existing as Promise<T>;

  const pending = performRequest<T>(path, options);
  inFlightGets.set(key, pending);
  void pending.then(
    () => { if (inFlightGets.get(key) === pending) inFlightGets.delete(key); },
    () => { if (inFlightGets.get(key) === pending) inFlightGets.delete(key); },
  );
  return pending;
}

export const api = {
  health: () => request<{
    status: string;
    data_source: string;
    market_data_status?: string;
    market_status?: string;
    last_updated: string | null;
    frontend_poll_interval_seconds: number;
  }>("/health"),
  overview: () => request<MarketOverview>("/market/overview"),
  stocks: (q = "", sector = "", limit = 1000) => {
    const params = new URLSearchParams();
    if (q) {
      params.set("q", q);
      params.set("query", q);
    }
    if (sector) params.set("sector", sector);
    if (limit) params.set("limit", String(limit));
    return request<{ items: Stock[]; data_source?: string; freshness_status?: string; last_updated?: string | null }>(`/stocks?${params.toString()}`);
  },
  stock: (symbol: string) => request<StockDetail>(`/stocks/${encodeURIComponent(symbol)}`),
  history: (symbol: string, range: string) =>
    request<HistoryResponse>(`/stocks/${encodeURIComponent(symbol)}/history?range=${range}`),
  dividends: (symbol: string) =>
    request<{
      items: Array<{ ex_date: string; amount: number; currency: string; source: string; inferred?: boolean }>;
      data_source?: string;
      freshness_status?: string;
      data_note?: string | null;
    }>(`/stocks/${encodeURIComponent(symbol)}/dividends`),
  indicators: (symbol: string) =>
    request<Record<string, unknown>>(`/stocks/${encodeURIComponent(symbol)}/indicators`),
  sectors: (period = "1D") => request<{
    items: Sector[];
    data_source: string;
    last_updated?: string;
    freshness_status?: string;
    cache_status?: string;
  }>(`/sectors?period=${period}`),
  screener: (filters: URLSearchParams) =>
    request<ScreenerResponse>(`/screener?${filters.toString()}`),
  watchlist: () => request<{
    items: Stock[];
    unavailable_symbols?: string[];
    account: string;
    data_source: string;
    last_updated?: string;
    freshness_status?: string;
    cache_status?: string;
  }>("/watchlist"),
  addWatchlist: (symbol: string) =>
    request<{ message: string }>("/watchlist", { method: "POST", body: JSON.stringify({ symbol }) }),
  toggleWatchlistFavorite: (symbol: string, is_favorite?: boolean) =>
    request<{ symbol: string; is_favorite: boolean; message: string }>(
      `/watchlist/${encodeURIComponent(symbol)}/favorite`,
      { method: "PATCH", body: JSON.stringify(is_favorite === undefined ? {} : { is_favorite }) },
    ),
  removeWatchlist: (symbol: string) =>
    request<{ message: string }>(`/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" }),
  portfolio: () => request<{
    items: Array<Stock & { shares: number; average_cost: number; invested: number; current_value: number }>;
    invested: number;
    current_value: number;
    return_pct: number;
    data_source?: string;
    freshness_status?: string;
    last_updated?: string | null;
  }>("/portfolio"),
  addHolding: (payload: { symbol: string; shares: number; average_cost: number }) =>
    request<{ message: string }>("/portfolio", { method: "POST", body: JSON.stringify(payload) }),
  removeHolding: (symbol: string) =>
    request<{ message: string }>(`/portfolio/${encodeURIComponent(symbol)}`, { method: "DELETE" }),
  news: (symbol?: string) => {
    const params = new URLSearchParams();
    if (symbol) params.set("symbol", symbol);
    const query = params.toString();
    return request<{
      items: Array<{ id: number; headline: string; summary: string; published_at: string; source: string; url?: string | null }>;
      data_source?: string;
      freshness_status?: string;
      last_updated?: string | null;
    }>(`/news${query ? `?${query}` : ""}`);
  },
  preferences: () => request<{ currency: string; email_alerts: boolean; chart_settings?: string }>("/preferences"),
  savePreferences: (payload: { currency?: string; email_alerts?: boolean; chart_settings?: string }) =>
    request<{ message: string; chart_settings?: string }>("/preferences", { method: "PUT", body: JSON.stringify(payload) }),
  screenerSettings: () => request<{ settings: Record<string, string> }>("/screener/settings"),
  saveScreenerSettings: (payload: Record<string, string>) =>
    request<{ message: string }>("/screener/settings", { method: "PUT", body: JSON.stringify(payload) }),
  login: (payload: { email: string; password: string }) =>
    request<{ access_token: string; user: { id: number; email: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  register: (payload: { email: string; password: string }) =>
    request<{ access_token: string; user: { id: number; email: string } }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
