import { FormEvent, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";
import { extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";
import { useI18n } from "../lib/i18n";
import { AuthFrame } from "./auth-frame";

export const ResetPasswordPage = () => {
  const location = useLocation();
  const { resetPassword } = useAuth();
  const { notify } = useToast();
  const { t } = useI18n();
  const token = useMemo(() => new URLSearchParams(location.search).get("token") ?? "", [location.search]);

  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setError(t("auth.reset.missingToken"));
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await resetPassword(token, newPassword);
      setCompleted(true);
      notify("success", t("auth.reset.success"));
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
        <h1>{t("auth.reset.title")}</h1>
      </div>
        <form className="form-grid" onSubmit={onSubmit}>
          <label className="field">
            <span>{t("auth.reset.newPassword")}</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          {completed ? <div className="muted">{t("auth.reset.completed")}</div> : null}
          <button type="submit" className="button-primary" disabled={submitting || completed}>
            {submitting ? t("auth.reset.submitting") : t("auth.reset.submit")}
          </button>
        </form>
        <div className="auth-links">
          <Link to="/login">{t("auth.login.back")}</Link>
        </div>
    </AuthFrame>
  );
};
