import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import { extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";
import { useI18n } from "../lib/i18n";

export const LoginPage = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { notify } = useToast();
  const { t } = useI18n();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
      notify("success", t("login.success"));
      navigate("/dashboard");
    } catch (submitError) {
      const message = extractErrorMessage(submitError);
      setError(message);
      notify("error", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div>
          <p className="eyebrow">{t("layout.platform")}</p>
          <h1>{import.meta.env.VITE_APP_NAME ?? "FastAIBooking Admin"}</h1>
          <p className="muted">{t("login.helper")}</p>
        </div>
        <form onSubmit={onSubmit} className="form-grid">
          <label className="field">
            <span>{t("login.email")}</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>{t("login.password")}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button type="submit" className="button-primary" disabled={submitting}>
            {submitting ? t("login.submitting") : t("login.submit")}
          </button>
        </form>
        <div className="mobile-item">
          <strong>{t("login.demoTitle")}</strong>
          <span className="muted">admin@fastaibooking.local / Admin123!</span>
        </div>
      </div>
    </div>
  );
};
