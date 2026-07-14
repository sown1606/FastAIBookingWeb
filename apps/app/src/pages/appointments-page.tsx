import { Fragment, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost, extractApiErrorCode, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { useAuth } from "../auth/auth-context";
import { formatDateTime } from "../lib/format";
import type { Pagination } from "../types";
import { useFormDialog } from "../components/form-dialog";
import { statusLabelKey, useI18n } from "../lib/i18n";
import { DemoAvatar } from "../components/avatar";
import { requiredLabel } from "../lib/phone";
import { useUiMode } from "../lib/ui-mode";
import {
  dateTimeLocalToUtcIso,
  getSalonDateKey,
  shiftSalonDateKey,
  utcToDateTimeLocalInTimeZone
} from "../lib/timezone";
import { formatCustomerName } from "../lib/customer-name";
import {
  filterOperationalAppointments,
  isHistoryAppointmentStatus,
  isOperationalAppointmentStatus,
  type AppointmentStatus
} from "../lib/appointment-status";

interface AppointmentItem {
  id: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  bookingChannel?: string;
  durationMinutes: number;
  notes: string | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
  };
  staff: {
    id: string;
    fullName: string;
  };
  service: {
    id: string;
    name: string;
  };
  salon?: {
    timezone?: string | null;
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

interface SalonProfileTimezone {
  timezone: string;
}

interface SalonOperatorNote {
  salonId: string;
  salonName: string;
  timezone: string;
  callCenterRoutingNote: string | null;
}

interface StaffReminder {
  id: string;
  reminderType: string;
  remindAt: string;
  message: string;
  appointment: AppointmentItem;
}

interface LoadOptions {
  silent?: boolean;
}

const FALLBACK_SALON_TIMEZONE = "America/New_York";

const formatHourLabel = (hour: number) => {
  const displayHour = ((hour + 11) % 12) + 1;
  return `${displayHour} ${hour >= 12 ? "PM" : "AM"}`;
};

const resolveAppointmentTimezone = (items: AppointmentItem[], salonProfileTimezone: string) =>
  salonProfileTimezone || items.find((item) => item.salon?.timezone)?.salon?.timezone || FALLBACK_SALON_TIMEZONE;

const formatTimeOnly = (value: string, timezone: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone
  });
};

