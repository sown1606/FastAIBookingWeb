import { useEffect, useState } from "react";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
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
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<AiLogItem[]>([]);
  const [selected, setSelected] = useState<AiLogDetail | null>(null);

  const loadDetail = async (id: string) => {
    const detail = await apiGet<AiLogDetail>(`/api/v1/ai/interactions/${id}`);
    setSelected(detail);
  };

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await apiGet<AiLogsResponse>("/api/v1/ai/interactions?page=1&limit=50");
      setLogs(response.items);
      const nextId = selected?.id ?? response.items[0]?.id;
      if (nextId) {
        await loadDetail(nextId);
      } else {
        setSelected(null);
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
      await loadDetail(id);
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
        <div className="section-header">
          <div>
            <h2>{t("nav.aiLogs")}</h2>
            <p className="muted">{t("aiLogs.hint")}</p>
          </div>
        </div>
        {logs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("calls.created")}</th>
                  <th>{t("aiLogs.task")}</th>
                  <th>{t("aiLogs.provider")}</th>
                  <th>{t("aiLogs.valid")}</th>
                  <th>{t("aiLogs.confidence")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>{log.taskType}</td>
                    <td>{log.model ? `${log.provider} / ${log.model}` : log.provider}</td>
                    <td>{log.isValid ? t("common.enabled") : t("common.disabled")}</td>
                    <td>{log.confidence ?? t("common.none")}</td>
                    <td>
                      <button type="button" className="button-secondary" onClick={() => void openLog(log.id)}>
                        {t("aiLogs.open")}
                      </button>
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

      <section className="card">
        <h2>{t("aiLogs.detailTitle")}</h2>
        {selected ? (
          <div className="stack">
            <div className="muted">
              {selected.taskType} · {formatDateTime(selected.createdAt)}
            </div>
            <h3>{t("aiLogs.requestText")}</h3>
            <pre>{selected.requestText ?? t("common.none")}</pre>
            <h3>{t("aiLogs.responseText")}</h3>
            <pre>{selected.responseText ?? t("common.none")}</pre>
            <h3>{t("aiLogs.parsedOutput")}</h3>
            <pre>{JSON.stringify(selected.parsedOutput ?? null, null, 2)}</pre>
            <h3>{t("aiLogs.validationErrors")}</h3>
            <pre>{JSON.stringify(selected.validationErrors ?? null, null, 2)}</pre>
          </div>
        ) : (
          <EmptyBlock message={t("aiLogs.select")} />
        )}
      </section>
    </div>
  );
};
