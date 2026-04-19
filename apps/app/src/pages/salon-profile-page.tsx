import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPut, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import {
  countryOptions,
  currencyOptions,
  localePreferenceOptions,
  timezoneOptions
} from "../lib/form-options";
import { formatUsPhoneInput, validateOptionalUsPhone } from "../lib/phone";

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

const callLogVisibilityOptions: Array<{
  value: SalonSettings["callLogVisibility"];
  label: string;
}> = [
  { value: "OWNER_ONLY", label: "Owner only" },
  { value: "OWNER_AND_STAFF", label: "Owner and staff" },
  { value: "OWNER_STAFF_OPERATOR", label: "Owner, staff, and operator" }
];

export const SalonProfilePage = () => {
  const { notify } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const load = async () => {
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
      notify("error", "Please enter valid US phone numbers.");
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
      notify("success", "Salon profile updated.");
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!validateOptionalUsPhone(settingsForm.callCenterRoutingNumber)) {
      notify("error", "Please enter a valid US call center phone number.");
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
      notify("success", "Salon settings updated.");
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
        <h2>Salon profile</h2>
        <form className="form-grid two-columns" onSubmit={saveProfile}>
          <label className="field">
            <span>Salon name</span>
            <input
              value={profileForm.name}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Timezone</span>
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
            <span>Contact email</span>
            <input
              type="email"
              value={profileForm.contactEmail}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, contactEmail: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Contact phone</span>
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
            <small>US format, for example (212) 555-0100</small>
          </label>
          <label className="field">
            <span>Salon phone number</span>
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
            <small>Customers still dial the salon&apos;s original business number.</small>
          </label>
          <label className="field">
            <span>Customer incoming number</span>
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
            <small>Use the routed number that CallRail sends inbound calls through.</small>
          </label>
          <label className="field">
            <span>Urgent notification number</span>
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
          </label>
          <label className="field">
            <span>Address line 1</span>
            <input
              value={profileForm.addressLine1}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, addressLine1: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Address line 2</span>
            <input
              value={profileForm.addressLine2}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, addressLine2: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>City</span>
            <input
              value={profileForm.city}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, city: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>State</span>
            <input
              value={profileForm.state}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, state: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Postal code</span>
            <input
              value={profileForm.postalCode}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, postalCode: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Country</span>
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
              Save profile
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Call handling settings</h2>
        <form className="form-grid two-columns" onSubmit={saveSettings}>
          <div className="settings-panel">
            <div>
              <h3>Business defaults</h3>
              <p className="muted">Shared defaults for booking, AI reception, and operator workflows.</p>
            </div>
            <label className="field">
              <span>Currency</span>
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
              <span>Default locale</span>
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
              <span>Minimum booking lead time (minutes)</span>
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
              <span>Cancellation policy</span>
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
              <h3>AI Reception</h3>
              <p className="muted">AI reception answers based on routing and can create real bookings.</p>
            </div>
            <label className="field checkbox-row">
              <span>AI Reception ON</span>
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
              <span>Ring count before AI</span>
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
              <span>AI greeting prompt</span>
              <textarea
                rows={5}
                value={settingsForm.aiGreetingPrompt}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, aiGreetingPrompt: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Caller language</span>
              <select
                value={settingsForm.callerLanguage}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, callerLanguage: event.target.value }))
                }
              >
                <option value="en">English</option>
              </select>
            </label>
          </div>

          <div className="settings-panel">
            <div>
              <h3>Human Call Center and fallback</h3>
              <p className="muted">Shared 24/7 operator queue, voicemail, callback, and SMS fallback behavior.</p>
            </div>
            <label className="field checkbox-row">
              <span>Human Call Center ON</span>
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
              <span>Voicemail fallback ON</span>
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
              <span>Callback request ON</span>
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
              <span>SMS fallback ON</span>
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
              <span>Direct call center number</span>
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
            </label>
            <label className="field">
              <span>Call center routing note</span>
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
              <h3>Notifications and visibility</h3>
              <p className="muted">Decide who receives call notifications and who can view call records.</p>
            </div>
            <label className="field">
              <span>Notification recipients</span>
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
              <small>Enter one email or phone number per line.</small>
            </label>
            <label className="field">
              <span>Call log, transcript, and summary visibility</span>
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
              Save settings
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
