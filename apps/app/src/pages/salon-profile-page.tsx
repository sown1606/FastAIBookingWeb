import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPut, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { countryOptions, currencyOptions, localePreferenceOptions, timezoneOptions } from "../lib/form-options";
import { formatUsPhoneInput, requiredLabel, validateOptionalUsPhone } from "../lib/phone";
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
  aiForwardingEnabled: boolean;
  aiTransferRingCount: number;
  callCenterRoutingNumber: string | null;
  callCenterRoutingNote: string | null;
}

export const SalonProfilePage = () => {
  const { notify } = useToast();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [profile, setProfile] = useState<SalonProfile | null>(null);
  const [settings, setSettings] = useState<SalonSettings | null>(null);

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
    locale: "vi-VN",
    bookingLeadTimeMinutes: "0",
    cancellationPolicy: "",
    aiForwardingEnabled: false,
    aiTransferRingCount: "3",
    callCenterRoutingNumber: "",
    callCenterRoutingNote: ""
  });

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const [profileResult, settingsResult] = await Promise.all([
        apiGet<SalonProfile>("/api/v1/salon/profile"),
        apiGet<SalonSettings>("/api/v1/salon/settings")
      ]);
      setProfile(profileResult);
      setSettings(settingsResult);
      setProfileForm({
        name: profileResult.name,
        contactEmail: profileResult.contactEmail ?? "",
        contactPhone: formatUsPhoneInput(profileResult.contactPhone ?? ""),
        originalPhoneNumber: formatUsPhoneInput(profileResult.originalPhoneNumber ?? ""),
        customerIncomingPhoneNumber: formatUsPhoneInput(profileResult.customerIncomingPhoneNumber ?? ""),
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
        aiForwardingEnabled: settingsResult.aiForwardingEnabled,
        aiTransferRingCount: String(settingsResult.aiTransferRingCount),
        callCenterRoutingNumber: formatUsPhoneInput(settingsResult.callCenterRoutingNumber ?? ""),
        callCenterRoutingNote: settingsResult.callCenterRoutingNote ?? ""
      });
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const phoneValues = [
      profileForm.contactPhone,
      profileForm.originalPhoneNumber,
      profileForm.customerIncomingPhoneNumber,
      profileForm.notificationPhoneNumber
    ];
    if (!phoneValues.every(validateOptionalUsPhone)) {
      notify("error", t("form.phoneInvalid"));
      return;
    }
    try {
      const updated = await apiPut<SalonProfile, unknown>("/api/v1/salon/profile", {
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
      setProfile(updated);
      notify("success", t("profile.saved"));
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateOptionalUsPhone(settingsForm.callCenterRoutingNumber)) {
      notify("error", t("form.phoneInvalid"));
      return;
    }
    try {
      const updated = await apiPut<SalonSettings, unknown>("/api/v1/salon/settings", {
        currency: settingsForm.currency,
        locale: settingsForm.locale,
        bookingLeadTimeMinutes: Number(settingsForm.bookingLeadTimeMinutes),
        cancellationPolicy: settingsForm.cancellationPolicy || null,
        aiForwardingEnabled: settingsForm.aiForwardingEnabled,
        aiTransferRingCount: Number(settingsForm.aiTransferRingCount),
        callCenterRoutingNumber: settingsForm.callCenterRoutingNumber || null,
        callCenterRoutingNote: settingsForm.callCenterRoutingNote || null
      });
      setSettings(updated);
      notify("success", t("profile.settingsSaved"));
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
      <section className="card">
        <h2>{t("profile.title")}</h2>
        <form className="form-grid two-columns" onSubmit={saveProfile}>
          <label className="field">
            <span>{requiredLabel(t("auth.register.salonName"))}</span>
            <input
              value={profileForm.name}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{requiredLabel(t("common.timezone"))}</span>
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
            <span>{t("common.email")}</span>
            <input
              type="email"
              value={profileForm.contactEmail}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, contactEmail: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("common.phone")}</span>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(212) 555-0100"
              value={profileForm.contactPhone}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, contactPhone: formatUsPhoneInput(event.target.value) }))
              }
            />
            <small>{t("form.phoneHint")}</small>
          </label>
          <label className="field">
            <span>{t("profile.currentPhone")}</span>
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
            <small>{t("form.phoneHint")}</small>
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
            <small>{t("form.phoneHint")}</small>
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
            <small>{t("form.phoneHint")}</small>
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
              rows={3}
              value={settingsForm.cancellationPolicy}
              onChange={(event) =>
                setSettingsForm((prev) => ({
                  ...prev,
                  cancellationPolicy: event.target.value
                }))
              }
            />
          </label>
          <label className="field checkbox-row">
            <span>{t("profile.aiForwarding")}</span>
            <input
              type="checkbox"
              checked={settingsForm.aiForwardingEnabled}
              onChange={(event) =>
                setSettingsForm((prev) => ({
                  ...prev,
                  aiForwardingEnabled: event.target.checked
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
            <small>{t("form.phoneHint")}</small>
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
          <div className="form-actions">
            <button type="submit" className="button-primary">
              {t("profile.saveSettings")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
