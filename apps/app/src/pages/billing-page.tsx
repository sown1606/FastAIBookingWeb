import { FormEvent, useEffect, useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { formatCurrencyCents, formatDateTime } from "../lib/format";
import { statusLabelKey, useI18n } from "../lib/i18n";
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
  status: "PENDING_PAYMENT" | "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED";
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

interface RegistrationBillingConfig {
  ready: boolean;
  publishableKey: string | null;
  trialDays: number;
}

interface SetupIntentResponse {
  setupIntentId: string;
  clientSecret: string;
}

const DeferredPaymentForm = ({
  subscription,
  submitting,
  error,
  onActivate,
  onCancel
}: {
  subscription: SubscriptionBilling;
  submitting: boolean;
  error: string;
  onActivate: (setupIntentId: string) => Promise<void>;
  onCancel: () => void;
}) => {
  const { t } = useI18n();
  const stripe = useStripe();
  const elements = useElements();
  const [consented, setConsented] = useState(false);
  const [cardError, setCardError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCardError("");
    if (!stripe || !elements || !consented) {
      return;
    }
    const result = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/billing` },
      redirect: "if_required"
    });
    if (result.error || result.setupIntent?.status !== "succeeded") {
      setCardError(result.error?.message ?? t("auth.register.cardFailed"));
      return;
    }
    await onActivate(result.setupIntent.id);
  };

  return (
    <form className="form-grid registration-payment" onSubmit={submit}>
      <PaymentElement options={{ layout: "tabs", paymentMethodOrder: ["card"] }} />
      <label className="registration-consent">
        <input
          type="checkbox"
          checked={consented}
          onChange={(event) => setConsented(event.target.checked)}
          required
        />
        <span>
          {t("auth.register.billingConsent", {
            days: 30,
            price: formatCurrencyCents(subscription.basePriceCents)
          })}
        </span>
      </label>
      {cardError || error ? <div className="form-error">{cardError || error}</div> : null}
      <div className="form-actions registration-payment-actions">
        <button type="button" className="button-secondary" onClick={onCancel} disabled={submitting}>
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          className="button-primary"
          disabled={!stripe || !elements || !consented || submitting}
        >
          {submitting ? t("billing.activatingPayment") : t("billing.startTrial")}
        </button>
      </div>
    </form>
  );
};

export const BillingPage = () => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [billing, setBilling] = useState<BillingUsageResponse | null>(null);
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionResponse | null>(null);
  const [retryingPhone, setRetryingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [billingConfig, setBillingConfig] = useState<RegistrationBillingConfig | null>(null);
  const [setupIntent, setSetupIntent] = useState<SetupIntentResponse | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const stripePromise = useMemo(
    () =>
      billingConfig?.ready && billingConfig.publishableKey
        ? loadStripe(billingConfig.publishableKey)
        : null,
    [billingConfig]
  );

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
      if (subscriptionResult.subscription?.status === "PENDING_PAYMENT") {
        try {
          setBillingConfig(
            await apiGet<RegistrationBillingConfig>("/api/v1/billing/registration-config")
          );
        } catch {
          setBillingConfig(null);
        }
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

  const beginPaymentSetup = async () => {
    setPaymentBusy(true);
    setPaymentError("");
    try {
      setSetupIntent(
        await apiPost<SetupIntentResponse>("/api/v1/billing/payment-method/setup-intent")
      );
    } catch (setupError) {
      setPaymentError(extractErrorMessage(setupError));
    } finally {
      setPaymentBusy(false);
    }
  };

  const activatePayment = async (setupIntentId: string) => {
    setPaymentBusy(true);
    setPaymentError("");
    try {
      const next = await apiPost<SubscriptionResponse, { setupIntentId: string }>(
        "/api/v1/billing/payment-method/activate",
        { setupIntentId },
        { timeout: 45_000 }
      );
      setSubscriptionData(next);
      setSetupIntent(null);
    } catch (activationError) {
      setPaymentError(extractErrorMessage(activationError));
    } finally {
      setPaymentBusy(false);
    }
  };

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
              <strong>
                {statusLabelKey(subscription.status)
                  ? t(statusLabelKey(subscription.status)!)
                  : subscription.status}
              </strong>
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
          {subscription.status === "PENDING_PAYMENT" ? (
            <div className="stack compact-stack">
              <div className="notice">{t("billing.paymentReminder")}</div>
              {setupIntent && stripePromise ? (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret: setupIntent.clientSecret,
                    appearance: { theme: "stripe" }
                  }}
                >
                  <DeferredPaymentForm
                    subscription={subscription}
                    submitting={paymentBusy}
                    error={paymentError}
                    onActivate={activatePayment}
                    onCancel={() => {
                      setPaymentError("");
                      setSetupIntent(null);
                    }}
                  />
                </Elements>
              ) : (
                <div className="form-actions">
                  <button
                    type="button"
                    className="button-primary"
                    disabled={paymentBusy || !stripePromise}
                    onClick={() => void beginPaymentSetup()}
                  >
                    {paymentBusy ? t("billing.preparingPayment") : t("billing.addVisa")}
                  </button>
                </div>
              )}
              {paymentError && !setupIntent ? <div className="form-error">{paymentError}</div> : null}
              {!stripePromise ? <small className="muted">{t("billing.paymentUnavailable")}</small> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {subscription?.status !== "PENDING_PAYMENT" ? <section className="card">
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
      </section> : (
        <section className="card">
          <h2>{t("billing.phoneTitle")}</h2>
          <p className="muted">{t("billing.phoneAfterPayment")}</p>
        </section>
      )}

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
