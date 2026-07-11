import { apiDelete, apiGet, extractErrorMessage } from "./api";
import type { TranslationKey } from "./i18n";

export interface SalonDeletePreview {
  salonId: string;
  salonName: string;
  status: string;
  counts: Record<string, number>;
  activeCallCount: number;
  activeAppointmentCount?: number;
  inProgressAppointmentCount: number;
  configuredProviders: string[];
  warnings: string[];
}

export interface SalonDeleteResponse {
  salonId: string;
  deleted: true;
  deletedAt: string;
  deletedUserCount: number;
  counts: Record<string, number>;
  externalCleanupRequired: string[];
}

type OpenFormDialog = <T extends Record<string, string>>(config: {
  title: string;
  description?: string;
  fields: Array<{
    name: string;
    label: string;
    required?: boolean;
    placeholder?: string;
  }>;
  initialValues: T;
  confirmLabel?: string;
  cancelLabel?: string;
}) => Promise<T | null>;

type Notify = (type: "success" | "error", message: string) => void;
type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

const ensureArray = (value: string[] | null | undefined) => (Array.isArray(value) ? value : []);

export const openSalonDeleteDialog = async (input: {
  salonId: string;
  t: Translate;
  openFormDialog: OpenFormDialog;
  notify: Notify;
  onDeleted?: (result: SalonDeleteResponse) => void | Promise<void>;
}) => {
  const { salonId, t, openFormDialog, notify, onDeleted } = input;

  try {
    const preview = await apiGet<SalonDeletePreview>(`/api/v1/admin/salons/${salonId}/delete-preview`);
    const countSummary = [
      `${t("salonDelete.ownerCount")}: ${preview.counts.owners ?? 0}`,
      `${t("salonDelete.staffCount")}: ${preview.counts.staff ?? 0}`,
      `${t("salonDelete.appointmentCount")}: ${preview.counts.appointments ?? 0}`,
      `${t("salonDelete.customerCount")}: ${preview.counts.customers ?? 0}`,
      `${t("salonDelete.callCount")}: ${preview.counts.callSessions ?? 0}`
    ].join(" · ");
    const activeSummary = [
      `${t("salonDetail.activeCalls")}: ${preview.activeCallCount}`,
      `${t("salonDelete.activeAppointments")}: ${
        preview.activeAppointmentCount ?? preview.inProgressAppointmentCount
      }`
    ].join(" · ");
    const externalCleanup = ensureArray(preview.configuredProviders).length
      ? `${t("salonDetail.externalCleanup")}: ${preview.configuredProviders.join(", ")}.`
      : "";
    const warnings = ensureArray(preview.warnings).join(" ");

    const values = await openFormDialog({
      title: t("salonDetail.confirmPermanentDelete"),
      description: [
        preview.salonName,
        t("salonDetail.permanentDeleteWarning"),
        t("salonDetail.permanentDeleteLoginWarning"),
        activeSummary,
        countSummary,
        externalCleanup,
        warnings
      ].filter(Boolean).join(" "),
      fields: [
        {
          name: "confirmationName",
          label: t("salonDetail.confirmSalonName"),
          required: true,
          placeholder: preview.salonName
        }
      ],
      initialValues: {
        confirmationName: ""
      },
      confirmLabel: t("salonDetail.permanentDeleteSalon")
    });

    if (!values) {
      return false;
    }
    if (values.confirmationName.trim() !== preview.salonName) {
      notify("error", t("salonDetail.confirmSalonName"));
      return false;
    }

    const result = await apiDelete<SalonDeleteResponse>(`/api/v1/admin/salons/${salonId}`, {
      data: {
        confirmPermanentDelete: true,
        confirmationName: values.confirmationName
      }
    });
    notify(
      "success",
      t("salonDetail.permanentDeleteSuccess", {
        userCount: String(result.deletedUserCount)
      })
    );
    await onDeleted?.(result);
    return true;
  } catch (error) {
    notify("error", extractErrorMessage(error));
    return false;
  }
};
