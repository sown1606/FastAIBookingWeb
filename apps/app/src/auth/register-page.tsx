import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import { extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";
import { getCountryOptions, getTimezoneOptions } from "../lib/form-options";
import { formatUsPhoneInput, requiredLabel, validateOptionalUsPhone } from "../lib/phone";
import { useI18n } from "../lib/i18n";
import { AuthFrame } from "./auth-frame";

export const RegisterPage = () => {
  const navigate = useNavigate();
  const { registerOwner } = useAuth();
  const { notify } = useToast();
  const { t } = useI18n();
  const timezoneOptions = getTimezoneOptions(t);
  const countryOptions = getCountryOptions(t);

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
    if (!validateOptionalUsPhone(form.phone) || !validateOptionalUsPhone(form.salonPhone)) {
      setError(t("form.phoneInvalid"));
      return;
    }
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
      notify("success", t("auth.register.success"));
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
    <AuthFrame wide>
      <div className="auth-heading">
        <h1>{t("auth.register.title")}</h1>
        <p className="muted">{t("auth.register.helper")}</p>
      </div>
      <form className="form-grid two-columns" onSubmit={onSubmit}>
          <div className="form-section-title">
            <strong>{t("auth.register.ownerInfo")}</strong>
          </div>
          <label className="field">
            <span>{requiredLabel(t("auth.register.ownerName"))}</span>
            <input
              value={form.fullName}
              onChange={(event) => onChange("fullName", event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>{requiredLabel(t("common.email"))}</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => onChange("email", event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>{t("auth.register.ownerPhone")}</span>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(212) 555-0100"
              value={form.phone}
              onChange={(event) => onChange("phone", formatUsPhoneInput(event.target.value))}
              aria-describedby="owner-phone-hint"
            />
            <small id="owner-phone-hint">{t("form.phoneHint")}</small>
          </label>
          <label className="field">
            <span>{requiredLabel(t("auth.login.password"))}</span>
            <input
              type="password"
              minLength={8}
              value={form.password}
              onChange={(event) => onChange("password", event.target.value)}
              required
            />
            <small>{t("auth.register.passwordHint")}</small>
          </label>

          <div className="form-section-title">
            <strong>{t("auth.register.salonInfo")}</strong>
          </div>
          <label className="field">
            <span>{requiredLabel(t("auth.register.salonName"))}</span>
            <input
              value={form.salonName}
              onChange={(event) => onChange("salonName", event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>{t("auth.register.salonEmail")}</span>
            <input
              type="email"
              value={form.salonEmail}
              onChange={(event) => onChange("salonEmail", event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("auth.register.salonPhone")}</span>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(212) 555-0100"
              value={form.salonPhone}
              onChange={(event) => onChange("salonPhone", formatUsPhoneInput(event.target.value))}
            />
            <small>{t("form.phoneHint")}</small>
          </label>
          <label className="field">
            <span>{requiredLabel(t("common.timezone"))}</span>
            <select
              value={form.timezone}
              onChange={(event) => onChange("timezone", event.target.value)}
              required
            >
              {timezoneOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("common.city")}</span>
            <input value={form.city} onChange={(event) => onChange("city", event.target.value)} />
          </label>
          <label className="field">
            <span>{t("common.state")}</span>
            <input value={form.state} onChange={(event) => onChange("state", event.target.value)} />
          </label>
          <label className="field">
            <span>{t("common.postalCode")}</span>
            <input
              value={form.postalCode}
              onChange={(event) => onChange("postalCode", event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("common.country")}</span>
            <select value={form.country} onChange={(event) => onChange("country", event.target.value)}>
              {countryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={submitting}>
              {submitting ? t("auth.register.submitting") : t("auth.register.submit")}
            </button>
          </div>
        </form>
        <div className="auth-links">
          <Link to="/login">{t("auth.login.back")}</Link>
        </div>
    </AuthFrame>
  );
};
