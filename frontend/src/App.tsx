import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Market } from "./pages/Market";
import { Screener } from "./pages/Screener";
import { Watchlist } from "./pages/Watchlist";
import { StockDetail } from "./pages/StockDetail";
import { SectorAnalysis } from "./pages/SectorAnalysis";
import { StockAnalysis } from "./pages/StockAnalysis";
import { News } from "./pages/News";
import { Portfolio } from "./pages/Portfolio";
import { Settings } from "./pages/Settings";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";

function Protected({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!localStorage.getItem("psa_token")) {
    const next = encodeURIComponent(location.pathname);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}

function NotFound() {
  return (
    <section className="not-found">
      <h1>Page Not Found</h1>
      <p>The requested page does not exist or may have moved.</p>
      <Link className="button" to="/">Return to Dashboard</Link>
    </section>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="chart" element={<Market />} />
        <Route path="market" element={<Market />} />
        <Route path="screener" element={<Screener />} />
        <Route path="watchlist" element={<Watchlist />} />
        <Route path="stocks/:symbol" element={<StockDetail />} />
        <Route path="sectors" element={<SectorAnalysis />} />
        <Route path="stock-analysis" element={<StockAnalysis />} />
        <Route path="news" element={<News />} />
        <Route path="portfolio" element={<Protected><Portfolio /></Protected>} />
        <Route path="settings" element={<Protected><Settings /></Protected>} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
