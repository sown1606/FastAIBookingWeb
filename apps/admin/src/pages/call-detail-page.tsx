import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { formatDateTime } from "../lib/format";

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

export const CallDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const [call, setCall] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    if (!id) {
      setError("Missing call ID.");
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
    return <EmptyBlock message="Call session not found." />;
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Call session {call.providerCallId}</h2>
        <div className="metrics-grid">
          <div>
            <span className="muted">Salon</span>
            <strong>{call.salon?.name ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">Status</span>
            <strong>{call.status}</strong>
          </div>
          <div>
            <span className="muted">Routing outcome</span>
            <strong>{call.routingOutcome ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">Caller phone</span>
            <strong>{call.callerPhone ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">Duration</span>
            <strong>{call.durationSeconds ?? 0} sec</strong>
          </div>
          <div>
            <span className="muted">Recording</span>
            <strong>{call.recordingUrl ? "Available" : "Not available"}</strong>
          </div>
        </div>
        {call.failureReason ? <p className="form-error">{call.failureReason}</p> : null}
      </section>

      <section className="card">
        <h3>Call metadata</h3>
        <div className="metrics-grid">
          <div>
            <span className="muted">Dialed phone</span>
            <strong>{call.dialedPhone ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">Tracking number</span>
            <strong>{call.trackingNumber ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">Campaign</span>
            <strong>{call.campaignName ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">Source</span>
            <strong>{call.sourceName ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">Started</span>
            <strong>{call.startedAt ? formatDateTime(call.startedAt) : "-"}</strong>
          </div>
          <div>
            <span className="muted">Ended</span>
            <strong>{call.endedAt ? formatDateTime(call.endedAt) : "-"}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Event timeline</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Status before</th>
                <th>Status after</th>
              </tr>
            </thead>
            <tbody>
              {call.events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.receivedAt)}</td>
                  <td>{event.eventType}</td>
                  <td>{event.statusBefore ?? "-"}</td>
                  <td>{event.statusAfter ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>Transcript</h3>
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
            <EmptyBlock message="No transcript stored for this call." />
          )}
        </article>

        <article className="card">
          <h3>AI summary</h3>
          {call.transcriptSummary ? <p>{call.transcriptSummary}</p> : null}
          <pre>{JSON.stringify(call.aiSummary ?? null, null, 2)}</pre>
          <h4>AI interactions</h4>
          {call.aiInteractions.length ? (
            <div className="mobile-list">
              {call.aiInteractions.map((item) => (
                <article key={item.id} className="mobile-item">
                  <strong>{item.taskType}</strong>
                  <span>{item.model ?? "unknown-model"}</span>
                  <small>{formatDateTime(item.createdAt)}</small>
                </article>
              ))}
            </div>
          ) : (
            <EmptyBlock message="No AI interactions linked to this call." />
          )}
        </article>
      </section>

      <section className="card">
        <h3>Booking attempts</h3>
        {call.bookingAttempts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Service</th>
                  <th>Staff</th>
                  <th>Failure reason</th>
                  <th>Appointment</th>
                </tr>
              </thead>
              <tbody>
                {call.bookingAttempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td>{formatDateTime(attempt.createdAt)}</td>
                    <td>{attempt.status}</td>
                    <td>{attempt.requestedService ?? "-"}</td>
                    <td>{attempt.requestedStaff ?? "-"}</td>
                    <td>{attempt.failureReason ?? "-"}</td>
                    <td>{attempt.appointment?.id ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message="No booking attempts were recorded for this call." />
        )}
      </section>

      <section className="card">
        <h3>Escalation and fallback state</h3>
        {call.callEscalations.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Routing</th>
                  <th>Resolution</th>
                  <th>Fallback</th>
                  <th>QA notes</th>
                </tr>
              </thead>
              <tbody>
                {call.callEscalations.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.requestedAt)}</td>
                    <td>{item.status}</td>
                    <td>{item.routingOutcome ?? "-"}</td>
                    <td>{item.resolution ?? "-"}</td>
                    <td>
                      {item.voicemailRecordingUrl
                        ? "Voicemail"
                        : item.callbackPhone
                          ? "Callback"
                          : item.smsRecipientPhone
                            ? "SMS"
                            : "-"}
                    </td>
                    <td>{item.qaNotes ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message="No escalation or fallback state was recorded for this call." />
        )}
      </section>

      <section className="card">
        <h3>Final resolution</h3>
        <p>{call.finalResolution ?? "No final resolution was stored for this call."}</p>
      </section>
    </div>
  );
};
