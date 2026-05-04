import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatDateTime } from "../lib/format";
import type { Pagination } from "../types";
import { DemoAvatar } from "../components/avatar";
import { formatUsPhoneInput, requiredLabel, validateOptionalUsPhone } from "../lib/phone";
import { statusLabelKey, useI18n } from "../lib/i18n";

interface CustomerItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
}

interface CustomersResponse {
  items: CustomerItem[];
  pagination: Pagination;
}

interface CustomerHistory {
  customer: CustomerItem;
  appointments: Array<{
    id: string;
    startTime: string;
    status: string;
    staff: {
      fullName: string;
    };
    service: {
      name: string;
    };
  }>;
}

export const CustomersPage = () => {
  const { notify } = useToast();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomersResponse | null>(null);
  const [selected, setSelected] = useState<CustomerHistory | null>(null);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: ""
  });

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "50"
      });
      if (query.trim()) {
        params.set("q", query.trim());
      }
      const response = await apiGet<CustomersResponse>(`/api/v1/customers?${params.toString()}`);
      setCustomers(response);
      if (selected) {
        const history = await apiGet<CustomerHistory>(`/api/v1/customers/${selected.customer.id}/appointments`);
        setSelected(history);
      }
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [query]);

  const createCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateOptionalUsPhone(form.phone)) {
      notify("error", t("form.phoneInvalid"));
      return;
    }
    try {
      await apiPost<unknown, unknown>("/api/v1/customers", {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email || undefined,
        phone: form.phone
      });
      setForm({
        firstName: "",
        lastName: "",
        email: "",
        phone: ""
      });
      notify("success", t("customers.created"));
      await load();
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const selectCustomer = async (customerId: string) => {
    try {
      const history = await apiGet<CustomerHistory>(`/api/v1/customers/${customerId}/appointments`);
      setSelected(history);
    } catch (selectError) {
      notify("error", extractErrorMessage(selectError));
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header">
          <div>
            <h2>{t("customers.listTitle")}</h2>
            <p className="muted">{t("customers.directoryHint")}</p>
          </div>
          <div className="summary-badges">
            <span className="summary-badge">
              {t("customers.total")}: {customers?.pagination.total ?? 0}
            </span>
            <span className="summary-badge">
              {t("customers.withEmail")}: {customers?.items.filter((item) => Boolean(item.email)).length ?? 0}
            </span>
            <span className="summary-badge">
              {t("customers.historyCount")}: {selected?.appointments.length ?? 0}
            </span>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{t("customers.createTitle")}</h2>
        <form className="form-grid two-columns" onSubmit={createCustomer}>
          <label className="field">
            <span>{requiredLabel(t("customers.firstName"))}</span>
            <input
              value={form.firstName}
              onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{requiredLabel(t("customers.lastName"))}</span>
            <input
              value={form.lastName}
              onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{t("common.email")}</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>{requiredLabel(t("common.phone"))}</span>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(212) 555-0100"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: formatUsPhoneInput(event.target.value) }))}
              required
            />
            <small>{t("form.phoneHint")}</small>
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              {t("customers.add")}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>{t("customers.listTitle")}</h2>
        <label className="field compact">
          <span>{t("common.search")}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("customers.searchPlaceholder")}
          />
        </label>
        {customers?.items.length ? (
          <div className="entity-grid">
            {customers.items.map((item) => (
              <article key={item.id} className="entity-card">
                <div className="entity-card-header">
                  <div className="person-cell">
                    <DemoAvatar name={`${item.firstName} ${item.lastName}`} variant="customer" size="sm" />
                    <span>
                      <strong>
                        {item.firstName} {item.lastName}
                      </strong>
                      <span className="muted">{item.email ?? t("common.none")}</span>
                    </span>
                  </div>
                  <button type="button" className="button-secondary" onClick={() => selectCustomer(item.id)}>
                    {t("customers.viewHistory")}
                  </button>
                </div>
                <div className="entity-metric-grid">
                  <div className="entity-metric">
                    <span className="muted">{t("common.email")}</span>
                    <strong>{item.email ?? t("common.none")}</strong>
                  </div>
                  <div className="entity-metric">
                    <span className="muted">{t("common.phone")}</span>
                    <strong>{item.phone}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock message={t("common.none")} />
        )}
      </section>

      <section className="card">
        <h2>{t("customers.historyTitle")}</h2>
        {selected ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("appointments.time")}</th>
                  <th>{t("appointments.service")}</th>
                  <th>{t("appointments.staff")}</th>
                  <th>{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {selected.appointments.map((appointment) => (
                  <tr key={appointment.id}>
                    <td>{formatDateTime(appointment.startTime)}</td>
                    <td>{appointment.service.name}</td>
                    <td>{appointment.staff.fullName}</td>
                    <td>{statusLabelKey(appointment.status) ? t(statusLabelKey(appointment.status)!) : appointment.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message={t("customers.pickForHistory")} />
        )}
      </section>
    </div>
  );
};
