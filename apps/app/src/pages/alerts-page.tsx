import { useEffect, useState } from "react";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatDateTime } from "../lib/format";
import type { Pagination } from "../types";
import { useI18n } from "../lib/i18n";

interface AlertItem {
  id: string;
  alertType: string;
  title: string;
  message: string;
  priority: string;
  metadata?: {
    appointmentId?: string;
    customerName?: string;
    serviceName?: string;
    staffName?: string;
    appointmentStartTime?: string;
    appointmentEndTime?: string;
    timezone?: string;
    source?: string;
  } | null;
  readAt: string | null;
  createdAt: string;
}

interface AlertsResponse {
  items: AlertItem[];
  pagination: Pagination;
}

export const AlertsPage = () => {
  const { notify } = useToast();
  const { t } = useI18n();
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

  const buildAlertView = (alert: AlertItem) => {
    if (alert.alertType !== "BOOKING_CREATED") {
      return {
        title: alert.title,
        label: alert.alertType,
        message: alert.message,
        appointmentTime: null as string | null
      };
    }

    const legacyIso = alert.message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/)?.[0];
    const startTime = alert.metadata?.appointmentStartTime ?? legacyIso;
    const timezone = alert.metadata?.timezone ?? "America/New_York";
    const appointmentTime = startTime ? formatDateTime(startTime, timezone) : null;
    const pieces = [
      alert.metadata?.customerName,
      alert.metadata?.serviceName,
      alert.metadata?.staffName ? `${t("common.staff")}: ${alert.metadata.staffName}` : null
    ].filter((item): item is string => Boolean(item));

    return {
      title: t("alerts.typeBookingCreated"),
      label: t("alerts.typeBookingCreated"),
      message: pieces.length ? pieces.join(" · ") : alert.message.replace(legacyIso ?? "", appointmentTime ?? "").trim(),
      appointmentTime
    };
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h2>{t("alerts.title")}</h2>
          <p className="muted">{t("alerts.hint")}</p>
        </div>
      </div>
      {alerts.length ? (
        <div className="mobile-list">
          {alerts.map((alert) => {
            const view = buildAlertView(alert);
            return (
              <article key={alert.id} className={`mobile-item alert-item ${alert.priority === "URGENT" ? "urgent" : ""}`}>
                <div className="section-header compact">
                  <div>
                    <strong>{view.title}</strong>
                    <small className="muted">{view.label}</small>
                  </div>
                  {alert.readAt ? (
                    <span className="status-pill">{t("alerts.readBadge")}</span>
                  ) : (
                    <button type="button" className="button-secondary compact-button" onClick={() => markRead(alert.id)}>
                      {t("alerts.read")}
                    </button>
                  )}
                </div>
                <span>{view.message}</span>
                {view.appointmentTime ? <strong className="alert-time">{view.appointmentTime}</strong> : null}
                <small className="muted">{formatDateTime(alert.createdAt, alert.metadata?.timezone ?? "America/New_York")}</small>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyBlock message={t("alerts.empty")} />
      )}
    </section>
  );
};
