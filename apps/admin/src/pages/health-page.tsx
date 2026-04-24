import { useEffect, useState } from "react";
import { apiGet, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { formatDateTime } from "../lib/format";

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
      <section className="card">
        <div className="section-header">
          <div>
            <h2>Sức khỏe hệ thống</h2>
            <p className="muted">Kiểm tra liveness, readiness và mức sẵn sàng của các tích hợp live demo.</p>
          </div>
          <button type="button" className="button-secondary" onClick={load}>
            Refresh
          </button>
        </div>
        <div className="metrics-grid">
          <div>
            <span className="muted">Liveness</span>
            <strong>{liveness?.status ?? "-"}</strong>
            <div className="muted">{formatDateTime(liveness?.timestamp)}</div>
          </div>
          <div>
            <span className="muted">Readiness</span>
            <strong>{readiness?.status ?? "-"}</strong>
            <div className="muted">{formatDateTime(readiness?.timestamp)}</div>
          </div>
          <div>
            <span className="muted">Agent tổng đài</span>
            <strong>{overview?.callCenterAgentCount ?? 0}</strong>
          </div>
          <div>
            <span className="muted">Escalation đang mở</span>
            <strong>{overview?.openEscalationCount ?? 0}</strong>
          </div>
        </div>
      </section>

      {overview ? (
        <section className="integration-grid">
          {[
            {
              label: "CallRail",
              value:
                overview.integrationSummary?.callRail ?? {
                  configured: false,
                  missing: ["Backend chưa trả integration summary"],
                  activeConfigCount: 0
                }
            },
            {
              label: "Vertex AI",
              value:
                overview.integrationSummary?.vertex ?? {
                  configured: false,
                  missing: ["Backend chưa trả integration summary"],
                  activeConfigCount: 0
                }
            },
            {
              label: "Amazon Connect",
              value:
                overview.integrationSummary?.amazonConnect ?? {
                  configured: false,
                  missing: ["Backend chưa trả integration summary"],
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
                  {integration.value.configured ? "Sẵn sàng" : "Thiếu config"}
                </span>
              </div>
              <div className="key-value-grid">
                <div>
                  <span className="muted">Active config</span>
                  <strong>{integration.value.activeConfigCount}</strong>
                </div>
                <div>
                  <span className="muted">Checklist còn thiếu</span>
                  <strong>{integration.value.missing.length}</strong>
                </div>
              </div>
              <p className="muted">
                {integration.value.missing.length
                  ? integration.value.missing.join(", ")
                  : "Không còn thiếu cấu hình ở mức hệ thống."}
              </p>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
};
