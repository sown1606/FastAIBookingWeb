import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { apiGet, apiPut, extractErrorMessage } from "../lib/api";
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
  originalPhoneNumberFormatted: string | null;
  forwardToNumberFormatted: string | null;
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
        callCenterEnabled: settingsResult.callCenterEnabled,
        aiGreetingPrompt: settingsResult.aiGreetingPrompt ?? "",
        callerLanguage: settingsResult.callerLanguage,
        callCenterRoutingNote: settingsResult.callCenterRoutingNote ?? ""
      });
      setAiReception(aiReceptionResult);
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
          callCenterEnabled: settingsForm.callCenterEnabled,
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
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    callCenterEnabled: event.target.checked
                  }))
                }
              />
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
