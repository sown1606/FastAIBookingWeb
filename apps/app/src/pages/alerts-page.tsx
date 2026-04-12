import { useEffect, useState } from "react";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatDateTime } from "../lib/format";
import type { Pagination } from "../types";

interface AlertItem {
  id: string;
  alertType: string;
  title: string;
  message: string;
  priority: string;
  readAt: string | null;
  createdAt: string;
}

interface AlertsResponse {
  items: AlertItem[];
  pagination: Pagination;
}

export const AlertsPage = () => {
  const { notify } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await apiGet<AlertsResponse>("/api/v1/alerts?page=1&limit=50");
      setAlerts(result.items);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const markRead = async (alertId: string) => {
    try {
      await apiPost<AlertItem, Record<string, never>>(`/api/v1/alerts/${alertId}/read`, {});
      await load();
    } catch (readError) {
      notify("error", extractErrorMessage(readError));
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <section className="card">
      <h2>Cảnh báo</h2>
      {alerts.length ? (
        <div className="mobile-list">
          {alerts.map((alert) => (
            <article key={alert.id} className={`mobile-item ${alert.priority === "URGENT" ? "urgent" : ""}`}>
              <strong>{alert.title}</strong>
              <span>{alert.message}</span>
              <small>
                {alert.alertType} - {formatDateTime(alert.createdAt)}
              </small>
              {!alert.readAt ? (
                <button type="button" className="button-secondary" onClick={() => markRead(alert.id)}>
                  Đã xem
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <EmptyBlock message="Chưa có cảnh báo." />
      )}
    </section>
  );
};
