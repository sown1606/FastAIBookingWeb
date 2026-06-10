import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import type { Pagination } from "../types";
import { getStatusLabel, useI18n } from "../lib/i18n";

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
  const { t } = useI18n();
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
    return <ErrorBlock message={t("dashboard.noMetrics")} onRetry={load} />;
  }

  const integrationSummary = metrics.integrationSummary ?? {
    callRail: { configured: false, missing: [t("health.missingSummary")], activeConfigCount: 0 },
    vertex: { configured: false, missing: [t("health.missingSummary")], activeConfigCount: 0 },
    amazonConnect: {
      configured: false,
      missing: [t("health.missingSummary")],
      activeConfigCount: 0
    }
  };

  const integrations = [
    {
      label: "Amazon Connect",
      value: integrationSummary.amazonConnect
    }
  ];

  return (
    <div className="stack">
      <section className="card page-hero">
        <div className="section-header">
          <div>
            <p className="eyebrow">{t("layout.platform")}</p>
            <h2>{t("dashboard.heroTitle")}</h2>
            <p className="muted">{t("dashboard.heroHint")}</p>
          </div>
          <div className="inline-actions">
            <span className="status-pill info">
              {t("dashboard.updatedAt")} {new Date(metrics.generatedAt).toLocaleString("vi-VN")}
            </span>
            <Link to="/salons/new" className="button-primary">
              {t("dashboard.createSalon")}
            </Link>
          </div>
        </div>
        <div className="hero-stats">
          <article className="hero-stat-card">
            <span>{t("dashboard.totalSalons")}</span>
            <strong>{metrics.totalSalons}</strong>
          </article>
          <article className="hero-stat-card">
            <span>{t("dashboard.activeSalons")}</span>
            <strong>{metrics.activeSalons}</strong>
          </article>
          <article className="hero-stat-card">
            <span>{t("dashboard.openEscalations")}</span>
            <strong>{metrics.openEscalationCount ?? 0}</strong>
          </article>
          <article className="hero-stat-card">
            <span>Amazon Connect</span>
            <strong>{integrationSummary.amazonConnect.configured ? t("dashboard.ready") : t("dashboard.pending")}</strong>
          </article>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>{t("dashboard.recentSalons")}</h2>
            <p className="muted">{t("dashboard.recentSalonsHint")}</p>
          </div>
          <Link to="/salons" className="button-secondary">
            {t("common.viewDetail")}
          </Link>
        </div>
        {salons.length ? (
          <div className="entity-grid">
            {salons.map((salon) => (
              <article key={salon.id} className="entity-card">
                <div className="section-header">
                  <div className="table-meta">
                    <Link to={`/salons/${salon.id}`}>
                      <strong>{salon.name}</strong>
                    </Link>
                    <span>{salon.owner.email}</span>
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
                  </div>
                </div>
                <div className="meta-grid">
                  <div>
                    <span className="muted">{t("common.owner")}</span>
                    <strong>{salon.owner.fullName}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("salons.activeStaff")}</span>
                    <strong>{salon.staffUsage.activeStaffCount}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("salons.billableExtra")}</span>
                    <strong>{salon.staffUsage.billableExtraStaffCount}</strong>
                  </div>
                </div>
                <Link to={`/salons/${salon.id}`} className="button-secondary">
                  {t("common.viewDetail")}
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock message={t("dashboard.noSalons")} />
        )}
      </section>

      <details className="advanced-config">
        <summary>{t("dashboard.operationalDetails")}</summary>
        <section className="card-grid">
          <article className="card stat-card">
            <h3>{t("dashboard.totalOwners")}</h3>
            <strong>{metrics.totalOwners}</strong>
          </article>
          <article className="card stat-card">
            <h3>{t("dashboard.suspendedSalons")}</h3>
            <strong>{metrics.suspendedSalons}</strong>
          </article>
          <article className="card stat-card">
            <h3>{t("dashboard.totalAppointments")}</h3>
            <strong>{metrics.totalAppointments}</strong>
          </article>
          <article className="card stat-card">
            <h3>{t("dashboard.callCenterAgents")}</h3>
            <strong>{metrics.callCenterAgentCount ?? 0}</strong>
          </article>
        </section>
      </details>

      <details className="advanced-config">
        <summary>{t("dashboard.integrationStatus")}</summary>
        <section className="card">
          <div>
            <h3>{t("dashboard.integrationStatus")}</h3>
            <p className="muted">{t("dashboard.integrationHint")}</p>
          </div>
          <div className="integration-grid">
            {integrations.map((integration) => (
              <article key={integration.label} className="integration-card">
                <div className="section-header">
                  <h3>{integration.label}</h3>
                  <span
                    className={
                      integration.value.configured ? "status-pill success" : "status-pill warning"
                    }
                  >
                    {integration.value.configured ? t("dashboard.ready") : t("dashboard.pending")}
                  </span>
                </div>
                <div className="key-value-grid">
                  <div>
                    <span className="muted">{t("health.activeConfig")}</span>
                    <strong>{integration.value.activeConfigCount}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("common.status")}</span>
                    <strong>{integration.value.configured ? t("status.READY") : t("status.NEEDS_SETUP")}</strong>
                  </div>
                </div>
                <p className="muted">
                  {integration.value.missing.length
                    ? t("dashboard.integrationMissing", { items: integration.value.missing.join(", ") })
                    : t("dashboard.integrationReady")}
                </p>
              </article>
            ))}
          </div>
        </section>
      </details>
    </div>
  );
};
