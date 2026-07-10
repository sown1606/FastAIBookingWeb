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
  const [taskType, setTaskType] = useState("");
  const [salonId, setSalonId] = useState("");
  const [querySalonId, setQuerySalonId] = useState("");
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  const [includeSynthetic, setIncludeSynthetic] = useState(true);
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

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  const groupedItems = groupAiLogsByCall(data?.items ?? []);

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
              {groupedItems.map((group) => {
                const item = group.latest;
                return (
                <tr key={group.key}>
                  <td>
                    <div>{formatDateTime(group.lastTurnAt)}</div>
                    <small className="muted">
                      {group.turnCount > 1
                        ? `${group.turnCount} AI turns since ${formatDateTime(group.firstTurnAt)}`
                        : "1 AI turn"}
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
      ) : (
        <EmptyBlock message={t("aiLogs.empty")} />
      )}
    </section>
  );
};
