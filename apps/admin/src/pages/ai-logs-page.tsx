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
import { useI18n } from "../lib/i18n";
import { useRowSelection } from "../lib/use-row-selection";

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
  interactionKey?: string | null;
  isSynthetic?: boolean;
  requestPayload?: unknown;
  responsePayload?: unknown;
  requestText?: string | null;
  responseText?: string | null;
}

interface AiLogsResponse {
  items: AiLogItem[];
  pagination: Pagination;
}

interface PreparedBulkBundle {
  key: string;
  mode: DebugExportMode;
  payload: unknown;
  json: string;
  byteSize: number;
  response: BulkDebugExportResponse;
}

type DebugExportMode = "compact" | "gpt";

interface AiLogCallGroup {
  key: string;
  latest: AiLogItem;
  items: AiLogItem[];
  turnCount: number;
  firstTurnAt: string;
  lastTurnAt: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const readNestedRecord = (value: unknown, key: string): Record<string, unknown> => asRecord(asRecord(value)[key]);

const readContactId = (item: AiLogItem): string => {
  const requestPayload = asRecord(item.requestPayload);
  const responsePayload = asRecord(item.responsePayload);
  const requestAttributes = readNestedRecord(requestPayload, "attributes");
  const responseDebug = readNestedRecord(responsePayload, "lexTurnDebug");
  return String(
    item.callSession?.providerCallId ??
      requestPayload.amazonConnectContactId ??
      requestPayload.contactId ??
      requestAttributes.AmazonConnectContactId ??
      requestAttributes.amazonConnectContactId ??
      responseDebug.contactId ??
      item.callSessionId ??
      item.id
  );
};

const readTurnCount = (item: AiLogItem): number => {
  const responsePayload = asRecord(item.responsePayload);
  const turnHistory = responsePayload.turnHistory;
  return Array.isArray(turnHistory) && turnHistory.length ? turnHistory.length : 1;
};

const readTurnTimes = (item: AiLogItem): { first: string; last: string } => {
  const responsePayload = asRecord(item.responsePayload);
  const turnHistory = Array.isArray(responsePayload.turnHistory)
    ? responsePayload.turnHistory.map(asRecord)
    : [];
  const times = turnHistory
    .map((turn) => (typeof turn.createdAt === "string" ? turn.createdAt : ""))
    .filter(Boolean);
  return {
    first: times[0] ?? item.createdAt,
    last: times[times.length - 1] ?? item.createdAt
  };
};

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

const groupAiLogsByCall = (items: AiLogItem[]): AiLogCallGroup[] => {
  const groups = new Map<string, AiLogItem[]>();
  for (const item of items) {
    const key = item.callSession?.id ?? readContactId(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return Array.from(groups.entries())
    .map(([key, groupItems]) => {
      const sorted = [...groupItems].sort(
        (left, right) => new Date(readTurnTimes(right).last).getTime() - new Date(readTurnTimes(left).last).getTime()
      );
      const chronological = [...groupItems].sort(
        (left, right) => new Date(readTurnTimes(left).first).getTime() - new Date(readTurnTimes(right).first).getTime()
      );
      return {
        key,
        latest: sorted[0],
        items: sorted,
        turnCount: groupItems.reduce((total, item) => total + readTurnCount(item), 0),
        firstTurnAt: chronological[0] ? readTurnTimes(chronological[0]).first : readTurnTimes(sorted[0]).first,
        lastTurnAt: readTurnTimes(sorted[0]).last
      };
    })
    .sort((left, right) => new Date(right.lastTurnAt).getTime() - new Date(left.lastTurnAt).getTime());
};

export const AiLogsPage = () => {
  const { t } = useI18n();
  const { notify } = useToast();
  const [taskType, setTaskType] = useState("");
  const [salonId, setSalonId] = useState("");
  const [querySalonId, setQuerySalonId] = useState("");
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  const [includeSynthetic, setIncludeSynthetic] = useState(true);
  const [data, setData] = useState<AiLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [preparedBundle, setPreparedBundle] = useState<PreparedBulkBundle | null>(null);
  const groupedItems = useMemo(() => groupAiLogsByCall(data?.items ?? []), [data]);
  const visibleIds = useMemo(() => groupedItems.map((group) => group.latest.id), [groupedItems]);
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
        "ai-logs",
        selectedVisibleIds.join("|"),
        visibleIds.join("|"),
        taskType,
        salonId,
        search,
        String(includeSynthetic)
      ].join("::"),
    [selectedVisibleIds, visibleIds, taskType, salonId, search, includeSynthetic]
  );

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  useEffect(() => {
    setPreparedBundle(null);
  }, [selectionKey]);

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
      if (includeSynthetic) {
        params.set("includeSynthetic", "true");
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
  }, [taskType, salonId, search, includeSynthetic]);

