import { FormEvent, useEffect, useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { useToast } from "../components/toast";
import { getCountryOptions, getTimezoneOptions } from "../lib/form-options";
import { formatUsPhoneInput, requiredLabel, validateOptionalUsPhone } from "../lib/phone";
import { useI18n } from "../lib/i18n";
import { AuthFrame } from "./auth-frame";

type BillingPlanCode = "ai_reception" | "human_reception";

interface RegistrationBillingConfig {
  ready: boolean;
  publishableKey: string | null;
  trialDays: number;
  requiredCardBrand: "visa";
  plans: Array<{
    code: BillingPlanCode;
    name: string;
    monthlyPriceCents: number;
    trialDays: number;
    operatorTransferIncluded: boolean;
    ready: boolean;
  }>;
}

interface SetupIntentResponse {
  setupIntentId: string;
  clientSecret: string;
}

interface RegistrationPaymentStepProps {
  plan: RegistrationBillingConfig["plans"][number];
  submitting: boolean;
  error: string;
  onBack: () => void;
  onComplete: (setupIntentId: string) => Promise<void>;
}

const RegistrationPaymentStep = ({
  plan,
  submitting,
  error,
  onBack,
  onComplete
}: RegistrationPaymentStepProps) => {
  const stripe = useStripe();
  const elements = useElements();
  const { t } = useI18n();
  const [consented, setConsented] = useState(false);
  const [cardError, setCardError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCardError("");
    if (!stripe || !elements || !consented) {
      return;
    }

    const result = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/register`
      },
      redirect: "if_required"
    });
    if (result.error) {
      setCardError(result.error.message ?? t("auth.register.cardFailed"));
      return;
    }
    if (!result.setupIntent || result.setupIntent.status !== "succeeded") {
      setCardError(t("auth.register.cardFailed"));
      return;
    }
    await onComplete(result.setupIntent.id);
  };

  return (
    <form className="form-grid registration-payment" onSubmit={onSubmit}>
      <div className="registration-plan-summary">
        <span>{t("auth.register.selectedPlan")}</span>
        <strong>
          {plan.name} · ${(plan.monthlyPriceCents / 100).toFixed(0)}/{t("pricing.month")}
        </strong>
        <small>{t("auth.register.trialSummary", { days: plan.trialDays })}</small>
      </div>
      <div className="stripe-payment-element">
        <PaymentElement
          options={{
            layout: "tabs",
            paymentMethodOrder: ["card"]
          }}
        />
      </div>
      <label className="registration-consent">
        <input
          type="checkbox"
          checked={consented}
          onChange={(event) => setConsented(event.target.checked)}
          required
        />
        <span>
          {t("auth.register.billingConsent", {
            days: plan.trialDays,
            price: `$${(plan.monthlyPriceCents / 100).toFixed(0)}`
          })}
        </span>
      </label>
      {cardError || error ? <div className="form-error">{cardError || error}</div> : null}
      <div className="form-actions registration-payment-actions">
        <button type="button" className="button-secondary" onClick={onBack} disabled={submitting}>
          {t("common.back")}
        </button>
        <button
          type="submit"
          className="button-primary"
          disabled={!stripe || !elements || !consented || submitting}
        >
          {submitting ? t("auth.register.activating") : t("auth.register.startTrial")}
        </button>
      </div>
    </form>
  );
};

export const RegisterPage = () => {
  const navigate = useNavigate();
  const { registerOwner } = useAuth();
  const { notify } = useToast();
  const { t } = useI18n();
  const timezoneOptions = getTimezoneOptions(t);
  const countryOptions = getCountryOptions(t);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [billingConfig, setBillingConfig] = useState<RegistrationBillingConfig | null>(null);
  const [billingConfigError, setBillingConfigError] = useState("");
  const [setupIntent, setSetupIntent] = useState<SetupIntentResponse | null>(null);

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    salonName: "",
    salonEmail: "",
    salonPhone: "",
    timezone: "America/New_York",
    city: "",
    state: "",
    postalCode: "",
    country: "US",
    planCode: "ai_reception" as BillingPlanCode
  });

  useEffect(() => {
    let active = true;
    void apiGet<RegistrationBillingConfig>("/api/v1/billing/registration-config")
      .then((config) => {
        if (active) {
          setBillingConfig(config);
          setForm((current) => {
            const currentPlanReady = config.plans.some(
              (plan) => plan.code === current.planCode && plan.ready
            );
            const firstReadyPlan = config.plans.find((plan) => plan.ready);
            return currentPlanReady || !firstReadyPlan
              ? current
              : { ...current, planCode: firstReadyPlan.code };
          });
        }
      })
      .catch((loadError) => {
        if (active) {
          setBillingConfigError(extractErrorMessage(loadError));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const stripePromise = useMemo(
    () =>
      billingConfig?.ready && billingConfig.publishableKey
        ? loadStripe(billingConfig.publishableKey)
        : null,
    [billingConfig]
  );
  const selectedPlan = billingConfig?.plans.find((plan) => plan.code === form.planCode) ?? null;

  const onChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const onContinueToCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!validateOptionalUsPhone(form.phone) || !validateOptionalUsPhone(form.salonPhone)) {
      setError(t("form.phoneInvalid"));
      return;
    }
    if (!billingConfig?.ready || !stripePromise) {
      setError(t("auth.register.billingUnavailable"));
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiPost<
        SetupIntentResponse,
        { email: string; planCode: BillingPlanCode }
      >("/api/v1/billing/registration/setup-intent", {
        email: form.email,
        planCode: form.planCode
      });
      setSetupIntent(result);
    } catch (submitError) {
      const message = extractErrorMessage(submitError);
      setError(message);
      notify("error", message);
    } finally {
      setSubmitting(false);
    }
  };

  const onCompleteRegistration = async (setupIntentId: string) => {
    setError("");
    setSubmitting(true);
    try {
      const registration = await registerOwner({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
        planCode: form.planCode,
        setupIntentId,
        billingConsentAccepted: true,
        salon: {
          name: form.salonName,
          contactEmail: form.salonEmail || undefined,
          contactPhone: form.salonPhone || undefined,
          timezone: form.timezone,
          city: form.city || undefined,
          state: form.state || undefined,
          postalCode: form.postalCode || undefined,
          country: form.country || undefined
        }
      });
      if (
        registration.phoneProvisioning?.status === "ACTIVE" &&
        registration.phoneProvisioning.phoneNumber
      ) {
        notify("success", t("auth.register.success"));
        navigate("/dashboard");
      } else {
        notify("info", t("auth.register.phonePending"));
        navigate("/billing");
      }
    } catch (submitError) {
      const message = extractErrorMessage(submitError);
      setError(message);
      notify("error", message);
    } finally {
      setSubmitting(false);
    }
  };

  if (setupIntent && stripePromise && selectedPlan) {
    return (
      <AuthFrame wide>
        <div className="auth-heading">
          <h1>{t("auth.register.addVisaTitle")}</h1>
          <p className="muted">{t("auth.register.addVisaHelper")}</p>
        </div>
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret: setupIntent.clientSecret,
            appearance: {
              theme: "stripe",
              variables: {
                colorPrimary: "#7c3aed",
                borderRadius: "10px"
              }
            }
          }}
        >
          <RegistrationPaymentStep
            plan={selectedPlan}
            submitting={submitting}
            error={error}
            onBack={() => {
              setError("");
              setSetupIntent(null);
            }}
            onComplete={onCompleteRegistration}
          />
        </Elements>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame wide>
      <div className="auth-heading">
        <h1>{t("auth.register.title")}</h1>
        <p className="muted">{t("auth.register.helper")}</p>
      </div>
      {!billingConfigError && !billingConfig ? (
        <div className="notice">{t("auth.register.loadingBilling")}</div>
      ) : null}
      {billingConfigError || (billingConfig && !billingConfig.ready) ? (
        <div className="form-error">
          {billingConfigError || t("auth.register.billingUnavailable")}
        </div>
      ) : null}
      <form className="form-grid two-columns" onSubmit={onContinueToCard}>
        <div className="form-section-title">
          <strong>{t("auth.register.ownerInfo")}</strong>
        </div>
        <label className="field">
          <span>{requiredLabel(t("auth.register.ownerName"))}</span>
          <input
            value={form.fullName}
            onChange={(event) => onChange("fullName", event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>{requiredLabel(t("common.email"))}</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => onChange("email", event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>{t("auth.register.ownerPhone")}</span>
          <input
            type="tel"
            inputMode="tel"
            placeholder="(212) 555-0100"
            value={form.phone}
            onChange={(event) => onChange("phone", formatUsPhoneInput(event.target.value))}
            aria-describedby="owner-phone-hint"
          />
          <small id="owner-phone-hint">{t("form.phoneHint")}</small>
        </label>
        <label className="field">
          <span>{requiredLabel(t("auth.login.password"))}</span>
          <input
            type="password"
            minLength={8}
            value={form.password}
            onChange={(event) => onChange("password", event.target.value)}
            required
          />
          <small>{t("auth.register.passwordHint")}</small>
        </label>

        <div className="form-section-title">
          <strong>{t("auth.register.salonInfo")}</strong>
        </div>
        <label className="field">
          <span>{requiredLabel(t("auth.register.salonName"))}</span>
          <input
            value={form.salonName}
            onChange={(event) => onChange("salonName", event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>{t("auth.register.salonEmail")}</span>
          <input
            type="email"
            value={form.salonEmail}
            onChange={(event) => onChange("salonEmail", event.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("auth.register.salonPhone")}</span>
          <input
            type="tel"
            inputMode="tel"
            placeholder="(212) 555-0100"
            value={form.salonPhone}
            onChange={(event) => onChange("salonPhone", formatUsPhoneInput(event.target.value))}
          />
          <small>{t("form.phoneHint")}</small>
        </label>
        <label className="field">
          <span>{requiredLabel(t("common.timezone"))}</span>
          <select
            value={form.timezone}
            onChange={(event) => onChange("timezone", event.target.value)}
            required
          >
            {timezoneOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("common.city")}</span>
          <input value={form.city} onChange={(event) => onChange("city", event.target.value)} />
        </label>
        <label className="field">
          <span>{t("common.state")}</span>
          <input value={form.state} onChange={(event) => onChange("state", event.target.value)} />
        </label>
        <label className="field">
          <span>{t("common.postalCode")}</span>
          <input
            value={form.postalCode}
            onChange={(event) => onChange("postalCode", event.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("common.country")}</span>
          <select value={form.country} onChange={(event) => onChange("country", event.target.value)}>
            {countryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="form-section-title">
          <strong>{t("auth.register.choosePlan")}</strong>
        </div>
        <div className="registration-plan-grid">
          {(billingConfig?.plans ?? []).map((plan) => (
            <label
              className={`registration-plan-card ${form.planCode === plan.code ? "selected" : ""} ${!plan.ready ? "disabled" : ""}`}
              key={plan.code}
            >
              <input
                type="radio"
                name="planCode"
                value={plan.code}
                checked={form.planCode === plan.code}
                disabled={!plan.ready}
                onChange={() => onChange("planCode", plan.code)}
              />
              <strong>{plan.name}</strong>
              <span>
                ${(plan.monthlyPriceCents / 100).toFixed(0)}/{t("pricing.month")}
              </span>
              <small>{t("auth.register.trialSummary", { days: plan.trialDays })}</small>
              <small>
                {plan.operatorTransferIncluded
                  ? t("auth.register.planOperatorFeature")
                  : t("auth.register.planAiFeature")}
              </small>
            </label>
          ))}
        </div>

        {error ? <div className="form-error">{error}</div> : null}
        <div className="form-actions">
          <button
            type="submit"
            className="button-primary"
            disabled={submitting || !billingConfig?.ready || !selectedPlan?.ready}
          >
            {submitting ? t("auth.register.preparingCard") : t("auth.register.continueToVisa")}
          </button>
        </div>
      </form>
      <div className="auth-links">
        <Link to="/login">{t("auth.login.back")}</Link>
      </div>
    </AuthFrame>
  );
};
