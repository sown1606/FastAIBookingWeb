import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatCurrencyCents } from "../lib/format";
import { useFormDialog } from "../components/form-dialog";
import { statusLabelKey, useI18n } from "../lib/i18n";
import { requiredLabel } from "../lib/phone";

interface StaffItem {
  id: string;
  fullName: string;
  status: "ACTIVE" | "INACTIVE";
}

interface ServiceItem {
  id: string;
  name: string;
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

const staffDisplayOrder = ["Amy", "Kelly", "Trang"];

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
    durationMinutes: "45",
    priceDollars: ""
  });
  const activeStaffIds = useMemo(() => new Set(staff.map((member) => member.id)), [staff]);
  const activeStaffServices = (item: ServiceItem) =>
    item.staffServices.filter((row) => activeStaffIds.has(row.staffId));

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const [serviceResult, staffResult] = await Promise.all([
        apiGet<ServiceItem[]>("/api/v1/services?includeInactive=true"),
        apiGet<StaffItem[]>("/api/v1/staff?includeInactive=false")
      ]);
      setServices(serviceResult);
      setStaff(
        staffResult
          .filter((item) => item.status === "ACTIVE")
          .sort((left, right) => {
            const leftIndex = staffDisplayOrder.indexOf(left.fullName);
            const rightIndex = staffDisplayOrder.indexOf(right.fullName);
            return (leftIndex === -1 ? staffDisplayOrder.length : leftIndex) -
              (rightIndex === -1 ? staffDisplayOrder.length : rightIndex);
          })
      );
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const parseServiceForm = (values: {
    name: string;
    durationMinutes: string;
    priceDollars: string;
  }) => {
    const name = values.name.trim();
    const durationMinutes = Number(values.durationMinutes);
    const priceDollars = values.priceDollars.trim() === "" ? 0 : Number(values.priceDollars);

    if (name.length < 2) {
      notify("error", t("form.requiredAll"));
      return null;
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) {
      notify("error", t("form.numberInvalid"));
      return null;
    }
    if (!Number.isFinite(priceDollars) || priceDollars < 0) {
      notify("error", t("form.numberInvalid"));
      return null;
    }

    return {
      name,
      durationMinutes,
      priceCents: Math.round(priceDollars * 100)
    };
  };

  const createService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = parseServiceForm(form);
    if (!payload) {
      return;
    }
    try {
      await apiPost("/api/v1/services", payload);
      setForm({
        name: "",
        durationMinutes: "45",
        priceDollars: ""
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
        {
          name: "durationMinutes",
          label: t("services.duration"),
          type: "number",
          required: true,
          min: 1,
          max: 600
        },
        {
          name: "priceDollars",
          label: t("services.price"),
          type: "number",
          min: 0,
          step: 0.01
        }
      ],
      initialValues: {
        name: item.name,
        durationMinutes: String(item.durationMinutes),
        priceDollars: item.priceCents > 0 ? (item.priceCents / 100).toFixed(2) : ""
      },
      confirmLabel: t("services.save")
    });
    if (!values) {
      return;
    }
    const payload = parseServiceForm(values);
    if (!payload) {
      return;
    }
    try {
      await apiPatch(`/api/v1/services/${item.id}`, payload);
      notify("success", t("services.updated"));
      await load();
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  const toggleServiceState = async (item: ServiceItem) => {
    const action = item.isActive ? "deactivate" : "activate";
    try {
      await apiPost(`/api/v1/services/${item.id}/${action}`, {});
      notify("success", item.isActive ? t("services.disabled") : t("services.enabled"));
      await load();
    } catch (toggleError) {
      notify("error", extractErrorMessage(toggleError));
    }
  };

  const deleteService = async (item: ServiceItem) => {
    if (!window.confirm(t("services.deleteConfirm"))) {
      return;
    }
    try {
      await apiDelete(`/api/v1/services/${item.id}`);
      notify("success", t("services.deleted"));
      await load();
    } catch (deleteError) {
      notify("error", extractErrorMessage(deleteError));
    }
  };

  const mapServiceToStaff = async (item: ServiceItem) => {
    const defaultValue = activeStaffServices(item).map((row) => row.staffId).join(",");
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
      await apiPut(`/api/v1/services/${item.id}/staff`, { staffIds });
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
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{t("services.createTitle")}</h2>
        <form className="form-grid two-columns" onSubmit={createService}>
          <label className="field">
            <span>{requiredLabel(t("services.name"))}</span>
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
              minLength={2}
            />
          </label>
          <label className="field">
            <span>{requiredLabel(t("services.duration"))}</span>
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
            <span>{t("services.price")}</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.priceDollars}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, priceDollars: event.target.value }))
              }
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
        <div className="section-header">
          <div>
            <h2>{t("services.staffMatrixTitle")}</h2>
            <p className="muted">{t("services.staffMatrixHint")}</p>
          </div>
          <span className="status-pill info">{t("staff.directoryCount", { count: staff.length })}</span>
        </div>
        {services.length && staff.length ? (
          <div className="service-matrix-wrap">
            <div
              className="service-matrix"
              style={{ "--staff-count": staff.length } as CSSProperties}
            >
              <div className="service-matrix-heading service-matrix-sticky">
                {t("services.serviceColumn")}
              </div>
              {staff.map((member) => (
                <div key={member.id} className="service-matrix-heading service-matrix-staff">
                  <strong>{member.fullName}</strong>
                </div>
              ))}
              {services.map((service) => {
                const assigned = new Set(activeStaffServices(service).map((row) => row.staffId));
                return (
                  <div key={service.id} className="service-matrix-row">
                    <div className="service-matrix-service service-matrix-sticky">
                      <strong>{service.name}</strong>
                      <span className="muted">
                        {service.durationMinutes} min
                        {service.priceCents > 0 ? ` · ${formatCurrencyCents(service.priceCents)}` : ""}
                      </span>
                      <span className={service.isActive ? "status-pill success" : "status-pill warning"}>
                        {statusLabelKey(service.isActive ? "ACTIVE" : "INACTIVE")
                          ? t(statusLabelKey(service.isActive ? "ACTIVE" : "INACTIVE")!)
                          : service.isActive
                            ? "ACTIVE"
                            : "INACTIVE"}
                      </span>
                    </div>
                    {staff.map((member) => (
                      <div
                        key={`${service.id}-${member.id}`}
                        className={
                          assigned.has(member.id)
                            ? "service-matrix-cell service-matrix-cell-on"
                            : "service-matrix-cell"
                        }
                      >
                        {assigned.has(member.id)
                          ? t("services.canPerform")
                          : t("services.cannotPerform")}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <EmptyBlock message={services.length ? t("appointments.noStaffColumns") : t("services.empty")} />
        )}
      </section>

      <section className="card">
        <h2>{t("services.listTitle")}</h2>
        {services.length ? (
          <div className="entity-grid">
            {services.map((item) => (
              <article key={item.id} className="entity-card">
                <div className="entity-card-header">
                  <div className="service-card-title">
                    <span className="service-icon-tile">{item.name.slice(0, 1).toUpperCase()}</span>
                    <div className="entity-card-copy">
                      <strong>{item.name}</strong>
                      <span className="muted">
                        {item.durationMinutes} min
                        {item.priceCents > 0 ? ` · ${formatCurrencyCents(item.priceCents)}` : ""}
                      </span>
                    </div>
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
                  {item.priceCents > 0 ? (
                    <div className="entity-metric">
                      <span className="muted">{t("services.price")}</span>
                      <strong>{formatCurrencyCents(item.priceCents)}</strong>
                    </div>
                  ) : null}
                  <div className="entity-metric">
                    <span className="muted">{t("services.assignedStaffCount")}</span>
                    <strong>{activeStaffServices(item).length}</strong>
                  </div>
                </div>
                <div className="summary-badges">
                  {activeStaffServices(item).length ? (
                    activeStaffServices(item).map((row) => (
                      <span key={row.staffId} className="summary-badge">
                        {row.staff.fullName}
                      </span>
                    ))
                  ) : (
                    <span className="summary-badge">{t("services.noAssignedStaff")}</span>
                  )}
                </div>
                <div className="inline-actions">
                  <button type="button" className="button-secondary" onClick={() => void editService(item)}>
                    {t("services.editAction")}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => void toggleServiceState(item)}>
                    {item.isActive ? t("services.disableAction") : t("services.enableAction")}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => void mapServiceToStaff(item)}>
                    {t("services.assignStaff")}
                  </button>
                  <button type="button" className="button-danger-outline" onClick={() => void deleteService(item)}>
                    {t("services.deleteAction")}
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
