import { useEffect, useState } from "react";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { formatDateTime } from "../lib/format";

interface AiLogItem {
  id: string;
  taskType: string;
  provider: string;
  model: string | null;
  isValid: boolean;
  confidence: number | null;
  createdAt: string;
}

interface AiLogsResponse {
  items: AiLogItem[];
}

interface AiLogDetail {
  id: string;
  taskType: string;
  requestText: string | null;
  responseText: string | null;
  parsedOutput: unknown;
  isValid: boolean;
  validationErrors: unknown;
  createdAt: string;
}

export const AiLogsPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<AiLogItem[]>([]);
  const [selected, setSelected] = useState<AiLogDetail | null>(null);

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await apiGet<AiLogsResponse>("/api/v1/ai/interactions?page=1&limit=50");
      setLogs(response.items);
      if (selected) {
        const detail = await apiGet<AiLogDetail>(`/api/v1/ai/interactions/${selected.id}`);
        setSelected(detail);
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

  const openLog = async (id: string) => {
    try {
      const detail = await apiGet<AiLogDetail>(`/api/v1/ai/interactions/${id}`);
      setSelected(detail);
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
        <h2>Nhật ký AI</h2>
        {logs.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Tác vụ</th>
                <th>Nguồn</th>
                <th>Hợp lệ</th>
                <th>Độ tin cậy</th>
                <th>Mở</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.createdAt)}</td>
                  <td>{log.taskType}</td>
                  <td>{log.provider}</td>
                  <td>{log.isValid ? "Có" : "Không"}</td>
                  <td>{log.confidence ?? "-"}</td>
                  <td>
                    <button type="button" className="button-secondary" onClick={() => openLog(log.id)}>
                      Xem
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : (
          <EmptyBlock message="Chưa có nhật ký AI." />
        )}
      </section>

      <section className="card">
        <h2>Chi tiết tương tác AI</h2>
        {selected ? (
          <div className="stack">
            <div className="muted">
              {selected.taskType} - {formatDateTime(selected.createdAt)}
            </div>
            <h3>Yêu cầu</h3>
            <pre>{selected.requestText ?? "-"}</pre>
            <h3>Phản hồi</h3>
            <pre>{selected.responseText ?? "-"}</pre>
            <h3>Kết quả đã phân tích</h3>
            <pre>{JSON.stringify(selected.parsedOutput, null, 2)}</pre>
            <h3>Lỗi kiểm tra</h3>
            <pre>{JSON.stringify(selected.validationErrors, null, 2)}</pre>
          </div>
        ) : (
          <EmptyBlock message="Chọn một nhật ký để xem chi tiết." />
        )}
      </section>
    </div>
  );
};
