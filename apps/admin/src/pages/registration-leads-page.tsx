import { useEffect, useState } from "react";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { apiGet, apiPatch, extractErrorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { Pagination } from "../types";

type LeadStatus = "NEW" | "CONTACTED" | "CLOSED";

interface RegistrationLead {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  note: string | null;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
}

interface RegistrationLeadResponse {
  items: RegistrationLead[];
  pagination: Pagination;
}

export const RegistrationLeadsPage = () => {
  const { t } = useI18n();
  const { notify } = useToast();
  const [data, setData] = useState<RegistrationLeadResponse | null>(null);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (status) {
        params.set("status", status);
      }
      setData(
        await apiGet<RegistrationLeadResponse>(
          `/api/v1/admin/registration-leads?${params.toString()}`
        )
      );
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [page, status]);

  const updateStatus = async (id: string, nextStatus: LeadStatus) => {
    setSavingId(id);
    try {
      const updated = await apiPatch<RegistrationLead, { status: LeadStatus }>(
        `/api/v1/admin/registration-leads/${id}`,
        { status: nextStatus }
      );
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === id ? updated : item))
            }
          : current
      );
      notify("success", t("registrationLeads.updated"));
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    } finally {
      setSavingId("");
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }
  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  const pageCount = Math.max(
    Math.ceil((data?.pagination.total ?? 0) / (data?.pagination.limit ?? 20)),
    1
  );

  return (
    <div className="stack">
      <section className="card page-hero">
        <div className="section-header">
          <div>
            <p className="eyebrow">{t("nav.registrationLeads")}</p>
            <h2>{t("registrationLeads.title")}</h2>
            <p className="muted">{t("registrationLeads.hint")}</p>
          </div>
          <span className="status-pill info">
            {t("registrationLeads.count", { count: data?.pagination.total ?? 0 })}
          </span>
        </div>
        <div className="filters">
          <label className="field compact">
            <span>{t("common.status")}</span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">{t("common.all")}</option>
              <option value="NEW">{t("registrationLeads.statusNew")}</option>
              <option value="CONTACTED">{t("registrationLeads.statusContacted")}</option>
              <option value="CLOSED">{t("registrationLeads.statusClosed")}</option>
            </select>
          </label>
        </div>
        {data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("common.createdAt")}</th>
                  <th>{t("common.phone")}</th>
                  <th>{t("common.owner")}</th>
                  <th>{t("common.email")}</th>
                  <th>{t("registrationLeads.note")}</th>
                  <th>{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((lead) => (
                  <tr key={lead.id}>
                    <td>{formatDateTime(lead.createdAt)}</td>
                    <td>
                      <a href={`tel:${lead.phone}`}>{lead.phone}</a>
                    </td>
                    <td>{lead.fullName ?? t("common.none")}</td>
                    <td>{lead.email ?? t("common.none")}</td>
                    <td>{lead.note ?? t("common.none")}</td>
                    <td>
                      <select
                        value={lead.status}
                        disabled={savingId === lead.id}
                        onChange={(event) =>
                          void updateStatus(lead.id, event.target.value as LeadStatus)
                        }
                      >
                        <option value="NEW">{t("registrationLeads.statusNew")}</option>
                        <option value="CONTACTED">
                          {t("registrationLeads.statusContacted")}
                        </option>
                        <option value="CLOSED">{t("registrationLeads.statusClosed")}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message={t("registrationLeads.empty")} />
        )}
        <div className="pagination">
          <button
            type="button"
            className="button-secondary"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(current - 1, 1))}
          >
            {t("salons.prev")}
          </button>
          <span>{t("salons.page", { page, total: pageCount })}</span>
          <button
            type="button"
            className="button-secondary"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            {t("salons.next")}
          </button>
        </div>
      </section>
    </div>
  );
};
