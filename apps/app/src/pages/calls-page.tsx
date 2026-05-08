import { useEffect, useMemo, useState } from "react";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { formatDateTime } from "../lib/format";
import { statusLabelKey, useI18n } from "../lib/i18n";

interface CallItem {
  id: string;
  provider: string;
  status: string;
  routingOutcome: string | null;
  callerPhone: string | null;
  dialedPhone: string | null;
  trackingNumber: string | null;
  durationSeconds: number | null;
  finalResolution: string | null;
  createdAt: string;
  _count: {
    events: number;
    transcripts: number;
    bookingAttempts: number;
    callEscalations: number;
  };
}

interface CallsResponse {
  items: CallItem[];
}

interface CallDetail {
  id: string;
  provider: string;
  status: string;
  routingOutcome: string | null;
  callerPhone: string | null;
  dialedPhone: string | null;
  trackingNumber: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  transcriptSummary: string | null;
  aiSummary: unknown;
  failureReason: string | null;
  finalResolution: string | null;
  events: Array<{
    id: string;
    eventType: string;
    statusAfter: string | null;
    receivedAt: string;
  }>;
  transcripts: Array<{
    id: string;
    transcriptSource: string;
    transcriptText: string;
    transcriptSummary: string | null;
    createdAt: string;
  }>;
  bookingAttempts: Array<{
    id: string;
    status: string;
    requestedService: string | null;
    requestedStaff: string | null;
    failureReason: string | null;
    createdAt: string;
  }>;
  callEscalations: Array<{
    id: string;
    status: string;
    routingOutcome: string | null;
    requestedAt: string;
    connectedAt: string | null;
    closedAt: string | null;
    resolution: string | null;
  }>;
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

export const CallsPage = () => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallDetail | null>(null);

  const translateStatus = (value: string) => {
    const key = statusLabelKey(value);
    return key ? t(key) : value;
  };

  const translateRoutingOutcome = (value: string | null | undefined) => {
    if (!value) {
      return t("common.none");
    }

    const key = routingLabelKeyByValue[value as keyof typeof routingLabelKeyByValue];
    return key ? t(key) : value;
  };

  const loadCallDetail = async (callId: string) => {
    const detail = await apiGet<CallDetail>(`/api/v1/calls/${callId}`);
    setSelectedCall(detail);
  };

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await apiGet<CallsResponse>("/api/v1/calls?page=1&limit=50");
      setCalls(result.items);

      const nextCallId = selectedCall?.id ?? result.items[0]?.id;
      if (nextCallId) {
        await loadCallDetail(nextCallId);
      } else {
        setSelectedCall(null);
      }
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openDetail = async (callId: string) => {
    try {
      await loadCallDetail(callId);
    } catch (detailError) {
      setError(extractErrorMessage(detailError));
    }
  };

  const metrics = useMemo(() => {
    return {
      total: calls.length,
      escalated: calls.filter((item) => item._count.callEscalations > 0).length,
      withTranscripts: calls.filter((item) => item._count.transcripts > 0).length
    };
  }, [calls]);

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
            <h2>{t("calls.title")}</h2>
            <p className="muted">{t("calls.hint")}</p>
          </div>
        </div>
        <div className="hero-stats">
          <article className="hero-stat-card">
            <span>{t("calls.flowTitle")}</span>
            <strong>{t("calls.flowValue")}</strong>
          </article>
          <article className="hero-stat-card">
            <span>{t("calls.listTitle")}</span>
            <strong>{metrics.total}</strong>
          </article>
          <article className="hero-stat-card">
            <span>{t("calls.escalations")}</span>
            <strong>{metrics.escalated}</strong>
          </article>
          <article className="hero-stat-card">
            <span>{t("calls.transcripts")}</span>
            <strong>{metrics.withTranscripts}</strong>
          </article>
        </div>
      </section>

      <section className="card">
        <h2>{t("calls.listTitle")}</h2>
        {calls.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("calls.created")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("calls.routing")}</th>
                  <th>{t("calls.caller")}</th>
                  <th>{t("calls.trackingNumber")}</th>
                  <th>{t("calls.duration")}</th>
                  <th>{t("calls.transcripts")}</th>
                  <th>{t("calls.escalations")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{translateStatus(item.status)}</td>
                    <td>{translateRoutingOutcome(item.routingOutcome)}</td>
                    <td>{item.callerPhone ?? t("common.none")}</td>
                    <td>{item.trackingNumber ?? t("common.none")}</td>
                    <td>
                      {item.durationSeconds !== null
                        ? t("calls.seconds", { count: item.durationSeconds })
                        : t("common.none")}
                    </td>
                    <td>{item._count.transcripts}</td>
                    <td>{item._count.callEscalations}</td>
                    <td>
                      <button type="button" className="button-secondary" onClick={() => void openDetail(item.id)}>
                        {t("calls.open")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message={t("calls.empty")} />
        )}
      </section>

