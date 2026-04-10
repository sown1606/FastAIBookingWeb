import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import type { Pagination } from "../types";
import { formatDateTime } from "../lib/format";

interface AiLogItem {
  id: string;
  taskType: string;
  provider: string;
  model: string | null;
  isValid: boolean;
  confidence: number | null;
  createdAt: string;
  salon: {
    id: string;
    name: string;
  } | null;
}

interface AiLogsResponse {
  items: AiLogItem[];
  pagination: Pagination;
}

export const AiLogsPage = () => {
  const [taskType, setTaskType] = useState("");
  const [salonId, setSalonId] = useState("");
  const [querySalonId, setQuerySalonId] = useState("");
  const [data, setData] = useState<AiLogsResponse | null>(null);
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
      if (taskType.trim()) {
        params.set("taskType", taskType.trim());
      }
      if (salonId.trim()) {
        params.set("salonId", salonId.trim());
      }
      const response = await apiGet<AiLogsResponse>(`/api/v1/admin/ai-logs?${params.toString()}`);
      setData(response);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [taskType, salonId]);

  const onFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSalonId(querySalonId);
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <section className="card">
      <h2>AI logs</h2>
      <form className="filters" onSubmit={onFilter}>
        <label className="field compact">
          <span>Task type</span>
          <input
            value={taskType}
            onChange={(event) => setTaskType(event.target.value)}
            placeholder="parse_booking"
          />
        </label>
        <label className="field compact">
          <span>Salon ID</span>
          <input
            value={querySalonId}
            onChange={(event) => setQuerySalonId(event.target.value)}
            placeholder="Optional salon UUID"
          />
        </label>
        <button type="submit" className="button-secondary">
          Apply
        </button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Salon</th>
              <th>Task</th>
              <th>Provider</th>
              <th>Valid</th>
              <th>Confidence</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.createdAt)}</td>
                <td>{item.salon?.name ?? "-"}</td>
                <td>{item.taskType}</td>
                <td>{item.provider}</td>
                <td>{item.isValid ? "Yes" : "No"}</td>
                <td>{item.confidence ?? "-"}</td>
                <td>
                  <Link to={`/ai-logs/${item.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
