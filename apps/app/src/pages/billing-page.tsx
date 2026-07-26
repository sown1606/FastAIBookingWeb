import { useEffect, useState } from "react";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { formatCurrencyCents, formatDateTime } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { formatUsPhoneInput } from "../lib/phone";

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

interface SubscriptionBilling {
  planCode: "ai_reception" | "human_reception";
  basePriceCents: number;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  cancelAtPeriodEnd: boolean;
}

interface PhoneProvisioning {
  status: "PENDING" | "SEARCHING" | "CLAIMING" | "CONFIGURING" | "ACTIVE" | "FAILED";
  phoneNumber: string | null;
  phoneNumberId: string | null;
  contactFlowId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  completedAt: string | null;
}

interface SubscriptionResponse {
  subscription: SubscriptionBilling | null;
  phoneProvisioning: PhoneProvisioning | null;
}

export const BillingPage = () => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [billing, setBilling] = useState<BillingUsageResponse | null>(null);
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionResponse | null>(null);
  const [retryingPhone, setRetryingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const [usageResult, subscriptionResult] = await Promise.all([
        apiGet<BillingUsageResponse>("/api/v1/billing/usage?historyLimit=6"),
        apiGet<SubscriptionResponse>("/api/v1/billing/subscription")
      ]);
      setBilling(usageResult);
      setSubscriptionData(subscriptionResult);
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
  const subscription = subscriptionData?.subscription;
  const phoneProvisioning = subscriptionData?.phoneProvisioning;

  const retryPhoneProvisioning = async () => {
    setRetryingPhone(true);
    setPhoneError("");
    try {
      const next = await apiPost<PhoneProvisioning>(
        "/api/v1/billing/phone-provisioning/retry",
        undefined,
        { timeout: 30_000 }
      );
      setSubscriptionData((current) =>
        current ? { ...current, phoneProvisioning: next } : current
      );
    } catch (retryError) {
      setPhoneError(extractErrorMessage(retryError));
    } finally {
      setRetryingPhone(false);
    }
  };

  return (
    <div className="stack">
      {subscription ? (
        <section className="card">
          <h2>{t("billing.subscriptionTitle")}</h2>
          <div className="metrics-grid">
            <div>
              <span className="muted">{t("billing.plan")}</span>
              <strong>
                {subscription.planCode === "human_reception"
                  ? t("billing.planHuman")
                  : t("billing.planAi")}
              </strong>
            </div>
            <div>
              <span className="muted">{t("billing.monthlyPrice")}</span>
              <strong>{formatCurrencyCents(subscription.basePriceCents)}</strong>
            </div>
            <div>
              <span className="muted">{t("billing.subscriptionStatus")}</span>
              <strong>{subscription.status}</strong>
            </div>
            <div>
              <span className="muted">{t("billing.visaCard")}</span>
              <strong>
                {subscription.paymentMethodLast4
                  ? `Visa •••• ${subscription.paymentMethodLast4}`
                  : t("common.none")}
              </strong>
            </div>
          </div>
          {subscription.trialEndsAt ? (
            <p className="muted">
              {t("billing.trialEnds")} {formatDateTime(subscription.trialEndsAt)}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="card">
        <h2>{t("billing.phoneTitle")}</h2>
        {phoneProvisioning?.status === "ACTIVE" && phoneProvisioning.phoneNumber ? (
          <div className="metrics-grid">
            <div>
              <span className="muted">{t("billing.awsPhone")}</span>
              <strong>{formatUsPhoneInput(phoneProvisioning.phoneNumber)}</strong>
            </div>
            <div>
              <span className="muted">{t("common.status")}</span>
              <strong>{t("billing.phoneReady")}</strong>
            </div>
          </div>
        ) : (
          <>
            <p className="muted">
              {phoneProvisioning?.status === "FAILED"
                ? t("billing.phoneFailed")
                : t("billing.phonePreparing")}
            </p>
            {phoneProvisioning?.lastErrorMessage ? (
              <div className="form-error">{phoneProvisioning.lastErrorMessage}</div>
            ) : null}
            {phoneError ? <div className="form-error">{phoneError}</div> : null}
            <div className="form-actions">
              <button
                type="button"
                className="button-secondary"
                disabled={retryingPhone}
                onClick={() => void retryPhoneProvisioning()}
              >
                {retryingPhone ? t("billing.phoneRetrying") : t("billing.phoneRetry")}
              </button>
            </div>
          </>
        )}
      </section>

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
