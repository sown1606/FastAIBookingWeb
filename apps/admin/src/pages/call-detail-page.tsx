import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { formatDateTime } from "../lib/format";
import { getStatusLabel, useI18n } from "../lib/i18n";

interface CallDetail {
  id: string;
  provider: string;
  providerCallId: string;
  status: string;
  routingOutcome: string | null;
  callerPhone: string | null;
  dialedPhone: string | null;
  trackingNumber: string | null;
  sourceName: string | null;
  campaignName: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  transcriptSummary: string | null;
  aiSummary: unknown;
  failureReason: string | null;
  finalResolution: string | null;
  salon: {
    id: string;
    name: string;
  } | null;
  events: Array<{
    id: string;
    eventType: string;
    statusBefore: string | null;
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
    appointment: {
      id: string;
    } | null;
  }>;
  aiInteractions: Array<{
    id: string;
    taskType: string;
    model: string | null;
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
    operatorNotes: string | null;
    qaNotes: string | null;
    voicemailRecordingUrl: string | null;
    callbackPhone: string | null;
    smsRecipientPhone: string | null;
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

export const CallDetailPage = () => {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [call, setCall] = useState<CallDetail | null>(null);
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
      setError(t("calls.missingId"));
      setLoading(false);
      return;
    }

    setError("");
    setLoading(true);
    try {
      const result = await apiGet<CallDetail>(`/api/v1/admin/calls/${id}`);
      setCall(result);
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

  if (!call) {
    return <EmptyBlock message={t("calls.notFound")} />;
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header">
          <div>
            <h2>
              {t("calls.detailTitle")} {call.providerCallId}
            </h2>
            <p className="muted">{t("calls.flowValue")}</p>
          </div>
        </div>
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("calls.salon")}</span>
            <strong>{call.salon?.name ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("common.status")}</span>
            <strong>{translateStatus(call.status)}</strong>
          </div>
          <div>
            <span className="muted">{t("calls.routing")}</span>
            <strong>{translateRouting(call.routingOutcome)}</strong>
          </div>
          <div>
            <span className="muted">{t("calls.caller")}</span>
            <strong>{call.callerPhone ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("calls.duration")}</span>
            <strong>
              {call.durationSeconds !== null
                ? t("calls.seconds", { count: call.durationSeconds })
                : t("common.none")}
            </strong>
          </div>
          <div>
            <span className="muted">{t("calls.recording")}</span>
            <strong>{call.recordingUrl ? t("calls.recordingAvailable") : t("calls.recordingMissing")}</strong>
          </div>
        </div>
        {call.failureReason ? <p className="form-error">{call.failureReason}</p> : null}
      </section>

      <section className="card">
        <h3>{t("calls.callMetadata")}</h3>
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("calls.dialedPhone")}</span>
            <strong>{call.dialedPhone ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("calls.trackingNumber")}</span>
            <strong>{call.trackingNumber ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("calls.campaign")}</span>
            <strong>{call.campaignName ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("calls.source")}</span>
            <strong>{call.sourceName ?? t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("calls.started")}</span>
            <strong>{call.startedAt ? formatDateTime(call.startedAt) : t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("calls.ended")}</span>
            <strong>{call.endedAt ? formatDateTime(call.endedAt) : t("common.none")}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>{t("calls.eventTimeline")}</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("calls.time")}</th>
                <th>{t("calls.eventType")}</th>
                <th>{t("calls.statusBefore")}</th>
                <th>{t("calls.statusAfter")}</th>
              </tr>
            </thead>
            <tbody>
              {call.events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.receivedAt)}</td>
                  <td>{event.eventType}</td>
                  <td>{translateStatus(event.statusBefore)}</td>
                  <td>{translateStatus(event.statusAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>{t("calls.transcript")}</h3>
          {call.transcripts.length ? (
            <div className="stack">
              {call.transcripts.map((transcript) => (
                <article key={transcript.id} className="inspection-box">
                  <h4>
                    {transcript.transcriptSource} · {formatDateTime(transcript.createdAt)}
                  </h4>
                  {transcript.transcriptSummary ? <p>{transcript.transcriptSummary}</p> : null}
                  <pre>{transcript.transcriptText}</pre>
                </article>
              ))}
            </div>
          ) : (
            <EmptyBlock message={t("common.none")} />
          )}
        </article>

        <article className="card">
          <h3>{t("calls.aiSummary")}</h3>
          {call.transcriptSummary ? (
            <article className="inspection-box">
              <h4>{t("calls.transcriptSummary")}</h4>
              <p>{call.transcriptSummary}</p>
            </article>
          ) : null}
          <pre>{JSON.stringify(call.aiSummary ?? null, null, 2)}</pre>
          <h4>{t("calls.aiInteractions")}</h4>
          {call.aiInteractions.length ? (
            <div className="mobile-list">
              {call.aiInteractions.map((item) => (
                <article key={item.id} className="mobile-item">
                  <strong>{item.taskType}</strong>
                  <span>{item.model ?? t("common.none")}</span>
                  <small>{formatDateTime(item.createdAt)}</small>
                </article>
              ))}
            </div>
          ) : (
            <EmptyBlock message={t("calls.aiInteractionsEmpty")} />
          )}
        </article>
      </section>

      <section className="card">
        <h3>{t("calls.bookingAttempts")}</h3>
        {call.bookingAttempts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("calls.created")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("common.service")}</th>
                  <th>{t("common.staff")}</th>
                  <th>{t("calls.failureReason")}</th>
                  <th>{t("calls.appointment")}</th>
                </tr>
              </thead>
              <tbody>
                {call.bookingAttempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td>{formatDateTime(attempt.createdAt)}</td>
                    <td>{translateStatus(attempt.status)}</td>
                    <td>{attempt.requestedService ?? t("common.none")}</td>
                    <td>{attempt.requestedStaff ?? t("common.none")}</td>
                    <td>{attempt.failureReason ?? t("common.none")}</td>
                    <td>{attempt.appointment?.id ?? t("common.none")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message={t("calls.bookingAttemptsEmpty")} />
        )}
      </section>

      <section className="card">
        <h3>{t("calls.escalationState")}</h3>
        {call.callEscalations.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("calls.requested")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("calls.routing")}</th>
                  <th>{t("calls.resolution")}</th>
                  <th>{t("calls.fallback")}</th>
                  <th>{t("calls.qaNotes")}</th>
                </tr>
              </thead>
              <tbody>
                {call.callEscalations.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.requestedAt)}</td>
                    <td>{translateStatus(item.status)}</td>
                    <td>{translateRouting(item.routingOutcome)}</td>
                    <td>{item.resolution ?? t("common.none")}</td>
                    <td>
                      {item.voicemailRecordingUrl
                        ? t("routing.VOICEMAIL")
                        : item.callbackPhone
                          ? t("routing.CALLBACK_REQUEST")
                          : item.smsRecipientPhone
                            ? t("routing.SMS_FALLBACK")
                            : t("common.none")}
                    </td>
                    <td>{item.qaNotes ?? t("common.none")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message={t("calls.noEscalations")} />
        )}
      </section>

      <section className="card">
        <h3>{t("calls.finalResolutionTitle")}</h3>
        <p>{call.finalResolution ?? t("calls.finalResolutionEmpty")}</p>
      </section>
    </div>
  );
};
