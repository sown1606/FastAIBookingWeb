import { useEffect, useState } from "react";
import { apiGet, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { formatDateTime } from "../lib/format";

interface HealthStatus {
  status: string;
  timestamp: string;
}

export const HealthPage = () => {
  const [liveness, setLiveness] = useState<HealthStatus | null>(null);
  const [readiness, setReadiness] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const [live, ready] = await Promise.all([
        apiGet<HealthStatus>("/health/liveness"),
        apiGet<HealthStatus>("/health/readiness")
      ]);
      setLiveness(live);
      setReadiness(ready);
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
    <section className="card">
      <div className="section-header">
        <h2>System health</h2>
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
      </div>
    </section>
  );
};
