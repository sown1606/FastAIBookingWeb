import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import { extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";

export const LoginPage = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { notify } = useToast();

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
      notify("success", "Đăng nhập thành công.");
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
        <h1>{import.meta.env.VITE_APP_NAME}</h1>
        <p className="muted">Ứng dụng cho chủ tiệm, nhân viên và tổng đài</p>
        <form className="form-grid" onSubmit={onSubmit}>
          <label className="field">
            <span>Đăng nhập với vai trò</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as "owner" | "staff" | "call-center")}
            >
              <option value="owner">Chủ tiệm</option>
              <option value="staff">Nhân viên</option>
              <option value="call-center">Tổng đài</option>
            </select>
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span>Mật khẩu</span>
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
            {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>
        <div className="auth-links">
          <Link to="/register">Tạo tài khoản chủ tiệm</Link>
          <Link to="/forgot-password">Quên mật khẩu</Link>
        </div>
      </div>
    </div>
  );
};
