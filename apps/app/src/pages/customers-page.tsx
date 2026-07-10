import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatDateTime } from "../lib/format";
import { formatCustomerName } from "../lib/customer-name";
import type { Pagination } from "../types";
import { DemoAvatar } from "../components/avatar";
import { formatCustomerPhoneInput, requiredLabel, validateOptionalCustomerPhone } from "../lib/phone";
import { statusLabelKey, useI18n } from "../lib/i18n";
import { useFormDialog } from "../components/form-dialog";

interface CustomerItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  notes?: string | null;
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

interface DeleteCustomerResponse {
  customerId: string;
  mode: "hard_delete" | "archive";
  appointmentCount: number;
  deletedAt?: string;
}

const activeStatuses = new Set(["SCHEDULED", "CONFIRMED", "IN_PROGRESS"]);
const completedStatuses = new Set(["COMPLETED"]);
const canceledStatuses = new Set(["CANCELED", "NO_SHOW"]);

const localDateKey = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

export const CustomersPage = () => {
  const { notify } = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { openFormDialog, FormDialog } = useFormDialog();
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
    if (!validateOptionalCustomerPhone(form.phone)) {
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

  const editCustomer = async (customer: CustomerItem) => {
    const values = await openFormDialog({
      title: t("customers.edit"),
      fields: [
        { name: "firstName", label: t("customers.firstName"), required: true },
        { name: "lastName", label: t("customers.lastName") },
        { name: "email", label: t("common.email"), type: "email" },
        { name: "phone", label: t("common.phone"), required: true, type: "tel" },
        { name: "notes", label: t("customers.notes"), type: "textarea", rows: 3 }
      ],
      initialValues: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email ?? "",
        phone: customer.phone,
        notes: customer.notes ?? ""
      },
      confirmLabel: t("common.save")
    });
    if (!values) {
      return;
    }
    if (!validateOptionalCustomerPhone(values.phone)) {
      notify("error", t("form.phoneInvalid"));
      return;
    }
    try {
      await apiPatch<CustomerItem, Partial<CustomerItem>>(`/api/v1/customers/${customer.id}`, {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email || null,
        phone: values.phone,
        notes: values.notes || null
      });
      notify("success", t("customers.updated"));
      await load();
    } catch (editError) {
      notify("error", extractErrorMessage(editError));
    }
  };

  const deleteCustomer = async (customer: CustomerItem) => {
    try {
      const history = await apiGet<CustomerHistory>(`/api/v1/customers/${customer.id}/appointments`);
      const now = Date.now();
      const activeFuture = history.appointments.find(
        (appointment) =>
          activeStatuses.has(appointment.status) && new Date(appointment.startTime).getTime() >= now
      );
      setSelected(history);

      if (activeFuture) {
        notify("error", t("customers.deleteActiveFutureBlocked"));
        return;
      }

      const displayName = formatCustomerName(customer.firstName, customer.lastName) || customer.phone;
      const modeLabel = history.appointments.length
        ? t("customers.deleteModeArchive")
        : t("customers.deleteModeHard");
      const confirmed = window.confirm(
        t("customers.deleteConfirm", {
          name: displayName,
          phone: customer.phone,
          mode: modeLabel
        })
      );
      if (!confirmed) {
        return;
      }

      const result = await apiDelete<DeleteCustomerResponse>(`/api/v1/customers/${customer.id}`);
      notify("success", result.mode === "archive" ? t("customers.archived") : t("customers.deleted"));
      if (selected?.customer.id === customer.id) {
        setSelected(null);
      }
      await load();
    } catch (deleteError) {
      notify("error", extractErrorMessage(deleteError));
    }
  };

  const historyGroups = useMemo(() => {
    const appointments = selected?.appointments ?? [];
    return {
      upcoming: appointments.filter((appointment) => activeStatuses.has(appointment.status)),
      completed: appointments.filter((appointment) => completedStatuses.has(appointment.status)),
      canceled: appointments.filter((appointment) => canceledStatuses.has(appointment.status))
    };
  }, [selected]);

  const lastVisit = useMemo(() => {
    const completed = historyGroups.completed
      .slice()
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];
    return completed?.startTime ?? null;
  }, [historyGroups.completed]);

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <div className="stack">
      <FormDialog />
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
            <span>{t("customers.lastName")}</span>
            <input
              value={form.lastName}
              onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
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
              placeholder="+84978634886"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: formatCustomerPhoneInput(event.target.value) }))}
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
            {customers.items.map((item) => {
              const displayName = formatCustomerName(item.firstName, item.lastName) || item.phone;
              return (
              <article key={item.id} className="entity-card">
                <div className="entity-card-header">
                  <div className="person-cell">
                    <DemoAvatar name={displayName} variant="customer" size="sm" />
                    <span>
                      <strong>{displayName}</strong>
                      <span className="muted">{item.email ?? t("common.none")}</span>
                    </span>
                  </div>
                </div>
                <div className="entity-metric-grid">
                  <div className="entity-metric">
                    <span className="muted">{t("common.phone")}</span>
                    <strong>{item.phone}</strong>
                  </div>
                  <div className="entity-metric">
                    <span className="muted">{t("common.email")}</span>
                    <strong>{item.email ?? t("common.none")}</strong>
                  </div>
                </div>
                <div className="entity-card-actions">
                  <button type="button" className="button-secondary" onClick={() => selectCustomer(item.id)}>
                    {t("customers.viewHistory")}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => void editCustomer(item)}>
                    {t("customers.edit")}
                  </button>
                  <button type="button" className="button-secondary danger" onClick={() => void deleteCustomer(item)}>
                    {t("customers.delete")}
                  </button>
                </div>
              </article>
              );
            })}
          </div>
        ) : (
          <EmptyBlock message={t("common.none")} />
        )}
      </section>

      <section className="card">
        <h2>{t("customers.historyTitle")}</h2>
        {selected ? (
          <>
            <div className="summary-badges">
              <span className="summary-badge">{formatCustomerName(selected.customer.firstName, selected.customer.lastName) || selected.customer.phone}</span>
              <span className="summary-badge">{t("common.phone")}: {selected.customer.phone}</span>
              <span className="summary-badge">{t("appointments.upcomingCount")}: {historyGroups.upcoming.length}</span>
              <span className="summary-badge">{t("appointments.completedCount")}: {historyGroups.completed.length}</span>
              <span className="summary-badge">{t("appointments.canceledNoShowCount")}: {historyGroups.canceled.length}</span>
              <span className="summary-badge">{t("customers.lastVisit")}: {lastVisit ? formatDateTime(lastVisit) : t("common.none")}</span>
            </div>
            {[
              [t("appointments.upcomingTitle"), historyGroups.upcoming],
              [t("appointments.completedTab"), historyGroups.completed],
              [t("appointments.canceledNoShowTab"), historyGroups.canceled]
            ].map(([label, items]) => (
              <div key={String(label)} className="day-section">
                <h3>{String(label)}</h3>
                {Array.isArray(items) && items.length ? (
                  <div className="mobile-list">
                    {items.map((appointment) => (
                      <article
                        key={appointment.id}
                        className="mobile-item"
                        onClick={() =>
                          navigate(`/appointments?date=${localDateKey(appointment.startTime)}&appointmentId=${appointment.id}`)
                        }
                      >
                        <strong>{formatDateTime(appointment.startTime)}</strong>
                        <span>{appointment.service.name} · {appointment.staff.fullName}</span>
                        <span className="muted">
                          {statusLabelKey(appointment.status) ? t(statusLabelKey(appointment.status)!) : appointment.status}
                        </span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock message={t("common.none")} />
                )}
              </div>
            ))}
          </>
        ) : (
          <EmptyBlock message={t("customers.pickForHistory")} />
        )}
      </section>
    </div>
  );
};
