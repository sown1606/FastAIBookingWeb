import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  extractErrorMessage
} from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatCurrencyCents, formatDateTime } from "../lib/format";
import type { Pagination } from "../types";
import { toDateTimeLocalValue, useFormDialog } from "../components/form-dialog";

interface SalonDetail {
  id: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  originalPhoneNumber: string | null;
  customerIncomingPhoneNumber: string | null;
  notificationPhoneNumber: string | null;
  timezone: string;
  status: "PENDING" | "ACTIVE" | "SUSPENDED";
  subscriptionStatus: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED";
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  owner: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
  };
  settings: {
    currency: string;
    locale: string;
    bookingLeadTimeMinutes: number;
  } | null;
  subscription: {
    planCode: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  } | null;
  metrics: {
    activeStaffCount: number;
    activeServiceCount: number;
    customerCount: number;
    appointmentCount: number;
  };
  staffUsage: {
    freeStaffLimit: number;
    activeStaffCount: number;
    includedStaffCount: number;
    billableExtraStaffCount: number;
    extraStaffUnitPriceCents: number;
    estimatedExtraCostCents: number;
  };
}

interface IntegrationConfig {
  provider: "CALLRAIL" | "AMAZON_CONNECT" | "VERTEX";
  configKey: string;
  configValue: string;
  isActive: boolean;
  metadata?: unknown;
}

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

interface BusinessHour {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
}

interface CustomerItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
}

interface CustomersResponse {
  items: CustomerItem[];
  pagination: Pagination;
}

interface AppointmentItem {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  source: string;
  notes: string | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
  };
  staff: {
    id: string;
    fullName: string;
  };
  service: {
    id: string;
    name: string;
  };
}

interface AppointmentsResponse {
  items: AppointmentItem[];
  pagination: Pagination;
}

interface BillingUsageResponse {
  currentUsage: {
    freeStaffLimit: number;
    activeStaffCount: number;
    includedStaffCount: number;
    billableExtraStaffCount: number;
    extraStaffUnitPriceCents: number;
    estimatedExtraCostCents: number;
  };
  history: Array<{
    periodStart: string;
    periodEnd: string;
    estimatedExtraCostCents: number;
    billableExtraStaffCount: number;
  }>;
}

interface CallCenterAgent {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  isActive: boolean;
}

interface CallCenterAssignment {
  agent: CallCenterAgent;
}

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const integrationProviderOptions: Array<IntegrationConfig["provider"]> = [
  "CALLRAIL",
  "AMAZON_CONNECT",
  "VERTEX"
];

const appointmentStatusOptions = [
  { value: "SCHEDULED", label: "SCHEDULED" },
  { value: "CONFIRMED", label: "CONFIRMED" },
  { value: "CANCELED", label: "CANCELED" },
  { value: "NO_SHOW", label: "NO_SHOW" }
];

