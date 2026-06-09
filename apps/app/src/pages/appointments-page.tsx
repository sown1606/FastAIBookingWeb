import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { apiGet, apiPatch, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { useAuth } from "../auth/auth-context";
import { formatDateTime } from "../lib/format";
import type { Pagination } from "../types";
import { toDateTimeLocalValue, useFormDialog } from "../components/form-dialog";
import { statusLabelKey, useI18n } from "../lib/i18n";
import { DemoAvatar } from "../components/avatar";
import { requiredLabel } from "../lib/phone";
import { useUiMode } from "../lib/ui-mode";

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

const SALON_TIMEZONE = "America/New_York";

const formatHourLabel = (hour: number) => {
  const displayHour = ((hour + 11) % 12) + 1;
  return `${displayHour} ${hour >= 12 ? "PM" : "AM"}`;
};

const formatTimeOnly = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: SALON_TIMEZONE
  });
};

const formatSalonDateKey = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: SALON_TIMEZONE
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
};

const minutesFromDayStart = (value: string) => {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: SALON_TIMEZONE
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
};

const localDateKey = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return formatSalonDateKey(date);
};

const shiftDateKey = (dateKey: string, days: number) => {
  const [year = 1970, month = 1, day = 1] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

const formatSelectedDateLabel = (dateKey: string, locale: "vi" | "en") => {
  const [year = 1970, month = 1, day = 1] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
};

const buildTimeSlots = (items: AppointmentItem[]) => {
  if (!items.length) {
    return Array.from({ length: 10 }, (_value, index) => index + 9);
  }
  const starts = items.map((item) => minutesFromDayStart(item.startTime));
  const ends = items.map((item) => minutesFromDayStart(item.endTime));
  const firstHour = Math.max(0, Math.min(9, Math.floor(Math.min(...starts) / 60)));
  const lastHour = Math.min(23, Math.max(18, Math.ceil(Math.max(...ends) / 60)));
  return Array.from({ length: lastHour - firstHour + 1 }, (_value, index) => firstHour + index);
};

const activeAppointmentStatuses = new Set(["SCHEDULED", "CONFIRMED", "IN_PROGRESS"]);

const nearestUpcomingDateKey = (items: AppointmentItem[]) => {
  const now = Date.now();
  const nearest = items
    .filter((item) => activeAppointmentStatuses.has(item.status) && new Date(item.startTime).getTime() >= now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
  return nearest ? localDateKey(nearest.startTime) : formatSalonDateKey(new Date());
};

export const AppointmentsPage = () => {
  const { session } = useAuth();
  const { notify } = useToast();
  const { openFormDialog, FormDialog } = useFormDialog();
  const { t, locale } = useI18n();
  const { isBasicMode } = useUiMode();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [reminders, setReminders] = useState<StaffReminder[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => formatSalonDateKey(new Date()));
  const [staffDateInitialized, setStaffDateInitialized] = useState(false);
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
    { value: "IN_PROGRESS", label: t("status.IN_PROGRESS") },
    { value: "COMPLETED", label: t("status.COMPLETED") },
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

  useEffect(() => {
    if (isOwner || loading || staffDateInitialized) {
      return;
    }
    setSelectedDate(nearestUpcomingDateKey(appointments));
    setStaffDateInitialized(true);
  }, [appointments, isOwner, loading, staffDateInitialized]);

  const createAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isOwner) {
      return;
    }
    if (!form.customerId || !form.staffId || !form.serviceId || !form.startTime) {
      notify("error", t("form.requiredAll"));
      return;
    }
    const startTime = new Date(form.startTime);
    if (Number.isNaN(startTime.getTime())) {
      notify("error", t("form.dateInvalid"));
      return;
    }
    try {
      await apiPost<unknown, unknown>("/api/v1/appointments", {
        customerId: form.customerId,
        staffId: form.staffId,
        serviceId: form.serviceId,
        startTime: startTime.toISOString(),
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
    const startTime = new Date(values.startTime);
    if (Number.isNaN(startTime.getTime())) {
      notify("error", t("form.dateInvalid"));
      return;
    }
    try {
      await apiPatch<unknown, { startTime: string }>(`/api/v1/appointments/${appointment.id}/reschedule`, {
        startTime: startTime.toISOString()
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
    const minutes = Number(values.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) {
      notify("error", t("form.numberInvalid"));
      return;
    }
    try {
      await apiPost<unknown, { minutes: number }>(`/api/v1/appointments/${appointmentId}/extend`, {
        minutes
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

  const selectedDayAppointments = useMemo(
    () => appointments.filter((appointment) => localDateKey(appointment.startTime) === selectedDate),
    [appointments, selectedDate]
  );

  const upcomingAppointments = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return appointments
      .filter(
        (appointment) =>
          activeAppointmentStatuses.has(appointment.status) &&
          new Date(appointment.startTime).getTime() >= todayStart.getTime()
      )
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [appointments]);

  const groupedByDay = useMemo(() => {
    const byDay = new Map<string, AppointmentItem[]>();
    const sourceAppointments = isOwner ? selectedDayAppointments : upcomingAppointments;
    sourceAppointments.forEach((appointment) => {
      const dateKey = localDateKey(appointment.startTime);
      const list = byDay.get(dateKey) ?? [];
      list.push(appointment);
      byDay.set(dateKey, list);
    });
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [isOwner, selectedDayAppointments, upcomingAppointments]);

  const scheduleStaff = useMemo(() => {
    const byId = new Map<string, StaffItem>();
    staff.forEach((member) => byId.set(member.id, member));
    selectedDayAppointments.forEach((appointment) => {
      if (!byId.has(appointment.staff.id)) {
        byId.set(appointment.staff.id, appointment.staff);
      }
    });
    return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [selectedDayAppointments, staff]);

  const getAppointmentToneClass = (appointment: AppointmentItem) => {
    if (appointment.status === "CANCELED" || appointment.status === "NO_SHOW") {
      return "schedule-appointment muted-card";
    }
    if (appointment.status === "IN_PROGRESS") {
      return "schedule-appointment active-card";
    }
    if (appointment.source === "AI" || appointment.source === "AMAZON_CONNECT") {
      return "schedule-appointment ai-card";
    }
    return "schedule-appointment";
  };

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
        <div className="date-navigation">
          <button
            type="button"
            className="button-secondary"
            aria-label={t("appointments.previousDay")}
            onClick={() => setSelectedDate((value) => shiftDateKey(value, -1))}
          >
            {"<"}
          </button>
          <strong className="selected-date-label">
            {t("appointments.selectedDate")}: {formatSelectedDateLabel(selectedDate, locale)}
          </strong>
          <button
            type="button"
            className="button-secondary"
            aria-label={t("appointments.nextDay")}
            onClick={() => setSelectedDate((value) => shiftDateKey(value, 1))}
          >
            {">"}
          </button>
          <label className="field compact">
            <span>{t("appointments.selectDate")}</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value || formatSalonDateKey(new Date()))}
            />
          </label>
        </div>
        <div className="summary-badges">
          <span className="summary-badge">
            {t("appointments.selectedDateCount")}: {selectedDayAppointments.length}
          </span>
          {!isOwner ? (
            <span className="summary-badge">
              Upcoming: {upcomingAppointments.length}
            </span>
          ) : null}
          <span className="summary-badge">
            {t("appointments.completedCount")}: {selectedDayAppointments.filter((item) => item.status === "COMPLETED").length}
          </span>
          <span className="summary-badge">
            {t("appointments.inProgressCount")}: {selectedDayAppointments.filter((item) => item.status === "IN_PROGRESS").length}
          </span>
        </div>
      </section>

      {isOwner ? (
        <section className="card">
          <h2>{t("appointments.createTitle")}</h2>
          <form className="form-grid two-columns" onSubmit={createAppointment}>
            <label className="field">
              <span>{requiredLabel(t("appointments.customer"))}</span>
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
              <span>{requiredLabel(t("appointments.staff"))}</span>
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
              <span>{requiredLabel(t("appointments.service"))}</span>
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
              <span>{requiredLabel(t("appointments.start"))}</span>
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

      {isOwner ? (
        <section className="card">
          <div className="section-header">
            <div>
              <h2>{t("appointments.scheduleBoard")}</h2>
              <p className="muted">{t("appointments.scheduleBoardHint")}</p>
            </div>
            <span className="status-pill info">
              {t("staff.directoryCount", { count: scheduleStaff.length })}
            </span>
          </div>
          {groupedByDay.length && scheduleStaff.length ? (
            groupedByDay.map(([day, items]) => {
              const timeSlots = buildTimeSlots(items);
              const firstHour = timeSlots[0] ?? 9;
              return (
                <div key={day} className="schedule-day">
                  <div className="section-header">
                    <h3>{day}</h3>
                    <span className="summary-badge">{items.length} {t("nav.appointments")}</span>
                  </div>
                  <div className="schedule-board-wrap">
                    <div
                      className="schedule-board"
                      style={
                        {
                          "--staff-count": scheduleStaff.length,
                          "--slot-count": timeSlots.length
                        } as CSSProperties
                      }
                    >
                      <div className="schedule-corner">{t("appointments.time")}</div>
                      {scheduleStaff.map((member, staffIndex) => (
                        <div
                          key={member.id}
                          className="schedule-staff-header"
                          style={{ gridColumn: staffIndex + 2, gridRow: 1 }}
                        >
                          <DemoAvatar name={member.fullName} variant="staff" size="sm" />
                          <strong>{member.fullName}</strong>
                        </div>
                      ))}
                      {timeSlots.map((hour, hourIndex) => (
                        <Fragment key={hour}>
                          <div
                            className="schedule-time"
                            style={{ gridColumn: 1, gridRow: hourIndex + 2 }}
                          >
                            {formatHourLabel(hour)}
                          </div>
                          {scheduleStaff.map((member, staffIndex) => (
                            <div
                              key={`${hour}-${member.id}`}
                              className="schedule-lane-cell"
                              style={{ gridColumn: staffIndex + 2, gridRow: hourIndex + 2 }}
                            />
                          ))}
                        </Fragment>
                      ))}
                      {items.map((item) => {
                        const staffIndex = scheduleStaff.findIndex((member) => member.id === item.staff.id);
                        if (staffIndex < 0) {
                          return null;
                        }
                        const startMinutes = minutesFromDayStart(item.startTime);
                        const endMinutes = Math.max(minutesFromDayStart(item.endTime), startMinutes + 15);
                        const startRow = Math.max(2, Math.floor((startMinutes - firstHour * 60) / 60) + 2);
                        const span = Math.max(1, Math.ceil((endMinutes - startMinutes) / 60));
                        const statusKey = statusLabelKey(item.status);
                        return (
                          <article
                            key={item.id}
                            className={getAppointmentToneClass(item)}
                            style={{
                              gridColumn: staffIndex + 2,
                              gridRow: `${startRow} / span ${span}`
                            }}
                          >
                            <div className="schedule-appointment-top">
                              <span className={item.status === "COMPLETED" ? "status-pill success" : item.status === "IN_PROGRESS" ? "status-pill info" : "status-pill"}>
                                {statusKey ? t(statusKey) : item.status}
                              </span>
                              <strong>
                                {t("appointments.timeRange", {
                                  start: formatTimeOnly(item.startTime),
                                  end: formatTimeOnly(item.endTime)
                                })}
                              </strong>
                            </div>
                            <div className="schedule-appointment-copy">
                              <strong>
                                {item.customer.firstName} {item.customer.lastName}
                              </strong>
                              <span>{item.service.name}</span>
                              {item.notes ? <small>{item.notes}</small> : null}
                            </div>
                            <div className="schedule-appointment-actions">
                              <button type="button" className="button-secondary" onClick={() => void updateStatus(item)}>
                                {t("appointments.updateStatus")}
                              </button>
                              <button type="button" className="button-secondary" onClick={() => void rescheduleAppointment(item)}>
                                {t("appointments.reschedule")}
                              </button>
                              <button type="button" className="button-secondary" onClick={() => void cancelAppointment(item)}>
                                {t("appointments.cancel")}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyBlock message={scheduleStaff.length ? t("appointments.noOwner") : t("appointments.noStaffColumns")} />
          )}
        </section>
      ) : null}

      {!isOwner && !isBasicMode ? (
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

      {!isOwner ? <section className="card">
        <div className="section-header">
          <div>
            <h2>Upcoming appointments</h2>
            <p className="muted">All upcoming appointments are shown by date. Use the calendar above to jump to a specific day.</p>
          </div>
          <span className="summary-badge">{upcomingAppointments.length} upcoming</span>
        </div>
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
                      {!isBasicMode ? (
                        <div>
                          <span className="muted">{t("appointments.source")}</span>
                          <strong>{item.source}</strong>
                        </div>
                      ) : null}
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
      </section> : null}
    </div>
  );
};
