import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { useFormDialog } from "../components/form-dialog";
import { getStaffTitleLabel, getStaffTitleOptions } from "../lib/form-options";
import { formatUsPhoneInput, requiredLabel, validateOptionalUsPhone } from "../lib/phone";
import { statusLabelKey, useI18n } from "../lib/i18n";
import { InfoHint } from "../components/info-hint";
import { DemoAvatar } from "../components/avatar";

const DEFAULT_STAFF_TITLE = "Nail Technician";

interface StaffItem {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  status: "ACTIVE" | "INACTIVE";
  isBookable: boolean;
}

interface StaffResetAccessResponse {
  staff: StaffItem;
  invitation?: {
    email?: string | null;
  };
  emailSent?: boolean;
}

const generatePassword = (): string => {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%&*"
  ];
  const allCharacters = groups.join("");
  const randomIndex = (length: number) => {
    const value = new Uint32Array(1);
    window.crypto.getRandomValues(value);
    return value[0] % length;
  };
  const characters = groups.map((group) => group[randomIndex(group.length)]);

  while (characters.length < 12) {
    characters.push(allCharacters[randomIndex(allCharacters.length)]);
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }

  return characters.join("");
};

export const StaffPage = () => {
  const { notify } = useToast();
  const { openFormDialog, FormDialog } = useFormDialog();
  const { t } = useI18n();
  const staffTitleOptions = getStaffTitleOptions(t);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    title: DEFAULT_STAFF_TITLE,
    isBookable: true
  });

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      setStaff(await apiGet<StaffItem[]>("/api/v1/staff?includeInactive=true"));
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
    const fullName = form.fullName.trim();
    const email = form.email.trim().toLowerCase();
    const phone = form.phone.trim();
    const title = form.title.trim();
    if (fullName.length < 2 || !email || !phone) {
      notify("error", t("form.requiredAll"));
      return;
    }
    if (!validateOptionalUsPhone(phone)) {
      notify("error", t("form.phoneInvalid"));
      return;
    }
    try {
      await apiPost("/api/v1/staff", {
        fullName,
        email,
        phone,
        title: title || undefined,
        isBookable: form.isBookable,
        createLogin: true
      });
      setForm({
        fullName: "",
        email: "",
        phone: "",
        title: DEFAULT_STAFF_TITLE,
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
        { name: "title", label: t("staff.title"), type: "select", options: staffTitleOptions },
        {
          name: "isBookable",
          label: t("staff.isBookableField"),
          type: "select",
          required: true,
          options: [
            { value: "true", label: t("common.statusOn") },
            { value: "false", label: t("common.statusOff") }
          ]
        }
      ],
      initialValues: {
        fullName: item.fullName,
        email: item.email ?? "",
        phone: formatUsPhoneInput(item.phone ?? ""),
        title: item.title ?? "",
        isBookable: item.isBookable ? "true" : "false"
      },
      confirmLabel: t("staff.save")
    });
    if (!values) {
      return;
    }
    const fullName = values.fullName.trim();
    const email = values.email.trim().toLowerCase();
    const phone = values.phone.trim();
    const title = values.title.trim();
    if (fullName.length < 2 || !email || !phone) {
      notify("error", t("form.requiredAll"));
      return;
    }
    if (!validateOptionalUsPhone(phone)) {
      notify("error", t("form.phoneInvalid"));
      return;
    }
    try {
      await apiPatch(`/api/v1/staff/${item.id}`, {
        fullName,
        email,
        phone,
        title: title || null,
        isBookable: values.isBookable === "true"
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
      await apiPost(`/api/v1/staff/${item.id}/${action}`, {});
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
          min: 8,
          generateLabel: t("staff.generatePassword"),
          generateValue: generatePassword
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
    if (values.newPassword.length < 8) {
      notify("error", t("auth.register.passwordHint"));
      return;
    }
    try {
      const result = await apiPost<StaffResetAccessResponse, { newPassword: string }>(
        `/api/v1/staff/${item.id}/reset-access`,
        { newPassword: values.newPassword }
      );
      notify(
        result.emailSent ? "success" : "error",
        result.emailSent ? t("staff.passwordChangedEmailSent") : t("staff.passwordChangedEmailFailed")
      );
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
        <div>
          <h2>{t("staff.addTitle")}</h2>
          <p className="muted">{t("staff.addHint")}</p>
        </div>
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
              onChange={(event) =>
                setForm((prev) => ({ ...prev, phone: formatUsPhoneInput(event.target.value) }))
              }
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
              {staffTitleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field checkbox-row">
            <span>
              {t("staff.isBookableField")}
              <InfoHint text={t("hints.staffBookable")} />
            </span>
            <input
              type="checkbox"
              checked={form.isBookable}
              onChange={(event) => setForm((prev) => ({ ...prev, isBookable: event.target.checked }))}
            />
            <small>{t("staff.bookingCallReady")}</small>
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
            <p className="muted">{t("staff.directoryHint")}</p>
          </div>
          <span className="status-pill info">{t("staff.directoryCount", { count: staff.length })}</span>
        </div>
        {staff.length ? (
          <div className="staff-grid">
            {staff.map((item) => {
              const phoneLabel = item.phone ? formatUsPhoneInput(item.phone) : t("staff.phoneMissing");
              const emailLabel = item.email ?? t("staff.emailMissing");
              const titleLabel = getStaffTitleLabel(item.title, t);

              return (
                <article
                  key={item.id}
                  className={item.status === "ACTIVE" ? "staff-card" : "staff-card staff-card-inactive"}
                >
                  <div className="staff-card-header">
                    <div className="staff-identity">
                      <DemoAvatar name={item.fullName} variant="staff" size="md" />
                      <div className="staff-identity-copy">
                        <strong>{item.fullName}</strong>
                        <span>{titleLabel}</span>
                      </div>
                    </div>
                    <div className="staff-chip-row">
                      <span className={item.status === "ACTIVE" ? "status-pill success" : "status-pill warning"}>
                        {statusLabelKey(item.status) ? t(statusLabelKey(item.status)!) : item.status}
                      </span>
                      <span className={item.isBookable ? "status-pill info" : "status-pill"}>
                        {t("staff.isBookableField")}: {item.isBookable ? t("common.statusOn") : t("common.statusOff")}
                      </span>
                      {item.status === "ACTIVE" && item.isBookable ? (
                        <span className="status-pill staff-call-ready">{t("staff.aiCallReady")}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="staff-contact-grid">
                    <div>
                      <span className="muted">{t("common.email")}</span>
                      <strong>{emailLabel}</strong>
                    </div>
                    <div>
                      <span className="muted">{t("common.phone")}</span>
                      <strong>{phoneLabel}</strong>
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
