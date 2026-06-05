import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import type { Pagination } from "../types";
import { formatDateTime } from "../lib/format";
import { useI18n } from "../lib/i18n";

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
  callSessionId?: string | null;
  callSession?: {
    id: string;
    providerCallId: string;
    callerPhone: string | null;
  } | null;
  bookingAttemptId?: string | null;
}

interface AiLogsResponse {
  items: AiLogItem[];
  pagination: Pagination;
}

export const AiLogsPage = () => {
  const { t } = useI18n();
  const [taskType, setTaskType] = useState("");
  const [salonId, setSalonId] = useState("");
  const [querySalonId, setQuerySalonId] = useState("");
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
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
      if (search.trim()) {
        params.set("q", search.trim());
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
  }, [taskType, salonId, search]);

  const onFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSalonId(querySalonId.trim());
    setSearch(querySearch.trim());
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h2>{t("aiLogs.title")}</h2>
          <p className="muted">{t("aiLogs.hint")}</p>
        </div>
      </div>
      <form className="filters" onSubmit={onFilter}>
        <label className="field compact">
          <span>{t("aiLogs.taskType")}</span>
          <input
            value={taskType}
            onChange={(event) => setTaskType(event.target.value)}
            placeholder={t("aiLogs.filterTaskPlaceholder")}
          />
        </label>
        <label className="field compact">
          <span>{t("calls.filterSalonId")}</span>
          <input
            value={querySalonId}
            onChange={(event) => setQuerySalonId(event.target.value)}
            placeholder={t("aiLogs.filterSalonPlaceholder")}
          />
        </label>
        <label className="field compact">
          <span>{t("aiLogs.search")}</span>
          <input
            value={querySearch}
            onChange={(event) => setQuerySearch(event.target.value)}
            placeholder={t("aiLogs.searchPlaceholder")}
          />
        </label>
        <button type="submit" className="button-secondary">
          {t("aiLogs.apply")}
        </button>
      </form>
      {data?.items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("aiLogs.created")}</th>
                <th>{t("aiLogs.salon")}</th>
                <th>{t("aiLogs.linkedCall")}</th>
                <th>{t("aiLogs.task")}</th>
                <th>{t("aiLogs.provider")}</th>
                <th>{t("aiLogs.valid")}</th>
                <th>{t("aiLogs.confidence")}</th>
                <th>{t("aiLogs.details")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>{item.salon?.name ?? t("common.none")}</td>
                  <td>
                    <div>{item.callSession?.providerCallId ?? item.callSessionId ?? t("common.none")}</div>
                    <small className="muted">{item.callSession?.callerPhone ?? item.bookingAttemptId ?? ""}</small>
                  </td>
                  <td>{item.taskType}</td>
                  <td>{item.model ? `${item.provider} / ${item.model}` : item.provider}</td>
                  <td>{item.isValid ? t("common.yes") : t("common.no")}</td>
                  <td>{item.confidence ?? t("common.none")}</td>
                  <td>
                    <Link to={`/ai-logs/${item.id}`}>{t("common.open")}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyBlock message={t("aiLogs.empty")} />
      )}
    </section>
  );
};
