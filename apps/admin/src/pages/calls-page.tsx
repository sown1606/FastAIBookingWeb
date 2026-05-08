import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import type { Pagination } from "../types";
import { formatDateTime } from "../lib/format";
import { getStatusLabel, useI18n } from "../lib/i18n";

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

export const CallsPage = () => {
  const { t } = useI18n();
  const [status, setStatus] = useState("");
  const [salonId, setSalonId] = useState("");
  const [querySalon, setQuerySalon] = useState("");
  const [data, setData] = useState<CallsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
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
                  <tr key={item.id}>
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
        ) : (
          <EmptyBlock message={t("calls.empty")} />
        )}
      </section>
    </div>
  );
};