  const onFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSalonId(querySalonId.trim());
    setSearch(querySearch.trim());
  };

  const prepareSelectedDebugBundle = async (
    mode: DebugExportMode = "compact"
  ): Promise<PreparedBulkBundle | null> => {
    if (!selectedVisibleIds.length) {
      notify("error", t("debugBulk.noRecordsSelected"));
      return null;
    }
    const preparedKey = `${selectionKey}::${mode}`;
    if (preparedBundle?.key === preparedKey) {
      return preparedBundle;
    }

    setBulkActionLoading(true);
    try {
      const response = await apiPost<BulkDebugExportResponse, { ids: string[]; mode: DebugExportMode }>(
        "/api/v1/admin/ai-logs/debug-export",
        {
          ids: selectedVisibleIds,
          mode
        },
        {
          timeout: DEBUG_EXPORT_TIMEOUT_MS
        }
      );
      const payload = buildBulkDebugBundle(response, {
        sourcePage: "ai_logs",
        selection: {
          selectedCount: selectedVisibleIds.length,
          visibleCount: visibleIds.length,
          filters: {
            taskType,
            salonId,
            search,
            includeSynthetic
          }
        }
      });
      const json = stringifyServerDebugBundle(payload);
      const nextPreparedBundle = {
        key: preparedKey,
        mode,
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

  const copySelectedGptDebug = async () => {
    let prepared: PreparedBulkBundle | null;
    try {
      prepared = await prepareSelectedDebugBundle("gpt");
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

    const filename = `fastaibooking-ai-debug-${prepared.response.recordCount}-calls-${toUtcTimestampForFilename(
      new Date(prepared.response.exportedAt)
    )}.json`;
    downloadPreparedJson(filename, prepared.json);
    notify("success", t("debugBulk.exported"));
  };

  const exportSelectedGptDebug = async () => {
    let prepared: PreparedBulkBundle | null;
    try {
      prepared = await prepareSelectedDebugBundle("gpt");
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

    const filename = `fastaibooking-ai-gpt-debug-${prepared.response.recordCount}-calls-${toUtcTimestampForFilename(
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
        "/api/v1/admin/ai-logs/debug-export?download=true",
        {
          ids: selectedVisibleIds,
          mode: "full"
        },
        {
          timeout: DEBUG_EXPORT_TIMEOUT_MS
        }
      );
      const fallbackFilename = `fastaibooking-ai-debug-${selectedVisibleIds.length}-calls-${toUtcTimestampForFilename()}.json`;
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
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={includeSynthetic}
            onChange={(event) => setIncludeSynthetic(event.target.checked)}
          />
          <span>{t("aiLogs.includeSynthetic")}</span>
        </label>
        <button type="submit" className="button-secondary">
          {t("aiLogs.apply")}
        </button>
      </form>
      {groupedItems.length ? (
        <>
        <DebugBulkActions
          selectedCount={selectedVisibleIds.length}
          totalVisible={visibleIds.length}
          busy={bulkActionLoading}
          preparedByteSize={
            preparedBundle?.key.startsWith(`${selectionKey}::`) ? formatDebugByteSize(preparedBundle.byteSize) : undefined
          }
          onSelectAllVisible={selectAllVisible}
          onCopy={copySelectedDebug}
          onExport={exportSelectedDebug}
          onCopyGpt={copySelectedGptDebug}
          onExportGpt={exportSelectedGptDebug}
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
              {groupedItems.map((group) => {
                const item = group.latest;
                return (
                <tr key={group.key} className={selectedIds.has(item.id) ? "is-selected" : undefined}>
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
                      aria-label={`${t("debugBulk.selectRow")} ${readContactId(item)}`}
                    />
                  </td>
                  <td>
                    <div>{formatDateTime(group.lastTurnAt)}</div>
                    <small className="muted">
                      {group.turnCount > 1
                        ? t("aiLogs.turnsSince", {
                            count: group.turnCount,
                            time: formatDateTime(group.firstTurnAt)
                          })
                        : t("aiLogs.oneTurn")}
                    </small>
                  </td>
                  <td>{item.salon?.name ?? t("common.none")}</td>
                  <td>
                    <div>{item.callSession?.providerCallId ?? readContactId(item) ?? t("common.none")}</div>
                    <small className="muted">{item.callSession?.callerPhone ?? item.bookingAttemptId ?? ""}</small>
                  </td>
                  <td>
                    <div>{item.taskType}</div>
                    {item.isSynthetic ? <small className="muted">{t("aiLogs.synthetic")}</small> : null}
                  </td>
                  <td>{item.model ? `${item.provider} / ${item.model}` : item.provider}</td>
                  <td>{item.isValid ? t("common.yes") : t("common.no")}</td>
                  <td>{item.confidence ?? t("common.none")}</td>
                  <td>
                    <Link to={`/ai-logs/${item.id}`}>{t("common.open")}</Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <EmptyBlock message={t("aiLogs.empty")} />
      )}
    </section>
  );
};
