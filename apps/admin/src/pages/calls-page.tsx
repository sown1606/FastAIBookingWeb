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
  routingOutcome: string | null;
  finalResolution: string | null;
  callerPhone: string | null;
  salon: {
    id: string;
    name: string;
  } | null;
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
      <h2>Calls</h2>
      <form className="filters" onSubmit={onFilter}>
        <label className="field compact">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option>
            <option value="RECEIVED">RECEIVED</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="FAILED">FAILED</option>
            <option value="MISSED">MISSED</option>
            <option value="VOICEMAIL">VOICEMAIL</option>
          </select>
        </label>
        <label className="field compact">
          <span>Salon ID</span>
          <input
            value={querySalon}
            onChange={(event) => setQuerySalon(event.target.value)}
            placeholder="Filter by salon UUID"
          />
        </label>
        <button type="submit" className="button-secondary">
          Filter
        </button>
      </form>

      {data?.items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Salon</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Routing</th>
                <th>Caller</th>
                <th>Escalations</th>
                <th>Resolution</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{item.salon?.name ?? "-"}</td>
                  <td>{item.provider}</td>
                  <td>{item.status}</td>
                  <td>{item.routingOutcome ?? "-"}</td>
                  <td>{item.callerPhone ?? "-"}</td>
                  <td>{item._count.callEscalations}</td>
                  <td>{item.finalResolution ?? "-"}</td>
                  <td>
                    <Link to={`/calls/${item.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyBlock message="No calls matched the current filter." />
      )}
    </section>
  );
};
