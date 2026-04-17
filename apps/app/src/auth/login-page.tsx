import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import { extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";
import { useI18n } from "../lib/i18n";
import { AuthFrame } from "./auth-frame";

export const LoginPage = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { notify } = useToast();
  const { t } = useI18n();

  const [mode, setMode] = useState<"owner" | "staff" | "call-center">("owner");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password, mode);
      notify("success", t("auth.login.success"));
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
    <AuthFrame>
      <div className="auth-heading">
        <h1>{t("auth.login.title")}</h1>
        <p className="muted">{t("auth.login.helper")}</p>
      </div>
      <form className="form-grid" onSubmit={onSubmit}>
          <label className="field">
            <span>{t("auth.login.role")}</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as "owner" | "staff" | "call-center")}
            >
              <option value="owner">{t("auth.login.owner")}</option>
              <option value="staff">{t("auth.login.staff")}</option>
              <option value="call-center">{t("auth.login.operator")}</option>
            </select>
          </label>
          <label className="field">
            <span>{t("common.email")}</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span>{t("auth.login.password")}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button type="submit" className="button-primary" disabled={submitting}>
            {submitting ? t("auth.login.submitting") : t("auth.login.submit")}
          </button>
      </form>
      <div className="demo-account-card">
        <strong>{t("auth.login.demoTitle")}</strong>
        <span>{t("auth.login.ownerDemo")}</span>
        <span>{t("auth.login.staffDemo")}</span>
        <span>{t("auth.login.operatorDemo")}</span>
      </div>
      <div className="auth-links">
        <Link to="/register">{t("auth.login.createOwner")}</Link>
        <Link to="/forgot-password">{t("auth.login.forgot")}</Link>
      </div>
    </AuthFrame>
  );
};
