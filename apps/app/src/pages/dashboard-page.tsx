import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPut, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useAuth } from "../auth/auth-context";
import { useToast } from "../components/toast";
import { formatDateTime, formatCurrencyCents } from "../lib/format";

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
      notify("success", updated.aiForwardingEnabled ? "Đã bật AI." : "Đã tắt AI.");
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
          <p className="eyebrow">Tổng đài</p>
          <h2>Xử lý lịch hẹn cho tiệm được phân công</h2>
          <Link to="/call-center" className="button-primary">
            Mở màn hình tổng đài
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      {session?.user.role === "SALON_OWNER" ? (
        <>
        <section className="mobile-hero">
          <p className="eyebrow">FastAIBooking</p>
          <h2>{settings?.aiForwardingEnabled ? "AI đang nhận cuộc gọi" : "Cuộc gọi đang về số tiệm"}</h2>
          <p className="muted">Ngưỡng chuyển mặc định {settings?.aiTransferRingCount ?? 3} hồi chuông.</p>
          <button type="button" className="button-primary" onClick={toggleAi}>
            {settings?.aiForwardingEnabled ? "Tắt AI" : "Bật AI"}
          </button>
        </section>
        <section className="card-grid">
          <article className="card stat-card">
            <h3>Nhân viên</h3>
            <strong>{staffCount}</strong>
          </article>
          <article className="card stat-card">
            <h3>Dịch vụ</h3>
            <strong>{serviceCount}</strong>
          </article>
          <article className="card stat-card">
            <h3>Khách hàng</h3>
            <strong>{customerCount}</strong>
          </article>
          <article className="card stat-card">
            <h3>Chi phí thêm</h3>
            <strong>{formatCurrencyCents(billing?.currentUsage.estimatedExtraCostCents)}</strong>
          </article>
        </section>
        <section className="quick-actions">
          <Link to="/appointments">Lịch hẹn</Link>
          <Link to="/customers">Khách hàng</Link>
          <Link to="/services">Dịch vụ</Link>
          <Link to="/staff">Nhân viên</Link>
          <Link to="/availability">Giờ trống</Link>
          <Link to="/business-hours">Giờ làm việc</Link>
          <Link to="/calls">Cuộc gọi</Link>
          <Link to="/alerts">Cảnh báo</Link>
          <Link to="/billing">Chi phí</Link>
          <Link to="/ai-logs">Nhật ký AI</Link>
        </section>
        </>
      ) : (
        <section className="card-grid">
          <article className="card stat-card">
            <h3>Hôm nay / sắp tới</h3>
            <strong>{upcoming.length}</strong>
          </article>
          <article className="card stat-card">
            <h3>Trạng thái</h3>
            <strong>Nhân viên</strong>
          </article>
        </section>
      )}

      <section className="card">
        <h2>Lịch hẹn sắp tới</h2>
        {upcoming.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Giờ</th>
                  <th>Khách</th>
                  <th>Dịch vụ</th>
                  <th>Nhân viên</th>
                  <th>Trạng thái</th>
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
          <EmptyBlock message="Chưa có lịch hẹn sắp tới." />
        )}
      </section>
    </div>
  );
};
