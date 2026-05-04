import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { useAuth } from "../auth/auth-context";
import { formatDateTime } from "../lib/format";
import type { Pagination } from "../types";
import { toDateTimeLocalValue, useFormDialog } from "../components/form-dialog";
import { statusLabelKey, useI18n } from "../lib/i18n";

interface AppointmentItem {
  id: string;
  startTime: string;
  endTime: string;
  status: "SCHEDULED" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | "NO_SHOW";
  source: string;
  durationMinutes: number;
  notes: string | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
  };
  staff: {
    id: string;
    fullName: string;
  };
  service: {
    id: string;
    name: string;
  };
  workSessions?: Array<{
    id: string;
    status: string;
    expectedEndAt: string;
    startedAt: string;
    extendedMinutes: number;
  }>;
}

interface AppointmentsResponse {
  items: AppointmentItem[];
  pagination: Pagination;
}

interface CustomerItem {
  id: string;
  firstName: string;
  lastName: string;
}

interface StaffItem {
  id: string;
  fullName: string;
}

interface ServiceItem {
  id: string;
  name: string;
  isActive: boolean;
}

interface CustomersResponse {
  items: CustomerItem[];
}

interface StaffReminder {
  id: string;
  reminderType: string;
  remindAt: string;
  message: string;
  appointment: AppointmentItem;
}

