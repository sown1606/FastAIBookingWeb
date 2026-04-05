import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import { extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";

export const RegisterPage = () => {
  const navigate = useNavigate();
  const { registerOwner } = useAuth();
  const { notify } = useToast();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    salonName: "",
    salonEmail: "",
    salonPhone: "",
    timezone: "America/New_York",
    city: "",
    state: "",
    postalCode: "",
    country: "US"
  });

  const onChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await registerOwner({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
        salon: {
          name: form.salonName,
          contactEmail: form.salonEmail || undefined,
          contactPhone: form.salonPhone || undefined,
          timezone: form.timezone,
          city: form.city || undefined,
          state: form.state || undefined,
          postalCode: form.postalCode || undefined,
          country: form.country || undefined
        }
      });
      notify("success", "Đã tạo tài khoản.");
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
      <div className="auth-card large">
        <h1>Tạo tài khoản chủ tiệm</h1>
        <form className="form-grid two-columns" onSubmit={onSubmit}>
          <label className="field">
            <span>Họ tên chủ tiệm</span>
            <input
              value={form.fullName}
              onChange={(event) => onChange("fullName", event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Email chủ tiệm</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => onChange("email", event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Số điện thoại chủ tiệm</span>
            <input
              type="tel"
              inputMode="numeric"
              value={form.phone}
              onChange={(event) => onChange("phone", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Mật khẩu</span>
            <input
              type="password"
              minLength={8}
              value={form.password}
              onChange={(event) => onChange("password", event.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>Tên tiệm</span>
            <input
              value={form.salonName}
              onChange={(event) => onChange("salonName", event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Email tiệm</span>
            <input
              type="email"
              value={form.salonEmail}
              onChange={(event) => onChange("salonEmail", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Số điện thoại tiệm</span>
            <input
              type="tel"
              inputMode="numeric"
              value={form.salonPhone}
              onChange={(event) => onChange("salonPhone", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Múi giờ</span>
            <input
              value={form.timezone}
              onChange={(event) => onChange("timezone", event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Thành phố</span>
            <input value={form.city} onChange={(event) => onChange("city", event.target.value)} />
          </label>
          <label className="field">
            <span>Bang</span>
            <input value={form.state} onChange={(event) => onChange("state", event.target.value)} />
          </label>
          <label className="field">
            <span>Mã bưu điện</span>
            <input
              value={form.postalCode}
              onChange={(event) => onChange("postalCode", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Quốc gia</span>
            <input value={form.country} onChange={(event) => onChange("country", event.target.value)} />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={submitting}>
              {submitting ? "Đang tạo..." : "Tạo tài khoản"}
            </button>
          </div>
        </form>
        <div className="auth-links">
          <Link to="/login">Quay lại đăng nhập</Link>
        </div>
      </div>
    </div>
  );
};
