import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, apiPut, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatCurrencyCents } from "../lib/format";
import { useFormDialog } from "../components/form-dialog";
import { statusLabelKey, useI18n } from "../lib/i18n";

interface StaffItem {
  id: string;
  fullName: string;
  status: "ACTIVE" | "INACTIVE";
}

interface ServiceItem {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  isActive: boolean;
  staffServices: Array<{
    staffId: string;
    staff: {
      id: string;
      fullName: string;
    };
  }>;
}

export const ServicesPage = () => {
  const { notify } = useToast();
  const { openFormDialog, FormDialog } = useFormDialog();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [staff, setStaff] = useState<StaffItem[]>([]);

  const [form, setForm] = useState({
    name: "",
    description: "",
    durationMinutes: "45",
    priceCents: "4500"
  });

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const [serviceResult, staffResult] = await Promise.all([
        apiGet<ServiceItem[]>("/api/v1/services?includeInactive=true"),
        apiGet<StaffItem[]>("/api/v1/staff?includeInactive=false")
      ]);
      setServices(serviceResult);
      setStaff(staffResult.filter((item) => item.status === "ACTIVE"));
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiPost<unknown, unknown>("/api/v1/services", {
        name: form.name,
        description: form.description || undefined,
        durationMinutes: Number(form.durationMinutes),
        priceCents: Number(form.priceCents)
      });
      setForm({
        name: "",
        description: "",
        durationMinutes: "45",
        priceCents: "4500"
      });
      notify("success", t("services.created"));
      await load();
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const editService = async (item: ServiceItem) => {
    const values = await openFormDialog({
      title: t("services.edit"),
      fields: [
        { name: "name", label: t("services.name"), required: true },
        { name: "description", label: t("services.description"), type: "textarea" },
        { name: "durationMinutes", label: t("services.duration"), type: "number", required: true, min: 1, max: 600 },
        { name: "priceCents", label: t("services.priceCents"), type: "number", required: true, min: 0 }
      ],
      initialValues: {
        name: item.name,
        description: item.description ?? "",
        durationMinutes: String(item.durationMinutes),
        priceCents: String(item.priceCents)
      },
      confirmLabel: t("services.save")
    });
    if (!values) {
      return;
    }
    try {
      await apiPatch<unknown, unknown>(`/api/v1/services/${item.id}`, {
        name: values.name,
        description: values.description || null,
        durationMinutes: Number(values.durationMinutes),
        priceCents: Number(values.priceCents)
      });
      notify("success", t("services.updated"));
      await load();
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  const toggleServiceState = async (item: ServiceItem) => {
    const action = item.isActive ? "deactivate" : "activate";
    try {
      await apiPost<unknown, Record<string, never>>(`/api/v1/services/${item.id}/${action}`, {});
      notify("success", item.isActive ? t("services.disabled") : t("services.enabled"));
      await load();
    } catch (toggleError) {
      notify("error", extractErrorMessage(toggleError));
    }
  };

  const mapServiceToStaff = async (item: ServiceItem) => {
    const defaultValue = item.staffServices.map((row) => row.staffId).join(",");
    const values = await openFormDialog({
      title: t("services.assignStaff"),
      description: item.name,
      fields: [
        {
          name: "staffIds",
          label: t("services.staffForService"),
          type: "checkbox-list",
          options: staff.map((member) => ({
            value: member.id,
            label: member.fullName
          }))
        }
      ],
      initialValues: {
        staffIds: defaultValue
      },
      confirmLabel: t("common.save")
    });
    if (!values) {
      return;
    }
    const staffIds = values.staffIds
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    try {
      await apiPut<unknown, { staffIds: string[] }>(`/api/v1/services/${item.id}/staff`, {
        staffIds
      });
      notify("success", t("services.staffAssigned"));
      await load();
    } catch (mapError) {
      notify("error", extractErrorMessage(mapError));
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
        <div className="section-header">
          <div>
            <h2>{t("services.listTitle")}</h2>
            <p className="muted">{t("services.catalogHint")}</p>
          </div>
          <div className="summary-badges">
            <span className="summary-badge">
              {t("services.activeCount")}: {services.filter((item) => item.isActive).length}
            </span>
            <span className="summary-badge">
              {t("services.inactiveCount")}: {services.filter((item) => !item.isActive).length}
            </span>
            <span className="summary-badge">
              {t("services.assignedStaffCount")}: {services.reduce((sum, item) => sum + item.staffServices.length, 0)}
            </span>
          </div>
        </div>
      </section>
      <section className="card">
        <h2>{t("services.createTitle")}</h2>
        <form className="form-grid two-columns" onSubmit={createService}>
          <label className="field">
            <span>{t("services.name")}</span>
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{t("services.description")}</span>
            <input
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>{t("services.duration")}</span>
            <input
              type="number"
              min={1}
              max={600}
              value={form.durationMinutes}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, durationMinutes: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("services.priceCents")}</span>
            <input
              type="number"
              min={0}
              value={form.priceCents}
              onChange={(event) => setForm((prev) => ({ ...prev, priceCents: event.target.value }))}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              {t("services.add")}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>{t("services.listTitle")}</h2>
        {services.length ? (
          <div className="entity-grid">
            {services.map((item) => (
              <article key={item.id} className="entity-card">
                <div className="entity-card-header">
                  <div className="entity-card-copy">
                    <strong>{item.name}</strong>
                    <span className="muted">{item.description || t("services.description")}</span>
                  </div>
                  <span className={item.isActive ? "status-pill success" : "status-pill warning"}>
                    {statusLabelKey(item.isActive ? "ACTIVE" : "INACTIVE")
                      ? t(statusLabelKey(item.isActive ? "ACTIVE" : "INACTIVE")!)
                      : item.isActive
                        ? "ACTIVE"
                        : "INACTIVE"}
                  </span>
                </div>
                <div className="entity-metric-grid">
                  <div className="entity-metric">
                    <span className="muted">{t("services.duration")}</span>
                    <strong>{item.durationMinutes} min</strong>
                  </div>
                  <div className="entity-metric">
                    <span className="muted">{t("services.priceCents")}</span>
                    <strong>{formatCurrencyCents(item.priceCents)}</strong>
                  </div>
                  <div className="entity-metric">
                    <span className="muted">{t("services.assignedStaffCount")}</span>
                    <strong>{item.staffServices.length}</strong>
                  </div>
                </div>
                <div className="summary-badges">
                  {item.staffServices.length ? (
                    item.staffServices.map((row) => (
                      <span key={row.staffId} className="summary-badge">
                        {row.staff.fullName}
                      </span>
                    ))
                  ) : (
                    <span className="summary-badge">{t("common.none")}</span>
                  )}
                </div>
                <div className="inline-actions">
                  <button type="button" className="button-secondary" onClick={() => void editService(item)}>
                    {t("staff.editAction")}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => toggleServiceState(item)}>
                    {item.isActive ? t("staff.disable") : t("staff.enable")}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => void mapServiceToStaff(item)}>
                    {t("services.assignStaff")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock message={t("services.empty")} />
        )}
      </section>
    </div>
  );
};
