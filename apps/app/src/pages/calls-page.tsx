import { useEffect, useState } from "react";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { formatDateTime } from "../lib/format";

interface CallItem {
  id: string;
  provider: string;
  status: string;
  routingOutcome: string | null;
  callerPhone: string | null;
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
  status: string;
  routingOutcome: string | null;
  recordingUrl: string | null;
  transcriptSummary: string | null;
  aiSummary: unknown;
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

export const CallsPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallDetail | null>(null);

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await apiGet<CallsResponse>("/api/v1/calls?page=1&limit=50");
      setCalls(result.items);
      if (selectedCall?.id) {
        const detail = await apiGet<CallDetail>(`/api/v1/calls/${selectedCall.id}`);
        setSelectedCall(detail);
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
      const detail = await apiGet<CallDetail>(`/api/v1/calls/${callId}`);
      setSelectedCall(detail);
    } catch (detailError) {
      setError(extractErrorMessage(detailError));
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Calls</h2>
        {calls.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Routing</th>
                  <th>Caller</th>
                  <th>Transcripts</th>
                  <th>Escalations</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{item.status}</td>
                    <td>{item.routingOutcome ?? "-"}</td>
                    <td>{item.callerPhone ?? "-"}</td>
                    <td>{item._count.transcripts}</td>
                    <td>{item._count.callEscalations}</td>
                    <td>
                      <button type="button" className="button-secondary" onClick={() => void openDetail(item.id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message="No calls available." />
        )}
      </section>

      <section className="card">
        <h2>Call detail</h2>
        {selectedCall ? (
          <div className="stack">
            <div className="metrics-grid">
              <div>
                <span className="muted">Status</span>
                <strong>{selectedCall.status}</strong>
              </div>
              <div>
                <span className="muted">Routing outcome</span>
                <strong>{selectedCall.routingOutcome ?? "-"}</strong>
              </div>
              <div>
                <span className="muted">Recording</span>
                <strong>{selectedCall.recordingUrl ? "Available" : "Not available"}</strong>
              </div>
              <div>
                <span className="muted">Final resolution</span>
                <strong>{selectedCall.finalResolution ?? "-"}</strong>
              </div>
            </div>

            {selectedCall.transcriptSummary ? (
              <article className="inspection-box">
                <h3>Transcript summary</h3>
                <p>{selectedCall.transcriptSummary}</p>
              </article>
            ) : null}

            <article className="inspection-box">
              <h3>AI summary</h3>
              <pre>{JSON.stringify(selectedCall.aiSummary ?? null, null, 2)}</pre>
            </article>

            <article className="inspection-box">
              <h3>Escalation state</h3>
              {selectedCall.callEscalations.length ? (
                <div className="mobile-list">
                  {selectedCall.callEscalations.map((item) => (
                    <article key={item.id} className="mobile-item">
                      <strong>{item.status}</strong>
                      <span>{item.routingOutcome ?? "-"}</span>
                      <small>{formatDateTime(item.requestedAt)}</small>
                      <small>{item.resolution ?? "No resolution yet"}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyBlock message="No escalation recorded for this call." />
              )}
            </article>

            <h3>Transcripts</h3>
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
              <EmptyBlock message="No transcript is stored for this call." />
            )}

            <h3>Booking attempts</h3>
            {selectedCall.bookingAttempts.length ? (
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
                    {selectedCall.bookingAttempts.map((attempt) => (
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
            ) : (
              <EmptyBlock message="No booking attempts are linked to this call." />
            )}
          </div>
        ) : (
          <EmptyBlock message="Select a call to inspect the full timeline." />
        )}
      </section>
    </div>
  );
};