      <section className="card">
        <h2>{t("calls.detailTitle")}</h2>
        {selectedCall ? (
          <div className="stack">
            <div className="metrics-grid">
              <div>
                <span className="muted">{t("common.status")}</span>
                <strong>{translateStatus(selectedCall.status)}</strong>
              </div>
              <div>
                <span className="muted">{t("calls.routing")}</span>
                <strong>{translateRoutingOutcome(selectedCall.routingOutcome)}</strong>
              </div>
              <div>
                <span className="muted">{t("calls.caller")}</span>
                <strong>{selectedCall.callerPhone ?? t("common.none")}</strong>
              </div>
              <div>
                <span className="muted">{t("calls.provider")}</span>
                <strong>{selectedCall.provider}</strong>
              </div>
              <div>
                <span className="muted">{t("calls.dialedPhone")}</span>
                <strong>{selectedCall.dialedPhone ?? t("common.none")}</strong>
              </div>
              <div>
                <span className="muted">{t("calls.trackingNumber")}</span>
                <strong>{selectedCall.trackingNumber ?? t("common.none")}</strong>
              </div>
              <div>
                <span className="muted">{t("calls.duration")}</span>
                <strong>
                  {selectedCall.durationSeconds !== null
                    ? t("calls.seconds", { count: selectedCall.durationSeconds })
                    : t("common.none")}
                </strong>
              </div>
              <div>
                <span className="muted">{t("calls.recording")}</span>
                <strong>
                  {selectedCall.recordingUrl ? t("calls.recordingAvailable") : t("calls.recordingMissing")}
                </strong>
              </div>
              <div>
                <span className="muted">{t("calls.resolution")}</span>
                <strong>{selectedCall.finalResolution ?? t("common.none")}</strong>
              </div>
            </div>

            {selectedCall.failureReason ? <div className="form-error">{selectedCall.failureReason}</div> : null}

            {selectedCall.transcriptSummary ? (
              <article className="inspection-box">
                <h3>{t("calls.transcriptSummary")}</h3>
                <p>{selectedCall.transcriptSummary}</p>
              </article>
            ) : null}

            <article className="inspection-box">
              <h3>{t("calls.aiSummary")}</h3>
              <pre>{JSON.stringify(selectedCall.aiSummary ?? null, null, 2)}</pre>
            </article>

            <article className="inspection-box">
              <h3>{t("calls.escalations")}</h3>
              {selectedCall.callEscalations.length ? (
                <div className="mobile-list">
                  {selectedCall.callEscalations.map((item) => (
                    <article key={item.id} className="mobile-item">
                      <strong>{translateStatus(item.status)}</strong>
                      <span>{translateRoutingOutcome(item.routingOutcome)}</span>
                      <small>{formatDateTime(item.requestedAt)}</small>
                      <small>{item.resolution ?? t("common.none")}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyBlock message={t("calls.noEscalations")} />
              )}
            </article>

            <article className="inspection-box">
              <h3>{t("calls.eventTimeline")}</h3>
              {selectedCall.events.length ? (
                <div className="mobile-list">
                  {selectedCall.events.map((event) => (
                    <article key={event.id} className="mobile-item">
                      <strong>{event.eventType}</strong>
                      <span>{event.statusAfter ? translateStatus(event.statusAfter) : t("common.none")}</span>
                      <small>{formatDateTime(event.receivedAt)}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyBlock message={t("common.none")} />
              )}
            </article>

            <h3>{t("calls.transcripts")}</h3>
            {selectedCall.transcripts.length ? (
              selectedCall.transcripts.map((transcript) => (
                <article key={transcript.id} className="inspection-box">
                  <h4>
                    {transcript.transcriptSource} · {formatDateTime(transcript.createdAt)}
                  </h4>
                  {transcript.transcriptSummary ? <p>{transcript.transcriptSummary}</p> : null}
                  <pre>{transcript.transcriptText}</pre>
                </article>
              ))
            ) : (
              <EmptyBlock message={t("calls.noTranscripts")} />
            )}

            <h3>{t("calls.bookingAttempts")}</h3>
            {selectedCall.bookingAttempts.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("calls.created")}</th>
                      <th>{t("common.status")}</th>
                      <th>{t("appointments.service")}</th>
                      <th>{t("appointments.staff")}</th>
                      <th>{t("calls.failureReason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCall.bookingAttempts.map((attempt) => (
                      <tr key={attempt.id}>
                        <td>{formatDateTime(attempt.createdAt)}</td>
                        <td>{translateStatus(attempt.status)}</td>
                        <td>{attempt.requestedService ?? t("common.none")}</td>
                        <td>{attempt.requestedStaff ?? t("common.unassigned")}</td>
                        <td>{attempt.failureReason ?? t("common.none")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyBlock message={t("calls.noBookingAttempts")} />
            )}
          </div>
        ) : (
          <EmptyBlock message={t("calls.select")} />
        )}
      </section>
    </div>
  );
};
