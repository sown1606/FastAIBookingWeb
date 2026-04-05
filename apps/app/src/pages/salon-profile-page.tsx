import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPut, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";

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
        contactPhone: profileResult.contactPhone ?? "",
        originalPhoneNumber: profileResult.originalPhoneNumber ?? "",
        customerIncomingPhoneNumber: profileResult.customerIncomingPhoneNumber ?? "",
        notificationPhoneNumber: profileResult.notificationPhoneNumber ?? "",
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
        callCenterRoutingNumber: settingsResult.callCenterRoutingNumber ?? "",
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
      notify("success", "Đã cập nhật hồ sơ tiệm.");
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      notify("success", "Đã cập nhật cài đặt tiệm.");
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
        <h2>Hồ sơ tiệm</h2>
        <form className="form-grid two-columns" onSubmit={saveProfile}>
          <label className="field">
            <span>Tên tiệm</span>
            <input
              value={profileForm.name}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Múi giờ</span>
            <input
              value={profileForm.timezone}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, timezone: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Email liên hệ</span>
            <input
              type="email"
              value={profileForm.contactEmail}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, contactEmail: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Số điện thoại liên hệ</span>
            <input
              type="tel"
              inputMode="numeric"
              value={profileForm.contactPhone}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, contactPhone: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Số hiện tại của tiệm</span>
            <input
              type="tel"
              inputMode="numeric"
              value={profileForm.originalPhoneNumber}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, originalPhoneNumber: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Số khách gọi vào</span>
            <input
              type="tel"
              inputMode="numeric"
              value={profileForm.customerIncomingPhoneNumber}
              onChange={(event) =>
                setProfileForm((prev) => ({
                  ...prev,
                  customerIncomingPhoneNumber: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>Số nhận thông báo khẩn</span>
            <input
              type="tel"
              inputMode="numeric"
              value={profileForm.notificationPhoneNumber}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, notificationPhoneNumber: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Địa chỉ 1</span>
            <input
              value={profileForm.addressLine1}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, addressLine1: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Địa chỉ 2</span>
            <input
              value={profileForm.addressLine2}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, addressLine2: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Thành phố</span>
            <input
              value={profileForm.city}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, city: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Bang</span>
            <input
              value={profileForm.state}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, state: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Mã bưu điện</span>
            <input
              value={profileForm.postalCode}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, postalCode: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Quốc gia</span>
            <input
              value={profileForm.country}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, country: event.target.value }))}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              Lưu hồ sơ
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Cài đặt đặt lịch và cuộc gọi</h2>
        <form className="form-grid two-columns" onSubmit={saveSettings}>
          <label className="field">
            <span>Tiền tệ</span>
            <input
              value={settingsForm.currency}
              onChange={(event) =>
                setSettingsForm((prev) => ({ ...prev, currency: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Locale</span>
            <input
              value={settingsForm.locale}
              onChange={(event) => setSettingsForm((prev) => ({ ...prev, locale: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Đặt trước tối thiểu (phút)</span>
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
            <span>Chính sách hủy lịch</span>
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
            <span>Bật AI nghe máy</span>
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
            <span>Số hồi chuông trước khi chuyển</span>
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
            <span>Số tổng đài trực tiếp</span>
            <input
              type="tel"
              inputMode="numeric"
              value={settingsForm.callCenterRoutingNumber}
              onChange={(event) =>
                setSettingsForm((prev) => ({
                  ...prev,
                  callCenterRoutingNumber: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>Ghi chú tổng đài</span>
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
              Lưu cài đặt
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