const createDefaultHours = (): BusinessHour[] => [
  { dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
  { dayOfWeek: 1, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 2, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 3, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 4, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 5, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 6, isOpen: true, openTime: "09:00", closeTime: "16:00" }
];

export const SalonDetailPage = () => {
  const { salonId } = useParams<{ salonId: string }>();
  const { notify } = useToast();
  const { openFormDialog, FormDialog } = useFormDialog();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [salon, setSalon] = useState<SalonDetail | null>(null);
  const [profileForm, setProfileForm] = useState({
    name: "",
    contactEmail: "",
    contactPhone: "",
    originalPhoneNumber: "",
    customerIncomingPhoneNumber: "",
    notificationPhoneNumber: "",
    timezone: "",
    status: "ACTIVE" as "PENDING" | "ACTIVE" | "SUSPENDED",
    subscriptionStatus: "TRIAL" as "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "US"
  });
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [hours, setHours] = useState<BusinessHour[]>(createDefaultHours());
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [billing, setBilling] = useState<BillingUsageResponse | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentItem | null>(null);
  const [callCenterAgents, setCallCenterAgents] = useState<CallCenterAgent[]>([]);
  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>([]);

  const [creatingStaff, setCreatingStaff] = useState(false);
  const [staffForm, setStaffForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    title: "",
    isBookable: true,
    password: ""
  });

  const [serviceForm, setServiceForm] = useState({
    name: "",
    description: "",
    durationMinutes: "45",
    priceCents: "4500"
  });

  const [customerForm, setCustomerForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: ""
  });

  const [appointmentForm, setAppointmentForm] = useState({
    customerId: "",
    staffId: "",
    serviceId: "",
    startTime: ""
  });

  const availableStaffForSelect = useMemo(
    () => staff.filter((item) => item.status === "ACTIVE"),
    [staff]
  );

  const load = async () => {
    if (!salonId) {
      setError("Missing salon ID.");
      setLoading(false);
      return;
    }

    setError("");
    setLoading(true);

    try {
      const [
        salonDetail,
        integrationItems,
        staffItems,
        serviceItems,
        businessHours,
        customerResult,
        appointmentResult,
        usage,
        agents,
        assignments
      ] = await Promise.all([
        apiGet<SalonDetail>(`/api/v1/admin/salons/${salonId}`),
        apiGet<IntegrationConfig[]>(`/api/v1/admin/salons/${salonId}/integrations`),
        apiGet<StaffItem[]>(`/api/v1/admin/salons/${salonId}/staff?includeInactive=true`),
        apiGet<ServiceItem[]>(`/api/v1/admin/salons/${salonId}/services?includeInactive=true`),
        apiGet<BusinessHour[]>(`/api/v1/admin/salons/${salonId}/business-hours`),
        apiGet<CustomersResponse>(`/api/v1/admin/salons/${salonId}/customers?page=1&limit=30`),
        apiGet<AppointmentsResponse>(`/api/v1/admin/salons/${salonId}/appointments?page=1&limit=30`),
        apiGet<BillingUsageResponse>(`/api/v1/admin/salons/${salonId}/billing/usage?historyLimit=6`),
        apiGet<CallCenterAgent[]>("/api/v1/admin/call-center/agents"),
        apiGet<CallCenterAssignment[]>(`/api/v1/admin/salons/${salonId}/call-center-assignments`)
      ]);

      setSalon(salonDetail);
      setProfileForm({
        name: salonDetail.name,
        contactEmail: salonDetail.contactEmail ?? "",
        contactPhone: salonDetail.contactPhone ?? "",
        originalPhoneNumber: salonDetail.originalPhoneNumber ?? "",
        customerIncomingPhoneNumber: salonDetail.customerIncomingPhoneNumber ?? "",
        notificationPhoneNumber: salonDetail.notificationPhoneNumber ?? "",
        timezone: salonDetail.timezone,
        status: salonDetail.status,
        subscriptionStatus: salonDetail.subscriptionStatus,
        addressLine1: salonDetail.addressLine1 ?? "",
        addressLine2: salonDetail.addressLine2 ?? "",
        city: salonDetail.city ?? "",
        state: salonDetail.state ?? "",
        postalCode: salonDetail.postalCode ?? "",
        country: salonDetail.country ?? "US"
      });
      setIntegrations(integrationItems);
      setStaff(staffItems);
      setServices(serviceItems);
      setHours(
        businessHours.length === 7
          ? [...businessHours].sort((a, b) => a.dayOfWeek - b.dayOfWeek)
          : createDefaultHours()
      );
      setCustomers(customerResult.items);
      setAppointments(appointmentResult.items);
      setBilling(usage);
      setCallCenterAgents(agents);
      setAssignedAgentIds(assignments.map((assignment) => assignment.agent.id));
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [salonId]);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!salonId) {
      return;
    }
    try {
      const updated = await apiPatch<SalonDetail, unknown>(`/api/v1/admin/salons/${salonId}`, {
        name: profileForm.name,
        contactEmail: profileForm.contactEmail || null,
        contactPhone: profileForm.contactPhone || null,
        originalPhoneNumber: profileForm.originalPhoneNumber || null,
        customerIncomingPhoneNumber: profileForm.customerIncomingPhoneNumber || null,
        notificationPhoneNumber: profileForm.notificationPhoneNumber || null,
        timezone: profileForm.timezone,
        status: profileForm.status,
        subscriptionStatus: profileForm.subscriptionStatus,
        addressLine1: profileForm.addressLine1 || null,
        addressLine2: profileForm.addressLine2 || null,
        city: profileForm.city || null,
        state: profileForm.state || null,
        postalCode: profileForm.postalCode || null,
        country: profileForm.country
      });
      setSalon(updated);
      notify("success", "Salon profile updated.");
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const addIntegration = () => {
    setIntegrations((prev) => [
      ...prev,
      {
        provider: "CALLRAIL",
        configKey: "",
        configValue: "",
        isActive: true
      }
    ]);
  };

  const saveIntegrations = async () => {
    if (!salonId) {
      return;
    }

    const validItems = integrations.filter(
      (item) => item.configKey.trim().length > 0 && item.configValue.trim().length > 0
    );
    try {
      const result = await apiPut<IntegrationConfig[], { items: IntegrationConfig[] }>(
        `/api/v1/admin/salons/${salonId}/integrations`,
        {
          items: validItems
        }
      );
      setIntegrations(result);
      notify("success", "Integration settings saved.");
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const saveCallCenterAssignments = async () => {
    if (!salonId) {
      return;
    }
    try {
      const assignments = await apiPut<CallCenterAssignment[], { agentUserIds: string[] }>(
        `/api/v1/admin/salons/${salonId}/call-center-assignments`,
        {
          agentUserIds: assignedAgentIds
        }
      );
      setAssignedAgentIds(assignments.map((assignment) => assignment.agent.id));
      notify("success", "Call center assignments saved.");
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const createStaffMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!salonId) {
      return;
    }
    setCreatingStaff(true);
    try {
      await apiPost<unknown, unknown>(`/api/v1/admin/salons/${salonId}/staff`, {
        fullName: staffForm.fullName,
        email: staffForm.email || undefined,
        phone: staffForm.phone || undefined,
        title: staffForm.title || undefined,
        isBookable: staffForm.isBookable,
        createLogin: true,
        password: staffForm.password || undefined
      });
      setStaffForm({
        fullName: "",
        email: "",
        phone: "",
        title: "",
        isBookable: true,
        password: ""
      });
      notify("success", "Staff created.");
      await load();
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    } finally {
      setCreatingStaff(false);
    }
  };

  const editStaffMember = async (item: StaffItem) => {
    if (!salonId) {
      return;
    }
    const values = await openFormDialog({
      title: "Sửa nhân viên",
      description: item.fullName,
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
      await apiPatch<unknown, unknown>(`/api/v1/admin/salons/${salonId}/staff/${item.id}`, {
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
        title: values.title
      });
      notify("success", "Staff updated.");
      await load();
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  const toggleStaffStatus = async (item: StaffItem) => {
    if (!salonId) {
      return;
    }
    const action = item.status === "ACTIVE" ? "deactivate" : "reactivate";
    try {
      await apiPost<unknown, Record<string, never>>(
        `/api/v1/admin/salons/${salonId}/staff/${item.id}/${action}`,
        {}
      );
      notify("success", `Staff ${action}d.`);
      await load();
    } catch (toggleError) {
      notify("error", extractErrorMessage(toggleError));
    }
  };

  const resetStaffLogin = async (item: StaffItem) => {
    if (!salonId) {
      return;
    }
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
      await apiPost<unknown, { newPassword: string }>(
        `/api/v1/admin/salons/${salonId}/staff/${item.id}/reset-access`,
        {
          newPassword: values.newPassword
        }
      );
      notify("success", "Staff access reset.");
      await load();
    } catch (resetError) {
      notify("error", extractErrorMessage(resetError));
    }
  };

  const createServiceItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!salonId) {
      return;
    }
    try {
      await apiPost<unknown, unknown>(`/api/v1/admin/salons/${salonId}/services`, {
        name: serviceForm.name,
        description: serviceForm.description || undefined,
        durationMinutes: Number(serviceForm.durationMinutes),
        priceCents: Number(serviceForm.priceCents)
      });
      setServiceForm({
        name: "",
        description: "",
        durationMinutes: "45",
        priceCents: "4500"
      });
      notify("success", "Service created.");
      await load();
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const editServiceItem = async (item: ServiceItem) => {
    if (!salonId) {
      return;
    }
    const values = await openFormDialog({
      title: "Sửa dịch vụ",
      description: item.name,
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
      await apiPatch<unknown, unknown>(`/api/v1/admin/salons/${salonId}/services/${item.id}`, {
        name: values.name,
        description: values.description || null,
        durationMinutes: Number(values.durationMinutes),
        priceCents: Number(values.priceCents)
      });
      notify("success", "Service updated.");
      await load();
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  const toggleServiceState = async (item: ServiceItem) => {
    if (!salonId) {
      return;
    }
    const action = item.isActive ? "deactivate" : "activate";
    try {
      await apiPost<unknown, Record<string, never>>(
        `/api/v1/admin/salons/${salonId}/services/${item.id}/${action}`,
        {}
      );
      notify("success", `Service ${action}d.`);
      await load();
    } catch (toggleError) {
      notify("error", extractErrorMessage(toggleError));
    }
  };

  const saveBusinessHours = async () => {
    if (!salonId) {
      return;
    }
    try {
      await apiPut<BusinessHour[], { hours: BusinessHour[] }>(
        `/api/v1/admin/salons/${salonId}/business-hours`,
        {
          hours
        }
      );
      notify("success", "Business hours updated.");
      await load();
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const createCustomerItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!salonId) {
      return;
    }
    try {
      await apiPost<unknown, unknown>(`/api/v1/admin/salons/${salonId}/customers`, {
        firstName: customerForm.firstName,
        lastName: customerForm.lastName,
        email: customerForm.email || undefined,
        phone: customerForm.phone
      });
      setCustomerForm({
        firstName: "",
        lastName: "",
        email: "",
        phone: ""
      });
      notify("success", "Customer created.");
      await load();
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const createAppointmentItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!salonId) {
      return;
    }
    if (!appointmentForm.customerId || !appointmentForm.staffId || !appointmentForm.serviceId) {
      notify("error", "Customer, staff, service, and date-time are required.");
      return;
    }
    try {
      await apiPost<unknown, unknown>(`/api/v1/admin/salons/${salonId}/appointments`, {
        customerId: appointmentForm.customerId,
        staffId: appointmentForm.staffId,
        serviceId: appointmentForm.serviceId,
        startTime: new Date(appointmentForm.startTime).toISOString(),
        source: "DASHBOARD"
      });
      setAppointmentForm({
        customerId: "",
        staffId: "",
        serviceId: "",
        startTime: ""
      });
      notify("success", "Appointment created.");
      await load();
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const cancelAppointmentItem = async (appointment: AppointmentItem) => {
    if (!salonId) {
      return;
    }
    const values = await openFormDialog({
      title: "Hủy lịch hẹn",
      description: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      fields: [{ name: "reason", label: "Lý do hủy", type: "textarea", rows: 3 }],
      initialValues: {
        reason: "Admin hủy lịch"
      },
      confirmLabel: "Hủy lịch"
    });
    if (!values) {
      return;
    }
    try {
      await apiPatch<unknown, { reason?: string }>(
        `/api/v1/admin/salons/${salonId}/appointments/${appointment.id}/cancel`,
        {
          reason: values.reason || undefined
        }
      );
      notify("success", "Appointment canceled.");
      await load();
    } catch (cancelError) {
      notify("error", extractErrorMessage(cancelError));
    }
  };

  const rescheduleAppointmentItem = async (appointment: AppointmentItem) => {
    if (!salonId) {
      return;
    }
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
        `/api/v1/admin/salons/${salonId}/appointments/${appointment.id}/reschedule`,
        {
          startTime: new Date(values.startTime).toISOString()
        }
      );
      notify("success", "Appointment rescheduled.");
      await load();
    } catch (rescheduleError) {
      notify("error", extractErrorMessage(rescheduleError));
    }
  };

  const setAppointmentStatus = async (appointmentId: string, currentStatus: string) => {
    if (!salonId) {
      return;
    }
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
        status: currentStatus
      },
      confirmLabel: "Cập nhật"
    });
    if (!values?.status) {
      return;
    }
    try {
      await apiPatch<unknown, { status: string }>(
        `/api/v1/admin/salons/${salonId}/appointments/${appointmentId}`,
        {
          status: values.status
        }
      );
      notify("success", "Appointment updated.");
      await load();
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  if (!salon) {
    return <EmptyBlock message="Salon not found." />;
  }

  return (
    <div className="stack">
      <FormDialog />
      <section className="card">
        <h2>{salon.name}</h2>
        <div className="metrics-grid">
          <div>
            <span className="muted">Owner</span>
            <strong>{salon.owner.fullName}</strong>
          </div>
          <div>
            <span className="muted">Active staff</span>
            <strong>{salon.staffUsage.activeStaffCount}</strong>
          </div>
          <div>
            <span className="muted">Free limit</span>
            <strong>{salon.staffUsage.freeStaffLimit}</strong>
          </div>
          <div>
            <span className="muted">Extra billable</span>
            <strong>{salon.staffUsage.billableExtraStaffCount}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Salon profile</h3>
        <form className="form-grid two-columns" onSubmit={saveProfile}>
          <label className="field">
            <span>Name</span>
            <input
              value={profileForm.name}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Timezone</span>
            <input
              value={profileForm.timezone}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, timezone: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Contact email</span>
            <input
              type="email"
              value={profileForm.contactEmail}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, contactEmail: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Contact phone</span>
            <input
              type="tel"
              inputMode="numeric"
              value={profileForm.contactPhone}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, contactPhone: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Original salon phone</span>
            <input
              type="tel"
              inputMode="numeric"
              value={profileForm.originalPhoneNumber}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, originalPhoneNumber: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Customer incoming phone</span>
            <input
              type="tel"
              inputMode="numeric"
              value={profileForm.customerIncomingPhoneNumber}
              onChange={(event) =>
                setProfileForm((prev) => ({
                  ...prev,
                  customerIncomingPhoneNumber: event.target.value
                }))
              }
            />
          </label>
          <label className="field">
            <span>Notification phone</span>
            <input
              type="tel"
              inputMode="numeric"
              value={profileForm.notificationPhoneNumber}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, notificationPhoneNumber: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Status</span>
            <select
              value={profileForm.status}
              onChange={(event) =>
                setProfileForm((prev) => ({
                  ...prev,
                  status: event.target.value as "PENDING" | "ACTIVE" | "SUSPENDED"
                }))
              }
            >
              <option value="PENDING">PENDING</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </select>
          </label>
          <label className="field">
            <span>Subscription status</span>
            <select
              value={profileForm.subscriptionStatus}
              onChange={(event) =>
                setProfileForm((prev) => ({
                  ...prev,
                  subscriptionStatus: event.target.value as "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED"
                }))
              }
            >
              <option value="TRIAL">TRIAL</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="PAST_DUE">PAST_DUE</option>
              <option value="CANCELED">CANCELED</option>
            </select>
          </label>
          <label className="field">
            <span>Address line 1</span>
            <input
              value={profileForm.addressLine1}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, addressLine1: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Address line 2</span>
            <input
              value={profileForm.addressLine2}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, addressLine2: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>City</span>
            <input
              value={profileForm.city}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, city: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>State</span>
            <input
              value={profileForm.state}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, state: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Postal code</span>
            <input
              value={profileForm.postalCode}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, postalCode: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Country</span>
            <input
              value={profileForm.country}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, country: event.target.value }))}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              Save profile
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>Integration config</h3>
          <div className="inline-actions">
            <button type="button" className="button-secondary" onClick={addIntegration}>
              Add row
            </button>
            <button type="button" className="button-primary" onClick={saveIntegrations}>
              Save integrations
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Key</th>
                <th>Value</th>
                <th>Active</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {integrations.map((item, index) => (
                <tr key={`${item.provider}-${item.configKey}-${index}`}>
                  <td>
                    <select
                      value={item.provider}
                      onChange={(event) =>
                        setIntegrations((prev) =>
                          prev.map((row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, provider: event.target.value as IntegrationConfig["provider"] }
                              : row
                          )
                        )
                      }
                    >
                      {integrationProviderOptions.map((provider) => (
                        <option key={provider} value={provider}>
                          {provider}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={item.configKey}
                      onChange={(event) =>
                        setIntegrations((prev) =>
                          prev.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, configKey: event.target.value } : row
                          )
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={item.configValue}
                      onChange={(event) =>
                        setIntegrations((prev) =>
                          prev.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, configValue: event.target.value } : row
                          )
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={item.isActive}
                      onChange={(event) =>
                        setIntegrations((prev) =>
                          prev.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, isActive: event.target.checked } : row
                          )
                        )
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() =>
                        setIntegrations((prev) => prev.filter((_row, rowIndex) => rowIndex !== index))
                      }
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>Call center assignment</h3>
          <button type="button" className="button-primary" onClick={saveCallCenterAssignments}>
            Save assignments
          </button>
        </div>
        <div className="mobile-list">
          {callCenterAgents.map((agent) => (
            <label key={agent.id} className="mobile-item checkbox-row">
              <span>
                <strong>{agent.fullName}</strong>
                <span className="muted">
                  {agent.email} / {agent.phone ?? "-"}
                </span>
              </span>
              <input
                type="checkbox"
                checked={assignedAgentIds.includes(agent.id)}
                onChange={(event) =>
                  setAssignedAgentIds((prev) =>
                    event.target.checked
                      ? Array.from(new Set([...prev, agent.id]))
                      : prev.filter((id) => id !== agent.id)
                  )
                }
              />
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>Staff</h3>
          <span className="muted">
            Active {salon.staffUsage.activeStaffCount} / Free {salon.staffUsage.freeStaffLimit} / Extra{" "}
            {salon.staffUsage.billableExtraStaffCount}
          </span>
        </div>
        <form className="form-grid two-columns" onSubmit={createStaffMember}>
          <label className="field">
            <span>Full name</span>
            <input
              value={staffForm.fullName}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, fullName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={staffForm.email}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, email: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              type="tel"
              inputMode="numeric"
              value={staffForm.phone}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, phone: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Title</span>
            <input
              value={staffForm.title}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Temporary password</span>
            <input
              type="password"
              minLength={8}
              value={staffForm.password}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, password: event.target.value }))}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={creatingStaff}>
              {creatingStaff ? "Creating..." : "Add staff"}
            </button>
          </div>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Title</th>
                <th>Status</th>
                <th>Login</th>
                <th>Actions</th>
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
                  <td>{item.user ? (item.user.isActive ? "Enabled" : "Disabled") : "Not created"}</td>
                  <td>
                    <div className="inline-actions">
                      <button type="button" className="button-secondary" onClick={() => editStaffMember(item)}>
                        Edit
                      </button>
                      <button type="button" className="button-secondary" onClick={() => toggleStaffStatus(item)}>
                        {item.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                      </button>
                      <button type="button" className="button-secondary" onClick={() => resetStaffLogin(item)}>
                        Reset access
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Services</h3>
        <form className="form-grid two-columns" onSubmit={createServiceItem}>
          <label className="field">
            <span>Name</span>
            <input
              value={serviceForm.name}
              onChange={(event) => setServiceForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Description</span>
            <input
              value={serviceForm.description}
              onChange={(event) =>
                setServiceForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Duration (minutes)</span>
            <input
              type="number"
              min={1}
              max={600}
              value={serviceForm.durationMinutes}
              onChange={(event) =>
                setServiceForm((prev) => ({ ...prev, durationMinutes: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>Price (cents)</span>
            <input
              type="number"
              min={0}
              value={serviceForm.priceCents}
              onChange={(event) => setServiceForm((prev) => ({ ...prev, priceCents: event.target.value }))}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              Add service
            </button>
          </div>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Duration</th>
                <th>Price</th>
                <th>Status</th>
                <th>Mapped staff</th>
                <th>Actions</th>
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
                      <button type="button" className="button-secondary" onClick={() => editServiceItem(item)}>
                        Edit
                      </button>
                      <button type="button" className="button-secondary" onClick={() => toggleServiceState(item)}>
                        {item.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>Business hours</h3>
          <button type="button" className="button-primary" onClick={saveBusinessHours}>
            Save hours
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Open</th>
                <th>Open time</th>
                <th>Close time</th>
              </tr>
            </thead>
            <tbody>
              {hours.map((item, index) => (
                <tr key={item.dayOfWeek}>
                  <td>{days[item.dayOfWeek]}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={item.isOpen}
                      onChange={(event) =>
                        setHours((prev) =>
                          prev.map((row, rowIndex) =>
                            rowIndex === index
                              ? {
                                  ...row,
                                  isOpen: event.target.checked,
                                  openTime: event.target.checked ? row.openTime ?? "09:00" : null,
                                  closeTime: event.target.checked ? row.closeTime ?? "18:00" : null
                                }
                              : row
                          )
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="time"
                      value={item.openTime ?? ""}
                      disabled={!item.isOpen}
                      onChange={(event) =>
                        setHours((prev) =>
                          prev.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, openTime: event.target.value } : row
                          )
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="time"
                      value={item.closeTime ?? ""}
                      disabled={!item.isOpen}
                      onChange={(event) =>
                        setHours((prev) =>
                          prev.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, closeTime: event.target.value } : row
                          )
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Customers</h3>
        <form className="form-grid two-columns" onSubmit={createCustomerItem}>
          <label className="field">
            <span>First name</span>
            <input
              value={customerForm.firstName}
              onChange={(event) =>
                setCustomerForm((prev) => ({ ...prev, firstName: event.target.value }))
              }
              required
            />
          </label>
          <label className="field">
            <span>Last name</span>
            <input
              value={customerForm.lastName}
              onChange={(event) => setCustomerForm((prev) => ({ ...prev, lastName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={customerForm.email}
              onChange={(event) => setCustomerForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              type="tel"
              inputMode="numeric"
              value={customerForm.phone}
              onChange={(event) => setCustomerForm((prev) => ({ ...prev, phone: event.target.value }))}
              required
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              Add customer
            </button>
          </div>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    {customer.firstName} {customer.lastName}
                  </td>
                  <td>{customer.email ?? "-"}</td>
                  <td>{customer.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Appointments</h3>
        <form className="form-grid two-columns" onSubmit={createAppointmentItem}>
          <label className="field">
            <span>Customer</span>
            <select
              value={appointmentForm.customerId}
              onChange={(event) =>
                setAppointmentForm((prev) => ({ ...prev, customerId: event.target.value }))
              }
              required
            >
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.firstName} {customer.lastName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Staff</span>
            <select
              value={appointmentForm.staffId}
              onChange={(event) => setAppointmentForm((prev) => ({ ...prev, staffId: event.target.value }))}
              required
            >
              <option value="">Select staff</option>
              {availableStaffForSelect.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Service</span>
            <select
              value={appointmentForm.serviceId}
              onChange={(event) =>
                setAppointmentForm((prev) => ({ ...prev, serviceId: event.target.value }))
              }
              required
            >
              <option value="">Select service</option>
              {services
                .filter((item) => item.isActive)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>Start time</span>
            <input
              type="datetime-local"
              value={appointmentForm.startTime}
              onChange={(event) =>
                setAppointmentForm((prev) => ({ ...prev, startTime: event.target.value }))
              }
              required
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              Create appointment
            </button>
          </div>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Customer</th>
                <th>Staff</th>
                <th>Service</th>
                <th>Status</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.startTime)}</td>
                  <td>
                    {item.customer.firstName} {item.customer.lastName}
                  </td>
                  <td>{item.staff.fullName}</td>
                  <td>{item.service.name}</td>
                  <td>{item.status}</td>
                  <td>{item.source}</td>
                  <td>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => setSelectedAppointment(item)}
                      >
                        Inspect
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void setAppointmentStatus(item.id, item.status)}
                      >
                        Status
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void rescheduleAppointmentItem(item)}
                      >
                        Reschedule
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void cancelAppointmentItem(item)}
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedAppointment ? (
          <div className="inspection-box">
            <div className="section-header">
              <h4>Appointment detail</h4>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setSelectedAppointment(null)}
              >
                Close
              </button>
            </div>
            <pre>{JSON.stringify(selectedAppointment, null, 2)}</pre>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h3>Billing usage</h3>
        {billing ? (
          <>
            <div className="metrics-grid">
              <div>
                <span className="muted">Free allowance</span>
                <strong>{billing.currentUsage.freeStaffLimit}</strong>
              </div>
              <div>
                <span className="muted">Active staff</span>
                <strong>{billing.currentUsage.activeStaffCount}</strong>
              </div>
              <div>
                <span className="muted">Extra staff</span>
                <strong>{billing.currentUsage.billableExtraStaffCount}</strong>
              </div>
              <div>
                <span className="muted">Estimated extra</span>
                <strong>{formatCurrencyCents(billing.currentUsage.estimatedExtraCostCents)}</strong>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Period start</th>
                    <th>Period end</th>
                    <th>Extra staff</th>
                    <th>Estimated extra cost</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.history.map((row) => (
                    <tr key={`${row.periodStart}-${row.periodEnd}`}>
                      <td>{formatDateTime(row.periodStart)}</td>
                      <td>{formatDateTime(row.periodEnd)}</td>
                      <td>{row.billableExtraStaffCount}</td>
                      <td>{formatCurrencyCents(row.estimatedExtraCostCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyBlock message="Billing usage data is not available." />
        )}
      </section>
    </div>
  );
};
