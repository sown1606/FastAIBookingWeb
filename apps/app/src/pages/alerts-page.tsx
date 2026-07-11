import { useEffect, useState } from "react";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatDateTime } from "../lib/format";
import type { Pagination } from "../types";
import { useI18n } from "../lib/i18n";

type AlertMetadata = {
  appointmentId?: string;
  customerName?: string;
  serviceName?: string;
  staffName?: string;
  appointmentStartTime?: string;
  appointmentEndTime?: string;
  timezone?: string;
  source?: string;
  callSessionId?: string;
  escalationId?: string;
  status?: string;
  routingOutcome?: string;
  customerPhone?: string | null;
  callerPhone?: string | null;
  requestedBy?: string | null;
  escalationReason?: string | null;
  messageToCaller?: string | null;
  salonName?: string | null;
  rating?: number;
  reason?: string | null;
};

interface AlertItem {
  id: string;
  alertType: string;
  title: string;
  message: string;
  priority: string;
  metadata?: AlertMetadata | null;
  readAt: string | null;
  createdAt: string;
}

interface AlertsResponse {
  items: AlertItem[];
  pagination: Pagination;
}

const FALLBACK_TIMEZONE = "America/New_York";
const rawEnumPattern = /\b[A-Z][A-Z0-9_]{2,}\b/;

const knownAlertConfig = {
  BOOKING_CREATED: {
    titleKey: "alerts.typeBookingCreated",
    categoryKey: "alerts.categoryBooking",
    fallbackKey: "alerts.bookingFallback"
  },
  CALL_ESCALATION_CREATED: {
    titleKey: "alerts.typeCallEscalation",
    categoryKey: "alerts.categoryCallCenter",
    fallbackKey: "alerts.callEscalationFallback"
  },
  CALL_CENTER_ESCALATION: {
    titleKey: "alerts.typeCallEscalation",
    categoryKey: "alerts.categoryCallCenter",
    fallbackKey: "alerts.callEscalationFallback"
  },
  MISSED_CALL: {
    titleKey: "alerts.typeMissedCall",
    categoryKey: "alerts.categoryCallCenter",
    fallbackKey: "alerts.missedCallFallback"
  },
  CALLBACK_REQUESTED: {
    titleKey: "alerts.typeCallback",
    categoryKey: "alerts.categoryFollowUp",
    fallbackKey: "alerts.callbackFallback"
  },
  SMS_SENT: {
    titleKey: "alerts.typeSms",
    categoryKey: "alerts.categoryFollowUp",
    fallbackKey: "alerts.smsFallback"
  },
  VOICEMAIL_LEFT: {
    titleKey: "alerts.typeVoicemail",
    categoryKey: "alerts.categoryFollowUp",
    fallbackKey: "alerts.voicemailFallback"
  },
  POOR_FEEDBACK: {
    titleKey: "alerts.typePoorFeedback",
    categoryKey: "alerts.categoryFeedback",
    fallbackKey: "alerts.feedbackFallback"
  }
} as const;

const isKnownAlertType = (value: string): value is keyof typeof knownAlertConfig =>
  value in knownAlertConfig;

