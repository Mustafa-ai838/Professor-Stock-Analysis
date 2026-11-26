import { useState, type FormEvent } from "react";
import { BarChart3, UserPlus } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../services/api";

export function Register() {
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
      const result = await api.register({ email, password });
      localStorage.setItem("psa_token", result.access_token);
      localStorage.setItem("psa_email", result.user.email);
      navigate(searchParams.get("next") || "/", { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to register. Please try a different email or password.");
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
        <h1>Create Account</h1>
        <p>Register to save custom watchlists, portfolios, and alerts.</p>
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
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Minimum 8 characters"
            />
          </label>
          {error && <div className="inline-error">{error}</div>}
          <button className="button auth-submit" disabled={loading} type="submit">
            <UserPlus size={16} />
            {loading ? "Creating account…" : "Register"}
          </button>
        </form>
        <div className="auth-switch">
          Already registered? <Link className="text-link" to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
export default Register;
