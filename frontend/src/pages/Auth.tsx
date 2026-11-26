import { useState, type FormEvent } from "react";
import { BarChart3, LogIn, UserPlus } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../services/api";

export function Auth() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [registerMode, setRegisterMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setLoading(true);
    try {
      const result = registerMode ? await api.register({ email, password }) : await api.login({ email, password });
      localStorage.setItem("psa_token", result.access_token);
      localStorage.setItem("psa_email", result.user.email);
      navigate(searchParams.get("next") || "/portfolio", { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to authenticate. Try again.");
    } finally { setLoading(false); }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link to="/" className="auth-brand"><span className="brand-mark"><BarChart3 size={22} /></span>Professor Stock Analysis</Link>
        <h1>{registerMode ? "Create your account" : "Welcome back"}</h1>
        <p>{registerMode ? "Save a personal watchlist and portfolio." : "Sign in to your personal market workspace."}</p>
        <form onSubmit={submit} className="auth-form">
          <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
          <label>Password<input required type="password" minLength={8} autoComplete={registerMode ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label>
          {error && <div className="inline-error">{error}</div>}
          <button className="button auth-submit" disabled={loading}>{registerMode ? <UserPlus size={16} /> : <LogIn size={16} />}{loading ? "Please wait…" : registerMode ? "Create account" : "Sign in"}</button>
        </form>
        <div className="auth-switch">{registerMode ? "Already registered?" : "New to the platform?"} <button className="text-button" onClick={() => { setRegisterMode((current) => !current); setError(""); }}>{registerMode ? "Sign in" : "Create account"}</button></div>
      </div>
    </div>
  );
}
