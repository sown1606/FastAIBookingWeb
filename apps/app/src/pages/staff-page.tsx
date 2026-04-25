import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatCurrencyCents } from "../lib/format";
import { useFormDialog } from "../components/form-dialog";
import { DemoAvatar } from "../components/avatar";
import { staffTitleOptions } from "../lib/form-options";
import { formatUsPhoneInput, requiredLabel, validateOptionalUsPhone } from "../lib/phone";
import { statusLabelKey, useI18n } from "../lib/i18n";

interface StaffItem {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  status: "ACTIVE" | "INACTIVE";
  isBookable: boolean;
  user?: {
    id: string;
    email: string;
    isActive: boolean;
  } | null;
}

interface BillingUsage {
  currentUsage: {
    freeStaffLimit: number;
    activeStaffCount: number;
    billableExtraStaffCount: number;
    extraStaffUnitPriceCents: number;
    estimatedExtraCostCents: number;
  };
}

export const StaffPage = () => {
  const { notify } = useToast();
  const { openFormDialog, FormDialog } = useFormDialog();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [billing, setBilling] = useState<BillingUsage | null>(null);

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    title: "",
    isBookable: true
  });

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const [staffResult, billingResult] = await Promise.all([
        apiGet<StaffItem[]>("/api/v1/staff?includeInactive=true"),
        apiGet<BillingUsage>("/api/v1/billing/usage?historyLimit=3")
      ]);
      setStaff(staffResult);
      setBilling(billingResult);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createStaffMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateOptionalUsPhone(form.phone)) {
      notify("error", t("form.phoneInvalid"));
      return;
    }
    try {
      await apiPost<unknown, unknown>("/api/v1/staff", {
        fullName: form.fullName,
        email: form.email || undefined,
        phone: form.phone || undefined,
        title: form.title || undefined,
        isBookable: form.isBookable,
        createLogin: true
      });
      setForm({
        fullName: "",
        email: "",
        phone: "",
        title: "",
        isBookable: true
      });
      notify("success", t("staff.created"));
      await load();
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const editStaffMember = async (item: StaffItem) => {
    const values = await openFormDialog({
      title: t("staff.edit"),
      fields: [
        { name: "fullName", label: t("staff.fullName"), required: true },
        { name: "email", label: t("common.email"), type: "email", required: true },
        { name: "phone", label: t("common.phone"), type: "tel", required: true },
        { name: "title", label: t("staff.title"), type: "select", options: staffTitleOptions }
      ],
      initialValues: {
        fullName: item.fullName,
        email: item.email ?? "",
        phone: formatUsPhoneInput(item.phone ?? ""),
        title: item.title ?? ""
      },
      confirmLabel: t("staff.save")
    });
    if (!values) {
      return;
    }
    if (!validateOptionalUsPhone(values.phone)) {
      notify("error", t("form.phoneInvalid"));
      return;
    }
    try {
      await apiPatch<unknown, unknown>(`/api/v1/staff/${item.id}`, {
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
        title: values.title
      });
      notify("success", t("staff.updated"));
      await load();
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  const toggleStatus = async (item: StaffItem) => {
    const action = item.status === "ACTIVE" ? "deactivate" : "reactivate";
    try {
      await apiPost<unknown, Record<string, never>>(`/api/v1/staff/${item.id}/${action}`, {});
      notify("success", item.status === "ACTIVE" ? t("staff.deactivated") : t("staff.reactivated"));
      await load();
    } catch (toggleError) {
      notify("error", extractErrorMessage(toggleError));
    }
  };

  const resetAccess = async (item: StaffItem) => {
    const values = await openFormDialog({
      title: t("staff.resetAccess"),
      description: item.fullName,
      fields: [
        {
          name: "newPassword",
          label: t("staff.newPassword"),
          type: "password",
          required: true,
          min: 8
        }
      ],
      initialValues: {
        newPassword: ""
      },
      confirmLabel: t("staff.reset")
    });
    if (!values?.newPassword) {
      return;
    }
    try {
      await apiPost<unknown, { newPassword: string }>(`/api/v1/staff/${item.id}/reset-access`, {
        newPassword: values.newPassword
      });
      notify("success", t("staff.accessReset"));
      await load();
    } catch (resetError) {
      notify("error", extractErrorMessage(resetError));
    }
  };

  const activeStaffCount = staff.filter((item) => item.status === "ACTIVE").length;
  const inactiveStaffCount = staff.length - activeStaffCount;
  const loginReadyCount = staff.filter((item) => item.user?.isActive).length;
  const bookableStaffCount = staff.filter((item) => item.isBookable && item.status === "ACTIVE").length;

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <div className="stack">
      <FormDialog />
      <section className="card">
        <h2>{t("staff.usageTitle")}</h2>
        <p className="muted">{t("billing.rule")}</p>
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("billing.freeStaff")}</span>
            <strong>{billing?.currentUsage.freeStaffLimit ?? 0}</strong>
          </div>
          <div>
            <span className="muted">{t("billing.activeStaff")}</span>
            <strong>{billing?.currentUsage.activeStaffCount ?? 0}</strong>
          </div>
          <div>
            <span className="muted">{t("billing.billableStaff")}</span>
            <strong>{billing?.currentUsage.billableExtraStaffCount ?? 0}</strong>
          </div>
          <div>
            <span className="muted">{t("billing.estimated")}</span>
            <strong>{formatCurrencyCents(billing?.currentUsage.estimatedExtraCostCents)}</strong>
          </div>
        </div>
        <div className="summary-badges">
          <span className="summary-badge">Đang hoạt động: {activeStaffCount}</span>
          <span className="summary-badge">Tạm tắt: {inactiveStaffCount}</span>
          <span className="summary-badge">Có đăng nhập: {loginReadyCount}</span>
          <span className="summary-badge">Nhận lịch: {bookableStaffCount}</span>
        </div>
      </section>

      <section className="card">
        <h2>{t("staff.addTitle")}</h2>
        <form className="form-grid two-columns" onSubmit={createStaffMember}>
          <label className="field">
            <span>{requiredLabel(t("staff.fullName"))}</span>
            <input
              value={form.fullName}
              onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{requiredLabel(t("common.email"))}</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{requiredLabel(t("common.phone"))}</span>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(212) 555-0100"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: formatUsPhoneInput(event.target.value) }))}
              required
            />
            <small>{t("form.phoneHint")}</small>
          </label>
          <label className="field">
            <span>{t("staff.title")}</span>
            <select
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            >
              <option value="">{t("common.optional")}</option>
              {staffTitleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              {t("staff.invite")}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>{t("staff.listTitle")}</h2>
            <p className="muted">Hiển thị toàn bộ nhân viên, trạng thái hoạt động, truy cập và thông tin liên hệ.</p>
          </div>
          <span className="status-pill info">{staff.length} nhân viên</span>
        </div>
        {staff.length ? (
          <div className="staff-grid">
            {staff.map((item) => {
              const loginLabel = item.user
                ? item.user.isActive
                  ? t("staff.on")
                  : t("staff.off")
                : t("staff.notCreated");

              return (
                <article
                  key={item.id}
                  className={item.status === "ACTIVE" ? "staff-card" : "staff-card staff-card-inactive"}
                >
                  <div className="staff-card-header">
                    <div className="person-cell">
                      <DemoAvatar name={item.fullName} variant="staff" size="md" />
                      <span>
                        <strong>{item.fullName}</strong>
                        <span className="muted">{item.email ?? "Chưa có email"}</span>
                      </span>
                    </div>
                    <span className={item.status === "ACTIVE" ? "status-pill success" : "status-pill warning"}>
                      {statusLabelKey(item.status) ? t(statusLabelKey(item.status)!) : item.status}
                    </span>
                  </div>

                  <div className="staff-meta-grid">
                    <div>
                      <span className="muted">{t("staff.title")}</span>
                      <strong>{item.title ?? "Chưa đặt vai trò"}</strong>
                    </div>
                    <div>
                      <span className="muted">{t("common.phone")}</span>
                      <strong>{item.phone ?? "Chưa có số điện thoại"}</strong>
                    </div>
                    <div>
                      <span className="muted">{t("staff.login")}</span>
                      <strong>{loginLabel}</strong>
                    </div>
                    <div>
                      <span className="muted">Nhận lịch</span>
                      <strong>{item.isBookable ? t("common.statusOn") : t("common.statusOff")}</strong>
                    </div>
                  </div>

                  <div className="inline-actions">
                    <button type="button" className="button-secondary" onClick={() => void editStaffMember(item)}>
                      {t("staff.editAction")}
                    </button>
                    <button type="button" className="button-secondary" onClick={() => void toggleStatus(item)}>
                      {item.status === "ACTIVE" ? t("staff.disable") : t("staff.enable")}
                    </button>
                    <button type="button" className="button-secondary" onClick={() => void resetAccess(item)}>
                      {t("staff.reset")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyBlock message={t("staff.empty")} />
        )}
      </section>
    </div>
  );
};
