import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost, apiPostBlob, extractErrorMessage } from "../lib/api";
import { DebugBulkActions } from "../components/debug-bulk-actions";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import type { Pagination } from "../types";
import { copyTextToClipboard } from "../lib/clipboard";
import {
  buildBulkDebugBundle,
  formatDebugByteSize,
  getJsonByteSize,
  stringifyServerDebugBundle,
  type BulkDebugExportResponse
} from "../lib/debug-export";
import {
  downloadBlobFile,
  downloadPreparedJson,
  toUtcTimestampForFilename
} from "../lib/download-json";
import { formatDateTime } from "../lib/format";
import { getStatusLabel, useI18n } from "../lib/i18n";
import { useRowSelection } from "../lib/use-row-selection";

interface CallItem {
  id: string;
  provider: string;
  providerCallId: string;
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

interface PreparedBulkBundle {
  key: string;
  payload: unknown;
  json: string;
  byteSize: number;
  response: BulkDebugExportResponse;
}

const routingLabelKeyByValue = {
  SALON_RING: "routing.SALON_RING",
  AI_RECEPTION: "routing.AI_RECEPTION",
  CALL_CENTER_ESCALATION: "routing.CALL_CENTER_ESCALATION",
  CALLBACK_REQUEST: "routing.CALLBACK_REQUEST",
  SMS_FALLBACK: "routing.SMS_FALLBACK",
  VOICEMAIL: "routing.VOICEMAIL",
  QUEUED: "routing.QUEUED"
} as const;

const callStatuses = ["", "RECEIVED", "RINGING", "IN_PROGRESS", "COMPLETED", "FAILED", "MISSED", "VOICEMAIL"];
const DEBUG_EXPORT_TIMEOUT_MS = 120_000;

const isTimeoutError = (error: unknown) =>
  /timeout|exceeded/i.test(extractErrorMessage(error)) ||
  (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ECONNABORTED");

const readContentDispositionFilename = (value: unknown, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }
  const filenameMatch = value.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  return filenameMatch?.[1] ? decodeURIComponent(filenameMatch[1].replace(/^"|"$/g, "")) : fallback;
};

export const CallsPage = () => {
  const { t } = useI18n();
  const { notify } = useToast();
  const [status, setStatus] = useState("");
  const [salonId, setSalonId] = useState("");
  const [querySalon, setQuerySalon] = useState("");
  const [data, setData] = useState<CallsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [preparedBundle, setPreparedBundle] = useState<PreparedBulkBundle | null>(null);
  const visibleIds = useMemo(() => data?.items.map((item) => item.id) ?? [], [data]);
  const {
    selectedIds,
    toggleOne,
    selectAllVisible,
    clearAll,
    allVisibleSelected,
    someVisibleSelected
  } = useRowSelection(visibleIds);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const selectedVisibleIds = useMemo(
    () => visibleIds.filter((id) => selectedIds.has(id)),
    [visibleIds, selectedIds]
  );
  const selectionKey = useMemo(
    () =>
      [
        "calls",
        selectedVisibleIds.join("|"),
        visibleIds.join("|"),
        status,
        salonId
      ].join("::"),
    [selectedVisibleIds, visibleIds, status, salonId]
  );

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  useEffect(() => {
    setPreparedBundle(null);
  }, [selectionKey]);

  const translateStatus = (value: string) => {
    const key = getStatusLabel(value);
    return key ? t(key) : value;
  };

  const translateRouting = (value: string | null | undefined) => {
    if (!value) {
      return t("common.none");
    }
    const key = routingLabelKeyByValue[value as keyof typeof routingLabelKeyByValue];
    return key ? t(key) : value;
  };

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

  const metrics = useMemo(() => {
    const items = data?.items ?? [];
    return {
      total: data?.pagination.total ?? items.length,
      escalated: items.filter((item) => item._count.callEscalations > 0).length,
      withAi: items.filter((item) => item._count.transcripts > 0 || item._count.bookingAttempts > 0).length
    };
  }, [data]);

  const prepareSelectedDebugBundle = async (): Promise<PreparedBulkBundle | null> => {
    if (!selectedVisibleIds.length) {
      notify("error", t("debugBulk.noRecordsSelected"));
      return null;
    }
    if (preparedBundle?.key === selectionKey) {
      return preparedBundle;
    }

    setBulkActionLoading(true);
    try {
      const response = await apiPost<BulkDebugExportResponse, { ids: string[]; mode: "compact" }>(
        "/api/v1/admin/calls/debug-export",
        {
          ids: selectedVisibleIds,
          mode: "compact"
        },
        {
          timeout: DEBUG_EXPORT_TIMEOUT_MS
        }
      );
      const payload = buildBulkDebugBundle(response, {
        sourcePage: "call_logs",
        selection: {
          selectedCount: selectedVisibleIds.length,
          visibleCount: visibleIds.length,
          filters: {
            status,
            salonId
          }
        }
      });
      const json = stringifyServerDebugBundle(payload);
      const nextPreparedBundle = {
        key: selectionKey,
        payload,
        json,
        byteSize: getJsonByteSize(json),
        response
      };
      setPreparedBundle(nextPreparedBundle);
      if (response.notFoundIds.length > 0) {
        notify("info", t("debugBulk.someNotFound"));
      }
      return nextPreparedBundle;
    } finally {
      setBulkActionLoading(false);
    }
  };

  const copySelectedDebug = async () => {
    let prepared: PreparedBulkBundle | null;
    try {
      prepared = await prepareSelectedDebugBundle();
    } catch (copyError) {
      notify("error", isTimeoutError(copyError) ? t("debugBulk.timeout") : extractErrorMessage(copyError));
      return;
    }
    if (!prepared) {
      return;
    }

    try {
      await copyTextToClipboard(prepared.json);
      notify("success", t("debugBulk.copied"));
    } catch {
      notify("error", t("debugBulk.copyTooLarge"));
    }
  };

  const exportSelectedDebug = async () => {
    let prepared: PreparedBulkBundle | null;
    try {
      prepared = await prepareSelectedDebugBundle();
    } catch (exportError) {
      notify("error", isTimeoutError(exportError) ? t("debugBulk.timeout") : extractErrorMessage(exportError));
      return;
    }
    if (!prepared) {
      return;
    }
    if (prepared.response.recordCount === 0) {
      notify("error", t("debugBulk.someNotFound"));
      return;
    }

    const filename = `fastaibooking-call-debug-${prepared.response.recordCount}-records-${toUtcTimestampForFilename(
      new Date(prepared.response.exportedAt)
    )}.json`;
    downloadPreparedJson(filename, prepared.json);
    notify("success", t("debugBulk.exported"));
  };

  const exportSelectedFullDebug = async () => {
    if (!selectedVisibleIds.length) {
      notify("error", t("debugBulk.noRecordsSelected"));
      return;
    }

    setBulkActionLoading(true);
    notify("info", t("debugBulk.fullExportWarning"));
    try {
      const response = await apiPostBlob<{ ids: string[]; mode: "full" }>(
        "/api/v1/admin/calls/debug-export?download=true",
        {
          ids: selectedVisibleIds,
          mode: "full"
        },
        {
          timeout: DEBUG_EXPORT_TIMEOUT_MS
        }
      );
      const fallbackFilename = `fastaibooking-call-debug-${selectedVisibleIds.length}-records-${toUtcTimestampForFilename()}.json`;
      const filename = readContentDispositionFilename(response.headers["content-disposition"], fallbackFilename);
      downloadBlobFile(filename, response.data);
      notify("success", t("debugBulk.exported"));
    } catch (exportError) {
      notify("error", isTimeoutError(exportError) ? t("debugBulk.timeout") : extractErrorMessage(exportError));
    } finally {
      setBulkActionLoading(false);
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
            <h2>{t("calls.title")}</h2>
            <p className="muted">{t("calls.hint")}</p>
          </div>
        </div>
        <div className="hero-stats">
          <article className="hero-stat-card">
            <span>{t("calls.flowTitle")}</span>
            <strong>{t("calls.flowValue")}</strong>
          </article>
          <article className="hero-stat-card">
            <span>{t("calls.total")}</span>
            <strong>{metrics.total}</strong>
          </article>
          <article className="hero-stat-card">
            <span>{t("calls.escalations")}</span>
            <strong>{metrics.escalated}</strong>
          </article>
          <article className="hero-stat-card">
            <span>{t("nav.aiLogs")}</span>
            <strong>{metrics.withAi}</strong>
          </article>
        </div>
      </section>

      <section className="card">
        <form className="filters" onSubmit={onFilter}>
          <label className="field compact">
            <span>{t("calls.filterStatus")}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {callStatuses.map((value) => (
                <option key={value || "all"} value={value}>
                  {value ? translateStatus(value) : t("common.all")}
                </option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>{t("calls.filterSalonId")}</span>
            <input
              value={querySalon}
              onChange={(event) => setQuerySalon(event.target.value)}
              placeholder={t("calls.filterSalonPlaceholder")}
            />
          </label>
          <button type="submit" className="button-secondary">
            {t("calls.filterApply")}
          </button>
        </form>

        {data?.items.length ? (
          <>
          <DebugBulkActions
            selectedCount={selectedVisibleIds.length}
            totalVisible={visibleIds.length}
            busy={bulkActionLoading}
            preparedByteSize={
              preparedBundle?.key === selectionKey ? formatDebugByteSize(preparedBundle.byteSize) : undefined
            }
            onSelectAllVisible={selectAllVisible}
            onCopy={copySelectedDebug}
            onExport={exportSelectedDebug}
            onExportFull={exportSelectedFullDebug}
            onClear={clearAll}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="table-checkbox-column">
                    <input
                      ref={selectAllRef}
                      className="row-checkbox"
                      type="checkbox"
                      checked={allVisibleSelected}
                      disabled={!visibleIds.length || bulkActionLoading}
                      onChange={selectAllVisible}
                      aria-label={t("debugBulk.selectAllVisible")}
                    />
                  </th>
                  <th>{t("calls.created")}</th>
                  <th>{t("calls.salon")}</th>
                  <th>{t("calls.provider")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("calls.routing")}</th>
                  <th>{t("calls.caller")}</th>
                  <th>{t("calls.escalations")}</th>
                  <th>{t("calls.resolution")}</th>
                  <th>{t("calls.detail")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className={selectedIds.has(item.id) ? "is-selected" : undefined}>
                    <td className="table-checkbox-column">
                      <input
                        className="row-checkbox"
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        disabled={bulkActionLoading}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          toggleOne(item.id, {
                            shiftKey:
                              event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey
                          })
                        }
                        aria-label={`${t("debugBulk.selectRow")} ${item.providerCallId || item.id}`}
                      />
                    </td>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{item.salon?.name ?? t("common.none")}</td>
                    <td>{item.provider}</td>
                    <td>{translateStatus(item.status)}</td>
                    <td>{translateRouting(item.routingOutcome)}</td>
                    <td>{item.callerPhone ?? t("common.none")}</td>
                    <td>{item._count.callEscalations}</td>
                    <td>{item.finalResolution ?? t("common.none")}</td>
                    <td>
                      <Link to={`/calls/${item.id}`}>{t("common.open")}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <EmptyBlock message={t("calls.empty")} />
        )}
      </section>
    </div>
  );
};
