import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatCurrencyCents } from "../lib/format";
import { useFormDialog } from "../components/form-dialog";

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
      notify("success", "Đã tạo nhân viên.");
      await load();
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const editStaffMember = async (item: StaffItem) => {
    const values = await openFormDialog({
      title: "Sửa nhân viên",
      fields: [
        { name: "fullName", label: "Họ tên", required: true },
        { name: "email", label: "Email", type: "email", required: true },
        { name: "phone", label: "Số điện thoại Mỹ", type: "tel", required: true },
        { name: "title", label: "Vai trò" }
      ],
      initialValues: {
        fullName: item.fullName,
        email: item.email ?? "",
        phone: item.phone ?? "",
        title: item.title ?? ""
      },
      confirmLabel: "Lưu nhân viên"
    });
    if (!values) {
      return;
    }
    try {
      await apiPatch<unknown, unknown>(`/api/v1/staff/${item.id}`, {
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
        title: values.title
      });
      notify("success", "Đã cập nhật nhân viên.");
      await load();
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  const toggleStatus = async (item: StaffItem) => {
    const action = item.status === "ACTIVE" ? "deactivate" : "reactivate";
    try {
      await apiPost<unknown, Record<string, never>>(`/api/v1/staff/${item.id}/${action}`, {});
      notify("success", item.status === "ACTIVE" ? "Đã tắt nhân viên." : "Đã bật lại nhân viên.");
      await load();
    } catch (toggleError) {
      notify("error", extractErrorMessage(toggleError));
    }
  };

  const resetAccess = async (item: StaffItem) => {
    const values = await openFormDialog({
      title: "Đặt lại đăng nhập",
      description: item.fullName,
      fields: [
        {
          name: "newPassword",
          label: "Mật khẩu mới",
          type: "password",
          required: true,
          min: 8
        }
      ],
      initialValues: {
        newPassword: ""
      },
      confirmLabel: "Đặt lại"
    });
    if (!values?.newPassword) {
      return;
    }
    try {
      await apiPost<unknown, { newPassword: string }>(`/api/v1/staff/${item.id}/reset-access`, {
        newPassword: values.newPassword
      });
      notify("success", "Đã đặt lại đăng nhập.");
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
        <h2>Sử dụng nhân viên và chi phí</h2>
        <div className="metrics-grid">
          <div>
            <span className="muted">Nhân viên miễn phí</span>
            <strong>{billing?.currentUsage.freeStaffLimit ?? 0}</strong>
          </div>
          <div>
            <span className="muted">Đang hoạt động</span>
            <strong>{billing?.currentUsage.activeStaffCount ?? 0}</strong>
          </div>
          <div>
            <span className="muted">Tính phí thêm</span>
            <strong>{billing?.currentUsage.billableExtraStaffCount ?? 0}</strong>
          </div>
          <div>
            <span className="muted">Chi phí thêm dự kiến</span>
            <strong>{formatCurrencyCents(billing?.currentUsage.estimatedExtraCostCents)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Thêm nhân viên</h2>
        <form className="form-grid two-columns" onSubmit={createStaffMember}>
          <label className="field">
            <span>Họ tên</span>
            <input
              value={form.fullName}
              onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Số điện thoại Mỹ</span>
            <input
              type="tel"
              inputMode="numeric"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Vai trò</span>
            <input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              Gửi lời mời
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Danh sách nhân viên</h2>
        {staff.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th>Đăng nhập</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.fullName}
                    <div className="muted">{item.email ?? "-"}</div>
                  </td>
                  <td>{item.title ?? "-"}</td>
                  <td>{item.status}</td>
                  <td>{item.user ? (item.user.isActive ? "Đang bật" : "Đang tắt") : "Chưa tạo"}</td>
                  <td>
                    <div className="inline-actions">
                      <button type="button" className="button-secondary" onClick={() => editStaffMember(item)}>
                        Sửa
                      </button>
                      <button type="button" className="button-secondary" onClick={() => toggleStatus(item)}>
                        {item.status === "ACTIVE" ? "Tắt" : "Bật lại"}
                      </button>
                      <button type="button" className="button-secondary" onClick={() => resetAccess(item)}>
                        Đặt lại
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : (
          <EmptyBlock message="Chưa có nhân viên nào." />
        )}
      </section>
    </div>
  );
};
