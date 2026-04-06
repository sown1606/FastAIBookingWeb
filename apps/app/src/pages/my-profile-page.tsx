import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<StaffProfileResponse | null>(null);

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
    try {
      const response = await apiPut<StaffProfileResponse, unknown>("/api/v1/staff/me/profile", {
        fullName: form.fullName,
        phone: form.phone || null
      });
      setProfile(response);
      notify("success", "Đã cập nhật hồ sơ.");
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      notify("success", "Đã đổi mật khẩu.");
    } catch (changeError) {
      notify("error", extractErrorMessage(changeError));
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  if (!profile) {
    return <ErrorBlock message="Chưa tải được hồ sơ nhân viên." onRetry={load} />;
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Hồ sơ của tôi</h2>
        <form className="form-grid two-columns" onSubmit={saveProfile}>
          <label className="field">
            <span>Email</span>
            <input value={profile.user.email} disabled />
          </label>
          <label className="field">
            <span>Họ tên</span>
            <input
              value={form.fullName}
              onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Số điện thoại</span>
            <input
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Trạng thái</span>
            <input value={profile.staff.status} disabled />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              Lưu hồ sơ
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Đổi mật khẩu</h2>
        <form className="form-grid two-columns" onSubmit={changePassword}>
          <label className="field">
            <span>Mật khẩu hiện tại</span>
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) =>
                setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))
              }
              required
            />
          </label>
          <label className="field">
            <span>Mật khẩu mới</span>
            <input
              type="password"
              minLength={8}
              value={passwordForm.newPassword}
              onChange={(event) =>
                setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))
              }
              required
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              Đổi mật khẩu
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
