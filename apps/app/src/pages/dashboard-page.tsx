import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPut, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useAuth } from "../auth/auth-context";
import { useToast } from "../components/toast";
import { formatCurrencyCents, formatDateTime } from "../lib/format";

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

const routingLabels: Record<SalonSettings["routingSummary"]["mode"], string> = {
  SALON_PHONE_ONLY: "Salon phone only",
  AI_RECEPTION_ONLY: "AI Reception only",
  CALL_CENTER_ONLY: "Human Call Center only",
  AI_RECEPTION_WITH_CALL_CENTER: "AI Reception with human escalation"
};

const routingDescriptions: Record<SalonSettings["routingSummary"]["mode"], string> = {
  SALON_PHONE_ONLY: "Calls ring the salon first and stay on the salon line.",
  AI_RECEPTION_ONLY: "AI Reception answers after the configured ring threshold and can create bookings.",
  CALL_CENTER_ONLY: "Calls route directly into the human operator workflow.",
  AI_RECEPTION_WITH_CALL_CENTER:
    "Calls ring the salon first, AI Reception answers, and human requests move into the operator queue."
};

export const DashboardPage = () => {
  const { session } = useAuth();
  const { notify } = useToast();
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
        setBilling(null);
        setStaffCount(0);
        setServiceCount(0);
        setCustomerCount(0);
        setSettings(null);
        return;
      }

      const appointmentResult = await apiGet<AppointmentsResponse>("/api/v1/appointments?page=1&limit=20");
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
      notify("success", updated.aiReceptionEnabled ? "AI Reception enabled." : "AI Reception disabled.");
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
          <p className="eyebrow">Human Call Center</p>
          <h2>Operator workspace</h2>
          <p className="muted">Open the browser softphone, review queued escalations, and complete customer requests.</p>
          <Link to="/call-center" className="button-primary">
            Open operator dashboard
          </Link>
        </section>
      </div>
    );
  }

  const routingMode = settings?.routingSummary.mode ?? "SALON_PHONE_ONLY";

  return (
    <div className="stack">
      {session?.user.role === "SALON_OWNER" ? (
        <>
          <section className="dashboard-hero">
            <div className="dashboard-hero-copy">
              <p className="eyebrow">Call handling</p>
              <h2>{routingLabels[routingMode]}</h2>
              <p className="muted">{routingDescriptions[routingMode]}</p>
              <div className="inline-actions">
                <button type="button" className="button-primary" onClick={toggleAiReception}>
                  {settings?.aiReceptionEnabled ? "Turn AI Reception off" : "Turn AI Reception on"}
                </button>
                <Link to="/salon-profile" className="button-secondary">
                  Manage settings
                </Link>
              </div>
            </div>
          </section>

          <section className="card routing-status-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Routing summary</p>
                <h2>{routingLabels[routingMode]}</h2>
              </div>
              <Link to="/salon-profile" className="button-secondary">
                Open owner settings
              </Link>
            </div>
            <div className="metrics-grid">
              <div>
                <span className="muted">AI Reception</span>
                <strong>{settings?.aiReceptionEnabled ? "ON" : "OFF"}</strong>
              </div>
              <div>
                <span className="muted">Ring count before AI</span>
                <strong>{settings?.routingSummary.ringCountBeforeAi ?? 3}</strong>
              </div>
              <div>
                <span className="muted">Human Call Center</span>
                <strong>{settings?.callCenterEnabled ? "ON" : "OFF"}</strong>
              </div>
              <div>
                <span className="muted">Voicemail fallback</span>
                <strong>{settings?.voicemailEnabled ? "ON" : "OFF"}</strong>
              </div>
              <div>
                <span className="muted">Callback request</span>
                <strong>{settings?.callbackRequestEnabled ? "ON" : "OFF"}</strong>
              </div>
              <div>
                <span className="muted">SMS fallback</span>
                <strong>{settings?.smsFallbackEnabled ? "ON" : "OFF"}</strong>
              </div>
            </div>
          </section>

          <section className="card-grid">
            <article className="card stat-card">
              <h3>Staff</h3>
              <strong>{staffCount}</strong>
            </article>
            <article className="card stat-card">
              <h3>Services</h3>
              <strong>{serviceCount}</strong>
            </article>
            <article className="card stat-card">
              <h3>Customers</h3>
              <strong>{customerCount}</strong>
            </article>
            <article className="card stat-card">
              <h3>Estimated extra cost</h3>
              <strong>{formatCurrencyCents(billing?.currentUsage.estimatedExtraCostCents)}</strong>
            </article>
          </section>

          <section className="quick-actions">
            <Link to="/appointments">Appointments</Link>
            <Link to="/customers">Customers</Link>
            <Link to="/services">Services</Link>
            <Link to="/staff">Staff</Link>
            <Link to="/availability">Availability</Link>
            <Link to="/business-hours">Business hours</Link>
            <Link to="/calls">Calls</Link>
            <Link to="/alerts">Alerts</Link>
            <Link to="/billing">Billing</Link>
            <Link to="/ai-logs">AI logs</Link>
          </section>
        </>
      ) : (
        <section className="card-grid">
          <article className="card stat-card">
            <h3>Upcoming appointments</h3>
            <strong>{upcoming.length}</strong>
          </article>
          <article className="card stat-card">
            <h3>Workspace</h3>
            <strong>Staff</strong>
          </article>
        </section>
      )}

      <section className="card">
        <h2>Upcoming appointments</h2>
        {upcoming.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Staff</th>
                  <th>Status</th>
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
                    <td>{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message="No upcoming appointments." />
        )}
      </section>
    </div>
  );
};
