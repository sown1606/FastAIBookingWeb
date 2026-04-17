import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPut, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useAuth } from "../auth/auth-context";
import { useToast } from "../components/toast";
import { formatDateTime, formatCurrencyCents } from "../lib/format";
import { statusLabelKey, useI18n } from "../lib/i18n";

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
  aiForwardingEnabled: boolean;
  aiTransferRingCount: number;
}

export const DashboardPage = () => {
  const { session } = useAuth();
  const { notify } = useToast();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [billing, setBilling] = useState<BillingUsageResponse | null>(null);
  const [staffCount, setStaffCount] = useState(0);
  const [serviceCount, setServiceCount] = useState(0);
  const [customerCount, setCustomerCount] = useState(0);
  const [settings, setSettings] = useState<SalonSettings | null>(null);

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      if (session?.user.role === "CALL_CENTER_AGENT") {
        setAppointments([]);
        return;
      }

      const appointmentResult = await apiGet<AppointmentsResponse>(
        "/api/v1/appointments?page=1&limit=20"
      );
      setAppointments(appointmentResult.items);

      if (session?.user.role === "SALON_OWNER") {
        const [billingUsage, staff, services, customers, salonSettings] = await Promise.all([
          apiGet<BillingUsageResponse>("/api/v1/billing/usage?historyLimit=3"),
          apiGet<StaffItem[]>("/api/v1/staff?includeInactive=false"),
          apiGet<ServiceItem[]>("/api/v1/services"),
          apiGet<CustomerResponse>("/api/v1/customers?page=1&limit=1"),
          apiGet<SalonSettings>("/api/v1/salon/settings")
        ]);
        setBilling(billingUsage);
        setStaffCount(staff.length);
        setServiceCount(services.length);
        setCustomerCount(customers.pagination.total);
        setSettings(salonSettings);
      } else {
        setBilling(null);
        setStaffCount(0);
        setServiceCount(0);
        setCustomerCount(0);
        setSettings(null);
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

  const toggleAi = async () => {
    if (!settings) {
      return;
    }
    try {
      const updated = await apiPut<SalonSettings, Partial<SalonSettings>>("/api/v1/salon/settings", {
        aiForwardingEnabled: !settings.aiForwardingEnabled,
        aiTransferRingCount: settings.aiTransferRingCount
      });
      setSettings(updated);
      notify("success", updated.aiForwardingEnabled ? t("dashboard.toggleAiOn") : t("dashboard.toggleAiOff"));
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
          <Link to="/call-center" className="button-primary">
            {t("dashboard.openOperator")}
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      {session?.user.role === "SALON_OWNER" ? (
        <>
        <section className="dashboard-hero">
          <div className="dashboard-hero-copy">
            <p className="eyebrow">{t("app.name")}</p>
            <h2>
              {settings?.aiForwardingEnabled
                ? t("dashboard.ownerHeroTitleAi")
                : t("dashboard.ownerHeroTitlePhone")}
            </h2>
            <p className="muted">
              {t("dashboard.ringCount", { count: settings?.aiTransferRingCount ?? 3 })}
            </p>
            <button type="button" className="button-primary" onClick={toggleAi}>
              {settings?.aiForwardingEnabled ? t("dashboard.toggleAiOff") : t("dashboard.toggleAiOn")}
            </button>
          </div>
        </section>
        <section className="card-grid">
          <article className="card stat-card">
            <h3>{t("dashboard.staff")}</h3>
            <strong>{staffCount}</strong>
          </article>
          <article className="card stat-card">
            <h3>{t("dashboard.services")}</h3>
            <strong>{serviceCount}</strong>
          </article>
          <article className="card stat-card">
            <h3>{t("dashboard.customers")}</h3>
            <strong>{customerCount}</strong>
          </article>
          <article className="card stat-card">
            <h3>{t("dashboard.extraCost")}</h3>
            <strong>{formatCurrencyCents(billing?.currentUsage.estimatedExtraCostCents)}</strong>
          </article>
        </section>
        <section className="quick-actions">
          <Link to="/appointments">{t("nav.appointments")}</Link>
          <Link to="/customers">{t("nav.customers")}</Link>
          <Link to="/services">{t("nav.services")}</Link>
          <Link to="/staff">{t("nav.staff")}</Link>
          <Link to="/availability">{t("nav.availability")}</Link>
          <Link to="/business-hours">{t("nav.businessHours")}</Link>
          <Link to="/calls">{t("nav.calls")}</Link>
          <Link to="/alerts">{t("nav.alerts")}</Link>
          <Link to="/billing">{t("nav.billing")}</Link>
          <Link to="/ai-logs">{t("nav.aiLogs")}</Link>
        </section>
        </>
      ) : (
        <section className="card-grid">
          <article className="card stat-card">
            <h3>{t("dashboard.upcoming")}</h3>
            <strong>{upcoming.length}</strong>
          </article>
          <article className="card stat-card">
            <h3>{t("common.status")}</h3>
            <strong>{t("nav.staff")}</strong>
          </article>
        </section>
      )}

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
    </div>
  );
};
