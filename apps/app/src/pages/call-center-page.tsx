import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatDateTime } from "../lib/format";
import { toDateTimeLocalValue, useFormDialog } from "../components/form-dialog";

interface SalonItem {
  id: string;
  name: string;
  customerIncomingPhoneNumber: string | null;
}

interface StaffItem {
  id: string;
  fullName: string;
  currentWorkStatus: string;
}

interface ServiceItem {
  id: string;
  name: string;
  isActive: boolean;
}

interface CustomerItem {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface CustomersResponse {
  items: CustomerItem[];
}

interface AppointmentItem {
  id: string;
  startTime: string;
  status: string;
  customer: CustomerItem;
  staff: StaffItem;
  service: ServiceItem;
}

interface AppointmentsResponse {
  items: AppointmentItem[];
}

const appointmentStatusOptions = [
  { value: "SCHEDULED", label: "SCHEDULED" },
  { value: "CONFIRMED", label: "CONFIRMED" },
  { value: "CANCELED", label: "CANCELED" },
  { value: "NO_SHOW", label: "NO_SHOW" }
];

export const CallCenterPage = () => {
  const { notify } = useToast();
  const { openFormDialog, FormDialog } = useFormDialog();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [salons, setSalons] = useState<SalonItem[]>([]);
  const [selectedSalonId, setSelectedSalonId] = useState("");
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [customerForm, setCustomerForm] = useState({
    firstName: "",
    lastName: "",
    phone: ""
  });
  const [bookingForm, setBookingForm] = useState({
    customerId: "",
    staffId: "",
    serviceId: "",
    startTime: ""
  });

  const loadSalonData = async (salonId: string) => {
    const [staffItems, serviceItems, customerItems, appointmentItems] = await Promise.all([
      apiGet<StaffItem[]>(`/api/v1/call-center/salons/${salonId}/staff`),
      apiGet<ServiceItem[]>(`/api/v1/call-center/salons/${salonId}/services`),
      apiGet<CustomersResponse>(`/api/v1/call-center/salons/${salonId}/customers?page=1&limit=100`),
      apiGet<AppointmentsResponse>(`/api/v1/call-center/salons/${salonId}/appointments?page=1&limit=50`)
    ]);
    setStaff(staffItems);
    setServices(serviceItems.filter((item) => item.isActive));
    setCustomers(customerItems.items);
    setAppointments(appointmentItems.items);
  };

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const salonItems = await apiGet<SalonItem[]>("/api/v1/call-center/salons");
      setSalons(salonItems);
      const nextSalonId = selectedSalonId || salonItems[0]?.id || "";
      setSelectedSalonId(nextSalonId);
      if (nextSalonId) {
        await loadSalonData(nextSalonId);
      }
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const changeSalon = async (salonId: string) => {
    setSelectedSalonId(salonId);
    try {
      await loadSalonData(salonId);
    } catch (changeError) {
      notify("error", extractErrorMessage(changeError));
    }
  };

  const createCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSalonId) {
      notify("error", "Chưa chọn tiệm.");
      return;
    }
    try {
      await apiPost<unknown, typeof customerForm>(
        `/api/v1/call-center/salons/${selectedSalonId}/customers`,
        customerForm
      );
      setCustomerForm({ firstName: "", lastName: "", phone: "" });
      await loadSalonData(selectedSalonId);
      notify("success", "Đã tạo khách.");
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const createBooking = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSalonId) {
      notify("error", "Chưa chọn tiệm.");
      return;
    }
    try {
      await apiPost<unknown, unknown>(`/api/v1/call-center/salons/${selectedSalonId}/appointments`, {
        ...bookingForm,
        startTime: new Date(bookingForm.startTime).toISOString(),
        status: "CONFIRMED"
      });
      setBookingForm({ customerId: "", staffId: "", serviceId: "", startTime: "" });
      await loadSalonData(selectedSalonId);
      notify("success", "Đã tạo lịch hẹn.");
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const reschedule = async (appointment: AppointmentItem) => {
    const values = await openFormDialog({
      title: "Đổi giờ lịch hẹn",
      description: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      fields: [{ name: "startTime", label: "Giờ mới", type: "datetime-local", required: true }],
      initialValues: {
        startTime: toDateTimeLocalValue(appointment.startTime)
      },
      confirmLabel: "Đổi giờ"
    });
    if (!values?.startTime) {
      return;
    }
    try {
      await apiPatch<unknown, { startTime: string }>(
        `/api/v1/call-center/salons/${selectedSalonId}/appointments/${appointment.id}/reschedule`,
        { startTime: new Date(values.startTime).toISOString() }
      );
      await loadSalonData(selectedSalonId);
    } catch (rescheduleError) {
      notify("error", extractErrorMessage(rescheduleError));
    }
  };

  const updateStatus = async (appointmentId: string, status: string) => {
    const values = await openFormDialog({
      title: "Cập nhật trạng thái",
      fields: [
        {
          name: "status",
          label: "Trạng thái",
          type: "select",
          required: true,
          options: appointmentStatusOptions
        }
      ],
      initialValues: {
        status
      },
      confirmLabel: "Cập nhật"
    });
    if (!values?.status) {
      return;
    }
    try {
      await apiPatch<unknown, { status: string }>(
        `/api/v1/call-center/salons/${selectedSalonId}/appointments/${appointmentId}`,
        { status: values.status }
      );
      await loadSalonData(selectedSalonId);
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  const cancel = async (appointment: AppointmentItem) => {
    const values = await openFormDialog({
      title: "Hủy lịch hẹn",
      description: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      fields: [{ name: "reason", label: "Lý do hủy", type: "textarea", rows: 3 }],
      initialValues: {
        reason: "Khách yêu cầu hủy"
      },
      confirmLabel: "Hủy lịch"
    });
    if (!values) {
      return;
    }
    try {
      await apiPatch<unknown, { reason?: string }>(
        `/api/v1/call-center/salons/${selectedSalonId}/appointments/${appointment.id}/cancel`,
        { reason: values.reason || undefined }
      );
      await loadSalonData(selectedSalonId);
    } catch (cancelError) {
      notify("error", extractErrorMessage(cancelError));
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  const visibleAppointments = statusFilter
    ? appointments.filter((appointment) => appointment.status === statusFilter)
    : appointments;
  const openRequests = appointments.filter(
    (appointment) => appointment.status !== "COMPLETED" && appointment.status !== "CANCELED"
  ).length;

  return (
    <div className="stack">
      <FormDialog />
      <section className="card">
        <h2>Tiệm được phân công</h2>
        {salons.length ? (
          <div className="quick-actions">
            {salons.map((salon) => (
              <button
                key={salon.id}
                type="button"
                className={salon.id === selectedSalonId ? "button-primary" : "button-secondary"}
                onClick={() => void changeSalon(salon.id)}
              >
                {salon.name}
              </button>
            ))}
          </div>
        ) : (
          <EmptyBlock message="Chưa có tiệm nào được phân công cho tổng đài." />
        )}
      </section>

      <section className="card-grid">
        <article className="card stat-card">
          <h3>Yêu cầu đang xử lý</h3>
          <strong>{openRequests}</strong>
        </article>
        <article className="card stat-card">
          <h3>Nhân viên sẵn sàng</h3>
          <strong>{staff.filter((member) => member.currentWorkStatus === "AVAILABLE").length}</strong>
        </article>
      </section>

      <section className="card">
        <h2>Nhân viên và trạng thái</h2>
        {staff.length ? (
          <div className="mobile-list">
            {staff.map((member) => (
              <article key={member.id} className="mobile-item">
                <strong>{member.fullName}</strong>
                <span>{member.currentWorkStatus}</span>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock message="Tiệm này chưa có nhân viên khả dụng." />
        )}
      </section>

      <section className="card">
        <h2>Thêm khách nhanh</h2>
        <form className="form-grid two-columns" onSubmit={createCustomer}>
          <label className="field">
            <span>Tên</span>
            <input
              value={customerForm.firstName}
              onChange={(event) => setCustomerForm((prev) => ({ ...prev, firstName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Họ</span>
            <input
              value={customerForm.lastName}
              onChange={(event) => setCustomerForm((prev) => ({ ...prev, lastName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Số điện thoại</span>
            <input
              type="tel"
              inputMode="numeric"
              value={customerForm.phone}
              onChange={(event) => setCustomerForm((prev) => ({ ...prev, phone: event.target.value }))}
              required
            />
          </label>
          <button type="submit" className="button-primary">
            Tạo khách
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Tạo lịch hẹn</h2>
        <form className="form-grid two-columns" onSubmit={createBooking}>
          <label className="field">
            <span>Khách</span>
            <select
              value={bookingForm.customerId}
              onChange={(event) => setBookingForm((prev) => ({ ...prev, customerId: event.target.value }))}
              required
            >
              <option value="">Chọn khách</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.firstName} {customer.lastName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Nhân viên</span>
            <select
              value={bookingForm.staffId}
              onChange={(event) => setBookingForm((prev) => ({ ...prev, staffId: event.target.value }))}
              required
            >
              <option value="">Chọn nhân viên</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Dịch vụ</span>
            <select
              value={bookingForm.serviceId}
              onChange={(event) => setBookingForm((prev) => ({ ...prev, serviceId: event.target.value }))}
              required
            >
              <option value="">Chọn dịch vụ</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Giờ bắt đầu</span>
            <input
              type="datetime-local"
              value={bookingForm.startTime}
              onChange={(event) => setBookingForm((prev) => ({ ...prev, startTime: event.target.value }))}
              required
            />
          </label>
          <button type="submit" className="button-primary">
            Đặt lịch
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>Lịch hẹn</h2>
          <label className="field compact">
            <span>Trạng thái</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Tất cả</option>
              <option value="SCHEDULED">SCHEDULED</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="CANCELED">CANCELED</option>
              <option value="NO_SHOW">NO_SHOW</option>
            </select>
          </label>
        </div>
        {visibleAppointments.length ? (
        <div className="mobile-list">
          {visibleAppointments.map((appointment) => (
            <article key={appointment.id} className="mobile-item">
              <strong>
                {appointment.customer.firstName} {appointment.customer.lastName}
              </strong>
              <span>
                {appointment.service.name} - {appointment.staff.fullName}
              </span>
              <small>
                {formatDateTime(appointment.startTime)} - {appointment.status}
              </small>
              <div className="inline-actions">
                <button type="button" className="button-secondary" onClick={() => void updateStatus(appointment.id, appointment.status)}>
                  Sửa
                </button>
                <button type="button" className="button-secondary" onClick={() => void reschedule(appointment)}>
                  Đổi giờ
                </button>
                <button type="button" className="button-secondary" onClick={() => void cancel(appointment)}>
                  Hủy
                </button>
              </div>
            </article>
          ))}
        </div>
        ) : (
          <EmptyBlock message="Chưa có lịch hẹn trong hàng chờ." />
        )}
      </section>
    </div>
  );
};
