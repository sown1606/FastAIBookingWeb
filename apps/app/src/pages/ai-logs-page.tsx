import { FormEvent, Fragment, useEffect, useState, type ReactNode } from "react";
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
}

interface AiLogDetail {
  id: string;
  taskType: string;
  provider: string;
  model: string | null;
  confidence: number | null;
  requestText: string | null;
  responseText: string | null;
  requestPayload: unknown;
  responsePayload: unknown;
  parsedOutput: unknown;
  isValid: boolean;
  validationErrors: unknown;
  createdAt: string;
  bookingAttemptId?: string | null;
  callSessionId?: string | null;
  bookingAttempt?: { id: string } | null;
  callSession?: { id: string; providerCallId?: string | null; callerPhone?: string | null } | null;
}

type AiLogExportItem = Pick<
  AiLogDetail,
  | "id"
  | "requestText"
  | "responseText"
  | "requestPayload"
  | "responsePayload"
  | "parsedOutput"
  | "validationErrors"
  | "createdAt"
  | "taskType"
  | "provider"
  | "model"
  | "confidence"
  | "bookingAttemptId"
  | "callSessionId"
>;

const formatJson = (value: unknown) => JSON.stringify(value ?? null, null, 2);

const DetailSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="ai-log-detail-section">
    <h3>{title}</h3>
    {children}
  </div>
);

export const AiLogsPage = () => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<AiLogItem[]>([]);
  const [selected, setSelected] = useState<AiLogDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");

  const loadDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoadingId(id);
    try {
      const detail = await apiGet<AiLogDetail>(`/api/v1/ai/interactions/${id}`);
      setSelected(detail);
    } finally {
      setDetailLoadingId(null);
    }
  };

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "50"
      });
      if (search.trim()) {
        params.set("q", search.trim());
      }
      const response = await apiGet<AiLogsResponse>(`/api/v1/ai/interactions?${params.toString()}`);
      setLogs(response.items);
      const nextId = selectedId ?? selected?.id ?? response.items[0]?.id;
      if (nextId) {
        await loadDetail(nextId);
      } else {
        setSelected(null);
        setSelectedId(null);
      }
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [search]);

  const onFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearch(querySearch.trim());
  };

  const openLog = async (id: string) => {
    try {
      await loadDetail(id);
    } catch (detailError) {
      setError(extractErrorMessage(detailError));
    }
  };

  const exportAll = async () => {
    setError("");
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) {
        params.set("q", search.trim());
      }
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const items = await apiGet<AiLogExportItem[]>(`/api/v1/ai/interactions/export${suffix}`);
      const blob = new Blob([JSON.stringify(items, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ai-interactions-${new Date().toISOString()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(extractErrorMessage(exportError));
    } finally {
      setExporting(false);
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
          <button type="button" className="button-secondary" onClick={() => void exportAll()} disabled={exporting}>
            {exporting ? t("common.loading") : "Export All JSON"}
          </button>
        </div>
        <form className="filters" onSubmit={onFilter}>
          <label className="field compact">
            <span>{t("aiLogs.search")}</span>
            <input
              value={querySearch}
              onChange={(event) => setQuerySearch(event.target.value)}
              placeholder={t("aiLogs.searchPlaceholder")}
            />
          </label>
          <button type="submit" className="button-secondary">
            {t("common.search")}
          </button>
        </form>
        {logs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("calls.created")}</th>
                  <th>{t("aiLogs.search")}</th>
                  <th>{t("aiLogs.task")}</th>
                  <th>{t("aiLogs.provider")}</th>
                  <th>{t("aiLogs.valid")}</th>
                  <th>{t("aiLogs.confidence")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <Fragment key={log.id}>
                    <tr
                      className={selectedId === log.id ? "ai-log-row ai-log-row-selected" : "ai-log-row"}
                      onClick={() => void openLog(log.id)}
                    >
                      <td>{formatDateTime(log.createdAt)}</td>
                      <td>
                        <div>{log.callSession?.providerCallId ?? log.callSessionId ?? t("common.none")}</div>
                        <small className="muted">{log.callSession?.callerPhone ?? log.bookingAttemptId ?? ""}</small>
                      </td>
                      <td>{log.taskType}</td>
                      <td>{log.model ? `${log.provider} / ${log.model}` : log.provider}</td>
                      <td>{log.isValid ? t("common.enabled") : t("common.disabled")}</td>
                      <td>{log.confidence ?? t("common.none")}</td>
                      <td>
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={(event) => {
                            event.stopPropagation();
                            void openLog(log.id);
                          }}
                        >
                          {t("aiLogs.open")}
                        </button>
                      </td>
                    </tr>
                    {selectedId === log.id ? (
                      <tr className="ai-log-detail-row">
                        <td colSpan={7}>
                          {detailLoadingId === log.id || !selected || selected.id !== log.id ? (
                            <div className="muted">{t("common.loading")}</div>
                          ) : (
                            <div className="ai-log-detail">
                              <div className="muted">
                                {selected.taskType} · {formatDateTime(selected.createdAt)} ·{" "}
                                {selected.model ? `${selected.provider} / ${selected.model}` : selected.provider}
                              </div>
                              <div className="ai-log-detail-meta">
                                <span>Confidence: {selected.confidence ?? t("common.none")}</span>
                                <span>
                                  Booking attempt:{" "}
                                  {selected.bookingAttemptId ?? selected.bookingAttempt?.id ?? t("common.none")}
                                </span>
                                <span>
                                  Call session:{" "}
                                  {selected.callSession?.providerCallId ??
                                    selected.callSessionId ??
                                    selected.callSession?.id ??
                                    t("common.none")}
                                </span>
                              </div>
                              <div className="ai-log-detail-grid">
                                <DetailSection title={t("aiLogs.requestText")}>
                                  <pre>{selected.requestText ?? t("common.none")}</pre>
                                </DetailSection>
                                <DetailSection title={t("aiLogs.responseText")}>
                                  <pre>{selected.responseText ?? t("common.none")}</pre>
                                </DetailSection>
                                <DetailSection title="Request payload">
                                  <pre>{formatJson(selected.requestPayload)}</pre>
                                </DetailSection>
                                <DetailSection title="Response payload">
                                  <pre>{formatJson(selected.responsePayload)}</pre>
                                </DetailSection>
                                <DetailSection title={t("aiLogs.parsedOutput")}>
                                  <pre>{formatJson(selected.parsedOutput)}</pre>
                                </DetailSection>
                                <DetailSection title={t("aiLogs.validationErrors")}>
                                  <pre>{formatJson(selected.validationErrors)}</pre>
                                </DetailSection>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message={t("aiLogs.empty")} />
        )}
      </section>
    </div>
  );
};
