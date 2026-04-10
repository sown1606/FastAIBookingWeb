import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import type { Pagination } from "../types";
import { formatDateTime } from "../lib/format";

interface CallItem {
  id: string;
  provider: string;
  status: string;
  callerPhone: string | null;
  dialedPhone: string | null;
  salon: {
    id: string;
    name: string;
  } | null;
  createdAt: string;
  _count: {
    events: number;
    transcripts: number;
    bookingAttempts: number;
  };
}

interface CallsResponse {
  items: CallItem[];
  pagination: Pagination;
}

export const CallsPage = () => {
  const [status, setStatus] = useState("");
  const [salonId, setSalonId] = useState("");
  const [querySalon, setQuerySalon] = useState("");
  const [data, setData] = useState<CallsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "50"
      });
      if (status) {
        params.set("status", status);
      }
      if (salonId) {
        params.set("salonId", salonId);
      }
      const response = await apiGet<CallsResponse>(`/api/v1/admin/calls?${params.toString()}`);
      setData(response);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status, salonId]);

  const onFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSalonId(querySalon.trim());
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <section className="card">
      <h2>Nhật ký cuộc gọi</h2>
      <form className="filters" onSubmit={onFilter}>
        <label className="field compact">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tất cả</option>
            <option value="RECEIVED">RECEIVED</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="FAILED">FAILED</option>
            <option value="MISSED">MISSED</option>
          </select>
        </label>
        <label className="field compact">
          <span>ID tiệm</span>
          <input
            value={querySalon}
            onChange={(event) => setQuerySalon(event.target.value)}
            placeholder="UUID tiệm nếu cần lọc"
          />
        </label>
        <button type="submit" className="button-secondary">
          Lọc
        </button>
      </form>
      {data?.items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Tiệm</th>
                <th>Nguồn</th>
                <th>Trạng thái</th>
                <th>Người gọi</th>
                <th>Transcript</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{item.salon?.name ?? "-"}</td>
                  <td>{item.provider}</td>
                  <td>{item.status}</td>
                  <td>{item.callerPhone ?? "-"}</td>
                  <td>{item._count.transcripts}</td>
                  <td>
                    <Link to={`/calls/${item.id}`}>Mở</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyBlock message="Chưa có cuộc gọi phù hợp." />
      )}
    </section>
  );
};
