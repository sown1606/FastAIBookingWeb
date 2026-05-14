import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../auth/auth-context";
import { apiGet, apiPost, apiPut, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import {
  getCountryOptions,
  getCurrencyOptions,
  getLocalePreferenceOptions,
  getTimezoneOptions
} from "../lib/form-options";
import { formatDateTime } from "../lib/format";
import { formatUsPhoneInput, validateOptionalUsPhone } from "../lib/phone";
import { useI18n } from "../lib/i18n";

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
  voicemailEnabled: boolean;
  callbackRequestEnabled: boolean;
  smsFallbackEnabled: boolean;
  aiGreetingPrompt: string | null;
  callerLanguage: string;
  callLogVisibility: "OWNER_ONLY" | "OWNER_AND_STAFF" | "OWNER_STAFF_OPERATOR";
  notificationRecipients: string[];
  callCenterRoutingNumber: string | null;
  callCenterRoutingNote: string | null;
  routingSummary: {
    mode:
      | "SALON_PHONE_ONLY"
      | "AI_RECEPTION_ONLY"
      | "CALL_CENTER_ONLY"
      | "AI_RECEPTION_WITH_CALL_CENTER";
    ringCountBeforeAi: number;
  };
}

interface AiReceptionConfig {
  id: string | null;
  salonId: string;
  salonName: string;
  provider: "amazon_connect" | "callrail";
  carrier: "tmobile";
  carrierLabel: string;
  originalPhoneNumber: string | null;
  originalPhoneNumberFormatted: string | null;
  forwardToNumber: string;
  forwardToNumberFormatted: string | null;
  forwardingPhoneNumber: string;
  forwardingPhoneNumberFormatted: string | null;
  forwardingType: "no_answer";
  activationCode: string;
  fallbackActivationCode: string;
  activationCodeWithoutDelay: string;
  deactivationCode: string;
  statusCheckCode: string;
  status: "not_configured" | "pending" | "active" | "failed";
  lastTestedAt: string | null;
  lastVerifiedAt: string | null;
  webhookVerificationEnabled: boolean;
  setupInstructions: string[];
}

