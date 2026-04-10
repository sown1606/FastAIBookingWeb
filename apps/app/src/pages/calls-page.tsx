import { useEffect, useState } from "react";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { formatDateTime } from "../lib/format";

interface CallItem {
  id: string;
  provider: string;
  status: string;
  callerPhone: string | null;
  dialedPhone: string | null;
  createdAt: string;
  _count: {
    events: number;
    transcripts: number;
    bookingAttempts: number;
  };
}

interface CallsResponse {
  items: CallItem[];
}

interface CallDetail {
  id: string;
  status: string;
  transcriptSummary: string | null;
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
      if (selectedCall) {
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
        <h2>Nhật ký cuộc gọi</h2>
        {calls.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Trạng thái</th>
                <th>Người gọi</th>
                <th>Transcript</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{item.status}</td>
                  <td>{item.callerPhone ?? "-"}</td>
                  <td>{item._count.transcripts}</td>
                  <td>
                    <button type="button" className="button-secondary" onClick={() => openDetail(item.id)}>
                      Mở
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : (
          <EmptyBlock message="Chưa có cuộc gọi nào." />
        )}
      </section>

      <section className="card">
        <h2>Chi tiết cuộc gọi</h2>
        {selectedCall ? (
          <div className="stack">
            <div className="muted">Trạng thái: {selectedCall.status}</div>
            {selectedCall.transcriptSummary ? <p>{selectedCall.transcriptSummary}</p> : null}
            <h3>Transcript</h3>
            {selectedCall.transcripts.length ? (
              selectedCall.transcripts.map((transcript) => (
                <article key={transcript.id} className="inspection-box">
                  <h4>
                    {transcript.transcriptSource} - {formatDateTime(transcript.createdAt)}
                  </h4>
                  <pre>{transcript.transcriptText}</pre>
                </article>
              ))
            ) : (
              <EmptyBlock message="Cuộc gọi này chưa có transcript." />
            )}
          </div>
        ) : (
          <EmptyBlock message="Chọn một cuộc gọi để xem chi tiết." />
        )}
      </section>
    </div>
  );
};
