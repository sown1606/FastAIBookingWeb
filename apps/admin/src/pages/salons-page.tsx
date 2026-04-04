import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import type { Pagination } from "../types";

interface SalonListItem {
  id: string;
  name: string;
  status: string;
  subscriptionStatus: string;
  timezone: string;
  contactPhone: string | null;
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

export const SalonsPage = () => {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [data, setData] = useState<SalonListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit)
      });
      if (status) {
        params.set("status", status);
      }
      if (subscriptionStatus) {
        params.set("subscriptionStatus", subscriptionStatus);
      }
      const response = await apiGet<SalonListResponse>(`/api/v1/admin/salons?${params.toString()}`);
      setData(response);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [page, limit, status, subscriptionStatus]);

  const filteredItems = useMemo(() => {
    if (!data?.items?.length) {
      return [];
    }
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return data.items;
    }
    return data.items.filter((item) => {
      return (
        item.name.toLowerCase().includes(normalizedQuery) ||
        item.owner.fullName.toLowerCase().includes(normalizedQuery) ||
        item.owner.email.toLowerCase().includes(normalizedQuery) ||
        (item.contactPhone ?? "").toLowerCase().includes(normalizedQuery)
      );
    });
  }, [data?.items, query]);

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  const pagination = data?.pagination;

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header">
          <h2>Quản lý tiệm nail</h2>
          <Link to="/salons/new" className="button-primary">
            Tạo tiệm
          </Link>
        </div>
        <div className="filters">
          <label className="field compact">
            <span>Tìm kiếm</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tiệm, chủ tiệm, email, điện thoại"
            />
          </label>
          <label className="field compact">
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Tất cả</option>
              <option value="PENDING">PENDING</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </select>
          </label>
          <label className="field compact">
            <span>Gói dịch vụ</span>
            <select
              value={subscriptionStatus}
              onChange={(event) => setSubscriptionStatus(event.target.value)}
            >
              <option value="">Tất cả</option>
              <option value="TRIAL">TRIAL</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="PAST_DUE">PAST_DUE</option>
              <option value="CANCELED">CANCELED</option>
            </select>
          </label>
        </div>
        {filteredItems.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tiệm</th>
                  <th>Chủ tiệm</th>
                  <th>Trạng thái</th>
                  <th>Múi giờ</th>
                  <th>Nhân viên hoạt động</th>
                  <th>Nhân viên tính phí</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((salon) => (
                  <tr key={salon.id}>
                    <td>
                      <Link to={`/salons/${salon.id}`}>{salon.name}</Link>
                    </td>
                    <td>
                      {salon.owner.fullName}
                      <div className="muted">{salon.owner.email}</div>
                    </td>
                    <td>{salon.status}</td>
                    <td>{salon.timezone}</td>
                    <td>{salon.staffUsage.activeStaffCount}</td>
                    <td>{salon.staffUsage.billableExtraStaffCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message="Không tìm thấy tiệm phù hợp." />
        )}

        {pagination ? (
          <div className="pagination">
            <button
              type="button"
              className="button-secondary"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
            >
              Trước
            </button>
            <span>
              Trang {page} / {Math.max(Math.ceil(pagination.total / pagination.limit), 1)}
            </span>
            <button
              type="button"
              className="button-secondary"
              disabled={page >= Math.ceil(pagination.total / pagination.limit)}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Sau
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
};
