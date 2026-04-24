import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import type { Pagination } from "../types";

interface OverviewMetrics {
  totalSalons: number;
  activeSalons: number;
  suspendedSalons: number;
  totalOwners: number;
  totalAppointments: number;
  callCenterAgentCount?: number;
  openEscalationCount?: number;
  integrationSummary?: {
    callRail: {
      configured: boolean;
      missing: string[];
      activeConfigCount: number;
    };
    vertex: {
      configured: boolean;
      missing: string[];
      activeConfigCount: number;
    };
    amazonConnect: {
      configured: boolean;
      missing: string[];
      activeConfigCount: number;
    };
  };
  generatedAt: string;
}

interface SalonListItem {
  id: string;
  name: string;
  status: string;
  subscriptionStatus: string;
  owner: {
    fullName: string;
    email: string;
  };
  staffUsage: {
    activeStaffCount: number;
    billableExtraStaffCount: number;
  };
}

interface SalonListResponse {
  items: SalonListItem[];
  pagination: Pagination;
}

export const DashboardPage = () => {
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [salons, setSalons] = useState<SalonListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const [overview, latestSalons] = await Promise.all([
        apiGet<OverviewMetrics>("/api/v1/admin/metrics/overview"),
        apiGet<SalonListResponse>("/api/v1/admin/salons?page=1&limit=5")
      ]);
      setMetrics(overview);
      setSalons(latestSalons.items);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  if (!metrics) {
    return <ErrorBlock message="Chưa tải được số liệu tổng quan." onRetry={load} />;
  }

  const integrationSummary = metrics.integrationSummary ?? {
    callRail: { configured: false, missing: ["Backend chưa trả integration summary"], activeConfigCount: 0 },
    vertex: { configured: false, missing: ["Backend chưa trả integration summary"], activeConfigCount: 0 },
    amazonConnect: {
      configured: false,
      missing: ["Backend chưa trả integration summary"],
      activeConfigCount: 0
    }
  };

  const integrations = [
    {
      label: "CallRail",
      value: integrationSummary.callRail
    },
    {
      label: "Vertex AI",
      value: integrationSummary.vertex
    },
    {
      label: "Amazon Connect",
      value: integrationSummary.amazonConnect
    }
  ];

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header">
          <div>
            <p className="eyebrow">FastAIBooking Admin</p>
            <h2>Vận hành nền tảng</h2>
            <p className="muted">Theo dõi tiệm, chủ tiệm, lịch hẹn và độ sẵn sàng của AI Reception cùng tổng đài con người.</p>
          </div>
          <div className="inline-actions">
            <span className="status-pill info">Cập nhật {new Date(metrics.generatedAt).toLocaleString("vi-VN")}</span>
            <Link to="/salons/new" className="button-primary">
              Tạo tiệm
            </Link>
          </div>
        </div>
        <div className="summary-badges">
          <span className="summary-badge">Owner: {metrics.totalOwners}</span>
          <span className="summary-badge">Agent tổng đài: {metrics.callCenterAgentCount ?? 0}</span>
          <span className="summary-badge">Escalation đang mở: {metrics.openEscalationCount ?? 0}</span>
        </div>
      </section>
      <section className="card-grid">
        <article className="card stat-card">
          <h3>Tổng số tiệm</h3>
          <strong>{metrics.totalSalons}</strong>
        </article>
        <article className="card stat-card">
          <h3>Tiệm đang hoạt động</h3>
          <strong>{metrics.activeSalons}</strong>
        </article>
        <article className="card stat-card">
          <h3>Tiệm tạm dừng</h3>
          <strong>{metrics.suspendedSalons}</strong>
        </article>
        <article className="card stat-card">
          <h3>Lịch hẹn</h3>
          <strong>{metrics.totalAppointments}</strong>
        </article>
        <article className="card stat-card">
          <h3>Agent tổng đài</h3>
          <strong>{metrics.callCenterAgentCount ?? 0}</strong>
        </article>
        <article className="card stat-card">
          <h3>Escalation đang mở</h3>
          <strong>{metrics.openEscalationCount ?? 0}</strong>
        </article>
      </section>

      <section className="integration-grid">
        {integrations.map((integration) => (
          <article key={integration.label} className="integration-card">
            <div className="section-header">
              <h3>{integration.label}</h3>
              <span
                className={
                  integration.value.configured ? "status-pill success" : "status-pill warning"
                }
              >
                {integration.value.configured ? "Sẵn sàng" : "Chờ cấu hình"}
              </span>
            </div>
            <div className="key-value-grid">
              <div>
                <span className="muted">Cấu hình active</span>
                <strong>{integration.value.activeConfigCount}</strong>
              </div>
              <div>
                <span className="muted">Trạng thái</span>
                <strong>{integration.value.configured ? "Configured" : "Pending"}</strong>
              </div>
            </div>
            <p className="muted">
              {integration.value.missing.length
                ? `Thiếu: ${integration.value.missing.join(", ")}`
                : "Không có thiếu cấu hình ở mức hệ thống."}
            </p>
          </article>
        ))}
      </section>

      <section className="card">
        <div className="section-header">
          <h2>Tiệm mới tạo gần đây</h2>
          <Link to="/salons" className="button-secondary">
            Xem tất cả
          </Link>
        </div>
        {salons.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tiệm</th>
                  <th>Chủ tiệm</th>
                  <th>Trạng thái</th>
                  <th>Nhân viên hoạt động</th>
                  <th>Nhân viên tính phí</th>
                </tr>
              </thead>
              <tbody>
                {salons.map((salon) => (
                  <tr key={salon.id}>
                    <td>
                      <div className="table-meta">
                        <Link to={`/salons/${salon.id}`}>
                          <strong>{salon.name}</strong>
                        </Link>
                        <span>{salon.owner.email}</span>
                      </div>
                    </td>
                    <td>
                      <div className="table-meta">
                        <strong>{salon.owner.fullName}</strong>
                        <span>{salon.owner.email}</span>
                      </div>
                    </td>
                    <td>
                      <div className="summary-badges">
                        <span className={salon.status === "ACTIVE" ? "status-pill success" : "status-pill warning"}>
                          {salon.status}
                        </span>
                        <span
                          className={
                            salon.subscriptionStatus === "ACTIVE"
                              ? "status-pill info"
                              : salon.subscriptionStatus === "PAST_DUE"
                                ? "status-pill warning"
                                : "status-pill"
                          }
                        >
                          {salon.subscriptionStatus}
                        </span>
                      </div>
                    </td>
                    <td>{salon.staffUsage.activeStaffCount}</td>
                    <td>{salon.staffUsage.billableExtraStaffCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message="Chưa có tiệm nào." />
        )}
      </section>
    </div>
  );
};