export const AlertsPage = () => {
  const { notify } = useToast();
  const { t, locale } = useI18n();
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

  const formatAlertAppointmentTime = (value: string, timezone: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    const localeTag = locale === "vi" ? "vi-VN" : "en-US";
    const time = new Intl.DateTimeFormat(localeTag, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: locale === "vi" ? "h23" : undefined,
      timeZone: timezone
    }).format(date);
    const parts = new Intl.DateTimeFormat(localeTag, {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: timezone
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return locale === "vi"
      ? `${time}, ${get("weekday")} ${get("day")}/${get("month")}/${get("year")}`
      : `${time}, ${get("weekday")}, ${get("month")}/${get("day")}/${get("year")}`;
  };

  const formatAlertCreatedTime = (value: string, timezone: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    const localeTag = locale === "vi" ? "vi-VN" : "en-US";
    const time = new Intl.DateTimeFormat(localeTag, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: locale === "vi" ? "h23" : undefined,
      timeZone: timezone
    }).format(date);
    const parts = new Intl.DateTimeFormat(localeTag, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: timezone
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    const dateText = locale === "vi"
      ? `${get("day")}/${get("month")}/${get("year")}`
      : `${get("month")}/${get("day")}/${get("year")}`;
    return t("alerts.receivedAt", { time, date: dateText });
  };

  const safeLegacyMessage = (message: string | null | undefined) => {
    const trimmed = message?.trim() ?? "";
    if (!trimmed || rawEnumPattern.test(trimmed)) {
      return t("alerts.systemFallback");
    }
    return trimmed;
  };

  const buildAlertView = (alert: AlertItem) => {
    const timezone = alert.metadata?.timezone ?? FALLBACK_TIMEZONE;
    if (alert.alertType === "BOOKING_CREATED") {
      const legacyIso = alert.message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/)?.[0];
      const startTime = alert.metadata?.appointmentStartTime ?? legacyIso;
      const appointmentTime = startTime ? formatAlertAppointmentTime(startTime, timezone) : null;
      const pieces = [
        alert.metadata?.customerName,
        alert.metadata?.serviceName,
        alert.metadata?.staffName
      ].filter((item): item is string => Boolean(item));

      return {
        title: t("alerts.typeBookingCreated"),
        label: t("alerts.categoryBooking"),
        message: pieces.length ? pieces.join(" · ") : t("alerts.bookingFallback"),
        appointmentTime,
        createdTime: formatAlertCreatedTime(alert.createdAt, timezone)
      };
    }

    if (alert.alertType === "CALL_ESCALATION_CREATED" || alert.alertType === "CALL_CENTER_ESCALATION") {
      const customerPhone = alert.metadata?.customerPhone ?? alert.metadata?.callerPhone;
      const pressedZero =
        alert.metadata?.requestedBy === "dtmf_0" ||
        alert.metadata?.escalationReason?.toLowerCase().includes("zero") ||
        alert.metadata?.escalationReason?.includes("0");
      return {
        title: t("alerts.typeCallEscalation"),
        label: t("alerts.categoryCallCenter"),
        message: pressedZero
          ? t("alerts.callEscalationPressedZero")
          : t("alerts.callEscalationFallback"),
        detail: customerPhone ? t("alerts.callerPhone", { phone: customerPhone }) : null,
        appointmentTime: null,
        createdTime: formatAlertCreatedTime(alert.createdAt, timezone)
      };
    }

    if (isKnownAlertType(alert.alertType)) {
      const config = knownAlertConfig[alert.alertType];
      const message =
        alert.alertType === "MISSED_CALL" && (alert.metadata?.callerPhone || alert.metadata?.customerPhone)
          ? t("alerts.missedCallWithPhone", { phone: alert.metadata.callerPhone ?? alert.metadata.customerPhone ?? "" })
          : t(config.fallbackKey);
      return {
        title: t(config.titleKey),
        label: t(config.categoryKey),
        message,
        appointmentTime: null,
        createdTime: formatAlertCreatedTime(alert.createdAt, timezone)
      };
    }

    return {
      title: t("alerts.systemTitle"),
      label: t("alerts.categorySystem"),
      message: safeLegacyMessage(alert.message),
      appointmentTime: null,
      createdTime: formatAlertCreatedTime(alert.createdAt, timezone)
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
              <article
                key={alert.id}
                className={[
                  "mobile-item alert-item",
                  alert.priority === "URGENT" ? "urgent" : "",
                  alert.readAt ? "" : "unread"
                ].filter(Boolean).join(" ")}
              >
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
                {"detail" in view && view.detail ? <small className="muted">{view.detail}</small> : null}
                {view.appointmentTime ? <strong className="alert-time">{view.appointmentTime}</strong> : null}
                <small className="muted">{view.createdTime || formatDateTime(alert.createdAt, alert.metadata?.timezone ?? FALLBACK_TIMEZONE)}</small>
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
