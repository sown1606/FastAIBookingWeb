import { useEffect, useState } from "react";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { apiGet, extractErrorMessage } from "../lib/api";
import { formatCurrencyCents, formatDateTime } from "../lib/format";
import { useI18n } from "../lib/i18n";

interface BillingUsage {
  periodStart: string;
  periodEnd: string;
  freeStaffLimit: number;
  activeStaffCount: number;
  includedStaffCount: number;
  billableExtraStaffCount: number;
  extraStaffUnitPriceCents: number;
  estimatedExtraCostCents: number;
}

interface BillingUsageResponse {
  currentUsage: BillingUsage;
  history: BillingUsage[];
}

export const BillingPage = () => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [billing, setBilling] = useState<BillingUsageResponse | null>(null);

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await apiGet<BillingUsageResponse>("/api/v1/billing/usage?historyLimit=6");
      setBilling(result);
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

  if (!billing) {
    return <EmptyBlock message={t("billing.empty")} />;
  }

  const { currentUsage } = billing;

  return (
    <div className="stack">
      <section className="card">
        <h2>{t("billing.title")}</h2>
        <p className="muted">{t("billing.hint")}</p>
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("billing.freeStaffLimit")}</span>
            <strong>{currentUsage.freeStaffLimit}</strong>
          </div>
          <div>
            <span className="muted">{t("billing.activeStaff")}</span>
            <strong>{currentUsage.activeStaffCount}</strong>
          </div>
          <div>
            <span className="muted">{t("billing.billableExtraStaff")}</span>
            <strong>{currentUsage.billableExtraStaffCount}</strong>
          </div>
          <div>
            <span className="muted">{t("billing.estimatedExtraCost")}</span>
            <strong>{formatCurrencyCents(currentUsage.estimatedExtraCostCents)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{t("billing.historyTitle")}</h2>
        {billing.history.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("billing.period")}</th>
                  <th>{t("billing.activeStaff")}</th>
                  <th>{t("billing.billableExtraStaff")}</th>
                  <th>{t("billing.estimatedExtraCost")}</th>
                </tr>
              </thead>
              <tbody>
                {billing.history.map((row) => (
                  <tr key={`${row.periodStart}-${row.periodEnd}`}>
                    <td>
                      {formatDateTime(row.periodStart)} - {formatDateTime(row.periodEnd)}
                    </td>
                    <td>{row.activeStaffCount}</td>
                    <td>{row.billableExtraStaffCount}</td>
                    <td>{formatCurrencyCents(row.estimatedExtraCostCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message={t("billing.historyEmpty")} />
        )}
      </section>

      <section className="card">
        <h2>{t("billing.pricingTitle")}</h2>
        <div className="pricing-list">
          <strong>{t("pricing.aiOnly")}</strong>
          <strong>{t("pricing.operatorAddon")}</strong>
          <strong>{t("pricing.trial")}</strong>
        </div>
      </section>
    </div>
  );
};
