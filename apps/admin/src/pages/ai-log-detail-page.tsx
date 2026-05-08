import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { formatDateTime } from "../lib/format";
import { getStatusLabel, useI18n } from "../lib/i18n";

interface AiLogDetail {
  id: string;
  provider: string;
  model: string | null;
  taskType: string;
  requestText: string | null;
  responseText: string | null;
  requestPayload: unknown;
  responsePayload: unknown;
  parsedOutput: unknown;
  isValid: boolean;
  validationErrors: unknown;
  confidence: number | null;
  createdAt: string;
  salon: {
    id: string;
    name: string;
  } | null;
  callSession: {
    id: string;
    status: string;
    routingOutcome: string | null;
    finalResolution: string | null;
  } | null;
  bookingAttempt: {
    id: string;
    status: string;
    failureReason: string | null;
  } | null;
  transcript: {
    id: string;
    transcriptSource: string;
    transcriptSummary: string | null;
  } | null;
}

const routingLabelKeyByValue = {
  SALON_RING: "routing.SALON_RING",
  AI_RECEPTION: "routing.AI_RECEPTION",
  CALL_CENTER_ESCALATION: "routing.CALL_CENTER_ESCALATION",
  CALLBACK_REQUEST: "routing.CALLBACK_REQUEST",
  SMS_FALLBACK: "routing.SMS_FALLBACK",
  VOICEMAIL: "routing.VOICEMAIL",
  QUEUED: "routing.QUEUED"
} as const;

export const AiLogDetailPage = () => {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [log, setLog] = useState<AiLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const translateStatus = (value: string | null | undefined) => {
    if (!value) {
      return t("common.none");
    }
    const key = getStatusLabel(value);
    return key ? t(key) : value;
  };

  const translateRouting = (value: string | null | undefined) => {
    if (!value) {
      return t("common.none");
    }
    const key = routingLabelKeyByValue[value as keyof typeof routingLabelKeyByValue];
    return key ? t(key) : value;
  };

  const load = async () => {
    if (!id) {
      setError(t("aiLogs.missingId"));
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const response = await apiGet<AiLogDetail>(`/api/v1/admin/ai-logs/${id}`);
      setLog(response);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  if (!log) {
    return <EmptyBlock message={t("aiLogs.notFound")} />;
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>{t("aiLogs.detailTitle")}</h2>
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("aiLogs.taskType")}</span>
            <strong>{log.taskType}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.providerModel")}</span>
            <strong>
              {log.provider} {log.model ? `/ ${log.model}` : ""}
            </strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.validation")}</span>
            <strong>{log.isValid ? t("common.yes") : t("common.no")}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.confidence")}</span>
            <strong>{log.confidence ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.created")}</span>
            <strong>{formatDateTime(log.createdAt)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>{t("aiLogs.linkedRecords")}</h3>
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("aiLogs.salon")}</span>
            <strong>{log.salon?.name ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.callSession")}</span>
            <strong>{log.callSession?.id ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.callOutcome")}</span>
            <strong>{translateRouting(log.callSession?.routingOutcome)}</strong>
          </div>
          <div>
            <span className="muted">{t("aiLogs.bookingAttempt")}</span>
            <strong>{translateStatus(log.bookingAttempt?.status)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>{t("aiLogs.requestText")}</h3>
        <pre>{log.requestText ?? t("common.none")}</pre>
      </section>

      <section className="card">
        <h3>{t("aiLogs.responseText")}</h3>
        <pre>{log.responseText ?? t("common.none")}</pre>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>{t("aiLogs.parsedOutput")}</h3>
          <pre>{JSON.stringify(log.parsedOutput ?? null, null, 2)}</pre>
        </article>
        <article className="card">
          <h3>{t("aiLogs.validationErrors")}</h3>
          <pre>{JSON.stringify(log.validationErrors ?? null, null, 2)}</pre>
        </article>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>{t("aiLogs.requestPayload")}</h3>
          <pre>{JSON.stringify(log.requestPayload ?? null, null, 2)}</pre>
        </article>
        <article className="card">
          <h3>{t("aiLogs.responsePayload")}</h3>
          <pre>{JSON.stringify(log.responsePayload ?? null, null, 2)}</pre>
        </article>
      </section>
    </div>
  );
};
