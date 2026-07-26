import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { apiGet, apiPost, apiPut, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import {
  getCountryOptions,
  getCurrencyOptions,
  getLocalePreferenceOptions,
  getTimezoneOptions
} from "../lib/form-options";
import { formatUsPhoneInput, validateOptionalUsPhone } from "../lib/phone";
import { useI18n } from "../lib/i18n";
import { InfoHint } from "../components/info-hint";
import { formatDateTime } from "../lib/format";

interface SalonProfile {
  id: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  originalPhoneNumber: string | null;
  customerIncomingPhoneNumber: string | null;
  notificationPhoneNumber: string | null;
  timezone: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
}

interface SalonSettings {
  currency: string;
  locale: string;
  bookingLeadTimeMinutes: number;
  cancellationPolicy: string | null;
  aiReceptionEnabled: boolean;
  aiTransferRingCount: number;
  callCenterEnabled: boolean;
  aiGreetingPrompt: string | null;
  callerLanguage: string;
  callCenterRoutingNote: string | null;
}

interface AiReceptionConfig {
  status: "not_configured" | "pending" | "active" | "failed";
  carrier: "tmobile" | "att" | "verizon" | "uscellular" | "other";
  carrierLabel: string;
  carrierOptions: Array<{
    value: AiReceptionConfig["carrier"];
    label: string;
  }>;
  originalPhoneNumberFormatted: string | null;
  forwardToNumberFormatted: string | null;
  activationCode: string | null;
  fallbackActivationCode: string | null;
  deactivationCode: string | null;
  statusCheckCode: string | null;
  lastTestedAt: string | null;
  lastVerifiedAt: string | null;
  setupInstructions: string[];
  carrierGuide: {
    summary: string;
    steps: string[];
    verifySteps: string[];
    troubleshooting: string[];
    sourceUrl: string;
  };
  forwardingVerification: {
    status: "verified" | "test_not_observed" | "awaiting_test";
    verified: boolean;
    detail: string;
  };
  operatorTransferIncluded: boolean;
  operatorTransferActive: boolean;
  readiness: {
    awsPhoneReady: boolean;
    lexFlowReady: boolean;
    forwardingVerified: boolean;
    staffReady: boolean;
    servicesReady: boolean;
    activeBookableStaffCount: number;
    activeServiceCount: number;
    readyForCalls: boolean;
  };
}

const aiReceptionStatusClasses: Record<AiReceptionConfig["status"], string> = {
  not_configured: "status-pill warning",
  pending: "status-pill info",
  active: "status-pill success",
  failed: "status-pill warning"
};

export const SalonProfilePage = () => {
  const { session } = useAuth();
  const { notify } = useToast();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiReception, setAiReception] = useState<AiReceptionConfig | null>(null);
  const [selectedCarrier, setSelectedCarrier] =
    useState<AiReceptionConfig["carrier"]>("tmobile");
  const [forwardingBusy, setForwardingBusy] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: "",
    contactEmail: "",
    contactPhone: "",
    originalPhoneNumber: "",
    customerIncomingPhoneNumber: "",
    notificationPhoneNumber: "",
    timezone: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "US"
  });
  const [settingsForm, setSettingsForm] = useState({
    currency: "USD",
    locale: "en-US",
    bookingLeadTimeMinutes: "0",
    cancellationPolicy: "",
    aiReceptionEnabled: false,
    aiTransferRingCount: "3",
    callCenterEnabled: false,
    aiGreetingPrompt: "",
    callerLanguage: "en",
    callCenterRoutingNote: ""
  });

  const salonId = session?.user.salonId ?? null;
  const timezoneOptions = getTimezoneOptions(t);
  const countryOptions = getCountryOptions(t);
  const currencyOptions = getCurrencyOptions(t);
  const localePreferenceOptions = getLocalePreferenceOptions(t);
  const aiReceptionStatusLabels: Record<AiReceptionConfig["status"], string> = {
    not_configured: t("profile.aiStatusNotConfigured"),
    pending: t("profile.aiStatusPending"),
    active: t("profile.aiStatusActive"),
    failed: t("profile.aiStatusFailed")
  };

  const load = async () => {
    if (!salonId) {
      setError(t("profile.missingSalonContext"));
      setLoading(false);
      return;
    }

    setError("");
    setLoading(true);
    try {
      const [profileResult, settingsResult, aiReceptionResult] = await Promise.all([
        apiGet<SalonProfile>("/api/v1/salon/profile"),
        apiGet<SalonSettings>("/api/v1/salon/settings"),
        apiGet<AiReceptionConfig>(`/api/v1/owner/salons/${salonId}/ai-reception`)
      ]);

      setProfileForm({
        name: profileResult.name,
        contactEmail: profileResult.contactEmail ?? "",
        contactPhone: formatUsPhoneInput(profileResult.contactPhone ?? ""),
        originalPhoneNumber: formatUsPhoneInput(profileResult.originalPhoneNumber ?? ""),
        customerIncomingPhoneNumber: formatUsPhoneInput(
          profileResult.customerIncomingPhoneNumber ?? ""
        ),
        notificationPhoneNumber: formatUsPhoneInput(profileResult.notificationPhoneNumber ?? ""),
        timezone: profileResult.timezone,
        addressLine1: profileResult.addressLine1 ?? "",
        addressLine2: profileResult.addressLine2 ?? "",
        city: profileResult.city ?? "",
        state: profileResult.state ?? "",
        postalCode: profileResult.postalCode ?? "",
        country: profileResult.country
      });
      setSettingsForm({
        currency: settingsResult.currency,
        locale: settingsResult.locale,
        bookingLeadTimeMinutes: String(settingsResult.bookingLeadTimeMinutes),
        cancellationPolicy: settingsResult.cancellationPolicy ?? "",
        aiReceptionEnabled: settingsResult.aiReceptionEnabled,
        aiTransferRingCount: String(settingsResult.aiTransferRingCount),
        callCenterEnabled:
          settingsResult.callCenterEnabled && aiReceptionResult.operatorTransferIncluded,
        aiGreetingPrompt: settingsResult.aiGreetingPrompt ?? "",
        callerLanguage: settingsResult.callerLanguage,
        callCenterRoutingNote: settingsResult.callCenterRoutingNote ?? ""
      });
      setAiReception(aiReceptionResult);
      setSelectedCarrier(aiReceptionResult.carrier);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [salonId]);

  const saveRoutingNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiPut("/api/v1/salon/settings", {
        callCenterRoutingNote: settingsForm.callCenterRoutingNote || null
      });
      notify("success", t("profile.settingsSaved"));
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateOptionalUsPhone(profileForm.notificationPhoneNumber)) {
      notify("error", t("profile.phoneValidation"));
      return;
    }

    try {
      await Promise.all([
        apiPut("/api/v1/salon/settings", {
          currency: settingsForm.currency,
          locale: settingsForm.locale,
          bookingLeadTimeMinutes: Number(settingsForm.bookingLeadTimeMinutes),
          cancellationPolicy: settingsForm.cancellationPolicy || null,
          aiReceptionEnabled: settingsForm.aiReceptionEnabled,
          aiTransferRingCount: Number(settingsForm.aiTransferRingCount),
          callCenterEnabled:
            Boolean(aiReception?.operatorTransferIncluded) && settingsForm.callCenterEnabled,
          aiGreetingPrompt: settingsForm.aiGreetingPrompt || null,
          callerLanguage: settingsForm.callerLanguage
        }),
        apiPut("/api/v1/salon/profile", {
          notificationPhoneNumber: profileForm.notificationPhoneNumber || null
        })
      ]);
      notify("success", t("profile.settingsSaved"));
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      ![profileForm.contactPhone, profileForm.originalPhoneNumber].every(validateOptionalUsPhone)
    ) {
      notify("error", t("profile.phoneValidation"));
      return;
    }

    try {
      await apiPut("/api/v1/salon/profile", {
        name: profileForm.name,
        contactEmail: profileForm.contactEmail || null,
        contactPhone: profileForm.contactPhone || null,
        originalPhoneNumber: profileForm.originalPhoneNumber || null,
        timezone: profileForm.timezone,
        addressLine1: profileForm.addressLine1 || null,
        addressLine2: profileForm.addressLine2 || null,
        city: profileForm.city || null,
        state: profileForm.state || null,
        postalCode: profileForm.postalCode || null,
        country: profileForm.country
      });
      notify("success", t("profile.saved"));
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const generateForwardingInstructions = async () => {
    if (!salonId) {
      return;
    }
    if (!validateOptionalUsPhone(profileForm.originalPhoneNumber)) {
      notify("error", t("profile.phoneValidation"));
      return;
    }
    setForwardingBusy(true);
    try {
      const next = await apiPost<
        AiReceptionConfig,
        {
          carrier: AiReceptionConfig["carrier"];
          originalPhoneNumber: string;
        }
      >(`/api/v1/owner/salons/${salonId}/ai-reception/generate-forwarding-code`, {
        carrier: selectedCarrier,
        originalPhoneNumber: profileForm.originalPhoneNumber
      });
      setAiReception(next);
      setSelectedCarrier(next.carrier);
      notify("success", t("profile.aiReceptionCodeGenerated"));
    } catch (generateError) {
      notify("error", extractErrorMessage(generateError));
    } finally {
      setForwardingBusy(false);
    }
  };

  const checkForwardingTest = async () => {
    if (!salonId) {
      return;
    }
    setForwardingBusy(true);
    try {
      const next = await apiPost<AiReceptionConfig>(
        `/api/v1/owner/salons/${salonId}/ai-reception/mark-forwarding-tested`
      );
      setAiReception(next);
      notify(
        next.forwardingVerification.verified ? "success" : "info",
        next.forwardingVerification.verified
          ? t("profile.aiReceptionTestVerified")
          : t("profile.aiReceptionTestPending")
      );
    } catch (testError) {
      notify("error", extractErrorMessage(testError));
    } finally {
      setForwardingBusy(false);
    }
  };

  const openDialer = (code: string) => {
    window.location.href = `tel:${encodeURIComponent(code)}`;
  };

  const copyForwardingCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    notify("success", t("profile.copyCodeSuccess"));
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <div className="stack">
      <section className="card owner-note-card">
        <form className="form-grid" onSubmit={saveRoutingNote}>
          <div>
            <h2>{t("profile.routingNote")}</h2>
            <p className="muted">{t("profile.routingNoteVisibilityHint")}</p>
          </div>
          <label className="field">
            <span>
              {t("profile.routingNote")}
              <InfoHint text={t("hints.routingNote")} />
            </span>
            <textarea
              rows={4}
              value={settingsForm.callCenterRoutingNote}
              placeholder={t("profile.routingNotePlaceholder")}
              onChange={(event) =>
                setSettingsForm((prev) => ({
                  ...prev,
                  callCenterRoutingNote: event.target.value
                }))
              }
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              {t("common.save")}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>{t("profile.settingsTitle")}</h2>
            <p className="muted">{t("profile.businessSettingsHint")}</p>
          </div>
          <Link to="/business-hours" className="button-secondary">
            {t("nav.businessHours")}
          </Link>
        </div>
        <form className="form-grid two-columns" onSubmit={saveSettings}>
          <div className="settings-panel">
            <div>
              <h3>{t("profile.businessDefaults")}</h3>
              <p className="muted">{t("profile.businessDefaultsHint")}</p>
            </div>
            <label className="field">
              <span>{t("profile.currency")}</span>
              <select
                value={settingsForm.currency}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, currency: event.target.value }))
                }
              >
                {currencyOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("profile.locale")}</span>
              <select
                value={settingsForm.locale}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, locale: event.target.value }))
                }
              >
                {localePreferenceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("profile.leadTime")}</span>
              <input
                type="number"
                min={0}
                value={settingsForm.bookingLeadTimeMinutes}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    bookingLeadTimeMinutes: event.target.value
                  }))
                }
              />
            </label>
            <label className="field">
              <span>{t("profile.cancelPolicy")}</span>
              <textarea
                rows={4}
                value={settingsForm.cancellationPolicy}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    cancellationPolicy: event.target.value
                  }))
                }
              />
            </label>
          </div>

          <div className="settings-panel">
            <div>
              <h3>{t("profile.aiReceptionTitle")}</h3>
              <p className="muted">{t("profile.aiReceptionTitleHint")}</p>
            </div>
            <label className="field checkbox-row">
              <span>
                {t("profile.aiForwarding")}
                <InfoHint text={t("hints.aiReception")} />
              </span>
              <input
                type="checkbox"
                checked={settingsForm.aiReceptionEnabled}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    aiReceptionEnabled: event.target.checked
                  }))
                }
              />
            </label>
            <label className="field">
              <span>
                {t("profile.ringCount")}
                <InfoHint text={t("hints.ringCount")} />
              </span>
              <input
                type="number"
                min={1}
                max={10}
                value={settingsForm.aiTransferRingCount}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    aiTransferRingCount: event.target.value
                  }))
                }
              />
            </label>
            <label className="field">
              <span>{t("profile.aiGreetingPrompt")}</span>
              <textarea
                rows={4}
                value={settingsForm.aiGreetingPrompt}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    aiGreetingPrompt: event.target.value
                  }))
                }
              />
            </label>
            <label className="field">
              <span>{t("profile.callerLanguage")}</span>
              <select
                value={settingsForm.callerLanguage}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    callerLanguage: event.target.value
                  }))
                }
              >
                <option value="en">{t("profile.callerLanguageEnglish")}</option>
              </select>
            </label>
          </div>

          <div className="settings-panel">
            <div>
              <h3>{t("profile.callCenterSettings")}</h3>
              <p className="muted">{t("profile.callCenterSettingsHint")}</p>
            </div>
            <label className="field checkbox-row">
              <span>
                {t("profile.callCenterEnabled")}
                <InfoHint text={t("hints.callCenter")} />
              </span>
              <input
                type="checkbox"
                checked={settingsForm.callCenterEnabled}
                disabled={!aiReception?.operatorTransferIncluded}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    callCenterEnabled: event.target.checked
                  }))
                }
              />
              <small>
                {aiReception?.operatorTransferIncluded
                  ? t("profile.operatorIncludedHint")
                  : t("profile.operatorUpgradeHint")}
              </small>
            </label>
            <label className="field">
              <span>{t("profile.notificationPhone")}</span>
              <input
                type="tel"
                inputMode="tel"
                placeholder="(212) 555-0100"
                value={profileForm.notificationPhoneNumber}
                onChange={(event) =>
                  setProfileForm((prev) => ({
                    ...prev,
                    notificationPhoneNumber: formatUsPhoneInput(event.target.value)
                  }))
                }
              />
              <small>{t("profile.notificationPhoneHint")}</small>
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" className="button-primary">
              {t("common.save")}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>{t("profile.title")}</h2>
        <form className="form-grid two-columns" onSubmit={saveProfile}>
          <label className="field">
            <span>{t("profile.salonName")}</span>
            <input
              value={profileForm.name}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, name: event.target.value }))
              }
              required
            />
          </label>
          <label className="field">
            <span>{t("common.timezone")}</span>
            <select
              value={profileForm.timezone}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, timezone: event.target.value }))
              }
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
            <span>{t("profile.contactEmail")}</span>
            <input
              type="email"
              value={profileForm.contactEmail}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, contactEmail: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("profile.contactPhone")}</span>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(212) 555-0100"
              value={profileForm.contactPhone}
              onChange={(event) =>
                setProfileForm((prev) => ({
                  ...prev,
                  contactPhone: formatUsPhoneInput(event.target.value)
                }))
              }
            />
            <small>{t("form.phoneHint")}</small>
          </label>
          <label className="field">
            <span>{t("profile.salonPhone")}</span>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(212) 555-0100"
              value={profileForm.originalPhoneNumber}
              onChange={(event) =>
                setProfileForm((prev) => ({
                  ...prev,
                  originalPhoneNumber: formatUsPhoneInput(event.target.value)
                }))
              }
            />
            <small>{t("profile.currentPhoneHint")}</small>
          </label>
          <label className="field">
            <span>{t("profile.address1")}</span>
            <input
              value={profileForm.addressLine1}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, addressLine1: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("profile.address2")}</span>
            <input
              value={profileForm.addressLine2}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, addressLine2: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("common.city")}</span>
            <input
              value={profileForm.city}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, city: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("common.state")}</span>
            <input
              value={profileForm.state}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, state: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("common.postalCode")}</span>
            <input
              value={profileForm.postalCode}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, postalCode: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("common.country")}</span>
            <select
              value={profileForm.country}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, country: event.target.value }))
              }
            >
              {countryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              {t("common.save")}
            </button>
          </div>
        </form>
      </section>

      {aiReception ? (
        <section className="card">
          <div className="section-header">
            <div>
              <h2>{t("profile.forwardingGuideTitle")}</h2>
              <p className="muted">{t("profile.forwardingGuideHint")}</p>
            </div>
            <span
              className={
                aiReception.forwardingVerification.verified
                  ? "status-pill success"
                  : "status-pill warning"
              }
            >
              {aiReception.forwardingVerification.verified
                ? t("profile.forwardingVerified")
                : t("profile.forwardingNeedsTest")}
            </span>
          </div>

          <div className="metrics-grid">
            <div>
              <span className="muted">{t("profile.awsNumberReady")}</span>
              <strong>
                {aiReception.readiness.awsPhoneReady
                  ? t("common.ready")
                  : t("common.pending")}
              </strong>
            </div>
            <div>
              <span className="muted">{t("profile.lexFlowReady")}</span>
              <strong>
                {aiReception.readiness.lexFlowReady
                  ? t("common.ready")
                  : t("common.pending")}
              </strong>
            </div>
            <div>
              <span className="muted">{t("profile.staffReady")}</span>
              <strong>
                {aiReception.readiness.activeBookableStaffCount} {t("profile.staffCountUnit")}
              </strong>
            </div>
            <div>
              <span className="muted">{t("profile.servicesReady")}</span>
              <strong>
                {aiReception.readiness.activeServiceCount} {t("profile.serviceCountUnit")}
              </strong>
            </div>
          </div>

          <div className="form-grid two-columns">
            <label className="field">
              <span>{t("profile.carrier")}</span>
              <select
                value={selectedCarrier}
                onChange={(event) =>
                  setSelectedCarrier(event.target.value as AiReceptionConfig["carrier"])
                }
              >
                {aiReception.carrierOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>{t("profile.carrierChooseHint")}</small>
            </label>
            <label className="field">
              <span>{t("profile.forwardToNumber")}</span>
              <input value={aiReception.forwardToNumberFormatted ?? ""} readOnly />
              <small>{t("profile.forwardNumberDoNotPort")}</small>
            </label>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="button-primary"
              disabled={forwardingBusy || !profileForm.originalPhoneNumber}
              onClick={() => void generateForwardingInstructions()}
            >
              {forwardingBusy
                ? t("common.loading")
                : t("profile.generateCarrierInstructions")}
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={forwardingBusy}
              onClick={() => void checkForwardingTest()}
            >
              {t("profile.checkTestCall")}
            </button>
          </div>

          <div className="notice">
            <strong>{aiReception.carrierLabel}</strong>
            <p>{aiReception.carrierGuide.summary}</p>
          </div>

          {aiReception.activationCode ? (
            <div className="metrics-grid">
              <div>
                <span className="muted">{t("profile.activationCode")}</span>
                <strong>
                  <code>{aiReception.activationCode}</code>
                </strong>
                <div className="form-actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => openDialer(aiReception.activationCode!)}
                  >
                    {t("profile.openDialer")}
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void copyForwardingCode(aiReception.activationCode!)}
                  >
                    {t("profile.copyCode")}
                  </button>
                </div>
              </div>
              {aiReception.deactivationCode ? (
                <div>
                  <span className="muted">{t("profile.deactivationCode")}</span>
                  <strong>
                    <code>{aiReception.deactivationCode}</code>
                  </strong>
                </div>
              ) : null}
              {aiReception.statusCheckCode ? (
                <div>
                  <span className="muted">{t("profile.statusCheckCode")}</span>
                  <strong>
                    <code>{aiReception.statusCheckCode}</code>
                  </strong>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="two-column-details">
            <div>
              <h3>{t("profile.carrierStepsTitle")}</h3>
              <ol>
                {aiReception.carrierGuide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
            <div>
              <h3>{t("profile.verifyStepsTitle")}</h3>
              <ol>
                {aiReception.carrierGuide.verifySteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </div>

          <div>
            <h3>{t("profile.forwardingTroubleshootingTitle")}</h3>
            <ul>
              {aiReception.carrierGuide.troubleshooting.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <p className="muted">{aiReception.forwardingVerification.detail}</p>
          <p className="muted">
            {t("profile.lastTested")}:{" "}
            {aiReception.lastTestedAt
              ? formatDateTime(aiReception.lastTestedAt)
              : t("common.none")}
            {" · "}
            {t("profile.lastVerified")}:{" "}
            {aiReception.lastVerifiedAt
              ? formatDateTime(aiReception.lastVerifiedAt)
              : t("common.none")}
          </p>
          {aiReception.carrierGuide.sourceUrl ? (
            <a
              href={aiReception.carrierGuide.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="button-secondary"
            >
              {t("profile.openCarrierGuide")}
            </a>
          ) : null}
        </section>
      ) : null}

      <section className="card phone-flow-card">
        <div className="section-header">
          <div>
            <h2>{t("profile.phoneFlowTitle")}</h2>
            <p className="muted">{t("profile.phoneFlowHint")}</p>
          </div>
          <span className={aiReception ? aiReceptionStatusClasses[aiReception.status] : "status-pill warning"}>
            {aiReception
              ? aiReceptionStatusLabels[aiReception.status]
              : t("profile.aiStatusNotConfigured")}
          </span>
        </div>
        <div className="phone-flow-steps">
          <article>
            <span>1</span>
            <strong>{t("profile.phoneFlowCustomer")}</strong>
            <p>
              {aiReception?.originalPhoneNumberFormatted ||
                profileForm.originalPhoneNumber ||
                t("profile.addSalonPhoneFirst")}
            </p>
          </article>
          <article>
            <span>2</span>
            <strong>{t("profile.phoneFlowForward")}</strong>
            <p>{t("profile.phoneFlowForwardHint")}</p>
          </article>
          <article>
            <span>3</span>
            <strong>{t("profile.phoneFlowAi")}</strong>
            <p>
              {aiReception?.forwardToNumberFormatted ||
                profileForm.customerIncomingPhoneNumber ||
                "-"}
            </p>
          </article>
        </div>
      </section>
    </div>
  );
};
