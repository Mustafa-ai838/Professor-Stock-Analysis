import { useState, type FormEvent } from "react";
import { BarChart3, LogIn } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../services/api";

export function Login() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api.login({ email, password });
      localStorage.setItem("psa_token", result.access_token);
      localStorage.setItem("psa_email", result.user.email);
      navigate(searchParams.get("next") || "/", { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to sign in. Please verify your credentials.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link to="/" className="auth-brand">
          <span className="brand-mark"><BarChart3 size={22} /></span>
          Professor Stock Analysis
        </Link>
        <h1>Sign In</h1>
        <p>Access your personal watchlist, portfolio, and settings.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Email address
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
            />
          </label>
          {error && <div className="inline-error">{error}</div>}
          <button className="button auth-submit" disabled={loading} type="submit">
            <LogIn size={16} />
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <div className="auth-switch">
          Don't have an account? <Link className="text-link" to="/register">Create account</Link>
        </div>
      </div>
    </div>
  );
}
export default Login;
