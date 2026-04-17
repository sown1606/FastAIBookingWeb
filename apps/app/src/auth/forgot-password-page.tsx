import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./auth-context";
import { extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";
import { useI18n } from "../lib/i18n";
import { AuthFrame } from "./auth-frame";

export const ForgotPasswordPage = () => {
  const { forgotPassword } = useAuth();
  const { notify } = useToast();
  const { t } = useI18n();

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setSent(true);
      notify("success", t("auth.forgot.success"));
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
        <h1>{t("auth.forgot.title")}</h1>
        <p className="muted">{t("auth.forgot.helper")}</p>
      </div>
        <form className="form-grid" onSubmit={onSubmit}>
          <label className="field">
            <span>{t("common.email")}</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          {sent ? (
            <div className="muted">
              {t("auth.forgot.sent")}
            </div>
          ) : null}
          <button type="submit" className="button-primary" disabled={submitting}>
            {submitting ? t("auth.forgot.submitting") : t("auth.forgot.submit")}
          </button>
        </form>
        <div className="auth-links">
          <Link to="/login">{t("auth.login.back")}</Link>
        </div>
    </AuthFrame>
  );
};
