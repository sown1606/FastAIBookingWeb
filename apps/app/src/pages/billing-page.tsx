import { useEffect, useState } from "react";
import { apiGet, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { formatCurrencyCents, formatDateTime } from "../lib/format";
import { useI18n } from "../lib/i18n";

interface BillingUsage {
  currentUsage: {
    freeStaffLimit: number;
    activeStaffCount: number;
    includedStaffCount: number;
    billableExtraStaffCount: number;
    extraStaffUnitPriceCents: number;
    estimatedExtraCostCents: number;
  };
  history: Array<{
    periodStart: string;
    periodEnd: string;
    activeStaffCount: number;
    billableExtraStaffCount: number;
    estimatedExtraCostCents: number;
  }>;
}

export const BillingPage = () => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<BillingUsage | null>(null);

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await apiGet<BillingUsage>("/api/v1/billing/usage?historyLimit=12");
      setUsage(result);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  if (!usage) {
    return <ErrorBlock message={t("billing.loadError")} onRetry={load} />;
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>{t("billing.current")}</h2>
        <p className="muted">{t("billing.rule")}</p>
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("billing.freeStaff")}</span>
            <strong>{usage.currentUsage.freeStaffLimit}</strong>
          </div>
          <div>
            <span className="muted">{t("billing.activeStaff")}</span>
            <strong>{usage.currentUsage.activeStaffCount}</strong>
          </div>
          <div>
            <span className="muted">{t("billing.billableStaff")}</span>
            <strong>{usage.currentUsage.billableExtraStaffCount}</strong>
          </div>
          <div>
            <span className="muted">{t("billing.unitPrice")}</span>
            <strong>{formatCurrencyCents(usage.currentUsage.extraStaffUnitPriceCents)}</strong>
          </div>
          <div>
            <span className="muted">{t("billing.estimated")}</span>
            <strong>{formatCurrencyCents(usage.currentUsage.estimatedExtraCostCents)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{t("billing.history")}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("billing.periodStart")}</th>
                <th>{t("billing.periodEnd")}</th>
                <th>{t("billing.activeStaff")}</th>
                <th>{t("billing.billableStaff")}</th>
                <th>{t("billing.estimated")}</th>
              </tr>
            </thead>
            <tbody>
              {usage.history.map((entry) => (
                <tr key={`${entry.periodStart}-${entry.periodEnd}`}>
                  <td>{formatDateTime(entry.periodStart)}</td>
                  <td>{formatDateTime(entry.periodEnd)}</td>
                  <td>{entry.activeStaffCount}</td>
                  <td>{entry.billableExtraStaffCount}</td>
                  <td>{formatCurrencyCents(entry.estimatedExtraCostCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
