import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, apiPut, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatCurrencyCents } from "../lib/format";
import { useFormDialog } from "../components/form-dialog";

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
      notify("success", "Đã tạo dịch vụ.");
      await load();
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const editService = async (item: ServiceItem) => {
    const values = await openFormDialog({
      title: "Sửa dịch vụ",
      fields: [
        { name: "name", label: "Tên dịch vụ", required: true },
        { name: "description", label: "Mô tả", type: "textarea" },
        { name: "durationMinutes", label: "Thời lượng (phút)", type: "number", required: true, min: 1, max: 600 },
        { name: "priceCents", label: "Giá (cent)", type: "number", required: true, min: 0 }
      ],
      initialValues: {
        name: item.name,
        description: item.description ?? "",
        durationMinutes: String(item.durationMinutes),
        priceCents: String(item.priceCents)
      },
      confirmLabel: "Lưu dịch vụ"
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
      notify("success", "Đã cập nhật dịch vụ.");
      await load();
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  const toggleServiceState = async (item: ServiceItem) => {
    const action = item.isActive ? "deactivate" : "activate";
    try {
      await apiPost<unknown, Record<string, never>>(`/api/v1/services/${item.id}/${action}`, {});
      notify("success", item.isActive ? "Đã tắt dịch vụ." : "Đã bật dịch vụ.");
      await load();
    } catch (toggleError) {
      notify("error", extractErrorMessage(toggleError));
    }
  };

  const mapServiceToStaff = async (item: ServiceItem) => {
    const defaultValue = item.staffServices.map((row) => row.staffId).join(",");
    const values = await openFormDialog({
      title: "Gán nhân viên cho dịch vụ",
      description: item.name,
      fields: [
        {
          name: "staffIds",
          label: "Nhân viên nhận dịch vụ này",
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
      confirmLabel: "Lưu phân công"
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
      notify("success", "Đã cập nhật nhân viên cho dịch vụ.");
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
        <h2>Tạo dịch vụ</h2>
        <form className="form-grid two-columns" onSubmit={createService}>
          <label className="field">
            <span>Tên dịch vụ</span>
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Mô tả</span>
            <input
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Thời lượng (phút)</span>
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
            <span>Giá (cent)</span>
            <input
              type="number"
              min={0}
              value={form.priceCents}
              onChange={(event) => setForm((prev) => ({ ...prev, priceCents: event.target.value }))}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              Thêm dịch vụ
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Dịch vụ</h2>
        {services.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Thời lượng</th>
                <th>Giá</th>
                <th>Trạng thái</th>
                <th>Nhân viên</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {services.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.durationMinutes} min</td>
                  <td>{formatCurrencyCents(item.priceCents)}</td>
                  <td>{item.isActive ? "ACTIVE" : "INACTIVE"}</td>
                  <td>{item.staffServices.length}</td>
                  <td>
                    <div className="inline-actions">
                      <button type="button" className="button-secondary" onClick={() => void editService(item)}>
                        Sửa
                      </button>
                      <button type="button" className="button-secondary" onClick={() => toggleServiceState(item)}>
                        {item.isActive ? "Tắt" : "Bật"}
                      </button>
                      <button type="button" className="button-secondary" onClick={() => void mapServiceToStaff(item)}>
                        Gán nhân viên
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : (
          <EmptyBlock message="Chưa có dịch vụ nào." />
        )}
      </section>
    </div>
  );
};
