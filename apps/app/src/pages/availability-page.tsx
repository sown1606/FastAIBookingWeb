import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { useAuth } from "../auth/auth-context";
import { useToast } from "../components/toast";
import { formatDateTime } from "../lib/format";

interface StaffItem {
  id: string;
  fullName: string;
}

interface ServiceItem {
  id: string;
  name: string;
  isActive: boolean;
}

interface SlotsResponse {
  date: string;
  slots: Array<{
    startTime: string;
    endTime: string;
  }>;
}

interface SlotValidationResult {
  valid: boolean;
  reason?: string;
  endTime: string;
  durationMinutes: number;
}

export const AvailabilityPage = () => {
  const { session } = useAuth();
  const { notify } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [slots, setSlots] = useState<SlotsResponse | null>(null);
  const [validation, setValidation] = useState<SlotValidationResult | null>(null);

  const today = new Date().toISOString().split("T")[0] ?? "";
  const [form, setForm] = useState({
    staffId: session?.user.staffId ?? "",
    serviceId: "",
    date: today
  });

  const isOwner = session?.user.role === "SALON_OWNER";

  const loadReferences = async () => {
    setError("");
    setLoading(true);
    try {
      const [serviceResult, staffResult] = await Promise.all([
        apiGet<ServiceItem[]>("/api/v1/services"),
        isOwner ? apiGet<StaffItem[]>("/api/v1/staff?includeInactive=false") : Promise.resolve([])
      ]);

      setServices(serviceResult.filter((item) => item.isActive));
      setStaff(staffResult);

      if (!isOwner && session?.user.staffId) {
        setForm((prev) => ({ ...prev, staffId: session.user.staffId ?? prev.staffId }));
      }
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReferences();
  }, [isOwner, session?.user.staffId]);

  const searchSlots = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidation(null);
    try {
      const params = new URLSearchParams({
        staffId: form.staffId,
        serviceId: form.serviceId,
        date: form.date,
        intervalMinutes: "15"
      });
      const result = await apiGet<SlotsResponse>(`/api/v1/availability/slots?${params.toString()}`);
      setSlots(result);
      notify("success", `Tìm thấy ${result.slots.length} khung giờ trống.`);
    } catch (searchError) {
      notify("error", extractErrorMessage(searchError));
    }
  };

  const validateSlot = async (startTime: string) => {
    try {
      const result = await apiPost<SlotValidationResult, unknown>("/api/v1/availability/validate", {
        staffId: form.staffId,
        serviceId: form.serviceId,
        startTime
      });
      setValidation(result);
    } catch (validateError) {
      notify("error", extractErrorMessage(validateError));
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={loadReferences} />;
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Kiểm tra giờ trống</h2>
        <form className="form-grid two-columns" onSubmit={searchSlots}>
          <label className="field">
            <span>Nhân viên</span>
            {isOwner ? (
              <select
                value={form.staffId}
                onChange={(event) => setForm((prev) => ({ ...prev, staffId: event.target.value }))}
                required
              >
                <option value="">Chọn nhân viên</option>
                {staff.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName}
                  </option>
                ))}
              </select>
            ) : (
              <input value={session?.user.fullName ?? ""} disabled />
            )}
          </label>
          <label className="field">
            <span>Dịch vụ</span>
            <select
              value={form.serviceId}
              onChange={(event) => setForm((prev) => ({ ...prev, serviceId: event.target.value }))}
              required
            >
              <option value="">Chọn dịch vụ</option>
              {services.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Ngày</span>
            <input
              type="date"
              value={form.date}
              onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
              required
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              Tìm giờ trống
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Giờ trống</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bắt đầu</th>
                <th>Kết thúc</th>
                <th>Kiểm tra</th>
              </tr>
            </thead>
            <tbody>
              {slots?.slots.map((slot) => (
                <tr key={slot.startTime}>
                  <td>{formatDateTime(slot.startTime)}</td>
                  <td>{formatDateTime(slot.endTime)}</td>
                  <td>
                    <button type="button" className="button-secondary" onClick={() => validateSlot(slot.startTime)}>
                      Kiểm tra giờ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {validation ? (
          <div className={validation.valid ? "muted" : "form-error"}>
            {validation.valid
              ? `Giờ hợp lệ. Kết thúc lúc ${formatDateTime(validation.endTime)} (${validation.durationMinutes} phút)`
              : validation.reason ?? "Giờ này không hợp lệ."}
          </div>
        ) : null}
      </section>
    </div>
  );
};
