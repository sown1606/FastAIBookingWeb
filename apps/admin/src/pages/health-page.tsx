import { useEffect, useState } from "react";
import { apiGet, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { formatDateTime } from "../lib/format";
import { useI18n } from "../lib/i18n";

interface HealthStatus {
  status: string;
  timestamp: string;
}

interface OverviewMetrics {
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
  openEscalationCount?: number;
  callCenterAgentCount?: number;
}

export const HealthPage = () => {
  const { t } = useI18n();
  const [liveness, setLiveness] = useState<HealthStatus | null>(null);
  const [readiness, setReadiness] = useState<HealthStatus | null>(null);
  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const [live, ready, adminOverview] = await Promise.all([
        apiGet<HealthStatus>("/health/liveness"),
        apiGet<HealthStatus>("/health/readiness"),
        apiGet<OverviewMetrics>("/api/v1/admin/metrics/overview")
      ]);
      setLiveness(live);
      setReadiness(ready);
      setOverview(adminOverview);
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

  return (
    <div className="stack">
      <section className="card page-hero">
        <div className="section-header">
          <div>
            <p className="eyebrow">{t("nav.health")}</p>
            <h2>{t("health.title")}</h2>
            <p className="muted">{t("health.hint")}</p>
          </div>
          <button type="button" className="button-secondary" onClick={load}>
            {t("common.refresh")}
          </button>
        </div>
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("health.liveness")}</span>
            <strong>{liveness?.status ?? "-"}</strong>
            <div className="muted">{formatDateTime(liveness?.timestamp)}</div>
          </div>
          <div>
            <span className="muted">{t("health.readiness")}</span>
            <strong>{readiness?.status ?? "-"}</strong>
            <div className="muted">{formatDateTime(readiness?.timestamp)}</div>
          </div>
          <div>
            <span className="muted">{t("health.callCenterAgents")}</span>
            <strong>{overview?.callCenterAgentCount ?? 0}</strong>
          </div>
          <div>
            <span className="muted">{t("health.openEscalations")}</span>
            <strong>{overview?.openEscalationCount ?? 0}</strong>
          </div>
        </div>
      </section>

      {overview ? (
        <section className="card">
          <div className="section-header">
            <div>
              <h3>{t("dashboard.integrationStatus")}</h3>
              <p className="muted">{t("health.integrationHint")}</p>
            </div>
          </div>
          <div className="integration-grid">
          {[
            {
              label: "Optional attribution",
              value:
                overview.integrationSummary?.callRail ?? {
                  configured: false,
                  missing: [t("health.missingSummary")],
                  activeConfigCount: 0
                }
            },
            {
              label: "Optional legacy AI",
              value:
                overview.integrationSummary?.vertex ?? {
                  configured: false,
                  missing: [t("health.missingSummary")],
                  activeConfigCount: 0
                }
            },
            {
              label: "Amazon Connect",
              value:
                overview.integrationSummary?.amazonConnect ?? {
                  configured: false,
                  missing: [t("health.missingSummary")],
                  activeConfigCount: 0
                }
            }
          ].map((integration) => (
            <article key={integration.label} className="integration-card">
              <div className="section-header">
                <h3>{integration.label}</h3>
                <span
                  className={
                    integration.value.configured ? "status-pill success" : "status-pill warning"
                  }
                >
                  {integration.value.configured ? t("status.READY") : t("status.NEEDS_SETUP")}
                </span>
              </div>
              <div className="key-value-grid">
                <div>
                  <span className="muted">{t("health.activeConfig")}</span>
                  <strong>{integration.value.activeConfigCount}</strong>
                </div>
                <div>
                  <span className="muted">{t("health.checklistMissing")}</span>
                  <strong>{integration.value.missing.length}</strong>
                </div>
              </div>
              <p className="muted">
                {integration.value.missing.length
                  ? integration.value.missing.join(", ")
                  : t("health.noMissing")}
              </p>
            </article>
          ))}
          </div>
        </section>
      ) : null}
    </div>
  );
};
