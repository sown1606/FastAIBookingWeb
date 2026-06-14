import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPut, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useAuth } from "../auth/auth-context";
import { useToast } from "../components/toast";
import { formatCurrencyCents, formatDateTime } from "../lib/format";
import { statusLabelKey, useI18n } from "../lib/i18n";
import { useUiMode } from "../lib/ui-mode";
import { InfoHint } from "../components/info-hint";

interface AppointmentItem {
  id: string;
  startTime: string;
  status: string;
  customer: {
    firstName: string;
    lastName: string;
  };
  staff: {
    fullName: string;
  };
  service: {
    name: string;
  };
}

interface AppointmentsResponse {
  items: AppointmentItem[];
}

interface BillingUsageResponse {
  currentUsage: {
    freeStaffLimit: number;
    activeStaffCount: number;
    billableExtraStaffCount: number;
    estimatedExtraCostCents: number;
  };
}

interface StaffItem {
  id: string;
}

interface ServiceItem {
  id: string;
}

interface CustomerResponse {
  pagination: {
    total: number;
  };
}

interface SalonSettings {
  aiReceptionEnabled: boolean;
  aiTransferRingCount: number;
  callCenterEnabled: boolean;
  voicemailEnabled: boolean;
  callbackRequestEnabled: boolean;
  smsFallbackEnabled: boolean;
  routingSummary: {
    mode:
      | "SALON_PHONE_ONLY"
      | "AI_RECEPTION_ONLY"
      | "CALL_CENTER_ONLY"
      | "AI_RECEPTION_WITH_CALL_CENTER";
    ringCountBeforeAi: number;
  };
}

interface SalonProfileSummary {
  id: string;
  name: string;
}

interface SalonOperatorNote {
  salonId: string;
  salonName: string;
  callCenterRoutingNote: string | null;
}

const isSameLocalDay = (value: string, reference: Date) => {
  const date = new Date(value);
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
};

