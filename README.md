# Professor Stock Analysis

A local Pakistan Stock Exchange (PSX) analysis dashboard built with React, TypeScript, Tailwind CSS, FastAPI, SQLAlchemy, and SQLite. The dashboard, screener, watchlist, portfolio, sector analysis, and stock pages use one shared API and database.

> **Market data:** The default source is PSX Lens public delayed data. It is not a real-time feed. The app checks the provider freshness endpoint and labels delayed, stale, and unavailable data explicitly. No price is generated when the source has none.

## Features

- Home and market dashboards, searchable PSX stock list, detailed stock pages, sectors, screener, watchlist, news, portfolio, and account settings.
- Interactive OHLC charts and calculated indicators when the provider supplies sufficient history.
- Server-side price, volume, sector, dividend, and change filters with CSV export. Bulk RSI screening is disabled because PSX Lens does not provide daily/weekly/monthly RSI in its screener response.
- User registration and login with PBKDF2 password hashes and signed bearer tokens. Watchlists, portfolio holdings, screener settings, and preferences are stored per account.
- SQLAlchemy models and a configurable `DATABASE_URL` keep the persistence layer ready for PostgreSQL.
- `MarketDataProvider` keeps provider-specific normalization behind the FastAPI backend. `PSXLensProviderAdapter` is the default; `DemoMarketDataProvider` is available only when explicitly selected with `DATA_PROVIDER=demo`.
- Market pages poll the FastAPI backend every 30 seconds while visible; server-side per-process caching, stale fallback, and retry/rate-limit policy are configurable.

## Requirements

- Python 3.10+
- Node.js 20.19+ and npm

## Run locally (Windows / VS Code)

1. Open this folder in VS Code. In a PowerShell terminal, create and activate a Python environment:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r backend\requirements.txt
   ```

2. Copy the backend environment template once, then replace the local secret with a random value:

   ```powershell
   Copy-Item backend\.env.example backend\.env
   ```

   Keep `.env` files local; they are ignored by Git. The default `DATA_PROVIDER=psxlens` does not require an API key.

3. Start the API in a VS Code terminal:

   ```powershell
   Set-Location backend
   uvicorn app.main:app --reload --env-file .env
   ```

   FastAPI docs: [http://localhost:8000/docs](http://localhost:8000/docs). The SQLite database is created in `backend\professor_stocks.db` on first startup.

4. In a second terminal, install and start the frontend:

   ```powershell
   Set-Location frontend
   npm install
   npm run dev
   ```

   Open [http://localhost:5173](http://localhost:5173). Set `VITE_API_URL` in `frontend\.env.local` only if the backend URL changes.

## Polling and data freshness

The React app only calls the FastAPI service; it never contacts a market provider directly. The dashboard, market list, watchlist, open Stock Detail, and dedicated Stock Analysis page refresh every 30 seconds by default, pause while the tab is hidden, and do not overlap an in-flight refresh. Configure the interval with `VITE_FRONTEND_POLL_INTERVAL` in `frontend\.env.local` and keep it consistent with `FRONTEND_POLL_INTERVAL` in `backend\.env`.

The backend shares quote, freshness, history, dividend, financial, and sector cache settings across requests in a process. Configure `QUOTE_CACHE_TTL`, `FRESHNESS_CACHE_TTL`, `HISTORICAL_CACHE_TTL`, `DIVIDEND_CACHE_TTL`, `FINANCIAL_CACHE_TTL`, `SECTOR_CACHE_TTL`, `API_TIMEOUT`, and `MAX_RETRIES` in `backend\.env`. Cached responses retain their original source timestamp and report `STALE` after the freshness threshold; future or timezone-naive timestamps are not considered fresh. Provider failures use a previous cached result when one exists; otherwise the API returns `503 DATA UNAVAILABLE`. HTTP 429 responses honor `Retry-After` and suppress requests during the provider cooldown. The health endpoint's `last_updated` value is the latest stored market-data timestamp, not the health-check time.

## Delayed and real-time providers

The backend uses PSX Lens endpoints for freshness, market status/summary/board, screener, stock details/quotes, price history, dividends, sectors, announcements, and market wrap. Responses are checked for provider timestamps and freshness. The source is **DELAYED**, not LIVE; the provider's refresh cadence does not guarantee a new quote, and the available history/dividend coverage has gaps and caveats. Bulk RSI screening is unsupported, and sector returns are available only for the latest reported session.

No free, authorized PSX real-time feed or 30-second update guarantee has been verified. Commercial redistribution terms for PSX Lens also need confirmation before production use. The Capital Stake WebSocket adapter is not implemented/enabled until licensed endpoint, authentication, and message documentation are supplied. No external market API is called by React.

## Accounts

Register an account from the sign-in page to save a personal watchlist, portfolio, screener settings, and preferences. Guest watchlists and portfolios remain local to the application database.

## API outline

- `GET /api/health`, `/api/market/overview`
- `GET /api/stocks`, `/api/stocks/{symbol}`, `/api/stocks/{symbol}/history`, `/api/stocks/{symbol}/indicators`, `/api/stocks/{symbol}/dividends`
- `GET /api/sectors`, `GET /api/screener`
- `GET|POST /api/watchlist`, `DELETE /api/watchlist/{symbol}`
- `GET|POST /api/portfolio`, `DELETE /api/portfolio/{symbol}`
- `GET|PUT /api/preferences`, `GET /api/news`
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`

## Future authorized PSX feed

Local delayed-data development does not need API credentials. A licensed real-time source would require its authorized API documentation, credentials, rate limits, permitted data fields, freshness semantics, and redistribution terms. Add secret values only to an ignored backend `.env`; do not enable scraping or present delayed data as live.

The database URL can later be switched to a PostgreSQL/hosted Postgres SQLAlchemy URL. No external accounts, deployment, or GitHub push are configured by this project.
