import { FormEvent, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";
import { extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";

export const ResetPasswordPage = () => {
  const location = useLocation();
  const { resetPassword } = useAuth();
  const { notify } = useToast();
  const token = useMemo(() => new URLSearchParams(location.search).get("token") ?? "", [location.search]);

  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setError("Thiếu mã đặt lại mật khẩu.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await resetPassword(token, newPassword);
      setCompleted(true);
      notify("success", "Đã đặt lại mật khẩu.");
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
        <h1>Đặt lại mật khẩu</h1>
        <form className="form-grid" onSubmit={onSubmit}>
          <label className="field">
            <span>Mật khẩu mới</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          {completed ? <div className="muted">Đã đổi mật khẩu thành công.</div> : null}
          <button type="submit" className="button-primary" disabled={submitting || completed}>
            {submitting ? "Đang cập nhật..." : "Đặt lại mật khẩu"}
          </button>
        </form>
        <div className="auth-links">
          <Link to="/login">Quay lại đăng nhập</Link>
        </div>
      </div>
    </div>
  );
};