const formatCompactSalonDateTime = (value: string, timezone: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone
  }).format(date);
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: timezone
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${time} ${get("day")}/${get("month")}/${get("year")}`;
};

const minutesFromDayStart = (value: string, timezone: string) => {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
};

const localDateKey = (value: string, timezone = FALLBACK_SALON_TIMEZONE) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return getSalonDateKey(date, timezone);
};

const isAppointmentNotFoundError = (error: unknown) =>
  extractApiErrorCode(error) === "APPOINTMENT_NOT_FOUND";

const buildAppointmentDateParams = (fromDateKey: string, toDateKey: string, timezone: string) => {
  const params = new URLSearchParams({
    limit: "100"
  });
  const dateFrom = dateTimeLocalToUtcIso(`${fromDateKey}T00:00`, timezone);
  const dateTo = dateTimeLocalToUtcIso(`${toDateKey}T23:59`, timezone);
  if (dateFrom) {
    params.set("dateFrom", dateFrom);
  }
  if (dateTo) {
    params.set("dateTo", dateTo);
  }
  return params;
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

const buildTimeSlots = (items: AppointmentItem[], timezone: string) => {
  if (!items.length) {
    return Array.from({ length: 10 }, (_value, index) => index + 9);
  }
  const starts = items.map((item) => minutesFromDayStart(item.startTime, timezone));
  const ends = items.map((item) => minutesFromDayStart(item.endTime, timezone));
  const firstHour = Math.max(0, Math.min(9, Math.floor(Math.min(...starts) / 60)));
  const lastHour = Math.min(23, Math.max(18, Math.ceil(Math.max(...ends) / 60)));
  return Array.from({ length: lastHour - firstHour + 1 }, (_value, index) => firstHour + index);
};

const nearestUsefulStaffDateKey = (items: AppointmentItem[], timezone: string) => {
  const todayKey = getSalonDateKey(new Date(), timezone);
  const hasToday = items.some(
    (item) => isOperationalAppointmentStatus(item.status) && localDateKey(item.startTime, timezone) === todayKey
  );
  if (hasToday) {
    return todayKey;
  }
  const now = Date.now();
  const nearest = items
    .filter((item) => isOperationalAppointmentStatus(item.status) && new Date(item.startTime).getTime() >= now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
  return nearest ? localDateKey(nearest.startTime, timezone) : todayKey;
};

export const AppointmentsPage = () => {
  const { session } = useAuth();
  const { notify } = useToast();
  const { openFormDialog, FormDialog } = useFormDialog();
  const { t, locale } = useI18n();
  const { isBasicMode } = useUiMode();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [ownerUpcomingAppointments, setOwnerUpcomingAppointments] = useState<AppointmentItem[]>([]);
  const [ownerCompletedAppointments, setOwnerCompletedAppointments] = useState<AppointmentItem[]>([]);
  const [ownerCanceledNoShowAppointments, setOwnerCanceledNoShowAppointments] = useState<AppointmentItem[]>([]);
  const [reminders, setReminders] = useState<StaffReminder[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedDate, setSelectedDate] = useState(
    () => searchParams.get("date") || getSalonDateKey(new Date(), FALLBACK_SALON_TIMEZONE)
  );
  const [staffDateInitialized, setStaffDateInitialized] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [archiveView, setArchiveView] = useState<"completed" | "canceled">("completed");

  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [salonProfileTimezone, setSalonProfileTimezone] = useState("");

  const [form, setForm] = useState({
    customerId: "",
    staffId: "",
    serviceId: "",
    startTime: ""
  });

  const isOwner = session?.user.role === "SALON_OWNER";
  const highlightedAppointmentId = searchParams.get("appointmentId") ?? "";
  const salonTimezone = useMemo(
    () => resolveAppointmentTimezone(appointments, salonProfileTimezone),
    [appointments, salonProfileTimezone]
  );
  const allLoadedAppointments = useMemo(
    () => [
      ...appointments,
      ...ownerUpcomingAppointments,
      ...ownerCompletedAppointments,
      ...ownerCanceledNoShowAppointments
    ],
    [appointments, ownerCanceledNoShowAppointments, ownerCompletedAppointments, ownerUpcomingAppointments]
  );
  const todayDateKey = useMemo(() => getSalonDateKey(new Date(), salonTimezone), [salonTimezone]);
  const fetchAppointments = useCallback(async (baseParams: URLSearchParams) => {
    const items: AppointmentItem[] = [];
    let page = 1;
    let total = 0;
    do {
      const params = new URLSearchParams(baseParams);
      params.set("page", String(page));
      const appointmentResponse = await apiGet<AppointmentsResponse>(
        `/api/v1/appointments?${params.toString()}`
      );
      items.push(...appointmentResponse.items);
      total = appointmentResponse.pagination.total;
      page += 1;
    } while (items.length < total && page <= 5);
    return items;
  }, []);

  const fetchAppointmentsForStatuses = useCallback(async (
    baseParams: URLSearchParams,
    statuses: AppointmentItem["status"][]
  ) => {
    const results = await Promise.all(
      statuses.map((status) => {
        const params = new URLSearchParams(baseParams);
        params.set("status", status);
        return fetchAppointments(params);
      })
    );
    return results
      .flat()
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [fetchAppointments]);

  const load = useCallback(async (options: LoadOptions = {}) => {
    if (!options.silent) {
      setError("");
      setLoading(true);
    }
    try {
      if (isOwner) {
        const [customerResponse, staffResponse, serviceResponse, salonProfile] = await Promise.all([
          apiGet<CustomersResponse>("/api/v1/customers?page=1&limit=100"),
          apiGet<StaffItem[]>("/api/v1/staff?includeInactive=false"),
          apiGet<ServiceItem[]>("/api/v1/services"),
          apiGet<SalonProfileTimezone>("/api/v1/salon/profile")
        ]);
        const timezone = salonProfile.timezone || FALLBACK_SALON_TIMEZONE;
        const params = buildAppointmentDateParams(selectedDate, selectedDate, timezone);
        if (statusFilter) {
          params.set("status", statusFilter);
        }
        const nowIso = new Date().toISOString();
        const ninetyDaysIso = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        const upcomingParams = new URLSearchParams({
          limit: "100",
          dateFrom: nowIso,
          dateTo: ninetyDaysIso
        });
        const archiveParams = new URLSearchParams({
          limit: "100"
        });
        const [dayAppointments, upcoming, completed, canceledNoShow] = await Promise.all([
          fetchAppointments(params),
          fetchAppointmentsForStatuses(upcomingParams, ["SCHEDULED", "CONFIRMED", "IN_PROGRESS"]),
          fetchAppointmentsForStatuses(archiveParams, ["COMPLETED"]),
          fetchAppointmentsForStatuses(archiveParams, ["CANCELED", "NO_SHOW"])
        ]);
        setAppointments(dayAppointments);
        setOwnerUpcomingAppointments(filterOperationalAppointments(upcoming));
        setOwnerCompletedAppointments(completed);
        setOwnerCanceledNoShowAppointments(canceledNoShow);
        setCustomers(customerResponse.items);
        setStaff(staffResponse);
        setServices(serviceResponse.filter((item) => item.isActive));
        setSalonProfileTimezone(salonProfile.timezone || "");
        setReminders([]);
      } else {
        const note = await apiGet<SalonOperatorNote>("/api/v1/salon/staff-note");
        const timezone = note.timezone || FALLBACK_SALON_TIMEZONE;
        const todayKey = getSalonDateKey(new Date(), timezone);
        const fromDateKey = selectedDate < todayKey ? selectedDate : todayKey;
        const selectedWindowEnd = shiftSalonDateKey(selectedDate, 1);
        const upcomingWindowEnd = shiftSalonDateKey(todayKey, 30);
        const toDateKey = selectedWindowEnd > upcomingWindowEnd ? selectedWindowEnd : upcomingWindowEnd;
        const params = buildAppointmentDateParams(fromDateKey, toDateKey, timezone);
        if (statusFilter) {
          params.set("status", statusFilter);
        }
        setAppointments(await fetchAppointments(params));
        setOwnerUpcomingAppointments([]);
        setOwnerCompletedAppointments([]);
        setOwnerCanceledNoShowAppointments([]);
        setCustomers([]);
        setStaff([]);
        setServices([]);
        setSalonProfileTimezone(note.timezone || "");
        const reminderResult = await apiGet<StaffReminder[]>("/api/v1/staff/me/reminders");
        setReminders(reminderResult);
      }
    } catch (loadError) {
      if (!options.silent) {
        setError(extractErrorMessage(loadError));
      }
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, [fetchAppointments, fetchAppointmentsForStatuses, isOwner, selectedDate, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const revalidateSchedule = () => {
      if (document.visibilityState === "visible") {
        void load({ silent: true });
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void load({ silent: true });
      }
    };

    window.addEventListener("focus", revalidateSchedule);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const interval = window.setInterval(revalidateSchedule, 20000);

    return () => {
      window.removeEventListener("focus", revalidateSchedule);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(interval);
    };
  }, [load]);

  useEffect(() => {
    const dateParam = searchParams.get("date");
    if (dateParam && dateParam !== selectedDate) {
      setSelectedDate(dateParam);
    }
  }, [searchParams, selectedDate]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isOwner || loading || staffDateInitialized) {
      return;
    }
    setSelectedDate(nearestUsefulStaffDateKey(appointments, salonTimezone));
    setStaffDateInitialized(true);
  }, [appointments, isOwner, loading, salonTimezone, staffDateInitialized]);

  useEffect(() => {
    if (!highlightedAppointmentId || loading) {
      return;
    }
    const selectedDeepLinkAppointment =
      selectedAppointment?.id === highlightedAppointmentId ? selectedAppointment : null;
    const loadedDeepLinkAppointment =
      selectedDeepLinkAppointment ?? allLoadedAppointments.find((item) => item.id === highlightedAppointmentId);
    if (loadedDeepLinkAppointment) {
      if (!selectedDeepLinkAppointment) {
        setSelectedAppointment(loadedDeepLinkAppointment);
      }
      const appointmentTimezone = loadedDeepLinkAppointment.salon?.timezone || salonTimezone;
      const appointmentDate = localDateKey(loadedDeepLinkAppointment.startTime, appointmentTimezone);
      if (selectedDate !== appointmentDate) {
        setSelectedDate(appointmentDate);
      }
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    const loadDeepLinkAppointment = async () => {
      try {
        const appointment = await apiGet<AppointmentItem>(`/api/v1/appointments/${highlightedAppointmentId}`);
        if (cancelled) {
          return;
        }
        setSelectedAppointment(appointment);
        const appointmentTimezone = appointment.salon?.timezone || salonTimezone;
        const appointmentDate = localDateKey(appointment.startTime, appointmentTimezone);
        if (selectedDate !== appointmentDate) {
          setSelectedDate(appointmentDate);
        }
      } catch (detailError) {
        if (cancelled) {
          return;
        }
        if (isAppointmentNotFoundError(detailError)) {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete("appointmentId");
          setSearchParams(nextParams, { replace: true });
          setSelectedAppointment(null);
          notify("error", t("appointments.notFoundStale"));
          return;
        }
        notify("error", extractErrorMessage(detailError));
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };
    void loadDeepLinkAppointment();
    return () => {
      cancelled = true;
    };
  }, [
    allLoadedAppointments,
    highlightedAppointmentId,
    loading,
    notify,
    salonTimezone,
    searchParams,
    selectedAppointment,
    selectedDate,
    setSearchParams,
    t
  ]);

  useEffect(() => {
    if (!highlightedAppointmentId || loading) {
      return;
    }
    const timeout = window.setTimeout(() => {
      document
        .getElementById(`appointment-${highlightedAppointmentId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [highlightedAppointmentId, loading, selectedDate]);

  const createAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isOwner) {
      return;
    }
    if (!form.customerId || !form.staffId || !form.serviceId || !form.startTime) {
      notify("error", t("form.requiredAll"));
      return;
    }
    try {
      await apiPost<unknown, unknown>("/api/v1/appointments", {
        customerId: form.customerId,
        staffId: form.staffId,
        serviceId: form.serviceId,
        startTimeLocal: form.startTime
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

  const selectAppointment = async (appointmentId: string) => {
    const existing = allLoadedAppointments.find((item) => item.id === appointmentId);
    if (existing) {
      setSelectedAppointment(existing);
      return existing;
    }
    setDetailLoading(true);
    try {
      const appointment = await apiGet<AppointmentItem>(`/api/v1/appointments/${appointmentId}`);
      setSelectedAppointment(appointment);
      return appointment;
    } catch (detailError) {
      if (isAppointmentNotFoundError(detailError)) {
        if (appointmentId === highlightedAppointmentId) {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete("appointmentId");
          setSearchParams(nextParams, { replace: true });
        }
        setSelectedAppointment(null);
        notify("error", t("appointments.notFoundStale"));
        return null;
      }
      notify("error", extractErrorMessage(detailError));
      return null;
    } finally {
      setDetailLoading(false);
    }
  };

  const openAppointmentDeepLink = async (appointment: AppointmentItem) => {
    const dateKey = localDateKey(appointment.startTime, salonTimezone);
    setSelectedDate(dateKey);
    setSearchParams({
      date: dateKey,
      appointmentId: appointment.id
    });
    await selectAppointment(appointment.id);
  };

  const removeAppointmentFromActiveCollections = (appointmentId: string) => {
    setAppointments((items) => items.filter((item) => item.id !== appointmentId));
    setOwnerUpcomingAppointments((items) => items.filter((item) => item.id !== appointmentId));
    setReminders((items) => items.filter((item) => item.appointment.id !== appointmentId));
    setSelectedAppointment((current) => (current?.id === appointmentId ? null : current));
    if (highlightedAppointmentId === appointmentId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("appointmentId");
      setSearchParams(nextParams, { replace: true });
    }
  };

  const cancelAppointment = async (appointment: AppointmentItem) => {
    const values = await openFormDialog({
      title: t("appointments.cancel"),
      description: formatCustomerName(appointment.customer.firstName, appointment.customer.lastName),
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
      removeAppointmentFromActiveCollections(appointment.id);
      notify("success", t("appointments.cancel"));
      await load({ silent: true });
    } catch (cancelError) {
      notify("error", extractErrorMessage(cancelError));
    }
  };

  const rescheduleAppointment = async (appointment: AppointmentItem) => {
    const appointmentTimezone = appointment.salon?.timezone || salonTimezone;
    const values = await openFormDialog({
      title: t("appointments.reschedule"),
      description: `${formatCustomerName(appointment.customer.firstName, appointment.customer.lastName)} · ${formatCompactSalonDateTime(appointment.startTime, appointmentTimezone)}`,
      fields: [
        {
          name: "startTime",
          label: t("appointments.start"),
          type: "datetime-local",
          required: true,
          helpText: `${t("appointments.startTimezoneHint")} ${t("common.timezone")}: ${appointmentTimezone}`
        }
      ],
      initialValues: {
        startTime: utcToDateTimeLocalInTimeZone(appointment.startTime, appointmentTimezone)
      },
      confirmLabel: t("appointments.reschedule")
    });
    if (!values?.startTime) {
      return;
    }
    try {
      await apiPatch<unknown, { startTimeLocal: string }>(`/api/v1/appointments/${appointment.id}/reschedule`, {
        startTimeLocal: values.startTime
      });
      notify("success", t("appointments.reschedule"));
      await load();
    } catch (rescheduleError) {
      notify("error", extractErrorMessage(rescheduleError));
    }
  };

  const setAppointmentStatus = async (appointment: AppointmentItem, status: "CONFIRMED" | "NO_SHOW") => {
    try {
      await apiPatch<unknown, { status: string }>(`/api/v1/appointments/${appointment.id}`, {
        status
      });
      notify("success", status === "CONFIRMED" ? t("appointments.confirm") : t("appointments.markNoShow"));
      await load();
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  const permanentlyDeleteAppointment = async (appointment: AppointmentItem) => {
    const values = await openFormDialog({
      title: t("appointments.deletePermanently"),
      description: t("appointments.deletePermanentlyConfirm"),
      fields: [],
      initialValues: {},
      confirmLabel: t("appointments.deletePermanently")
    });
    if (!values) {
      return;
    }
    try {
      await apiDelete<unknown>(`/api/v1/appointments/${appointment.id}`);
      notify("success", t("appointments.deletedPermanently"));
      if (selectedAppointment?.id === appointment.id) {
        setSelectedAppointment(null);
      }
      await load();
    } catch (deleteError) {
      notify("error", extractErrorMessage(deleteError));
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
    () =>
      appointments
        .filter((appointment) => localDateKey(appointment.startTime, salonTimezone) === selectedDate)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    [appointments, salonTimezone, selectedDate]
  );

  const activeStaffIds = useMemo(() => new Set(staff.map((member) => member.id)), [staff]);

  const selectedDayScheduleAppointments = useMemo(
    () =>
      filterOperationalAppointments(selectedDayAppointments).filter((appointment) =>
        activeStaffIds.has(appointment.staff.id)
      ),
    [activeStaffIds, selectedDayAppointments]
  );

  const todayAppointments = useMemo(
    () =>
      filterOperationalAppointments(appointments)
        .filter(
          (appointment) =>
            localDateKey(appointment.startTime, salonTimezone) === todayDateKey
        )
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    [appointments, salonTimezone, todayDateKey]
  );

  const selectedDayOperationalAppointments = useMemo(
    () => filterOperationalAppointments(selectedDayAppointments),
    [selectedDayAppointments]
  );

  const dailySummary = useMemo(
    () => ({
      total: selectedDayOperationalAppointments.length,
      confirmed: selectedDayOperationalAppointments.filter((item) => item.status === "CONFIRMED").length,
      inProgress: selectedDayOperationalAppointments.filter((item) => item.status === "IN_PROGRESS").length,
      completed: selectedDayAppointments.filter((item) => item.status === "COMPLETED").length,
      canceledOrNoShow: selectedDayAppointments.filter((item) => item.status === "CANCELED" || item.status === "NO_SHOW").length
    }),
    [selectedDayAppointments, selectedDayOperationalAppointments]
  );

  const upcomingAppointments = useMemo(() => {
    const now = Date.now();
    return filterOperationalAppointments(appointments)
      .filter(
        (appointment) =>
          new Date(appointment.startTime).getTime() >= now
      )
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [appointments]);

  const currentOrNextStaffAppointment = useMemo(() => {
    const current = appointments
      .filter((item) => item.status === "IN_PROGRESS")
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
    if (current) {
      return current;
    }
    return upcomingAppointments[0] ?? null;
  }, [appointments, upcomingAppointments]);

  const groupedByDay = useMemo(() => {
    const byDay = new Map<string, AppointmentItem[]>();
    const appointmentsForGrouping = isOwner ? selectedDayScheduleAppointments : upcomingAppointments;
    appointmentsForGrouping.forEach((appointment) => {
      const dateKey = localDateKey(appointment.startTime, salonTimezone);
      const list = byDay.get(dateKey) ?? [];
      list.push(appointment);
      byDay.set(dateKey, list);
    });
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [isOwner, salonTimezone, selectedDayScheduleAppointments, upcomingAppointments]);

  const ownerUpcomingByDay = useMemo(() => {
    const byDay = new Map<string, AppointmentItem[]>();
    ownerUpcomingAppointments.forEach((appointment) => {
      const dateKey = localDateKey(appointment.startTime, salonTimezone);
      const list = byDay.get(dateKey) ?? [];
      list.push(appointment);
      byDay.set(dateKey, list);
    });
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [ownerUpcomingAppointments, salonTimezone]);

  const ownerCompletedByDay = useMemo(() => {
    const byDay = new Map<string, AppointmentItem[]>();
    ownerCompletedAppointments.forEach((appointment) => {
      const dateKey = localDateKey(appointment.startTime, salonTimezone);
      const list = byDay.get(dateKey) ?? [];
      list.push(appointment);
      byDay.set(dateKey, list);
    });
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [ownerCompletedAppointments, salonTimezone]);

  const ownerCanceledNoShowByDay = useMemo(() => {
    const byDay = new Map<string, AppointmentItem[]>();
    ownerCanceledNoShowAppointments.forEach((appointment) => {
      const dateKey = localDateKey(appointment.startTime, salonTimezone);
      const list = byDay.get(dateKey) ?? [];
      list.push(appointment);
      byDay.set(dateKey, list);
    });
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [ownerCanceledNoShowAppointments, salonTimezone]);

  const scheduleStaff = useMemo(
    () => [...staff].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [staff]
  );

  const getAppointmentToneClass = (appointment: AppointmentItem) => {
    if (appointment.status === "CANCELED" || appointment.status === "NO_SHOW") {
      return "schedule-appointment muted-card";
    }
    if (appointment.status === "IN_PROGRESS") {
      return "schedule-appointment active-card";
    }
    return "schedule-appointment";
  };

  const getHighlightedClass = (appointmentId: string) =>
    appointmentId === highlightedAppointmentId ? " highlighted" : "";

  const renderStaffAppointmentActions = (item: AppointmentItem) => (
    <>
      {item.status === "SCHEDULED" || item.status === "CONFIRMED" ? (
        <button type="button" className="button-primary" onClick={() => void startWork(item.id)}>
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
  );

  const renderOwnerAppointmentActions = (item: AppointmentItem) => (
    <>
      {item.status === "SCHEDULED" ? (
        <button type="button" className="button-secondary" onClick={() => void setAppointmentStatus(item, "CONFIRMED")}>
          {t("appointments.confirm")}
        </button>
      ) : null}
      {item.status === "SCHEDULED" || item.status === "CONFIRMED" ? (
        <button type="button" className="button-secondary" onClick={() => void startWork(item.id)}>
          {t("appointments.startWork")}
        </button>
      ) : null}
      {item.status === "IN_PROGRESS" ? (
        <button type="button" className="button-primary" onClick={() => void finishWork(item.id)}>
          {t("appointments.done")}
        </button>
      ) : null}
      {isOperationalAppointmentStatus(item.status) ? (
        <>
          <button type="button" className="button-secondary" onClick={() => void rescheduleAppointment(item)}>
            {t("appointments.reschedule")}
          </button>
          <button type="button" className="button-secondary" onClick={() => void cancelAppointment(item)}>
            {t("appointments.cancel")}
          </button>
        </>
      ) : null}
      {item.status === "SCHEDULED" || item.status === "CONFIRMED" ? (
        <button type="button" className="button-secondary" onClick={() => void setAppointmentStatus(item, "NO_SHOW")}>
          {t("appointments.markNoShow")}
        </button>
      ) : null}
      {isHistoryAppointmentStatus(item.status) ? (
        <button type="button" className="button-secondary danger-button" onClick={() => void permanentlyDeleteAppointment(item)}>
          {t("appointments.deletePermanently")}
        </button>
      ) : null}
    </>
  );

  const renderOwnerAppointmentCard = (item: AppointmentItem) => {
    const statusKey = statusLabelKey(item.status);
    return (
      <article
        id={`appointment-${item.id}`}
        key={item.id}
        className={`appointment-card${getHighlightedClass(item.id)}`}
        onClick={() => void openAppointmentDeepLink(item)}
      >
        <div className="appointment-card-header">
          <div className="appointment-card-copy">
            <strong>
              {formatTimeOnly(item.startTime, salonTimezone)} · {formatCustomerName(item.customer.firstName, item.customer.lastName)}
            </strong>
            <span className="muted">
              {item.customer.phone ?? t("common.none")} · {item.service.name}
            </span>
          </div>
          <span className={item.status === "COMPLETED" ? "status-pill success" : item.status === "IN_PROGRESS" ? "status-pill info" : item.status === "CANCELED" || item.status === "NO_SHOW" ? "status-pill warning" : "status-pill"}>
            {statusKey ? t(statusKey) : item.status}
          </span>
        </div>
        <div className="appointment-card-meta">
          <div>
            <span className="muted">{t("appointments.time")}</span>
            <strong>{formatCompactSalonDateTime(item.startTime, salonTimezone)}</strong>
          </div>
          <div>
            <span className="muted">{t("appointments.staff")}</span>
            <strong>{item.staff.fullName}</strong>
          </div>
          <div>
            <span className="muted">{t("appointments.service")}</span>
            <strong>{item.service.name}</strong>
          </div>
        </div>
        {item.notes ? <p className="muted">{item.notes}</p> : null}
        <div className="inline-actions" onClick={(event) => event.stopPropagation()}>
          {renderOwnerAppointmentActions(item)}
        </div>
      </article>
    );
  };

  const renderAppointmentDetailSection = () => (
    selectedAppointment || detailLoading ? (
      <section className="card appointment-detail-card appointments-detail-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Appointment detail</p>
            <h2>
              {selectedAppointment
                ? formatCustomerName(selectedAppointment.customer.firstName, selectedAppointment.customer.lastName)
                : t("common.loading")}
            </h2>
          </div>
          <button type="button" className="button-secondary" onClick={() => setSelectedAppointment(null)}>
            Close
          </button>
        </div>
        {selectedAppointment ? (
          <>
            <div className="summary-badges">
              <span className={selectedAppointment.status === "COMPLETED" ? "status-pill success" : selectedAppointment.status === "IN_PROGRESS" ? "status-pill info" : selectedAppointment.status === "CANCELED" || selectedAppointment.status === "NO_SHOW" ? "status-pill warning" : "status-pill"}>
                {statusLabelKey(selectedAppointment.status)
                  ? t(statusLabelKey(selectedAppointment.status)!)
                  : selectedAppointment.status}
              </span>
            </div>
            <div className="appointment-card-meta">
              <div>
                <span className="muted">{t("appointments.time")}</span>
                <strong>
                  {t("appointments.timeRange", {
                    start: formatTimeOnly(selectedAppointment.startTime, salonTimezone),
                    end: formatTimeOnly(selectedAppointment.endTime, salonTimezone)
                  })}
                </strong>
              </div>
              <div>
                <span className="muted">{t("appointments.service")}</span>
                <strong>{selectedAppointment.service.name}</strong>
              </div>
              <div>
                <span className="muted">{t("appointments.staff")}</span>
                <strong>{selectedAppointment.staff.fullName}</strong>
              </div>
              <div>
                <span className="muted">{t("appointments.notes")}</span>
                <strong>{selectedAppointment.notes || t("appointments.noNotes")}</strong>
              </div>
            </div>
            {isOwner ? (
              <div className="inline-actions">
                {renderOwnerAppointmentActions(selectedAppointment)}
              </div>
            ) : (
              <div className="inline-actions">{renderStaffAppointmentActions(selectedAppointment)}</div>
            )}
          </>
        ) : (
          <LoadingBlock />
        )}
      </section>
    ) : null
  );

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <div className={isOwner ? "stack appointments-page owner-appointments-page" : "stack appointments-page"}>
      <FormDialog />
      <section className="card appointments-toolbar-card">
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
            onClick={() => setSelectedDate((value) => shiftSalonDateKey(value, -1))}
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
            onClick={() => setSelectedDate((value) => shiftSalonDateKey(value, 1))}
          >
            {">"}
          </button>
          <button
            type="button"
            className={selectedDate === todayDateKey ? "button-primary" : "button-secondary"}
            onClick={() => setSelectedDate(todayDateKey)}
          >
            {t("common.today")}
          </button>
          <label className="field compact">
            <span>{t("appointments.selectDate")}</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value || todayDateKey)}
            />
          </label>
        </div>
        <div className="summary-badges">
          <span className="summary-badge">
            {t("appointments.selectedDateCount")}: {dailySummary.total}
          </span>
          <span className="summary-badge">
            {t("appointments.confirmedCount")}: {dailySummary.confirmed}
          </span>
          {!isOwner ? (
            <span className="summary-badge">
              {t("appointments.upcomingCount")}: {upcomingAppointments.length}
            </span>
          ) : null}
          <span className="summary-badge">
            {t("appointments.inProgressCount")}: {dailySummary.inProgress}
          </span>
          <span className="summary-badge">
            {t("appointments.completedCount")}: {dailySummary.completed}
          </span>
          <span className="summary-badge">
            {t("appointments.canceledNoShowCount")}: {dailySummary.canceledOrNoShow}
          </span>
        </div>
      </section>

      {isOwner ? (
        <div className="owner-appointments-workspace">
          <div className="owner-appointments-sidebar">
            <section
              id="create-appointment"
              className={isBasicMode ? "card basic-secondary-section appointments-create-card" : "card appointments-create-card"}
            >
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
                    {formatCustomerName(item.firstName, item.lastName)}
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
              <small>
                {t("appointments.startTimezoneHint")} {t("common.timezone")}: {salonTimezone}
              </small>
            </label>
            <div className="form-actions">
              <button type="submit" className="button-primary">
                {t("appointments.create")}
              </button>
            </div>
          </form>
            </section>

            {renderAppointmentDetailSection()}

            <section className="card appointments-archive-card">
              <div className="section-header">
                <div>
                  <h2>{t("appointments.archiveTitle")}</h2>
                  <p className="muted">{t("appointments.archiveHint")}</p>
                </div>
              </div>
              <div className="segmented-control" role="tablist" aria-label={t("appointments.archiveTitle")}>
                <button
                  type="button"
                  className={archiveView === "completed" ? "button-primary" : "button-secondary"}
                  onClick={() => setArchiveView("completed")}
                >
                  {t("appointments.completedTab")}: {ownerCompletedAppointments.length}
                </button>
                <button
                  type="button"
                  className={archiveView === "canceled" ? "button-primary" : "button-secondary"}
                  onClick={() => setArchiveView("canceled")}
                >
                  {t("appointments.canceledNoShowTab")}: {ownerCanceledNoShowAppointments.length}
                </button>
              </div>
              {archiveView === "completed" && ownerCompletedByDay.length ? (
                ownerCompletedByDay.map(([day, items]) => (
                  <div key={`completed-${day}`} className="day-section">
                    <h3>{formatSelectedDateLabel(day, locale)}</h3>
                    <div className="entity-grid">
                      {items.map(renderOwnerAppointmentCard)}
                    </div>
                  </div>
                ))
              ) : null}
              {archiveView === "canceled" && ownerCanceledNoShowByDay.length ? (
                ownerCanceledNoShowByDay.map(([day, items]) => (
                  <div key={`terminal-${day}`} className="day-section">
                    <h3>{formatSelectedDateLabel(day, locale)}</h3>
                    <div className="entity-grid">
                      {items.map(renderOwnerAppointmentCard)}
                    </div>
                  </div>
                ))
              ) : null}
              {archiveView === "completed" && !ownerCompletedByDay.length ? (
                <EmptyBlock message={t("appointments.noArchive")} />
              ) : null}
              {archiveView === "canceled" && !ownerCanceledNoShowByDay.length ? (
                <EmptyBlock message={t("appointments.noArchive")} />
              ) : null}
            </section>
          </div>
          <div className="owner-appointments-main">

        <section className={isBasicMode ? "card basic-primary-section appointments-schedule-card" : "card appointments-schedule-card"}>
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
              const timeSlots = buildTimeSlots(items, salonTimezone);
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
                        const startMinutes = minutesFromDayStart(item.startTime, salonTimezone);
                        const endMinutes = Math.max(minutesFromDayStart(item.endTime, salonTimezone), startMinutes + 15);
                        const startRow = Math.max(2, Math.floor((startMinutes - firstHour * 60) / 60) + 2);
                        const span = Math.max(1, Math.ceil((endMinutes - startMinutes) / 60));
                        const statusKey = statusLabelKey(item.status);
                        return (
                          <article
                            id={`appointment-${item.id}`}
                            key={item.id}
                            className={`${getAppointmentToneClass(item)}${getHighlightedClass(item.id)}`}
                            onClick={() => void selectAppointment(item.id)}
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
                                  start: formatTimeOnly(item.startTime, salonTimezone),
                                  end: formatTimeOnly(item.endTime, salonTimezone)
                                })}
                              </strong>
                            </div>
                            <div className="schedule-appointment-copy">
                              <strong>
                                {formatCustomerName(item.customer.firstName, item.customer.lastName)}
                              </strong>
                              <span>{item.service.name}</span>
                              <span className="schedule-staff-label">{item.staff.fullName}</span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                  <div className="schedule-mobile-list mobile-list">
                    {items.map((item) => {
                      const statusKey = statusLabelKey(item.status);
                      return (
                        <article
                          key={`mobile-${item.id}`}
                          className={`mobile-item${getHighlightedClass(item.id)}`}
                          onClick={() => void selectAppointment(item.id)}
                        >
                          <div className="appointment-card-header">
                            <div className="appointment-card-copy">
                              <strong>
                                {formatTimeOnly(item.startTime, salonTimezone)} -{" "}
                                {formatTimeOnly(item.endTime, salonTimezone)}
                              </strong>
                              <span>
                                {formatCustomerName(item.customer.firstName, item.customer.lastName)} ·{" "}
                                {item.service.name}
                              </span>
                              <span className="muted">{item.staff.fullName}</span>
                            </div>
                            <span className={item.status === "IN_PROGRESS" ? "status-pill info" : "status-pill"}>
                              {statusKey ? t(statusKey) : item.status}
                            </span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="state-block">
              <p>{scheduleStaff.length ? t("appointments.noOwnerSelectedDate") : t("appointments.noStaffColumns")}</p>
              {scheduleStaff.length ? (
                <button
                  type="button"
                  className="button-primary"
                  onClick={() => document.getElementById("create-appointment")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  {t("appointments.create")}
                </button>
              ) : null}
            </div>
          )}
            </section>

            <section className="card appointments-upcoming-card">
          <div className="section-header">
            <div>
              <h2>{t("appointments.upcomingTitle")}</h2>
              <p className="muted">{t("appointments.upcomingHint")}</p>
            </div>
            <span className="summary-badge">{ownerUpcomingAppointments.length} {t("appointments.upcomingCount")}</span>
          </div>
          {ownerUpcomingByDay.length ? (
            ownerUpcomingByDay.map(([day, items]) => (
              <div key={day} className="day-section">
                <h3>{formatSelectedDateLabel(day, locale)}</h3>
                <div className="entity-grid">
                  {items.map(renderOwnerAppointmentCard)}
                </div>
              </div>
            ))
          ) : (
            <EmptyBlock message={t("appointments.noOwner")} />
          )}
            </section>
          </div>
        </div>
      ) : null}

      {!isOwner ? renderAppointmentDetailSection() : null}

      {!isOwner && !isBasicMode ? (
        <section className="card">
          <h2>{t("appointments.reminders")}</h2>
          {reminders.length ? (
            <div className="mobile-list">
              {reminders.slice(0, 6).map((reminder) => (
                <article key={reminder.id} className="mobile-item">
                  <strong>{formatDateTime(reminder.remindAt, salonTimezone)}</strong>
                  <span>{reminder.message}</span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyBlock message={t("appointments.noReminders")} />
          )}
        </section>
      ) : null}

      {!isOwner && isBasicMode ? (
        <>
          <section className="card">
            <div className="section-header">
              <div>
                <h2>{t("appointments.currentNextTitle")}</h2>
                <p className="muted">{t("appointments.staffBasicHint")}</p>
              </div>
              <span className="summary-badge">{t("appointments.todayCount")}: {todayAppointments.length}</span>
            </div>
            {currentOrNextStaffAppointment ? (
              <article
                id={`appointment-${currentOrNextStaffAppointment.id}`}
                className={`appointment-card appointment-card-featured${getHighlightedClass(currentOrNextStaffAppointment.id)}`}
                onClick={() => void selectAppointment(currentOrNextStaffAppointment.id)}
              >
                <div className="appointment-card-header">
                  <div className="appointment-card-copy">
                    <strong>
                      {formatCustomerName(
                        currentOrNextStaffAppointment.customer.firstName,
                        currentOrNextStaffAppointment.customer.lastName
                      )}
                    </strong>
                    <span className="muted">{currentOrNextStaffAppointment.service.name}</span>
                  </div>
                  <span
                    className={
                      currentOrNextStaffAppointment.status === "COMPLETED"
                        ? "status-pill success"
                        : currentOrNextStaffAppointment.status === "IN_PROGRESS"
                          ? "status-pill info"
                          : "status-pill"
                    }
                  >
                    {statusLabelKey(currentOrNextStaffAppointment.status)
                      ? t(statusLabelKey(currentOrNextStaffAppointment.status)!)
                      : currentOrNextStaffAppointment.status}
                  </span>
                </div>
                <div className="appointment-card-meta">
                  <div>
                    <span className="muted">{t("appointments.time")}</span>
                    <strong>{formatDateTime(currentOrNextStaffAppointment.startTime, salonTimezone)}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("appointments.staff")}</span>
                    <strong>{currentOrNextStaffAppointment.staff.fullName}</strong>
                  </div>
                </div>
                {countdownText(currentOrNextStaffAppointment) ? (
                  <span className="timer-pill">{countdownText(currentOrNextStaffAppointment)}</span>
                ) : null}
                <div className="inline-actions" onClick={(event) => event.stopPropagation()}>
                  {renderStaffAppointmentActions(currentOrNextStaffAppointment)}
                </div>
              </article>
            ) : (
              <EmptyBlock message={t("appointments.noStaff")} />
            )}
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <h2>{selectedDate === todayDateKey ? t("appointments.todaySchedule") : t("appointments.selectedDaySchedule")}</h2>
                <p className="muted">{formatSelectedDateLabel(selectedDate, locale)}</p>
              </div>
              <span className="summary-badge">{selectedDayOperationalAppointments.length} {t("nav.appointments")}</span>
            </div>
            {selectedDayOperationalAppointments.length ? (
              <div className="mobile-list">
                {selectedDayOperationalAppointments.map((item) => (
                  <article
                    id={`appointment-${item.id}`}
                    key={item.id}
                    className={`mobile-item${getHighlightedClass(item.id)}`}
                    onClick={() => void selectAppointment(item.id)}
                  >
                    <div className="appointment-card-header">
                      <div className="appointment-card-copy">
                        <strong>
                          {formatTimeOnly(item.startTime, salonTimezone)} · {formatCustomerName(item.customer.firstName, item.customer.lastName)}
                        </strong>
                        <span className="muted">{item.service.name}</span>
                      </div>
                      <span className={item.status === "IN_PROGRESS" ? "status-pill info" : "status-pill"}>
                        {statusLabelKey(item.status) ? t(statusLabelKey(item.status)!) : item.status}
                      </span>
                    </div>
                    {item.notes ? <p className="muted">{item.notes}</p> : null}
                    <div className="inline-actions" onClick={(event) => event.stopPropagation()}>
                      {renderStaffAppointmentActions(item)}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyBlock message={t("appointments.noStaffSelectedDate")} />
            )}
          </section>
        </>
      ) : null}

      {!isOwner && !isBasicMode ? (
        <section className="card">
          <div className="section-header">
            <div>
              <h2>{t("appointments.upcomingTitle")}</h2>
              <p className="muted">{t("appointments.upcomingHint")}</p>
            </div>
            <span className="summary-badge">{upcomingAppointments.length} {t("appointments.upcomingCount")}</span>
          </div>
          {groupedByDay.length ? (
            groupedByDay.map(([day, items]) => (
              <div key={day} className="day-section">
                <h3>{day}</h3>
                <div className="entity-grid">
                  {items.map((item) => (
                    <article
                      id={`appointment-${item.id}`}
                      key={item.id}
                      className={`appointment-card${getHighlightedClass(item.id)}`}
                      onClick={() => void selectAppointment(item.id)}
                    >
                      <div className="appointment-card-header">
                        <div className="appointment-card-copy">
                          <strong>
                            {formatCustomerName(item.customer.firstName, item.customer.lastName)}
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
                          <strong>{formatDateTime(item.startTime, salonTimezone)}</strong>
                        </div>
                        <div>
                          <span className="muted">{t("appointments.staff")}</span>
                          <strong>{item.staff.fullName}</strong>
                        </div>
                      </div>
                      <div className="summary-badges">
                        {countdownText(item) ? <span className="summary-badge">{countdownText(item)}</span> : null}
                        {item.notes ? <span className="summary-badge">{t("appointments.notes")}</span> : null}
                      </div>
                      {item.notes ? <p className="muted">{item.notes}</p> : <p className="muted">{t("appointments.noNotes")}</p>}
                      <div className="inline-actions" onClick={(event) => event.stopPropagation()}>
                        {renderStaffAppointmentActions(item)}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <EmptyBlock message={t("appointments.noStaff")} />
          )}
        </section>
      ) : null}
    </div>
  );
};