export const DashboardPage = () => {
  const { session } = useAuth();
  const { notify } = useToast();
  const { t } = useI18n();
  const { isBasicMode } = useUiMode();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [billing, setBilling] = useState<BillingUsageResponse | null>(null);
  const [staffCount, setStaffCount] = useState(0);
  const [serviceCount, setServiceCount] = useState(0);
  const [customerCount, setCustomerCount] = useState(0);
  const [settings, setSettings] = useState<SalonSettings | null>(null);
  const [salonProfile, setSalonProfile] = useState<SalonProfileSummary | null>(null);
  const [operatorNote, setOperatorNote] = useState<SalonOperatorNote | null>(null);

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      if (session?.user.role === "CALL_CENTER_AGENT") {
        setAppointments([]);
        setBilling(null);
        setStaffCount(0);
        setServiceCount(0);
        setCustomerCount(0);
        setSettings(null);
        setSalonProfile(null);
        setOperatorNote(null);
        return;
      }

      const appointmentResult = await apiGet<AppointmentsResponse>("/api/v1/appointments?page=1&limit=20");
      setAppointments(appointmentResult.items);

      if (session?.user.role === "SALON_OWNER") {
        const [billingUsage, staff, services, customers, salonSettings, profile] = await Promise.all([
          apiGet<BillingUsageResponse>("/api/v1/billing/usage?historyLimit=3"),
          apiGet<StaffItem[]>("/api/v1/staff?includeInactive=false"),
          apiGet<ServiceItem[]>("/api/v1/services"),
          apiGet<CustomerResponse>("/api/v1/customers?page=1&limit=1"),
          apiGet<SalonSettings>("/api/v1/salon/settings"),
          apiGet<SalonProfileSummary>("/api/v1/salon/profile")
        ]);
        setBilling(billingUsage);
        setStaffCount(staff.length);
        setServiceCount(services.length);
        setCustomerCount(customers.pagination.total);
        setSettings(salonSettings);
        setSalonProfile(profile);
        setOperatorNote(null);
      } else {
        const note = await apiGet<SalonOperatorNote>("/api/v1/salon/staff-note");
        setBilling(null);
        setStaffCount(0);
        setServiceCount(0);
        setCustomerCount(0);
        setSettings(null);
        setSalonProfile(null);
        setOperatorNote(note);
      }
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session?.user.role]);

  const toggleAiReception = async () => {
    if (!settings) {
      return;
    }
    try {
      const updated = await apiPut<SalonSettings, Partial<SalonSettings>>("/api/v1/salon/settings", {
        aiReceptionEnabled: !settings.aiReceptionEnabled,
        aiTransferRingCount: settings.aiTransferRingCount
      });
      setSettings(updated);
      notify("success", updated.aiReceptionEnabled ? t("dashboard.aiEnabled") : t("dashboard.aiDisabled"));
    } catch (toggleError) {
      notify("error", extractErrorMessage(toggleError));
    }
  };

  const upcoming = useMemo(() => {
    const now = Date.now();
    return appointments
      .filter((item) => new Date(item.startTime).getTime() >= now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 8);
  }, [appointments]);

  const now = new Date();
  const todayAppointments = useMemo(
    () => appointments.filter((item) => isSameLocalDay(item.startTime, now)),
    [appointments, now]
  );
  const completedToday = useMemo(
    () => todayAppointments.filter((item) => item.status === "COMPLETED"),
    [todayAppointments]
  );
  const inProgressToday = useMemo(
    () => todayAppointments.filter((item) => item.status === "IN_PROGRESS"),
    [todayAppointments]
  );
  const nextAppointment = upcoming[0] ?? null;

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  if (session?.user.role === "CALL_CENTER_AGENT") {
    return (
      <div className="stack">
        <section className="mobile-hero">
          <p className="eyebrow">{t("nav.callCenter")}</p>
          <h2>{t("dashboard.operatorTitle")}</h2>
          <p className="muted">{t("dashboard.operatorHint")}</p>
          <Link to="/call-center" className="button-primary">
            {t("dashboard.openOperator")}
          </Link>
        </section>
      </div>
    );
  }

  const routingMode = settings?.routingSummary.mode ?? "SALON_PHONE_ONLY";
  const routingLabelKeyByMode: Record<SalonSettings["routingSummary"]["mode"], Parameters<typeof t>[0]> = {
    SALON_PHONE_ONLY: "dashboard.routingSalonOnly",
    AI_RECEPTION_ONLY: "dashboard.routingAiOnly",
    CALL_CENTER_ONLY: "dashboard.routingCallCenter",
    AI_RECEPTION_WITH_CALL_CENTER: "dashboard.routingMixed"
  };
  const routingDescriptionKeyByMode: Record<
    SalonSettings["routingSummary"]["mode"],
    Parameters<typeof t>[0]
  > = {
    SALON_PHONE_ONLY: "dashboard.routingSalonOnlyHint",
    AI_RECEPTION_ONLY: "dashboard.routingAiOnlyHint",
    CALL_CENTER_ONLY: "dashboard.routingCallCenterHint",
    AI_RECEPTION_WITH_CALL_CENTER: "dashboard.routingMixedHint"
  };
  const routingLabel = t(routingLabelKeyByMode[routingMode]);
  const routingDescription = t(routingDescriptionKeyByMode[routingMode], {
    count: settings?.routingSummary.ringCountBeforeAi ?? 3
  });

  return (
    <div className="stack">
      {session?.user.role === "SALON_OWNER" ? (
        <>
          <section className="dashboard-hero">
            <div className="dashboard-hero-copy">
              <p className="eyebrow">{t("dashboard.commandCenterTitle")}</p>
              <h2>{salonProfile?.name ?? t("nav.dashboard")}</h2>
              <p className="muted">{t("dashboard.commandCenterHint")}</p>
              <div className="summary-badges">
                <span className={settings?.aiReceptionEnabled ? "status-pill success" : "status-pill warning"}>
                  {t("dashboard.aiReceptionStatus")}: {settings?.aiReceptionEnabled ? t("common.statusOn") : t("common.statusOff")}
                  <InfoHint text={t("hints.aiReception")} />
                </span>
                <span className={settings?.callCenterEnabled ? "status-pill success" : "status-pill warning"}>
                  {t("dashboard.callCenterStatus")}: {settings?.callCenterEnabled ? t("common.statusOn") : t("common.statusOff")}
                  <InfoHint text={t("hints.callCenter")} />
                </span>
                <span className="status-pill info">
                  {t("dashboard.todayStatus")}: {todayAppointments.length ? t("dashboard.todayOpenStatus") : t("dashboard.todayQuietStatus")}
                </span>
              </div>
              <div className="hero-stats">
                <article className="hero-stat-card">
                  <span>{t("dashboard.todayAppointments")}</span>
                  <strong>{todayAppointments.length}</strong>
                </article>
                {!isBasicMode ? (
                  <article className="hero-stat-card">
                    <span>{t("dashboard.completedToday")}</span>
                    <strong>{completedToday.length}</strong>
                  </article>
                ) : null}
                <article className="hero-stat-card">
                  <span>{t("dashboard.nextAppointment")}</span>
                  <strong>{nextAppointment ? formatDateTime(nextAppointment.startTime) : t("dashboard.noNextAppointment")}</strong>
                </article>
                <article className="hero-stat-card">
                  <span>{t("dashboard.staff")}</span>
                  <strong>{staffCount}</strong>
                </article>
              </div>
              <div className="inline-actions">
                <button type="button" className="button-primary" onClick={toggleAiReception}>
                  {settings?.aiReceptionEnabled ? t("dashboard.toggleAiOff") : t("dashboard.toggleAiOn")}
                </button>
                <Link to="/salon-profile" className="button-secondary">
                  {isBasicMode ? t("dashboard.salonSettings") : t("dashboard.openDetails")}
                </Link>
              </div>
            </div>
          </section>

          {!isBasicMode ? (
            <section className="card-grid">
              <article className="card stat-card">
                <h3>{t("dashboard.todayAppointments")}</h3>
                <strong>{todayAppointments.length}</strong>
                <span className="muted">{nextAppointment ? formatDateTime(nextAppointment.startTime) : t("dashboard.noNextAppointment")}</span>
              </article>
              <article className="card stat-card">
                <h3>{t("dashboard.staff")}</h3>
                <strong>{staffCount}</strong>
                <span className="muted">{t("billing.activeStaff")}</span>
              </article>
              <article className="card stat-card">
                <h3>{t("dashboard.services")}</h3>
                <strong>{serviceCount}</strong>
                <span className="muted">{t("nav.services")}</span>
              </article>
              <article className="card stat-card">
                <h3>{t("dashboard.customers")}</h3>
                <strong>{customerCount}</strong>
                <span className="muted">{t("nav.customers")}</span>
              </article>
              <article className="card stat-card">
                <h3>{t("dashboard.extraCost")}</h3>
                <strong>{formatCurrencyCents(billing?.currentUsage.estimatedExtraCostCents)}</strong>
                <span className="muted">{t("billing.billableStaff")}: {billing?.currentUsage.billableExtraStaffCount ?? 0}</span>
              </article>
              <article className="card stat-card">
                <h3>{t("dashboard.aiReceptionStatus")}</h3>
                <strong>{settings?.aiReceptionEnabled ? t("dashboard.ready") : t("dashboard.needsSetup")}</strong>
                <span className="muted">{routingLabel}</span>
              </article>
              <article className="card stat-card">
                <h3>{t("dashboard.callCenterStatus")}</h3>
                <strong>{settings?.callCenterEnabled ? t("dashboard.ready") : t("dashboard.needsSetup")}</strong>
                <span className="muted">{routingDescription}</span>
              </article>
            </section>
          ) : null}

          <section className={isBasicMode ? "quick-actions primary-actions" : "quick-actions"}>
            <Link to="/appointments">{isBasicMode ? t("dashboard.viewSchedule") : t("nav.appointments")}</Link>
            {isBasicMode ? <Link to="/appointments#create-appointment">{t("dashboard.addAppointment")}</Link> : null}
            {!isBasicMode ? <Link to="/customers">{t("nav.customers")}</Link> : null}
            <Link to="/staff">{isBasicMode ? t("dashboard.manageStaff") : t("nav.staff")}</Link>
            <Link to="/services">{isBasicMode ? t("dashboard.manageServices") : t("nav.services")}</Link>
            {isBasicMode ? <Link to="/salon-profile">{t("dashboard.salonSettings")}</Link> : null}
            {!isBasicMode ? <Link to="/availability">{t("nav.availability")}</Link> : null}
            {!isBasicMode ? <Link to="/business-hours">{t("nav.businessHours")}</Link> : null}
            {!isBasicMode ? <Link to="/calls">{t("nav.calls")}</Link> : null}
            {!isBasicMode ? <Link to="/alerts">{t("nav.alerts")}</Link> : null}
            {!isBasicMode ? <Link to="/billing">{t("nav.billing")}</Link> : null}
            {!isBasicMode ? <Link to="/ai-logs">{t("nav.aiLogs")}</Link> : null}
          </section>
        </>
      ) : (
        <>
          <section className="dashboard-hero">
            <div className="dashboard-hero-copy">
              <p className="eyebrow">{t("dashboard.todayWorkTitle")}</p>
              <h2>{t("layout.staffSpace")}</h2>
              <p className="muted">{t("dashboard.todayWorkHint")}</p>
              <div className="hero-stats">
                <article className="hero-stat-card">
                  <span>{t("appointments.todayCount")}</span>
                  <strong>{todayAppointments.length}</strong>
                </article>
                <article className="hero-stat-card">
                  <span>{t("appointments.completedCount")}</span>
                  <strong>{completedToday.length}</strong>
                </article>
                <article className="hero-stat-card">
                  <span>{t("appointments.inProgressCount")}</span>
                  <strong>{inProgressToday.length}</strong>
                </article>
                <article className="hero-stat-card">
                  <span>{t("dashboard.nextAppointment")}</span>
                  <strong>{nextAppointment ? formatDateTime(nextAppointment.startTime) : t("dashboard.noNextAppointment")}</strong>
                </article>
              </div>
            </div>
          </section>
          <section className={operatorNote?.callCenterRoutingNote ? "card operator-routing-note has-note" : "card operator-routing-note is-empty"}>
            <span>{t("dashboard.staffOwnerNoteTitle")}</span>
            <strong>{operatorNote?.callCenterRoutingNote?.trim() || t("dashboard.staffOwnerNoteEmpty")}</strong>
          </section>
          <section className="card">
            <div className="section-header">
              <div>
                <h2>{t("dashboard.upcomingSchedule")}</h2>
                <p className="muted">{t("appointments.staffHint")}</p>
              </div>
              <Link to="/appointments" className="button-secondary">
                {t("dashboard.openDetails")}
              </Link>
            </div>
            {todayAppointments.length ? (
              <div className="entity-grid">
                {todayAppointments.map((item) => (
                  <article key={item.id} className="appointment-card">
                    <div className="appointment-card-header">
                      <div className="appointment-card-copy">
                        <strong>
                          {item.customer.firstName} {item.customer.lastName}
                        </strong>
                        <span className="muted">{item.service.name}</span>
                      </div>
                      <span className="status-pill info">
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
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyBlock message={t("dashboard.noTodayAppointments")} />
            )}
          </section>
        </>
      )}

      {!isBasicMode ? (
        <section className="card">
          <h2>{t("dashboard.upcoming")}</h2>
          {upcoming.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("appointments.time")}</th>
                    <th>{t("appointments.customer")}</th>
                    <th>{t("appointments.service")}</th>
                    <th>{t("appointments.staff")}</th>
                    <th>{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDateTime(item.startTime)}</td>
                      <td>
                        {item.customer.firstName} {item.customer.lastName}
                      </td>
                      <td>{item.service.name}</td>
                      <td>{item.staff.fullName}</td>
                      <td>{statusLabelKey(item.status) ? t(statusLabelKey(item.status)!) : item.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyBlock message={t("dashboard.noUpcoming")} />
          )}
        </section>
      ) : null}
    </div>
  );
};
