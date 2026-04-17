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
        <h2>{t("staff.listTitle")}</h2>
        {staff.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("staff.fullName")}</th>
                <th>{t("staff.title")}</th>
                <th>{t("common.status")}</th>
                <th>{t("staff.login")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="person-cell">
                      <DemoAvatar name={item.fullName} variant="staff" size="sm" />
                      <span>
                        {item.fullName}
                        <span className="muted">{item.email ?? "-"}</span>
                      </span>
                    </div>
                  </td>
                  <td>{item.title ?? "-"}</td>
                  <td>{statusLabelKey(item.status) ? t(statusLabelKey(item.status)!) : item.status}</td>
                  <td>{item.user ? (item.user.isActive ? t("staff.on") : t("staff.off")) : t("staff.notCreated")}</td>
                  <td>
                    <div className="inline-actions">
                      <button type="button" className="button-secondary" onClick={() => editStaffMember(item)}>
                        {t("staff.editAction")}
                      </button>
                      <button type="button" className="button-secondary" onClick={() => toggleStatus(item)}>
                        {item.status === "ACTIVE" ? t("staff.disable") : t("staff.enable")}
                      </button>
                      <button type="button" className="button-secondary" onClick={() => resetAccess(item)}>
                        {t("staff.reset")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : (
          <EmptyBlock message={t("staff.empty")} />
        )}
      </section>
    </div>
  );
};
