import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { getStaffTitleLabel } from "../lib/form-options";
import { statusLabelKey, useI18n } from "../lib/i18n";

interface StaffProfileResponse {
  user: {
    id: string;
    email: string;
    fullName: string;
    phone: string | null;
    isActive: boolean;
  };
  staff: {
    id: string;
    fullName: string;
    title: string | null;
    status: string;
    isBookable: boolean;
  };
}

export const MyProfilePage = () => {
  const { notify } = useToast();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<StaffProfileResponse | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [form, setForm] = useState({
    fullName: "",
    phone: ""
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: ""
  });

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await apiGet<StaffProfileResponse>("/api/v1/staff/me/profile");
      setProfile(response);
      setForm({
        fullName: response.user.fullName,
        phone: response.user.phone ?? ""
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
    setSavingProfile(true);
    try {
      const response = await apiPut<StaffProfileResponse, unknown>("/api/v1/staff/me/profile", {
        fullName: form.fullName,
        phone: form.phone || null
      });
      setProfile(response);
      notify("success", t("myProfile.saved"));
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChangingPassword(true);
    try {
      await apiPost<null, { currentPassword: string; newPassword: string }>(
        "/api/v1/auth/change-password",
        {
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        }
      );
      setPasswordForm({
        currentPassword: "",
        newPassword: ""
      });
      notify("success", t("myProfile.passwordChanged"));
    } catch (changeError) {
      notify("error", extractErrorMessage(changeError));
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  if (!profile) {
    return <ErrorBlock message={t("myProfile.loadError")} onRetry={load} />;
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="section-header">
          <div>
            <h2>{t("myProfile.title")}</h2>
            <p className="muted">{profile.user.email}</p>
          </div>
          <div className="summary-badges">
            <span className={profile.user.isActive ? "status-pill success" : "status-pill warning"}>
              {statusLabelKey(profile.staff.status) ? t(statusLabelKey(profile.staff.status)!) : profile.staff.status}
            </span>
            <span className={profile.staff.isBookable ? "status-pill info" : "status-pill warning"}>
              {profile.staff.isBookable ? t("common.enabled") : t("common.disabled")}
            </span>
          </div>
        </div>
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("myProfile.jobTitle")}</span>
            <strong>{getStaffTitleLabel(profile.staff.title, t)}</strong>
          </div>
          <div>
            <span className="muted">{t("myProfile.bookable")}</span>
            <strong>{profile.staff.isBookable ? t("common.enabled") : t("common.disabled")}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{t("myProfile.accountTitle")}</h2>
        <form className="form-grid two-columns" onSubmit={saveProfile}>
          <label className="field">
            <span>{t("common.email")}</span>
            <input value={profile.user.email} disabled />
          </label>
          <label className="field">
            <span>{t("myProfile.fullName")}</span>
            <input
              value={form.fullName}
              onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
              required
              disabled={savingProfile}
            />
          </label>
          <label className="field">
            <span>{t("myProfile.phone")}</span>
            <input
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              disabled={savingProfile}
            />
          </label>
          <label className="field">
            <span>{t("myProfile.status")}</span>
            <input
              value={statusLabelKey(profile.staff.status) ? t(statusLabelKey(profile.staff.status)!) : profile.staff.status}
              disabled
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={savingProfile}>
              {savingProfile ? t("common.loading") : t("myProfile.save")}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>{t("myProfile.passwordTitle")}</h2>
        <form className="form-grid two-columns" onSubmit={changePassword}>
          <label className="field">
            <span>{t("myProfile.currentPassword")}</span>
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) =>
                setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))
              }
              required
              disabled={changingPassword}
            />
          </label>
          <label className="field">
            <span>{t("myProfile.newPassword")}</span>
            <input
              type="password"
              minLength={8}
              value={passwordForm.newPassword}
              onChange={(event) =>
                setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))
              }
              required
              disabled={changingPassword}
            />
            <small>{t("myProfile.passwordHint")}</small>
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={changingPassword}>
              {changingPassword ? t("common.loading") : t("myProfile.passwordTitle")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
