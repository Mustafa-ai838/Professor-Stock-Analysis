import { useEffect, useState } from "react";
import { Activity, Bell, CheckCircle2, Save, UserRound } from "lucide-react";
import { ErrorState, LoadingState, PageHeading, Panel } from "../components/ui";
import { api } from "../services/api";

export function Settings() {
  const [currency, setCurrency] = useState("PKR");
  const [emailAlerts, setEmailAlerts] = useState(false);
  const [dailyRsi, setDailyRsi] = useState("60");
  const [weeklyRsi, setWeeklyRsi] = useState("60");
  const [monthlyRsi, setMonthlyRsi] = useState("60");
  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [savingRsi, setSavingRsi] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [rsiMessage, setRsiMessage] = useState("");
  const email = localStorage.getItem("psa_email") ?? "Demo account";

  useEffect(() => {
    Promise.all([
      api.preferences(),
      api.screenerSettings().catch(() => ({ settings: {} as Record<string, string> })),
    ])
      .then(([prefs, scr]) => {
        setCurrency(prefs.currency);
        setEmailAlerts(prefs.email_alerts);
        const s = (scr.settings || {}) as Record<string, string>;
        if (s.dailyRsi) setDailyRsi(s.dailyRsi);
        if (s.weeklyRsi) setWeeklyRsi(s.weeklyRsi);
        if (s.monthlyRsi) setMonthlyRsi(s.monthlyRsi);
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  async function savePreferences() {
    setSavingPrefs(true);
    setError("");
    setMessage("");
    try {
      const res = await api.savePreferences({ currency, email_alerts: emailAlerts });
      setMessage(res.message || "Preferences saved successfully.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save preferences.");
    } finally {
      setSavingPrefs(false);
    }
  }

  async function saveRsiStrategy() {
    setSavingRsi(true);
    setError("");
    setRsiMessage("");
    try {
      const payload = {
        dailyRsi,
        weeklyRsi,
        monthlyRsi,
      };
      const res = await api.saveScreenerSettings(payload);
      localStorage.setItem("psa_screener_rsi_settings", JSON.stringify(payload));
      setRsiMessage(res.message || "RSI Strategy settings saved successfully.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save RSI strategy.");
    } finally {
      setSavingRsi(false);
    }
  }

  return (
    <>
      <PageHeading title="Settings" description="Manage your account, RSI trading strategy, and display preferences." />
      {message && <div className="success-message">{message}</div>}
      {rsiMessage && <div className="success-message">{rsiMessage}</div>}
      {error && <ErrorState message={error} />}

      {loading ? (
        <LoadingState label="Loading account preferences…" />
      ) : (
        <div className="settings-grid">
          {/* RSI Trading Strategy Card */}
          <Panel title="RSI Strategy Settings">
            <div className="flex items-center gap-2 mb-3 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
              <Activity size={16} />
              <span>Multi-Timeframe Strategy Thresholds</span>
            </div>
            <p className="helper-text mb-4">
              Configure your default RSI strategy for the Stock Screener. When stocks meet or exceed these thresholds across Daily, Weekly, and Monthly timeframes simultaneously, they match your strategy.
            </p>

            <div className="setting-row">
              <span>
                <b>Daily RSI Minimum</b>
                <small>Trigger threshold for short-term daily momentum.</small>
              </span>
              <select
                className="filter-select text-sm py-1.5 px-3 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-semibold"
                value={dailyRsi}
                onChange={(e) => setDailyRsi(e.target.value)}
              >
                <option value="40">Above 40</option>
                <option value="45">Above 45</option>
                <option value="50">Above 50</option>
                <option value="55">Above 55</option>
                <option value="60">Above 60 (Professor Recommended)</option>
                <option value="65">Above 65</option>
                <option value="70">Above 70 (Overbought / Strong)</option>
                <option value="75">Above 75</option>
                <option value="80">Above 80</option>
                <option value="Any">Any (Disabled)</option>
              </select>
            </div>

            <div className="setting-row">
              <span>
                <b>Weekly RSI Minimum</b>
                <small>Trigger threshold for intermediate-term weekly momentum.</small>
              </span>
              <select
                className="filter-select text-sm py-1.5 px-3 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-semibold"
                value={weeklyRsi}
                onChange={(e) => setWeeklyRsi(e.target.value)}
              >
                <option value="40">Above 40</option>
                <option value="45">Above 45</option>
                <option value="50">Above 50</option>
                <option value="55">Above 55</option>
                <option value="60">Above 60 (Professor Recommended)</option>
                <option value="65">Above 65</option>
                <option value="70">Above 70</option>
                <option value="75">Above 75</option>
                <option value="80">Above 80</option>
                <option value="Any">Any (Disabled)</option>
              </select>
            </div>

            <div className="setting-row">
              <span>
                <b>Monthly RSI Minimum</b>
                <small>Trigger threshold for long-term macro trend strength.</small>
              </span>
              <select
                className="filter-select text-sm py-1.5 px-3 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-semibold"
                value={monthlyRsi}
                onChange={(e) => setMonthlyRsi(e.target.value)}
              >
                <option value="40">Above 40</option>
                <option value="45">Above 45</option>
                <option value="50">Above 50</option>
                <option value="55">Above 55</option>
                <option value="60">Above 60 (Professor Recommended)</option>
                <option value="65">Above 65</option>
                <option value="70">Above 70</option>
                <option value="75">Above 75</option>
                <option value="80">Above 80</option>
                <option value="Any">Any (Disabled)</option>
              </select>
            </div>

            <div className="pt-2 flex items-center justify-between">
              <button
                className="button"
                onClick={saveRsiStrategy}
                disabled={savingRsi}
              >
                <Save size={15} />
                {savingRsi ? "Saving Strategy…" : "Save RSI Strategy"}
              </button>
              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-400" />
                <span>Auto-loads on Screener page</span>
              </div>
            </div>
          </Panel>

          {/* Account Card */}
          <Panel title="Account">
            <div className="account-card">
              <div className="account-avatar">
                <UserRound size={22} />
              </div>
              <div>
                <b>{email}</b>
                <span>Personal account · saved to local database</span>
              </div>
            </div>
            <p className="helper-text">
              Your watchlist, portfolio, and preferences are isolated to the account you are signed into.
            </p>
          </Panel>

          {/* Display preferences */}
          <Panel title="Display preferences">
            <div className="setting-row">
              <span>
                <b>Display currency</b>
                <small>PSX quotes and portfolio values are stored and displayed in Pakistani rupees.</small>
              </span>
              <strong className="preference-value">{currency}</strong>
            </div>
            <label className="setting-row">
              <span>
                <b><Bell size={15} /> Email alerts</b>
                <small>Preference is saved; email delivery is not configured in this demo.</small>
              </span>
              <input
                type="checkbox"
                checked={emailAlerts}
                onChange={(event) => setEmailAlerts(event.target.checked)}
              />
            </label>
            <button className="button" onClick={savePreferences} disabled={savingPrefs}>
              <Save size={15} />
              {savingPrefs ? "Saving…" : "Save preferences"}
            </button>
          </Panel>
        </div>
      )}
    </>
  );
}