export const AppointmentsPage = () => {
  const { session } = useAuth();
  const { notify } = useToast();
  const { openFormDialog, FormDialog } = useFormDialog();
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [reminders, setReminders] = useState<StaffReminder[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [now, setNow] = useState(Date.now());

  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);

  const [form, setForm] = useState({
    customerId: "",
    staffId: "",
    serviceId: "",
    startTime: ""
  });

  const isOwner = session?.user.role === "SALON_OWNER";
  const appointmentStatusOptions = [
    { value: "SCHEDULED", label: t("status.SCHEDULED") },
    { value: "CONFIRMED", label: t("status.CONFIRMED") },
    { value: "CANCELED", label: t("status.CANCELED") },
    { value: "NO_SHOW", label: t("status.NO_SHOW") }
  ];

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "50"
      });
      if (statusFilter) {
        params.set("status", statusFilter);
      }
      const appointmentResponse = await apiGet<AppointmentsResponse>(
        `/api/v1/appointments?${params.toString()}`
      );
      setAppointments(appointmentResponse.items);

      if (isOwner) {
        const [customerResponse, staffResponse, serviceResponse] = await Promise.all([
          apiGet<CustomersResponse>("/api/v1/customers?page=1&limit=100"),
          apiGet<StaffItem[]>("/api/v1/staff?includeInactive=false"),
          apiGet<ServiceItem[]>("/api/v1/services")
        ]);
        setCustomers(customerResponse.items);
        setStaff(staffResponse);
        setServices(serviceResponse.filter((item) => item.isActive));
        setReminders([]);
      } else {
        setCustomers([]);
        setStaff([]);
        setServices([]);
        const reminderResult = await apiGet<StaffReminder[]>("/api/v1/staff/me/reminders");
        setReminders(reminderResult);
      }
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [isOwner, statusFilter]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const createAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isOwner) {
      return;
    }
    try {
      await apiPost<unknown, unknown>("/api/v1/appointments", {
        customerId: form.customerId,
        staffId: form.staffId,
        serviceId: form.serviceId,
        startTime: new Date(form.startTime).toISOString(),
        source: "DASHBOARD"
      });
      setForm({
        customerId: "",
        staffId: "",
        serviceId: "",
        startTime: ""
      });
      notify("success", t("appointments.created"));
      await load();
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const cancelAppointment = async (appointment: AppointmentItem) => {
    const values = await openFormDialog({
      title: t("appointments.cancel"),
      description: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      fields: [{ name: "reason", label: t("appointments.cancel"), type: "textarea", rows: 3 }],
      initialValues: {
        reason: t("appointments.cancelReasonDefault")
      },
      confirmLabel: t("appointments.cancel")
    });
    if (!values) {
      return;
    }
    try {
      await apiPatch<unknown, { reason?: string }>(`/api/v1/appointments/${appointment.id}/cancel`, {
        reason: values.reason || undefined
      });
      notify("success", t("appointments.cancel"));
      await load();
    } catch (cancelError) {
      notify("error", extractErrorMessage(cancelError));
    }
  };

  const rescheduleAppointment = async (appointment: AppointmentItem) => {
    const values = await openFormDialog({
      title: t("appointments.reschedule"),
      description: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      fields: [{ name: "startTime", label: t("appointments.start"), type: "datetime-local", required: true }],
      initialValues: {
        startTime: toDateTimeLocalValue(appointment.startTime)
      },
      confirmLabel: t("appointments.reschedule")
    });
    if (!values?.startTime) {
      return;
    }
    try {
      await apiPatch<unknown, { startTime: string }>(`/api/v1/appointments/${appointment.id}/reschedule`, {
        startTime: new Date(values.startTime).toISOString()
      });
      notify("success", t("appointments.reschedule"));
      await load();
    } catch (rescheduleError) {
      notify("error", extractErrorMessage(rescheduleError));
    }
  };

  const updateStatus = async (appointment: AppointmentItem) => {
    const values = await openFormDialog({
      title: t("appointments.updateStatus"),
      fields: [
        {
          name: "status",
          label: t("common.status"),
          type: "select",
          required: true,
          options: appointmentStatusOptions
        }
      ],
      initialValues: {
        status: appointment.status
      },
      confirmLabel: t("common.save")
    });
    if (!values?.status) {
      return;
    }
    try {
      await apiPatch<unknown, { status: string }>(`/api/v1/appointments/${appointment.id}`, {
        status: values.status
      });
      notify("success", t("appointments.updateStatus"));
      await load();
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  const startWork = async (appointmentId: string) => {
    try {
      await apiPost<unknown, Record<string, never>>(`/api/v1/appointments/${appointmentId}/start`, {});
      notify("success", t("appointments.startWork"));
      await load();
    } catch (startError) {
      notify("error", extractErrorMessage(startError));
    }
  };

  const extendWork = async (appointmentId: string) => {
    const values = await openFormDialog({
      title: t("appointments.extend"),
      fields: [
        { name: "minutes", label: t("appointments.extend"), type: "number", required: true, min: 1, max: 180 }
      ],
      initialValues: {
        minutes: "10"
      },
      confirmLabel: t("appointments.extend")
    });
    if (!values?.minutes) {
      return;
    }
    try {
      await apiPost<unknown, { minutes: number }>(`/api/v1/appointments/${appointmentId}/extend`, {
        minutes: Number(values.minutes)
      });
      notify("success", t("appointments.extend"));
      await load();
    } catch (extendError) {
      notify("error", extractErrorMessage(extendError));
    }
  };

  const finishWork = async (appointmentId: string) => {
    const values = await openFormDialog({
      title: t("appointments.done"),
      fields: [],
      initialValues: {},
      confirmLabel: t("appointments.done")
    });
    if (!values) {
      return;
    }
    try {
      await apiPost<unknown, { confirm: boolean }>(`/api/v1/appointments/${appointmentId}/done`, {
        confirm: true
      });
      notify("success", t("appointments.done"));
      await load();
    } catch (doneError) {
      notify("error", extractErrorMessage(doneError));
    }
  };

  const countdownText = (appointment: AppointmentItem) => {
    const session = appointment.workSessions?.[0];
    if (!session || appointment.status !== "IN_PROGRESS") {
      return "";
    }
    const remaining = Math.max(new Date(session.expectedEndAt).getTime() - now, 0);
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  const groupedByDay = useMemo(() => {
    const byDay = new Map<string, AppointmentItem[]>();
    appointments.forEach((appointment) => {
      const dateKey = new Date(appointment.startTime).toISOString().split("T")[0] ?? "unknown";
      const list = byDay.get(dateKey) ?? [];
      list.push(appointment);
      byDay.set(dateKey, list);
    });
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [appointments]);

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
            <h2>{isOwner ? t("appointments.titleOwner") : t("appointments.titleStaff")}</h2>
            <p className="muted">{isOwner ? t("appointments.ownerHint") : t("appointments.staffHint")}</p>
          </div>
          <label className="field compact">
            <span>{t("common.status")}</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">{t("common.all")}</option>
              <option value="SCHEDULED">{t("status.SCHEDULED")}</option>
              <option value="CONFIRMED">{t("status.CONFIRMED")}</option>
              <option value="IN_PROGRESS">{t("status.IN_PROGRESS")}</option>
              <option value="COMPLETED">{t("status.COMPLETED")}</option>
              <option value="CANCELED">{t("status.CANCELED")}</option>
              <option value="NO_SHOW">{t("status.NO_SHOW")}</option>
            </select>
          </label>
        </div>
        <div className="summary-badges">
          <span className="summary-badge">
            {t("appointments.todayCount")}: {appointments.filter((item) => new Date(item.startTime).toDateString() === new Date().toDateString()).length}
          </span>
          <span className="summary-badge">
            {t("appointments.completedCount")}: {appointments.filter((item) => item.status === "COMPLETED").length}
          </span>
          <span className="summary-badge">
            {t("appointments.inProgressCount")}: {appointments.filter((item) => item.status === "IN_PROGRESS").length}
          </span>
        </div>
      </section>

      {isOwner ? (
        <section className="card">
          <h2>{t("appointments.createTitle")}</h2>
          <form className="form-grid two-columns" onSubmit={createAppointment}>
            <label className="field">
              <span>{t("appointments.customer")}</span>
              <select
                value={form.customerId}
                onChange={(event) => setForm((prev) => ({ ...prev, customerId: event.target.value }))}
                required
              >
                <option value="">{t("appointments.selectCustomer")}</option>
                {customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.firstName} {item.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("appointments.staff")}</span>
              <select
                value={form.staffId}
                onChange={(event) => setForm((prev) => ({ ...prev, staffId: event.target.value }))}
                required
              >
                <option value="">{t("appointments.selectStaff")}</option>
                {staff.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("appointments.service")}</span>
              <select
                value={form.serviceId}
                onChange={(event) => setForm((prev) => ({ ...prev, serviceId: event.target.value }))}
                required
              >
                <option value="">{t("appointments.selectService")}</option>
                {services.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("appointments.start")}</span>
              <input
                type="datetime-local"
                value={form.startTime}
                onChange={(event) => setForm((prev) => ({ ...prev, startTime: event.target.value }))}
                required
              />
            </label>
            <div className="form-actions">
              <button type="submit" className="button-primary">
                {t("appointments.create")}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {!isOwner ? (
        <section className="card">
          <h2>{t("appointments.reminders")}</h2>
          {reminders.length ? (
            <div className="mobile-list">
              {reminders.slice(0, 6).map((reminder) => (
                <article key={reminder.id} className="mobile-item">
                  <strong>{formatDateTime(reminder.remindAt)}</strong>
                  <span>{reminder.message}</span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyBlock message={t("appointments.noReminders")} />
          )}
        </section>
      ) : null}

      <section className="card">
        {groupedByDay.length ? (
          groupedByDay.map(([day, items]) => (
            <div key={day} className="day-section">
              <h3>{day}</h3>
              <div className="entity-grid">
                {items.map((item) => (
                  <article key={item.id} className="appointment-card">
                    <div className="appointment-card-header">
                      <div className="appointment-card-copy">
                        <strong>
                          {item.customer.firstName} {item.customer.lastName}
                        </strong>
                        <span className="muted">{item.service.name}</span>
                      </div>
                      <span className={item.status === "COMPLETED" ? "status-pill success" : item.status === "IN_PROGRESS" ? "status-pill info" : "status-pill"}>
                        {statusLabelKey(item.status) ? t(statusLabelKey(item.status)!) : item.status}
                      </span>
                    </div>
                    <div className="appointment-card-meta">
                      <div>
                        <span className="muted">{t("appointments.time")}</span>
                        <strong>{formatDateTime(item.startTime)}</strong>
                      </div>
                      <div>
                        <span className="muted">{t("appointments.staff")}</span>
                        <strong>{item.staff.fullName}</strong>
                      </div>
                      <div>
                        <span className="muted">{t("appointments.source")}</span>
                        <strong>{item.source}</strong>
                      </div>
                    </div>
                    <div className="summary-badges">
                      {countdownText(item) ? <span className="summary-badge">{countdownText(item)}</span> : null}
                      {item.notes ? <span className="summary-badge">{t("appointments.notes")}</span> : null}
                    </div>
                    {item.notes ? <p className="muted">{item.notes}</p> : <p className="muted">{t("appointments.noNotes")}</p>}
                    <div className="inline-actions">
                      {isOwner ? (
                        <>
                          <button type="button" className="button-secondary" onClick={() => void updateStatus(item)}>
                            {t("appointments.updateStatus")}
                          </button>
                          <button type="button" className="button-secondary" onClick={() => void rescheduleAppointment(item)}>
                            {t("appointments.reschedule")}
                          </button>
                          <button type="button" className="button-secondary" onClick={() => void cancelAppointment(item)}>
                            {t("appointments.cancel")}
                          </button>
                        </>
                      ) : (
                        <>
                          {item.status !== "IN_PROGRESS" && item.status !== "COMPLETED" && item.status !== "CANCELED" ? (
                            <button type="button" className="button-primary" onClick={() => startWork(item.id)}>
                              {t("appointments.startWork")}
                            </button>
                          ) : null}
                          {item.status === "IN_PROGRESS" ? (
                            <>
                              <button type="button" className="button-secondary" onClick={() => void extendWork(item.id)}>
                                {t("appointments.extend")}
                              </button>
                              <button type="button" className="button-primary" onClick={() => void finishWork(item.id)}>
                                {t("appointments.done")}
                              </button>
                            </>
                          ) : null}
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))
        ) : (
          <EmptyBlock message={isOwner ? t("appointments.noOwner") : t("appointments.noStaff")} />
        )}
      </section>
    </div>
  );
};
