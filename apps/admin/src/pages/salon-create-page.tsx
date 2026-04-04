import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost, extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";

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
      <h2>Create salon</h2>
      <form className="form-grid two-columns" onSubmit={onSubmit}>
        <label className="field">
          <span>Salon name *</span>
          <input value={form.name} onChange={(event) => onChange("name", event.target.value)} required />
        </label>
        <label className="field">
          <span>Timezone *</span>
          <input
            value={form.timezone}
            onChange={(event) => onChange("timezone", event.target.value)}
            required
          />
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
            inputMode="numeric"
            value={form.contactPhone}
            onChange={(event) => onChange("contactPhone", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Original salon phone</span>
          <input
            type="tel"
            inputMode="numeric"
            value={form.originalPhoneNumber}
            onChange={(event) => onChange("originalPhoneNumber", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Customer incoming phone</span>
          <input
            type="tel"
            inputMode="numeric"
            value={form.customerIncomingPhoneNumber}
            onChange={(event) => onChange("customerIncomingPhoneNumber", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Notification phone</span>
          <input
            type="tel"
            inputMode="numeric"
            value={form.notificationPhoneNumber}
            onChange={(event) => onChange("notificationPhoneNumber", event.target.value)}
          />
        </label>
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
          <input value={form.country} onChange={(event) => onChange("country", event.target.value)} />
        </label>

        <h3 className="section-title">Owner account</h3>
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
            inputMode="numeric"
            value={form.ownerPhone}
            onChange={(event) => onChange("ownerPhone", event.target.value)}
          />
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
