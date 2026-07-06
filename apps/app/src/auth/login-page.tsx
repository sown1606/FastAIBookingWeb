import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import { extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";
import { useI18n } from "../lib/i18n";
import { AuthFrame } from "./auth-frame";

type LoginMode = "owner" | "staff" | "call-center";

const demoAccounts: Array<{
  mode: LoginMode;
  labelKey: "auth.login.owner" | "auth.login.staff" | "auth.login.operator";
  email: string;
  password: string;
}> = [
  {
    mode: "owner",
    labelKey: "auth.login.owner",
    email: "owner.demo@fastaibooking.local",
    password: "Owner123!"
  },
  {
    mode: "staff",
    labelKey: "auth.login.staff",
    email: "staff.demo@fastaibooking.local",
    password: "Staff123!"
  },
  {
    mode: "call-center",
    labelKey: "auth.login.operator",
    email: "agent.demo@fastaibooking.local",
    password: "Agent123!"
  }
];

export const LoginPage = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { notify } = useToast();
  const { t } = useI18n();

  const [mode, setMode] = useState<LoginMode>("owner");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      const message = t("auth.login.missingCredentials");
      setError(message);
      notify("error", message);
      return;
    }
    setSubmitting(true);
    try {
      await login(normalizedEmail, password, mode);
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

  const copyDemoAccount = async (account: (typeof demoAccounts)[number]) => {
    try {
      await navigator.clipboard.writeText(`${account.email} / ${account.password}`);
      notify("success", t("auth.login.demoCopied"));
    } catch {
      setEmail(account.email);
      setPassword(account.password);
      setMode(account.mode);
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
              onChange={(event) => setMode(event.target.value as LoginMode)}
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
              onChange={(event) => setEmail(event.target.value.trimStart())}
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
      <details className="demo-account-card">
        <summary>{t("auth.login.demoTitle")}</summary>
        {demoAccounts.map((account) => (
          <div key={account.mode} className="demo-account-row">
            <span>
              <strong>{t(account.labelKey)}</strong>
              {account.email} / {account.password}
            </span>
            <button type="button" className="button-secondary compact-button" onClick={() => void copyDemoAccount(account)}>
              {t("common.copy")}
            </button>
          </div>
        ))}
      </details>
      <div className="auth-links">
        <Link to="/register">{t("auth.login.createOwner")}</Link>
        <Link to="/forgot-password">{t("auth.login.forgot")}</Link>
      </div>
    </AuthFrame>
  );
};
