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
  callerPhone: string | null;
  dialedPhone: string | null;
  trackingNumber: string | null;
  sourceName: string | null;
  campaignName: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  transcriptSummary: string | null;
  failureReason: string | null;
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
            <span className="muted">Caller phone</span>
            <strong>{call.callerPhone ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">Duration</span>
            <strong>{call.durationSeconds ?? 0} sec</strong>
          </div>
        </div>
        {call.failureReason ? <p className="form-error">{call.failureReason}</p> : null}
      </section>

      <section className="card">
        <h3>Events</h3>
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

      <section className="card">
        <h3>Transcripts</h3>
        {call.transcripts.length ? (
          <div className="stack">
            {call.transcripts.map((transcript) => (
              <article key={transcript.id} className="inspection-box">
                <h4>
                  {transcript.transcriptSource} - {formatDateTime(transcript.createdAt)}
                </h4>
                {transcript.transcriptSummary ? <p>{transcript.transcriptSummary}</p> : null}
                <pre>{transcript.transcriptText}</pre>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock message="No transcripts for this call." />
        )}
      </section>

      <section className="card">
        <h3>Booking attempts</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Status</th>
                <th>Service</th>
                <th>Staff</th>
                <th>Failure reason</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
