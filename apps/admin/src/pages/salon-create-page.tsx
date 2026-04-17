import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost, extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";
import { countryOptions, timezoneOptions } from "../lib/form-options";
import { formatUsPhoneInput, validateOptionalUsPhone } from "../lib/phone";

interface CreateSalonResponse {
  id: string;
}

export const SalonCreatePage = () => {
  const navigate = useNavigate();
  const { notify } = useToast();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    contactEmail: "",
    contactPhone: "",
    originalPhoneNumber: "",
    customerIncomingPhoneNumber: "",
    notificationPhoneNumber: "",
    timezone: "America/New_York",
    addressLine1: "",
    city: "",
    state: "",
    postalCode: "",
    country: "US",
    ownerFullName: "",
    ownerEmail: "",
    ownerPhone: "",
    ownerPassword: ""
  });

  const onChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!form.name || !form.timezone || !form.ownerFullName || !form.ownerEmail || !form.ownerPassword) {
      setError("Salon and owner required fields must be completed.");
      return;
    }
    const phoneValues = [
      form.contactPhone,
      form.originalPhoneNumber,
      form.customerIncomingPhoneNumber,
      form.notificationPhoneNumber,
      form.ownerPhone
    ];
    if (!phoneValues.every(validateOptionalUsPhone)) {
      setError("Please enter valid US phone numbers.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiPost<CreateSalonResponse, unknown>("/api/v1/admin/salons", {
        name: form.name,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
        originalPhoneNumber: form.originalPhoneNumber || undefined,
        customerIncomingPhoneNumber: form.customerIncomingPhoneNumber || undefined,
        notificationPhoneNumber: form.notificationPhoneNumber || undefined,
        timezone: form.timezone,
        addressLine1: form.addressLine1 || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        postalCode: form.postalCode || undefined,
        country: form.country || undefined,
        owner: {
          fullName: form.ownerFullName,
          email: form.ownerEmail,
          phone: form.ownerPhone || undefined,
          password: form.ownerPassword
        }
      });
      notify("success", "Salon created successfully.");
      navigate(`/salons/${result.id}`);
    } catch (submitError) {
      const message = extractErrorMessage(submitError);
      setError(message);
      notify("error", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="card">
      <div>
        <p className="eyebrow">FastAIBooking Admin</p>
        <h2>Create salon</h2>
        <p className="muted">Create the salon profile, routing phones, and owner login in one flow.</p>
      </div>
      <form className="form-grid two-columns" onSubmit={onSubmit}>
        <div className="form-panel">
          <div>
            <h3>Salon profile</h3>
            <p className="muted">Core business details used across owner, staff, and call operations.</p>
          </div>
        <label className="field">
          <span>Salon name *</span>
          <input value={form.name} onChange={(event) => onChange("name", event.target.value)} required />
        </label>
        <label className="field">
          <span>Timezone *</span>
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
          <span>Salon email</span>
          <input
            type="email"
            value={form.contactEmail}
            onChange={(event) => onChange("contactEmail", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Salon phone</span>
          <input
            type="tel"
            inputMode="tel"
            placeholder="(212) 555-0100"
            value={form.contactPhone}
            onChange={(event) => onChange("contactPhone", formatUsPhoneInput(event.target.value))}
          />
          <small>US format, for example (212) 555-0100</small>
        </label>
        <label className="field">
          <span>Original salon phone</span>
          <input
            type="tel"
            inputMode="tel"
            placeholder="(212) 555-0100"
            value={form.originalPhoneNumber}
            onChange={(event) => onChange("originalPhoneNumber", formatUsPhoneInput(event.target.value))}
          />
          <small>Used when calls should ring the salon directly.</small>
        </label>
        <label className="field">
          <span>Customer incoming phone</span>
          <input
            type="tel"
            inputMode="tel"
            placeholder="(212) 555-0100"
            value={form.customerIncomingPhoneNumber}
            onChange={(event) => onChange("customerIncomingPhoneNumber", formatUsPhoneInput(event.target.value))}
          />
          <small>Tracking or public number customers call.</small>
        </label>
        <label className="field">
          <span>Notification phone</span>
          <input
            type="tel"
            inputMode="tel"
            placeholder="(212) 555-0100"
            value={form.notificationPhoneNumber}
            onChange={(event) => onChange("notificationPhoneNumber", formatUsPhoneInput(event.target.value))}
          />
          <small>Used for urgent salon alerts.</small>
        </label>
        </div>

        <div className="form-panel">
          <div>
            <h3>Address</h3>
            <p className="muted">Location data for operations and local reporting.</p>
          </div>
        <label className="field">
          <span>Address line 1</span>
          <input value={form.addressLine1} onChange={(event) => onChange("addressLine1", event.target.value)} />
        </label>
        <label className="field">
          <span>City</span>
          <input value={form.city} onChange={(event) => onChange("city", event.target.value)} />
        </label>
        <label className="field">
          <span>State</span>
          <input value={form.state} onChange={(event) => onChange("state", event.target.value)} />
        </label>
        <label className="field">
          <span>Postal code</span>
          <input value={form.postalCode} onChange={(event) => onChange("postalCode", event.target.value)} />
        </label>
        <label className="field">
          <span>Country</span>
          <select value={form.country} onChange={(event) => onChange("country", event.target.value)}>
            {countryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        </div>

        <div className="form-panel">
          <div>
            <h3>Owner account</h3>
            <p className="muted">This login becomes the salon owner workspace account.</p>
          </div>
        <label className="field">
          <span>Owner full name *</span>
          <input
            value={form.ownerFullName}
            onChange={(event) => onChange("ownerFullName", event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Owner email *</span>
          <input
            type="email"
            value={form.ownerEmail}
            onChange={(event) => onChange("ownerEmail", event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Owner phone</span>
          <input
            type="tel"
            inputMode="tel"
            placeholder="(212) 555-0100"
            value={form.ownerPhone}
            onChange={(event) => onChange("ownerPhone", formatUsPhoneInput(event.target.value))}
          />
          <small>US format, for example (212) 555-0100</small>
        </label>
        <label className="field">
          <span>Owner password *</span>
          <input
            type="password"
            value={form.ownerPassword}
            onChange={(event) => onChange("ownerPassword", event.target.value)}
            required
            minLength={8}
          />
        </label>
        </div>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={submitting}>
            {submitting ? "Creating..." : "Create salon"}
          </button>
        </div>
      </form>
    </section>
  );
};
