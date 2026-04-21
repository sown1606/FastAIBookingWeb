import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { formatDateTime } from "../lib/format";

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

export const AiLogDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const [log, setLog] = useState<AiLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    if (!id) {
      setError("Missing AI interaction ID.");
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
    return <EmptyBlock message="AI interaction log not found." />;
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>AI interaction detail</h2>
        <div className="metrics-grid">
          <div>
            <span className="muted">Task type</span>
            <strong>{log.taskType}</strong>
          </div>
          <div>
            <span className="muted">Provider / model</span>
            <strong>
              {log.provider} {log.model ? `/ ${log.model}` : ""}
            </strong>
          </div>
          <div>
            <span className="muted">Validation</span>
            <strong>{log.isValid ? "VALID" : "INVALID"}</strong>
          </div>
          <div>
            <span className="muted">Created</span>
            <strong>{formatDateTime(log.createdAt)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Linked records</h3>
        <div className="metrics-grid">
          <div>
            <span className="muted">Salon</span>
            <strong>{log.salon?.name ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">Call session</span>
            <strong>{log.callSession?.id ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">Call outcome</span>
            <strong>{log.callSession?.routingOutcome ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">Booking attempt</span>
            <strong>{log.bookingAttempt?.status ?? "-"}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Request text</h3>
        <pre>{log.requestText ?? "-"}</pre>
      </section>

      <section className="card">
        <h3>Response text</h3>
        <pre>{log.responseText ?? "-"}</pre>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>Parsed output</h3>
          <pre>{JSON.stringify(log.parsedOutput, null, 2)}</pre>
        </article>
        <article className="card">
          <h3>Validation errors</h3>
          <pre>{JSON.stringify(log.validationErrors, null, 2)}</pre>
        </article>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>Request payload</h3>
          <pre>{JSON.stringify(log.requestPayload, null, 2)}</pre>
        </article>
        <article className="card">
          <h3>Response payload</h3>
          <pre>{JSON.stringify(log.responsePayload, null, 2)}</pre>
        </article>
      </section>
    </div>
  );
};
