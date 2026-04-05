import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./auth-context";
import { extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";

export const ForgotPasswordPage = () => {
  const { forgotPassword } = useAuth();
  const { notify } = useToast();

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
      notify("success", "Đã gửi yêu cầu đặt lại mật khẩu.");
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
        <h1>Quên mật khẩu</h1>
        <form className="form-grid" onSubmit={onSubmit}>
          <label className="field">
            <span>Email</span>
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
              Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi. Vui lòng kiểm tra hộp thư và spam.
            </div>
          ) : null}
          <button type="submit" className="button-primary" disabled={submitting}>
            {submitting ? "Đang gửi..." : "Gửi link đặt lại"}
          </button>
        </form>
        <div className="auth-links">
          <Link to="/login">Quay lại đăng nhập</Link>
        </div>
      </div>
    </div>
  );
};