interface AiReceptionCallLog {
  id: string;
  provider: "amazon_connect" | "callrail";
  providerCallId: string;
  trackingNumber: string | null;
  trackingNumberFormatted: string;
  originalPhoneNumber: string | null;
  originalPhoneNumberFormatted: string;
  callerNumber: string | null;
  callerNumberFormatted: string;
  direction: string;
  status: string;
  durationSeconds: number | null;
  startedAt: string | null;
  answeredAt: string | null;
  completedAt: string | null;
  recordingUrl: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AiReceptionCallLogsResponse {
  items: AiReceptionCallLog[];
}

const aiReceptionStatusClasses: Record<AiReceptionConfig["status"], string> = {
  not_configured: "status-pill warning",
  pending: "status-pill info",
  active: "status-pill success",
  failed: "status-pill warning"
};

const encodeDialerCode = (value: string) => value.replace(/\*/g, "%2A").replace(/#/g, "%23");

const formatDuration = (value: number | null) => {
  if (value === null || value === undefined) {
    return "-";
  }

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
};

export const SalonProfilePage = () => {
  const { session } = useAuth();
  const { notify } = useToast();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiReception, setAiReception] = useState<AiReceptionConfig | null>(null);
  const [aiReceptionCallLogs, setAiReceptionCallLogs] = useState<AiReceptionCallLog[]>([]);
  const [aiReceptionSubmitting, setAiReceptionSubmitting] = useState(false);

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
    voicemailEnabled: true,
    callbackRequestEnabled: true,
    smsFallbackEnabled: false,
    aiGreetingPrompt: "",
    callerLanguage: "en",
    callLogVisibility: "OWNER_STAFF_OPERATOR" as SalonSettings["callLogVisibility"],
    notificationRecipientsText: "",
    callCenterRoutingNumber: "",
    callCenterRoutingNote: ""
  });

  const salonId = session?.user.salonId ?? null;
  const timezoneOptions = getTimezoneOptions(t);
  const countryOptions = getCountryOptions(t);
  const currencyOptions = getCurrencyOptions(t);
  const localePreferenceOptions = getLocalePreferenceOptions(t);
  const callLogVisibilityOptions: Array<{
    value: SalonSettings["callLogVisibility"];
    label: string;
  }> = [
    { value: "OWNER_ONLY", label: t("profile.visibilityOwnerOnly") },
    { value: "OWNER_AND_STAFF", label: t("profile.visibilityOwnerAndStaff") },
    { value: "OWNER_STAFF_OPERATOR", label: t("profile.visibilityOwnerStaffOperator") }
  ];
  const aiReceptionStatusLabels: Record<AiReceptionConfig["status"], string> = {
    not_configured: t("profile.aiStatusNotConfigured"),
    pending: t("profile.aiStatusPending"),
    active: t("profile.aiStatusActive"),
    failed: t("profile.aiStatusFailed")
  };

  const loadAiReception = async (targetSalonId: string) => {
    const [configResult, callLogResult] = await Promise.all([
      apiGet<AiReceptionConfig>(`/api/v1/owner/salons/${targetSalonId}/ai-reception`),
      apiGet<AiReceptionCallLogsResponse>(`/api/v1/owner/salons/${targetSalonId}/call-logs?page=1&limit=10`)
    ]);

    setAiReception(configResult);
    setAiReceptionCallLogs(callLogResult.items);
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
      const [profileResult, settingsResult] = await Promise.all([
        apiGet<SalonProfile>("/api/v1/salon/profile"),
        apiGet<SalonSettings>("/api/v1/salon/settings")
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
        callCenterEnabled: settingsResult.callCenterEnabled,
        voicemailEnabled: settingsResult.voicemailEnabled,
        callbackRequestEnabled: settingsResult.callbackRequestEnabled,
        smsFallbackEnabled: settingsResult.smsFallbackEnabled,
        aiGreetingPrompt: settingsResult.aiGreetingPrompt ?? "",
        callerLanguage: settingsResult.callerLanguage,
        callLogVisibility: settingsResult.callLogVisibility,
        notificationRecipientsText: settingsResult.notificationRecipients.join("\n"),
        callCenterRoutingNumber: formatUsPhoneInput(settingsResult.callCenterRoutingNumber ?? ""),
        callCenterRoutingNote: settingsResult.callCenterRoutingNote ?? ""
      });

      await loadAiReception(salonId);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [salonId]);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const phoneValues = [
      profileForm.contactPhone,
      profileForm.originalPhoneNumber,
      profileForm.customerIncomingPhoneNumber,
      profileForm.notificationPhoneNumber
    ];

    if (!phoneValues.every(validateOptionalUsPhone)) {
      notify("error", t("profile.phoneValidation"));
      return;
    }

    try {
      await apiPut<SalonProfile, unknown>("/api/v1/salon/profile", {
        name: profileForm.name,
        contactEmail: profileForm.contactEmail || null,
        contactPhone: profileForm.contactPhone || null,
        originalPhoneNumber: profileForm.originalPhoneNumber || null,
        customerIncomingPhoneNumber: profileForm.customerIncomingPhoneNumber || null,
        notificationPhoneNumber: profileForm.notificationPhoneNumber || null,
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

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!validateOptionalUsPhone(settingsForm.callCenterRoutingNumber)) {
      notify("error", t("profile.callCenterPhoneValidation"));
      return;
    }

    try {
      await apiPut<SalonSettings, unknown>("/api/v1/salon/settings", {
        currency: settingsForm.currency,
        locale: settingsForm.locale,
        bookingLeadTimeMinutes: Number(settingsForm.bookingLeadTimeMinutes),
        cancellationPolicy: settingsForm.cancellationPolicy || null,
        aiReceptionEnabled: settingsForm.aiReceptionEnabled,
        aiTransferRingCount: Number(settingsForm.aiTransferRingCount),
        callCenterEnabled: settingsForm.callCenterEnabled,
        voicemailEnabled: settingsForm.voicemailEnabled,
        callbackRequestEnabled: settingsForm.callbackRequestEnabled,
        smsFallbackEnabled: settingsForm.smsFallbackEnabled,
        aiGreetingPrompt: settingsForm.aiGreetingPrompt || null,
        callerLanguage: settingsForm.callerLanguage,
        callLogVisibility: settingsForm.callLogVisibility,
        notificationRecipients: settingsForm.notificationRecipientsText
          .split(/\n|,/)
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
        callCenterRoutingNumber: settingsForm.callCenterRoutingNumber || null,
        callCenterRoutingNote: settingsForm.callCenterRoutingNote || null
      });
      notify("success", t("profile.settingsSaved"));
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const handleGenerateSetupCode = async () => {
    if (!salonId) {
      notify("error", t("profile.missingSalonContext"));
      return;
    }

    setAiReceptionSubmitting(true);
    try {
      const result = await apiPost<AiReceptionConfig>(`/api/v1/owner/salons/${salonId}/ai-reception/generate-forwarding-code`, {});
      setAiReception(result);
      notify("success", t("profile.aiReceptionCodeGenerated"));
    } catch (actionError) {
      notify("error", extractErrorMessage(actionError));
    } finally {
      setAiReceptionSubmitting(false);
    }
  };

  const handleOpenDialer = () => {
    if (!aiReception?.activationCode) {
      notify("error", t("profile.generateCodeFirst"));
      return;
    }

    const confirmed = window.confirm(t("profile.dialerConfirm", { code: aiReception.activationCode }));
    if (!confirmed) {
      return;
    }

    window.location.href = `tel:${encodeDialerCode(aiReception.activationCode)}`;
  };

  const handleCopyActivationCode = async () => {
    if (!aiReception?.activationCode) {
      notify("error", t("profile.generateCodeFirst"));
      return;
    }

    await navigator.clipboard.writeText(aiReception.activationCode);
    notify("success", t("profile.copyCodeSuccess"));
  };

  const handleMarkTestCompleted = async () => {
    if (!salonId) {
      notify("error", t("profile.missingSalonContext"));
      return;
    }

    setAiReceptionSubmitting(true);
    try {
      const result = await apiPost<AiReceptionConfig>(
        `/api/v1/owner/salons/${salonId}/ai-reception/mark-forwarding-tested`,
        {}
      );
      setAiReception(result);
      await loadAiReception(salonId);
      notify("success", t("profile.aiReceptionTestRecorded"));
    } catch (actionError) {
      notify("error", extractErrorMessage(actionError));
    } finally {
      setAiReceptionSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <div className="stack">
      <section className="card phone-flow-card">
        <div className="section-header">
          <div>
            <h2>{t("profile.phoneFlowTitle")}</h2>
            <p className="muted">{t("profile.phoneFlowHint")}</p>
          </div>
          <span className={aiReception ? aiReceptionStatusClasses[aiReception.status] : "status-pill warning"}>
            {aiReception ? aiReceptionStatusLabels[aiReception.status] : t("profile.aiStatusNotConfigured")}
          </span>
        </div>

        <div className="phone-flow-steps">
          <article>
            <span>1</span>
            <strong>{t("profile.phoneFlowCustomer")}</strong>
            <p>{aiReception?.originalPhoneNumberFormatted ?? (profileForm.originalPhoneNumber || t("profile.addSalonPhoneFirst"))}</p>
          </article>
          <article>
            <span>2</span>
            <strong>{t("profile.phoneFlowForward")}</strong>
            <p>{aiReception?.activationCode ?? t("profile.generateCodeFirst")}</p>
          </article>
          <article>
            <span>3</span>
            <strong>{t("profile.phoneFlowAi")}</strong>
            <p>{aiReception?.forwardToNumberFormatted ?? (profileForm.customerIncomingPhoneNumber || "-")}</p>
          </article>
        </div>

        <div className="simple-callout">
          <strong>{t("profile.phoneFlowPlainTitle")}</strong>
          <p>{t("profile.phoneFlowPlainCopy")}</p>
        </div>

        <div className="inline-actions">
          <button
            type="button"
            className="button-primary"
            onClick={handleOpenDialer}
            disabled={aiReceptionSubmitting || !aiReception?.activationCode}
          >
            {t("profile.openDialer")}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void handleCopyActivationCode()}
            disabled={aiReceptionSubmitting || !aiReception?.activationCode}
          >
            {t("profile.copyCode")}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void handleGenerateSetupCode()}
            disabled={aiReceptionSubmitting}
          >
            {t("profile.generateCode")}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void handleMarkTestCompleted()}
            disabled={aiReceptionSubmitting}
          >
            {t("profile.markTestCompleted")}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>{t("profile.title")}</h2>
        <form className="form-grid two-columns" onSubmit={saveProfile}>
          <label className="field">
            <span>{t("profile.salonName")}</span>
            <input
              value={profileForm.name}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{t("common.timezone")}</span>
            <select
              value={profileForm.timezone}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, timezone: event.target.value }))}
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
            <span>{t("profile.incomingPhone")}</span>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(212) 555-0100"
              value={profileForm.customerIncomingPhoneNumber}
              onChange={(event) =>
                setProfileForm((prev) => ({
                  ...prev,
                  customerIncomingPhoneNumber: formatUsPhoneInput(event.target.value)
                }))
              }
            />
            <small>{t("profile.incomingPhoneHint")}</small>
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
              onChange={(event) => setProfileForm((prev) => ({ ...prev, city: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>{t("common.state")}</span>
            <input
              value={profileForm.state}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, state: event.target.value }))}
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
              onChange={(event) => setProfileForm((prev) => ({ ...prev, country: event.target.value }))}
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
              {t("profile.saveProfile")}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>{t("profile.settingsTitle")}</h2>
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
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, currency: event.target.value }))}
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
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, locale: event.target.value }))}
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
                  setSettingsForm((prev) => ({ ...prev, cancellationPolicy: event.target.value }))
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
              <span>{t("profile.aiForwarding")}</span>
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
              <span>{t("profile.ringCount")}</span>
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
                rows={5}
                value={settingsForm.aiGreetingPrompt}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, aiGreetingPrompt: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>{t("profile.callerLanguage")}</span>
              <select
                value={settingsForm.callerLanguage}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, callerLanguage: event.target.value }))
                }
              >
                <option value="en">{t("profile.callerLanguageEnglish")}</option>
              </select>
            </label>
          </div>

          <div className="settings-panel">
            <div>
              <h3>{t("profile.callCenterFallbackTitle")}</h3>
              <p className="muted">{t("profile.callCenterFallbackHint")}</p>
            </div>
            <label className="field checkbox-row">
              <span>{t("profile.callCenterEnabled")}</span>
              <input
                type="checkbox"
                checked={settingsForm.callCenterEnabled}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    callCenterEnabled: event.target.checked
                  }))
                }
              />
            </label>
            <label className="field checkbox-row">
              <span>{t("profile.voicemailFallback")}</span>
              <input
                type="checkbox"
                checked={settingsForm.voicemailEnabled}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    voicemailEnabled: event.target.checked
                  }))
                }
              />
            </label>
            <label className="field checkbox-row">
              <span>{t("profile.callbackRequest")}</span>
              <input
                type="checkbox"
                checked={settingsForm.callbackRequestEnabled}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    callbackRequestEnabled: event.target.checked
                  }))
                }
              />
            </label>
            <label className="field checkbox-row">
              <span>{t("profile.smsFallback")}</span>
              <input
                type="checkbox"
                checked={settingsForm.smsFallbackEnabled}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    smsFallbackEnabled: event.target.checked
                  }))
                }
              />
            </label>
            <label className="field">
              <span>{t("profile.routingNumber")}</span>
              <input
                type="tel"
                inputMode="tel"
                placeholder="(212) 555-0100"
                value={settingsForm.callCenterRoutingNumber}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    callCenterRoutingNumber: formatUsPhoneInput(event.target.value)
                  }))
                }
              />
              <small>{t("profile.routingNumberHint")}</small>
            </label>
            <label className="field">
              <span>{t("profile.routingNote")}</span>
              <textarea
                rows={3}
                value={settingsForm.callCenterRoutingNote}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    callCenterRoutingNote: event.target.value
                  }))
                }
              />
            </label>
          </div>

          <div className="settings-panel">
            <div>
              <h3>{t("profile.notificationsTitle")}</h3>
              <p className="muted">{t("profile.notificationsHint")}</p>
            </div>
            <label className="field">
              <span>{t("profile.notificationRecipients")}</span>
              <textarea
                rows={4}
                value={settingsForm.notificationRecipientsText}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    notificationRecipientsText: event.target.value
                  }))
                }
                placeholder={"ops@salon.com\n+12125550100"}
              />
              <small>{t("profile.notificationRecipientsHint")}</small>
            </label>
            <label className="field">
              <span>{t("profile.callLogVisibility")}</span>
              <select
                value={settingsForm.callLogVisibility}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    callLogVisibility: event.target.value as SalonSettings["callLogVisibility"]
                  }))
                }
              >
                {callLogVisibilityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" className="button-primary">
              {t("profile.saveSettings")}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>{t("profile.aiSetupTitle")}</h2>
            <p className="muted">{t("profile.aiSetupHint")}</p>
          </div>
          <span className={aiReception ? aiReceptionStatusClasses[aiReception.status] : "status-pill warning"}>
            {aiReception ? aiReceptionStatusLabels[aiReception.status] : t("profile.aiStatusNotConfigured")}
          </span>
        </div>

        <div className="metrics-grid">
          <div>
            <span className="muted">{t("profile.salonName")}</span>
            <strong>{(aiReception?.salonName ?? profileForm.name) || "-"}</strong>
          </div>
          <div>
            <span className="muted">{t("profile.originalPhoneNumber")}</span>
            <strong>{aiReception?.originalPhoneNumberFormatted ?? t("profile.addSalonPhoneFirst")}</strong>
          </div>
          <div>
            <span className="muted">{t("profile.forwardToNumber")}</span>
            <strong>{aiReception?.forwardToNumberFormatted ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">{t("profile.carrier")}</span>
            <strong>{aiReception?.carrierLabel ?? "T-Mobile"}</strong>
          </div>
          <div>
            <span className="muted">{t("profile.forwardingType")}</span>
            <strong>{t("profile.forwardingTypeNoAnswer")}</strong>
          </div>
          <div>
            <span className="muted">{t("profile.setupStatus")}</span>
            <strong>
              {aiReception ? aiReceptionStatusLabels[aiReception.status] : t("profile.aiStatusNotConfigured")}
            </strong>
          </div>
          <div>
            <span className="muted">{t("profile.lastTested")}</span>
            <strong>{aiReception?.lastTestedAt ? formatDateTime(aiReception.lastTestedAt) : "-"}</strong>
          </div>
          <div>
            <span className="muted">{t("profile.lastVerified")}</span>
            <strong>{aiReception?.lastVerifiedAt ? formatDateTime(aiReception.lastVerifiedAt) : "-"}</strong>
          </div>
          <div>
            <span className="muted">{t("profile.webhookVerification")}</span>
            <strong>{aiReception?.webhookVerificationEnabled ? t("common.enabled") : t("common.disabled")}</strong>
          </div>
        </div>

        <div className="form-grid two-columns">
          <label className="field">
            <span>{t("profile.activationCode")}</span>
            <input value={aiReception?.activationCode ?? ""} readOnly />
            <small>{t("profile.activationCodeHint")}</small>
          </label>
          <label className="field">
            <span>{t("profile.fallbackActivationCode")}</span>
            <input
              value={aiReception?.fallbackActivationCode ?? aiReception?.activationCodeWithoutDelay ?? ""}
              readOnly
            />
            <small>{t("profile.fallbackActivationCodeHint")}</small>
          </label>
          <label className="field">
            <span>{t("profile.deactivationCode")}</span>
            <input value={aiReception?.deactivationCode ?? ""} readOnly />
          </label>
          <label className="field">
            <span>{t("profile.statusCheckCode")}</span>
            <input value={aiReception?.statusCheckCode ?? ""} readOnly />
          </label>
        </div>

        <article className="inspection-box">
          <h3>{t("profile.aiSetupInstructions")}</h3>
          {aiReception?.setupInstructions?.length ? (
            <div className="stack">
              {aiReception.setupInstructions.map((instruction) => (
                <p key={instruction}>{instruction}</p>
              ))}
            </div>
          ) : (
            <p>{t("profile.aiSetupEmpty")}</p>
          )}
        </article>

        <div className="inline-actions">
          <button
            type="button"
            className="button-primary"
            onClick={() => void handleGenerateSetupCode()}
            disabled={aiReceptionSubmitting}
          >
            {t("profile.generateCode")}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={handleOpenDialer}
            disabled={aiReceptionSubmitting || !aiReception?.activationCode}
          >
            {t("profile.openDialer")}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void handleMarkTestCompleted()}
            disabled={aiReceptionSubmitting}
          >
            {t("profile.markTestCompleted")}
          </button>
          <a href="#ai-reception-call-logs" className="button-secondary">
            {t("profile.viewCallLogs")}
          </a>
        </div>

        <div className="stack" id="ai-reception-call-logs">
          <h3>{t("profile.recentCallrailLogs")}</h3>
          {aiReceptionCallLogs.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("profile.started")}</th>
                    <th>{t("profile.caller")}</th>
                    <th>{t("common.status")}</th>
                    <th>{t("profile.summary")}</th>
                    <th>{t("profile.duration")}</th>
                    <th>{t("profile.recording")}</th>
                  </tr>
                </thead>
                <tbody>
                  {aiReceptionCallLogs.map((item) => (
                    <tr key={item.id}>
                      <td>{item.startedAt ? formatDateTime(item.startedAt) : "-"}</td>
                      <td>{item.callerNumberFormatted || item.callerNumber || "-"}</td>
                      <td>{item.status}</td>
                      <td>{item.summary ?? "-"}</td>
                      <td>{formatDuration(item.durationSeconds)}</td>
                      <td>
                        {item.recordingUrl ? (
                          <a href={item.recordingUrl} target="_blank" rel="noreferrer">
                            {t("profile.openRecording")}
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyBlock message={t("profile.noCallrailLogs")} />
          )}
        </div>
      </section>
    </div>
  );
};
