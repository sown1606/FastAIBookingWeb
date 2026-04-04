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

  return (
    <div className="stack">
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
          <h3>Chủ tiệm</h3>
          <strong>{metrics.totalOwners}</strong>
        </article>
        <article className="card stat-card">
          <h3>Lịch hẹn</h3>
          <strong>{metrics.totalAppointments}</strong>
        </article>
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
                      <Link to={`/salons/${salon.id}`}>{salon.name}</Link>
                    </td>
                    <td>{salon.owner.fullName}</td>
                    <td>{salon.status}</td>
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
