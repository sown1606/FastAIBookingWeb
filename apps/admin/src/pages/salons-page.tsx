import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import type { Pagination } from "../types";
import { getStatusLabel, useI18n } from "../lib/i18n";

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
  const { t } = useI18n();
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
      <section className="card page-hero">
        <div className="section-header">
          <div>
            <p className="eyebrow">{t("nav.salons")}</p>
            <h2>{t("salons.title")}</h2>
            <p className="muted">{t("salons.hint")}</p>
          </div>
          <div className="inline-actions">
            <span className="status-pill info">{t("salons.resultCount", { count: filteredItems.length })}</span>
            <Link to="/salons/new" className="button-primary">
              {t("nav.createSalon")}
            </Link>
          </div>
        </div>
        <div className="filters">
          <label className="field compact">
            <span>{t("common.search")}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("salons.searchPlaceholder")}
            />
          </label>
          <label className="field compact">
            <span>{t("salons.filterStatus")}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{t("common.all")}</option>
              <option value="PENDING">PENDING</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </select>
          </label>
          <label className="field compact">
            <span>{t("salons.filterSubscription")}</span>
            <select
              value={subscriptionStatus}
              onChange={(event) => setSubscriptionStatus(event.target.value)}
            >
              <option value="">{t("common.all")}</option>
              <option value="TRIAL">TRIAL</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="PAST_DUE">PAST_DUE</option>
              <option value="CANCELED">CANCELED</option>
            </select>
          </label>
        </div>
        {filteredItems.length ? (
          <div className="entity-grid">
            {filteredItems.map((salon) => (
              <article key={salon.id} className="entity-card">
                <div className="section-header">
                  <div className="table-meta">
                    <Link to={`/salons/${salon.id}`}>
                      <strong>{salon.name}</strong>
                    </Link>
                    <span>{salon.contactPhone ?? t("salons.hotlineMissing")}</span>
                  </div>
                  <Link to={`/salons/${salon.id}`} className="button-secondary">
                    {t("common.viewDetail")}
                  </Link>
                </div>
                <div className="summary-badges">
                  <span className={salon.status === "ACTIVE" ? "status-pill success" : "status-pill warning"}>
                    {getStatusLabel(salon.status) ? t(getStatusLabel(salon.status)!) : salon.status}
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
                    {getStatusLabel(salon.subscriptionStatus)
                      ? t(getStatusLabel(salon.subscriptionStatus)!)
                      : salon.subscriptionStatus}
                  </span>
                  <span className="status-pill">
                    {t("common.timezone")}: {salon.timezone}
                  </span>
                </div>
                <div className="meta-grid">
                  <div>
                    <span className="muted">{t("salons.ownerContact")}</span>
                    <strong>{salon.owner.fullName}</strong>
                    <span className="muted">{salon.owner.email}</span>
                  </div>
                  <div>
                    <span className="muted">{t("salons.activeStaff")}</span>
                    <strong>{salon.staffUsage.activeStaffCount}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("salons.billableExtra")}</span>
                    <strong>{salon.staffUsage.billableExtraStaffCount}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("common.phone")}</span>
                    <strong>{salon.contactPhone ?? t("salons.hotlineMissing")}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock message={t("salons.empty")} />
        )}

        {pagination ? (
          <div className="pagination">
            <button
              type="button"
              className="button-secondary"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
            >
              {t("salons.prev")}
            </button>
            <span>{t("salons.page", { page, total: Math.max(Math.ceil(pagination.total / pagination.limit), 1) })}</span>
            <button
              type="button"
              className="button-secondary"
              disabled={page >= Math.ceil(pagination.total / pagination.limit)}
              onClick={() => setPage((prev) => prev + 1)}
            >
              {t("salons.next")}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
};
