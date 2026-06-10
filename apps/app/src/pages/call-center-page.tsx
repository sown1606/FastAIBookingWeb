import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPatch, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatDateTime } from "../lib/format";
import { toDateTimeLocalValue, useFormDialog } from "../components/form-dialog";
import { formatUsPhoneInput, validateOptionalUsPhone } from "../lib/phone";
import { useAuth } from "../auth/auth-context";
import { statusLabelKey, useI18n } from "../lib/i18n";
import { useUiMode } from "../lib/ui-mode";

interface RuntimeResponse {
  assignedSalonCount: number;
  runtimeEnv: {
    workingDirectory: string;
    dotenvPath: string;
    dotenvFileExists: boolean;
    dotenvExamplePath: string;
    dotenvExampleExists: boolean;
    dotenvLoadedFromFile: boolean;
    note: string;
  };
  amazonConnect: {
    region: string | null;
    instanceId: string | null;
    instanceUrl: string | null;
    ccpUrl: string | null;
    queueIdDefault: string | null;
    routingProfileId: string | null;
    configured: boolean;
    missing: string[];
    adminConfigured: boolean;
    adminMissing: string[];
    activeIntegrationConfigCount: number;
  };
}

interface SalonItem {
  id: string;
  name: string;
  customerIncomingPhoneNumber: string | null;
}

interface SalonDetailResponse {
  id: string;
  name: string;
  contactPhone: string | null;
  notificationPhoneNumber: string | null;
  originalPhoneNumber: string | null;
  customerIncomingPhoneNumber: string | null;
  timezone: string;
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
    aiReceptionEnabled: boolean;
    aiTransferRingCount: number;
    callCenterEnabled: boolean;
    voicemailEnabled: boolean;
    callbackRequestEnabled: boolean;
    smsFallbackEnabled: boolean;
    callCenterRoutingNumber: string | null;
    callCenterRoutingNote: string | null;
  } | null;
  businessHours: Array<{
    dayOfWeek: number;
    isOpen: boolean;
    openTime: string | null;
    closeTime: string | null;
  }>;
  staff: StaffItem[];
  services: ServiceItem[];
  callCenterAssignments: Array<{
    id: string;
    agent: {
      id: string;
      fullName: string;
      email: string;
      phone: string | null;
      isActive: boolean;
    };
  }>;
}

interface StaffItem {
  id: string;
  fullName: string;
  title?: string | null;
  status?: string;
  currentWorkStatus: string;
  isBookable?: boolean;
}

interface ServiceItem {
  id: string;
  name: string;
  isActive: boolean;
  durationMinutes?: number;
  priceCents?: number;
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

interface QueueItem {
  id: string;
  status: string;
  routingOutcome: string | null;
  requestedAt: string;
  connectedAt: string | null;
  closedAt: string | null;
  salon: {
    id: string;
    name: string;
  };
  callSession: {
    id: string;
    callerPhone: string | null;
    providerCallId?: string;
    status: string;
    routingOutcome: string | null;
    aiSummary: unknown;
    createdAt: string;
  };
}

interface EscalationDetail {
  id: string;
  status: string;
  routingOutcome: string | null;
  requestedAt: string;
  connectedAt: string | null;
  closedAt: string | null;
  escalationReason: string | null;
  messageToCaller: string | null;
  customerPhone: string | null;
  callbackPhone: string | null;
  smsRecipientPhone: string | null;
  voicemailRecordingUrl: string | null;
  operatorNotes: string | null;
  resolution: string | null;
  qaNotes: string | null;
  salon: {
    id: string;
    name: string;
    settings: {
      callCenterEnabled: boolean;
      voicemailEnabled: boolean;
      callbackRequestEnabled: boolean;
      smsFallbackEnabled: boolean;
    } | null;
  };
  callSession: {
    id: string;
    callerPhone: string | null;
    providerCallId: string;
    status: string;
    routingOutcome: string | null;
    aiSummary: unknown;
    createdAt: string;
    finalResolution: string | null;
    transcripts: Array<{
      id: string;
      transcriptSource: string;
      transcriptText: string;
      transcriptSummary: string | null;
      createdAt: string;
    }>;
    bookingAttempts: Array<{
      id: string;
      status: string;
      requestedService: string | null;
      requestedStaff: string | null;
      failureReason: string | null;
      createdAt: string;
      appointment: {
        id: string;
      } | null;
    }>;
    aiInteractions: Array<{
      id: string;
      taskType: string;
      model: string | null;
      createdAt: string;
    }>;
  };
  customerMatches: CustomerItem[];
}

export const CallCenterPage = () => {
  const { session } = useAuth();
  const { notify } = useToast();
  const { openFormDialog, FormDialog } = useFormDialog();
  const { t } = useI18n();
  const { isBasicMode } = useUiMode();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runtime, setRuntime] = useState<RuntimeResponse | null>(null);
  const [salons, setSalons] = useState<SalonItem[]>([]);
  const [selectedSalonDetail, setSelectedSalonDetail] = useState<SalonDetailResponse | null>(null);
  const [selectedSalonId, setSelectedSalonId] = useState("");
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedEscalationId, setSelectedEscalationId] = useState("");
  const [selectedEscalation, setSelectedEscalation] = useState<EscalationDetail | null>(null);
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
  const [notesForm, setNotesForm] = useState({
    operatorNotes: "",
    qaNotes: "",
    resolution: ""
  });
  const [ccpError] = useState("");
  const isOwner = session?.user.role === "SALON_OWNER";
  const configuredCcpUrl = import.meta.env.VITE_AMAZON_CONNECT_CCP_URL?.trim();
  const ccpUrl = configuredCcpUrl || runtime?.amazonConnect.ccpUrl || null;
  const ccpSettingsUrl = ccpUrl ? `${ccpUrl.replace(/\/+$/, "")}/settings` : null;

  const appointmentStatusOptions = useMemo(
    () => ["SCHEDULED", "CONFIRMED", "CANCELED", "NO_SHOW"].map((value) => ({
      value,
      label: statusLabelKey(value) ? t(statusLabelKey(value)!) : value
    })),
    [t]
  );

  const translateRoutingOutcome = (value: string | null | undefined) => {
    if (!value) {
      return t("common.none");
    }
    const routingLabelKeyByValue: Record<string, Parameters<typeof t>[0]> = {
      SALON_RING: "routing.SALON_RING",
      AI_RECEPTION: "routing.AI_RECEPTION",
      CALL_CENTER_ESCALATION: "routing.CALL_CENTER_ESCALATION",
      CALLBACK_REQUEST: "routing.CALLBACK_REQUEST",
      SMS_FALLBACK: "routing.SMS_FALLBACK",
      VOICEMAIL: "routing.VOICEMAIL",
      QUEUED: "routing.QUEUED"
    };
    const key = routingLabelKeyByValue[value];
    return key ? t(key) : value;
  };

  const formatSalonAddress = (salon: SalonDetailResponse | null) => {
    if (!salon) {
      return t("common.none");
    }
    return [
      salon.addressLine1,
      salon.addressLine2,
      [salon.city, salon.state, salon.postalCode].filter(Boolean).join(" ")
    ]
      .filter(Boolean)
      .join(", ") || t("common.none");
  };

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const formatBusinessHour = (hour: SalonDetailResponse["businessHours"][number]) => {
    const day = dayLabels[hour.dayOfWeek] ?? String(hour.dayOfWeek);
    return hour.isOpen && hour.openTime && hour.closeTime
      ? `${day}: ${hour.openTime} - ${hour.closeTime}`
      : `${day}: Closed`;
  };

  const getTodayDayOfWeek = (timezone: string) => {
    const label = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: timezone
    }).format(new Date());
    const dayIndex = dayLabels.findIndex((day) => day === label);
    return dayIndex >= 0 ? dayIndex : new Date().getDay();
  };

  const summarizeUnknown = (value: unknown): string => {
    if (!value) {
      return t("common.none");
    }
    if (typeof value === "string") {
      return value.length > 360 ? `${value.slice(0, 360)}...` : value;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const readable =
        record.summary ??
        record.aiSummary ??
        record.intent ??
        record.result ??
        record.message;
      if (typeof readable === "string" && readable.trim()) {
        return readable;
      }
      try {
        const serialized = JSON.stringify(value);
        if (!serialized) {
          return t("common.none");
        }
        return serialized.length > 360 ? `${serialized.slice(0, 360)}...` : serialized;
      } catch {
        return t("common.none");
      }
    }
    return String(value);
  };

  const formatStaffStatus = (member: StaffItem) => {
    if (member.status && member.status !== "ACTIVE") {
      return member.status;
    }
    if (member.isBookable === false) {
      return "Not bookable";
    }
    return member.currentWorkStatus || "ACTIVE";
  };

  const loadSalonData = async (salonId: string) => {
    const [salonDetail, staffItems, serviceItems, customerItems, appointmentItems] = await Promise.all([
      apiGet<SalonDetailResponse>(`/api/v1/call-center/salons/${salonId}`),
      apiGet<StaffItem[]>(`/api/v1/call-center/salons/${salonId}/staff`),
      apiGet<ServiceItem[]>(`/api/v1/call-center/salons/${salonId}/services`),
      apiGet<CustomersResponse>(`/api/v1/call-center/salons/${salonId}/customers?page=1&limit=100`),
      apiGet<AppointmentsResponse>(`/api/v1/call-center/salons/${salonId}/appointments?page=1&limit=50`)
    ]);

    setSelectedSalonDetail(salonDetail);
    setStaff(staffItems);
    setServices(serviceItems.filter((item) => item.isActive));
    setCustomers(customerItems.items);
    setAppointments(appointmentItems.items);
  };

  const loadQueue = async (preserveSelected = true) => {
    const items = await apiGet<QueueItem[]>("/api/v1/call-center/queue?limit=50");
    setQueue(items);
    const nextId =
      preserveSelected && selectedEscalationId
        ? items.find((item) => item.id === selectedEscalationId)?.id
        : (items.find((item) => item.status !== "CLOSED") ?? items[0])?.id ?? "";
    if (nextId) {
      setSelectedEscalationId(nextId);
    } else {
      setSelectedEscalationId("");
      setSelectedEscalation(null);
    }
  };

  const loadEscalationDetail = async (escalationId: string) => {
    const detail = await apiGet<EscalationDetail>(`/api/v1/call-center/queue/${escalationId}`);
    setSelectedEscalation(detail);
    setNotesForm({
      operatorNotes: detail.operatorNotes ?? "",
      qaNotes: detail.qaNotes ?? "",
      resolution: detail.resolution ?? ""
    });
    setSelectedSalonId(detail.salon.id);
    setBookingForm((prev) => ({
      ...prev,
      customerId: detail.customerMatches[0]?.id ?? prev.customerId
    }));
    await loadSalonData(detail.salon.id);
  };

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const [runtimeResult, salonItems] = await Promise.all([
        apiGet<RuntimeResponse>("/api/v1/call-center/runtime"),
        apiGet<SalonItem[]>("/api/v1/call-center/salons")
      ]);

      setRuntime(runtimeResult);
      setSalons(salonItems);
      const initialSalonId = salonItems[0]?.id ?? "";
      if (initialSalonId) {
        setSelectedSalonId(initialSalonId);
        await loadSalonData(initialSalonId);
      }
      await loadQueue(false);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedEscalationId) {
      return;
    }
    void loadEscalationDetail(selectedEscalationId).catch((detailError) => {
      setError(extractErrorMessage(detailError));
    });
  }, [selectedEscalationId]);

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
      notify("error", t("callCenter.selectSalonFirst"));
      return;
    }
    if (!validateOptionalUsPhone(customerForm.phone)) {
      notify("error", t("form.phoneInvalid"));
      return;
    }

    try {
      await apiPost(`/api/v1/call-center/salons/${selectedSalonId}/customers`, customerForm);
      setCustomerForm({ firstName: "", lastName: "", phone: "" });
      await loadSalonData(selectedSalonId);
      notify("success", t("callCenter.customerCreated"));
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const createBooking = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSalonId) {
      notify("error", t("callCenter.selectSalonFirst"));
      return;
    }

    try {
      await apiPost(`/api/v1/call-center/salons/${selectedSalonId}/appointments`, {
        ...bookingForm,
        startTime: new Date(bookingForm.startTime).toISOString(),
        status: "CONFIRMED"
      });
      setBookingForm({ customerId: "", staffId: "", serviceId: "", startTime: "" });
      await loadSalonData(selectedSalonId);
      if (selectedEscalationId) {
        await loadEscalationDetail(selectedEscalationId);
      }
      notify("success", t("callCenter.bookingCreated"));
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const reschedule = async (appointment: AppointmentItem) => {
    const values = await openFormDialog({
      title: t("callCenter.rescheduleTitle"),
      description: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      fields: [{ name: "startTime", label: t("callCenter.newTime"), type: "datetime-local", required: true }],
      initialValues: {
        startTime: toDateTimeLocalValue(appointment.startTime)
      },
      confirmLabel: t("appointments.reschedule")
    });

    if (!values?.startTime || !selectedSalonId) {
      return;
    }

    try {
      await apiPatch(`/api/v1/call-center/salons/${selectedSalonId}/appointments/${appointment.id}/reschedule`, {
        startTime: new Date(values.startTime).toISOString()
      });
      await loadSalonData(selectedSalonId);
      notify("success", t("callCenter.rescheduled"));
    } catch (rescheduleError) {
      notify("error", extractErrorMessage(rescheduleError));
    }
  };

  const updateStatus = async (appointmentId: string, status: string) => {
    const values = await openFormDialog({
      title: t("callCenter.updateAppointmentStatusTitle"),
      fields: [
        {
          name: "status",
          label: t("common.status"),
          type: "select",
          required: true,
          options: appointmentStatusOptions
        }
      ],
      initialValues: {
        status
      },
      confirmLabel: t("appointments.updateStatus")
    });

    if (!values?.status || !selectedSalonId) {
      return;
    }

    try {
      await apiPatch(`/api/v1/call-center/salons/${selectedSalonId}/appointments/${appointmentId}`, {
        status: values.status
      });
      await loadSalonData(selectedSalonId);
      notify("success", t("callCenter.updated"));
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  const cancel = async (appointment: AppointmentItem) => {
    const values = await openFormDialog({
      title: t("callCenter.cancelTitle"),
      description: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      fields: [{ name: "reason", label: t("callCenter.cancelReason"), type: "textarea", rows: 3 }],
      initialValues: {
        reason: t("callCenter.defaultCancelReason")
      },
      confirmLabel: t("appointments.cancel")
    });

    if (!values || !selectedSalonId) {
      return;
    }

    try {
      await apiPatch(`/api/v1/call-center/salons/${selectedSalonId}/appointments/${appointment.id}/cancel`, {
        reason: values.reason || undefined
      });
      await loadSalonData(selectedSalonId);
      notify("success", t("callCenter.canceled"));
    } catch (cancelError) {
      notify("error", extractErrorMessage(cancelError));
    }
  };

  const acceptQueueItem = async () => {
    if (!selectedEscalationId) {
      return;
    }

    try {
      await apiPost(`/api/v1/call-center/queue/${selectedEscalationId}/accept`, {});
      await Promise.all([loadQueue(), loadEscalationDetail(selectedEscalationId)]);
      notify("success", t("callCenter.accepted"));
    } catch (acceptError) {
      notify("error", extractErrorMessage(acceptError));
    }
  };

  const saveNotes = async () => {
    if (!selectedEscalationId) {
      return;
    }

    try {
      await apiPatch(`/api/v1/call-center/queue/${selectedEscalationId}`, notesForm);
      await loadEscalationDetail(selectedEscalationId);
      notify("success", t("callCenter.notesSaved"));
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  const completeQueueItem = async () => {
    if (!selectedEscalationId) {
      return;
    }

    try {
      await apiPost(`/api/v1/call-center/queue/${selectedEscalationId}/complete`, {
        resolution: notesForm.resolution || t("callCenter.completeDefaultResolution"),
        operatorNotes: notesForm.operatorNotes || null,
        qaNotes: notesForm.qaNotes || null
      });
      await Promise.all([loadQueue(), loadEscalationDetail(selectedEscalationId)]);
      notify("success", t("callCenter.completed"));
    } catch (completeError) {
      notify("error", extractErrorMessage(completeError));
    }
  };

  const requestCallback = async () => {
    if (!selectedEscalationId || !selectedEscalation) {
      return;
    }

    const values = await openFormDialog({
      title: t("callCenter.createCallbackTitle"),
      fields: [
        {
          name: "callbackPhone",
          label: t("callCenter.callbackPhone"),
          required: true
        },
        {
          name: "notes",
          label: t("callCenter.operatorNotes"),
          type: "textarea",
          rows: 3
        }
      ],
      initialValues: {
        callbackPhone:
          selectedEscalation.callbackPhone ??
          selectedEscalation.customerPhone ??
          selectedEscalation.callSession.callerPhone ??
          "",
        notes: ""
      },
      confirmLabel: t("callCenter.createCallbackConfirm")
    });

    if (!values) {
      return;
    }

    try {
      await apiPost(`/api/v1/call-center/queue/${selectedEscalationId}/callback-request`, {
        callbackPhone: values.callbackPhone || null,
        notes: values.notes || null
      });
      await Promise.all([loadQueue(), loadEscalationDetail(selectedEscalationId)]);
      notify("success", t("callCenter.callbackCreated"));
    } catch (callbackError) {
      notify("error", extractErrorMessage(callbackError));
    }
  };

  const captureVoicemail = async () => {
    if (!selectedEscalationId) {
      return;
    }

    const values = await openFormDialog({
      title: t("callCenter.captureVoicemailTitle"),
      fields: [
        {
          name: "voicemailRecordingUrl",
          label: t("callCenter.recordingUrl"),
          type: "text"
        },
        {
          name: "notes",
          label: t("callCenter.operatorNotes"),
          type: "textarea",
          rows: 3
        }
      ],
      initialValues: {
        voicemailRecordingUrl: selectedEscalation?.voicemailRecordingUrl ?? "",
        notes: ""
      },
      confirmLabel: t("callCenter.saveVoicemailConfirm")
    });

    if (!values) {
      return;
    }

    try {
      await apiPost(`/api/v1/call-center/queue/${selectedEscalationId}/voicemail`, {
        voicemailRecordingUrl: values.voicemailRecordingUrl || null,
        notes: values.notes || null
      });
      await Promise.all([loadQueue(), loadEscalationDetail(selectedEscalationId)]);
      notify("success", t("callCenter.voicemailCaptured"));
    } catch (voicemailError) {
      notify("error", extractErrorMessage(voicemailError));
    }
  };

  const sendSmsFallback = async () => {
    if (!selectedEscalationId || !selectedEscalation) {
      return;
    }

    const values = await openFormDialog({
      title: t("callCenter.sendSmsTitle"),
      fields: [
        {
          name: "recipientPhone",
          label: t("callCenter.recipientPhone"),
          required: true
        },
        {
          name: "message",
          label: t("callCenter.message"),
          type: "textarea",
          rows: 3,
          required: true
        }
      ],
      initialValues: {
        recipientPhone:
          selectedEscalation.smsRecipientPhone ??
          selectedEscalation.customerPhone ??
          selectedEscalation.callSession.callerPhone ??
          "",
        message: t("callCenter.defaultSmsMessage")
      },
      confirmLabel: t("callCenter.sendSmsConfirm")
    });

    if (!values?.message) {
      return;
    }

    try {
      await apiPost(`/api/v1/call-center/queue/${selectedEscalationId}/sms-fallback`, {
        recipientPhone: values.recipientPhone || null,
        message: values.message
      });
      await Promise.all([loadQueue(), loadEscalationDetail(selectedEscalationId)]);
      notify("success", t("callCenter.smsSent"));
    } catch (smsError) {
      notify("error", extractErrorMessage(smsError));
    }
  };

  const selectedSalonQueue = selectedSalonId
    ? queue.filter((item) => item.salon.id === selectedSalonId)
    : queue;
  const openRequests = selectedSalonQueue.filter((item) => item.status !== "CLOSED").length;
  const availableStaffCount = staff.filter((member) => member.currentWorkStatus === "AVAILABLE").length;
  const amazonConnectRuntimeReady = Boolean(runtime?.amazonConnect.configured);
  const amazonConnectPlatformReady = Boolean(runtime?.amazonConnect.adminConfigured);
  const amazonConnectReady = Boolean(amazonConnectRuntimeReady && ccpUrl);
  const missingAmazonConnectItems = runtime?.amazonConnect.missing ?? [];
  const missingPlatformItems = runtime?.amazonConnect.adminMissing ?? [];
  const selectedSalonName =
    selectedEscalation?.salon.name ?? salons.find((item) => item.id === selectedSalonId)?.name ?? t("common.none");
  const hasSelectedSalon = Boolean(selectedSalonId);
  const amazonConnectRuntimeRows = [
    {
      key: "AWS_REGION",
      value: runtime?.amazonConnect.region ?? t("common.none"),
      usage: t("callCenter.usageRegion")
    },
    {
      key: "AMAZON_CONNECT_CCP_URL",
      value: ccpUrl ?? t("common.none"),
      usage: t("callCenter.usageCcpUrl")
    },
    {
      key: "AMAZON_CONNECT_INSTANCE_ID",
      value: runtime?.amazonConnect.instanceId ?? t("common.none"),
      usage: t("callCenter.usageInstanceId")
    },
    {
      key: "AMAZON_CONNECT_INSTANCE_URL",
      value: runtime?.amazonConnect.instanceUrl ?? t("common.none"),
      usage: t("callCenter.usageInstanceUrl")
    },
    {
      key: "AMAZON_CONNECT_QUEUE_ID_DEFAULT",
      value: runtime?.amazonConnect.queueIdDefault ?? t("common.none"),
      usage: t("callCenter.usageQueue")
    },
    {
      key: "AMAZON_CONNECT_ROUTING_PROFILE_ID",
      value: runtime?.amazonConnect.routingProfileId ?? t("common.none"),
      usage: t("callCenter.usageRoutingProfile")
    }
  ];

  const visibleAppointments = useMemo(() => {
    return appointments.slice().sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [appointments]);
  const contextStaff = selectedSalonDetail?.staff.length ? selectedSalonDetail.staff : staff;
  const activeBookableStaff = contextStaff.filter(
    (member) => (member.status ?? "ACTIVE") === "ACTIVE" && member.isBookable !== false
  );
  const unavailableStaff = contextStaff.filter(
    (member) =>
      (member.status && member.status !== "ACTIVE") ||
      member.isBookable === false ||
      (member.currentWorkStatus && member.currentWorkStatus !== "AVAILABLE")
  );
  const contextServices = selectedSalonDetail?.services.length ? selectedSalonDetail.services : services;
  const salonBusinessPhone =
    selectedSalonDetail?.customerIncomingPhoneNumber ??
    selectedSalonDetail?.originalPhoneNumber ??
    selectedSalonDetail?.contactPhone ??
    t("common.none");
  const customerIncomingPhone = selectedSalonDetail?.customerIncomingPhoneNumber ?? t("common.none");
  const originalSalonPhone = selectedSalonDetail?.originalPhoneNumber ?? selectedSalonDetail?.contactPhone ?? t("common.none");
  const ownerContact = selectedSalonDetail
    ? [selectedSalonDetail.owner.fullName, selectedSalonDetail.owner.phone ?? selectedSalonDetail.owner.email]
        .filter(Boolean)
        .join(" · ")
    : t("common.none");
  const todayBusinessHour = selectedSalonDetail?.businessHours.find(
    (hour) => hour.dayOfWeek === getTodayDayOfWeek(selectedSalonDetail.timezone)
  );
  const latestTranscript = selectedEscalation?.callSession.transcripts
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const latestBookingAttempt = selectedEscalation?.callSession.bookingAttempts
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  if (isOwner) {
    const assignedAgents = selectedSalonDetail?.callCenterAssignments ?? [];
    const queuedItems = queue.filter((item) => item.status === "QUEUED");
    const fallbackItems = queue.filter((item) =>
      ["CALLBACK_REQUESTED", "VOICEMAIL_LEFT", "SMS_SENT"].includes(item.status)
    );

    if (isBasicMode) {
      return (
        <div className="stack">
          <section className="card">
            <div className="section-header">
              <div>
                <h2>{t("callCenter.ownerMonitorTitle")}</h2>
                <p className="muted">{t("callCenter.ownerBasicHint")}</p>
              </div>
              <span
                className={
                  selectedSalonDetail?.settings?.callCenterEnabled
                    ? "status-pill success"
                    : "status-pill warning"
                }
              >
                {t("nav.callCenter")}:{" "}
                {selectedSalonDetail?.settings?.callCenterEnabled ? t("common.enabled") : t("common.disabled")}
              </span>
            </div>
            <div className="metrics-grid">
              <div>
                <span className="muted">{t("callCenter.currentSalon")}</span>
                <strong>{selectedSalonName}</strong>
              </div>
              <div>
                <span className="muted">{t("callCenter.openRequests")}</span>
                <strong>{openRequests}</strong>
              </div>
              <div>
                <span className="muted">{t("callCenter.queuedItems")}</span>
                <strong>{queuedItems.length}</strong>
              </div>
              <div>
                <span className="muted">{t("callCenter.assignedAgentsTitle")}</span>
                <strong>{assignedAgents.length}</strong>
              </div>
            </div>
            <div className="quick-actions primary-actions">
              <Link to="/salon-profile">{t("dashboard.salonSettings")}</Link>
              <Link to="/appointments">{t("dashboard.viewSchedule")}</Link>
              <button type="button" onClick={() => void loadQueue(false)}>
                {t("callCenter.refreshQueue")}
              </button>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="stack">
        <FormDialog />

        <section className="card">
          <div className="section-header">
            <div>
              <h2>{t("callCenter.ownerMonitorTitle")}</h2>
              <p className="muted">{t("callCenter.ownerMonitorHint")}</p>
            </div>
            <div className="summary-badges">
              <span
                className={
                  selectedSalonDetail?.settings?.callCenterEnabled
                    ? "status-pill success"
                    : "status-pill warning"
                }
              >
                {t("nav.callCenter")}:{" "}
                {selectedSalonDetail?.settings?.callCenterEnabled ? t("common.enabled") : t("common.disabled")}
              </span>
              <span className={runtime?.amazonConnect.adminConfigured ? "status-pill success" : "status-pill warning"}>
                {runtime?.amazonConnect.adminConfigured ? t("callCenter.platformReady") : t("callCenter.platformPending")}
              </span>
            </div>
          </div>
          <div className="hero-stats">
            <article className="hero-stat-card">
              <span>{t("callCenter.currentSalon")}</span>
              <strong>{selectedSalonName}</strong>
            </article>
            <article className="hero-stat-card">
              <span>{t("callCenter.assignedSalons")}</span>
              <strong>{runtime?.assignedSalonCount ?? 0}</strong>
            </article>
            <article className="hero-stat-card">
              <span>{t("callCenter.openRequests")}</span>
              <strong>{openRequests}</strong>
            </article>
            <article className="hero-stat-card">
              <span>{t("callCenter.assignedAgentsTitle")}</span>
              <strong>{assignedAgents.length}</strong>
            </article>
          </div>
          <div className="quick-actions">
            <Link to="/salon-profile" className="button-secondary">
              {t("nav.salonProfile")}
            </Link>
            <Link to="/appointments" className="button-secondary">
              {t("nav.appointments")}
            </Link>
            <Link to="/calls" className="button-secondary">
              {t("nav.calls")}
            </Link>
            {ccpUrl ? (
              <a
                href={ccpUrl}
                target="_blank"
                rel="noreferrer"
                className="button-secondary"
              >
                {t("callCenter.ccpLink")}
              </a>
            ) : null}
          </div>
        </section>

        <section className="card-grid">
          <article className="card stat-card">
            <h3>{t("callCenter.queuedItems")}</h3>
            <strong>{queuedItems.length}</strong>
          </article>
          <article className="card stat-card">
            <h3>{t("callCenter.availableStaff")}</h3>
            <strong>{availableStaffCount}</strong>
          </article>
          <article className="card stat-card">
            <h3>{t("callCenter.fallbackTitle")}</h3>
            <strong>{fallbackItems.length}</strong>
          </article>
          <article className="card stat-card">
            <h3>{t("callCenter.currentContact")}</h3>
            <strong>{selectedEscalation?.callSession.callerPhone ?? t("common.none")}</strong>
          </article>
        </section>

        <section className="card-grid">
          <article className="card">
            <div className="section-header">
              <h3>{t("callCenter.assignedAgentsTitle")}</h3>
              <span className="status-pill info">{assignedAgents.length}</span>
            </div>
            {assignedAgents.length ? (
              <div className="mobile-list">
                {assignedAgents.map((assignment) => (
                  <article key={assignment.id} className="mobile-item">
                    <strong>{assignment.agent.fullName}</strong>
                    <span>{assignment.agent.email}</span>
                    <small>
                      {assignment.agent.phone ?? t("common.none")} ·{" "}
                      {assignment.agent.isActive ? t("status.ACTIVE") : t("status.INACTIVE")}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyBlock message={t("callCenter.assignedAgentsEmpty")} />
            )}
          </article>

          <article className="card">
            <h3>{t("callCenter.fallbackTitle")}</h3>
            <div className="mobile-list">
              <article className="mobile-item">
                <strong>{t("dashboard.metricHumanCallCenter")}</strong>
                <span>
                  {selectedSalonDetail?.settings?.callCenterEnabled ? t("common.enabled") : t("common.disabled")}
                </span>
              </article>
              <article className="mobile-item">
                <strong>{t("dashboard.metricVoicemailFallback")}</strong>
                <span>
                  {selectedSalonDetail?.settings?.voicemailEnabled ? t("common.enabled") : t("common.disabled")}
                </span>
              </article>
              <article className="mobile-item">
                <strong>{t("dashboard.metricCallbackRequest")}</strong>
                <span>
                  {selectedSalonDetail?.settings?.callbackRequestEnabled ? t("common.enabled") : t("common.disabled")}
                </span>
              </article>
              <article className="mobile-item">
                <strong>{t("dashboard.metricSmsFallback")}</strong>
                <span>
                  {selectedSalonDetail?.settings?.smsFallbackEnabled ? t("common.enabled") : t("common.disabled")}
                </span>
              </article>
              <article className="mobile-item">
                <strong>{t("callCenter.ccpLinkHint")}</strong>
                <span>{ccpUrl ?? t("common.none")}</span>
              </article>
            </div>
          </article>
        </section>

        <section className="card">
          <div className="section-header">
            <div>
              <h2>{t("callCenter.queueTitle")}</h2>
              <p className="muted">{t("callCenter.ownerQueueHint")}</p>
            </div>
            <button type="button" className="button-secondary" onClick={() => void loadQueue(false)}>
              {t("callCenter.refreshQueue")}
            </button>
          </div>
          {queue.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("callCenter.requested")}</th>
                    <th>{t("callCenter.caller")}</th>
                    <th>{t("common.status")}</th>
                    <th>{t("callCenter.routing")}</th>
                    <th>{t("callCenter.waitingTime")}</th>
                    <th>{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((item) => {
                    const waitingReference = item.connectedAt ?? item.closedAt ?? new Date().toISOString();
                    const waitingMinutes = Math.max(
                      0,
                      Math.round(
                        (new Date(waitingReference).getTime() - new Date(item.requestedAt).getTime()) / 60000
                      )
                    );

                    return (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.requestedAt)}</td>
                        <td>{item.callSession.callerPhone ?? t("common.none")}</td>
                        <td>{statusLabelKey(item.status) ? t(statusLabelKey(item.status)!) : item.status}</td>
                        <td>{translateRoutingOutcome(item.routingOutcome ?? item.callSession.routingOutcome)}</td>
                        <td>{t("callCenter.waitingMinutes", { count: waitingMinutes })}</td>
                        <td>
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => setSelectedEscalationId(item.id)}
                          >
                            {t("callCenter.openAction")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyBlock message={t("callCenter.queueEmpty")} />
          )}
        </section>

        <section className="card">
          <div className="section-header">
            <div>
              <h2>{t("callCenter.selectedTitle")}</h2>
              <p className="muted">{t("callCenter.selectedHintEmpty")}</p>
            </div>
          </div>
          {selectedEscalation ? (
            <div className="stack">
              <div className="metrics-grid">
                <div>
                  <span className="muted">{t("common.status")}</span>
                  <strong>
                    {statusLabelKey(selectedEscalation.status)
                      ? t(statusLabelKey(selectedEscalation.status)!)
                      : selectedEscalation.status}
                  </strong>
                </div>
                <div>
                  <span className="muted">{t("callCenter.routing")}</span>
                  <strong>{translateRoutingOutcome(selectedEscalation.routingOutcome)}</strong>
                </div>
                <div>
                  <span className="muted">{t("callCenter.escalationReason")}</span>
                  <strong>{selectedEscalation.escalationReason ?? t("common.none")}</strong>
                </div>
                <div>
                  <span className="muted">{t("callCenter.finalResolution")}</span>
                  <strong>{selectedEscalation.callSession.finalResolution ?? t("common.none")}</strong>
                </div>
              </div>

              <article className="inspection-box">
                <h3>{t("callCenter.transcript")}</h3>
                {selectedEscalation.callSession.transcripts.length ? (
                  selectedEscalation.callSession.transcripts.map((transcript) => (
                    <div key={transcript.id} className="stack">
                      {transcript.transcriptSummary ? <p>{transcript.transcriptSummary}</p> : null}
                      <pre>{transcript.transcriptText}</pre>
                    </div>
                  ))
                ) : (
                  <EmptyBlock message={t("callCenter.transcriptEmpty")} />
                )}
              </article>

              <article className="inspection-box">
                <h3>{t("callCenter.aiSummary")}</h3>
                <pre>{JSON.stringify(selectedEscalation.callSession.aiSummary ?? null, null, 2)}</pre>
              </article>

              <article className="inspection-box">
                <h3>{t("callCenter.bookingAttempts")}</h3>
                {selectedEscalation.callSession.bookingAttempts.length ? (
                  <div className="mobile-list">
                    {selectedEscalation.callSession.bookingAttempts.map((attempt) => (
                      <article key={attempt.id} className="mobile-item">
                        <strong>
                          {statusLabelKey(attempt.status) ? t(statusLabelKey(attempt.status)!) : attempt.status}
                        </strong>
                        <span>
                          {attempt.requestedService ?? t("callCenter.noService")} ·{" "}
                          {attempt.requestedStaff ?? t("common.unassigned")}
                        </span>
                        <small>{attempt.failureReason ?? t("callCenter.noFailureReason")}</small>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock message={t("callCenter.bookingAttemptsEmpty")} />
                )}
              </article>
            </div>
          ) : (
            <EmptyBlock message={t("callCenter.selectedEmpty")} />
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="operator-workspace">
      <FormDialog />

      <aside className="card operator-context-panel">
        <div className="section-header compact-header">
          <div>
            <h2>{selectedSalonDetail?.name ?? selectedSalonName}</h2>
            <p className="muted">Salon context for this call</p>
          </div>
          <span className={amazonConnectReady ? "status-pill success" : "status-pill warning"}>
            {amazonConnectReady ? t("callCenter.amazonReady") : t("callCenter.amazonPending")}
          </span>
        </div>

        <label className="field compact">
          <span>{t("callCenter.selectSalon")}</span>
          <select
            value={selectedSalonId}
            onChange={(event) => void changeSalon(event.target.value)}
            disabled={!salons.length}
          >
            {salons.map((salon) => (
              <option key={salon.id} value={salon.id}>
                {salon.name}
              </option>
            ))}
          </select>
        </label>

        <div className="operator-info-list">
          <div>
            <span className="muted">{t("common.addressLine1")}</span>
            <strong>{formatSalonAddress(selectedSalonDetail)}</strong>
          </div>
          <div>
            <span className="muted">{t("callCenter.businessPhone")}</span>
            <strong>{salonBusinessPhone}</strong>
          </div>
          <div>
            <span className="muted">{t("callCenter.customerIncomingPhone")}</span>
            <strong>{customerIncomingPhone}</strong>
          </div>
          <div>
            <span className="muted">{t("callCenter.originalSalonPhone")}</span>
            <strong>{originalSalonPhone}</strong>
          </div>
          <div>
            <span className="muted">{t("callCenter.ownerContact")}</span>
            <strong>{ownerContact}</strong>
          </div>
          <div>
            <span className="muted">{t("callCenter.routingNumber")}</span>
            <strong>{selectedSalonDetail?.settings?.callCenterRoutingNumber || t("common.none")}</strong>
          </div>
          <div>
            <span className="muted">{t("callCenter.todayBusinessHours")}</span>
            <strong>{todayBusinessHour ? formatBusinessHour(todayBusinessHour) : t("common.none")}</strong>
          </div>
        </div>

        <div className="operator-routing-note">
          <span>{t("callCenter.routingNote")}</span>
          <strong>{selectedSalonDetail?.settings?.callCenterRoutingNote || t("common.none")}</strong>
        </div>

        <div className="operator-context-section">
          <details className="advanced-config">
            <summary>{t("callCenter.weeklyBusinessHours")}</summary>
            {selectedSalonDetail?.businessHours.length ? (
              <div className="compact-list">
                {selectedSalonDetail.businessHours.map((hour) => (
                  <span key={hour.dayOfWeek}>{formatBusinessHour(hour)}</span>
                ))}
              </div>
            ) : (
              <p className="muted">{t("common.none")}</p>
            )}
          </details>
        </div>

        <div className="operator-info-list">
          <div>
            <span className="muted">{t("callCenter.callerPhone")}</span>
            <strong>{selectedEscalation?.callSession.callerPhone ?? t("common.none")}</strong>
          </div>
        </div>

        <div className="operator-context-section">
          <h3>{t("callCenter.activeBookableStaff")}</h3>
          {activeBookableStaff.length ? (
            <div className="compact-list">
              {activeBookableStaff.map((member) => (
                <span key={member.id}>{member.fullName}</span>
              ))}
            </div>
          ) : (
            <p className="muted">{t("common.none")}</p>
          )}
        </div>

        <div className="operator-context-section">
          <h3>{t("callCenter.busyInactiveStaff")}</h3>
          {unavailableStaff.length ? (
            <div className="compact-list">
              {unavailableStaff.map((member) => (
                <span key={member.id}>{member.fullName} · {formatStaffStatus(member)}</span>
              ))}
            </div>
          ) : (
            <p className="muted">{t("common.none")}</p>
          )}
        </div>

        <div className="operator-context-section">
          <h3>{t("callCenter.activeServices")}</h3>
          {contextServices.length ? (
            <div className="compact-list">
              {contextServices.map((service) => (
                <span key={service.id}>{service.name}</span>
              ))}
            </div>
          ) : (
            <p className="muted">{t("common.none")}</p>
          )}
        </div>
      </aside>

      <main className="operator-main-panel">
        <section className="card operator-action-bar">
          <div>
            <h2>{t("callCenter.operatorSimpleTitle")}</h2>
            <p className="muted">{t("callCenter.operatorSimpleHint")}</p>
          </div>
          <div className="inline-actions">
            {ccpUrl ? (
              <a href={ccpUrl} target="_blank" rel="noreferrer" className="button-primary">
                {t("callCenter.ccpLink")}
              </a>
            ) : (
              <button type="button" className="button-primary" disabled>
                {t("callCenter.amazonPending")}
              </button>
            )}
            <button type="button" className="button-secondary" onClick={() => void loadQueue()}>
              {t("callCenter.refreshQueue")}
            </button>
          </div>
        </section>

        <section className="card-grid operator-top-grid">
          <article className="card">
            <div className="section-header compact-header">
              <div>
                <h3>Selected call</h3>
                <p className="muted">
                  {selectedEscalation
                    ? `${selectedEscalation.salon.name} · ${selectedEscalation.callSession.callerPhone ?? t("callCenter.unknownCaller")}`
                    : t("callCenter.selectedEmpty")}
                </p>
              </div>
              <span className="status-pill info">{openRequests} open</span>
            </div>
            {selectedEscalation ? (
              <div className="operator-call-card">
                <div className="metrics-grid compact-metrics">
                  <div>
                    <span className="muted">{t("common.status")}</span>
                    <strong>{statusLabelKey(selectedEscalation.status) ? t(statusLabelKey(selectedEscalation.status)!) : selectedEscalation.status}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("callCenter.callerPhone")}</span>
                    <strong>{selectedEscalation.callSession.callerPhone ?? t("common.none")}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("callCenter.routing")}</span>
                    <strong>{translateRoutingOutcome(selectedEscalation.routingOutcome)}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("callCenter.resolution")}</span>
                    <strong>{selectedEscalation.callSession.finalResolution ?? t("common.none")}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("callCenter.escalationReason")}</span>
                    <strong>{selectedEscalation.escalationReason ?? t("common.none")}</strong>
                  </div>
                </div>
                <div className="operator-call-summary">
                  <div>
                    <span className="muted">{t("callCenter.aiSummary")}</span>
                    <p>{summarizeUnknown(selectedEscalation.callSession.aiSummary)}</p>
                  </div>
                  <div>
                    <span className="muted">{t("calls.transcriptSummary")}</span>
                    <p>{latestTranscript?.transcriptSummary || t("common.none")}</p>
                  </div>
                  <div>
                    <span className="muted">{t("callCenter.bookingAttempts")}</span>
                    <p>
                      {latestBookingAttempt
                        ? `${statusLabelKey(latestBookingAttempt.status) ? t(statusLabelKey(latestBookingAttempt.status)!) : latestBookingAttempt.status} · ${latestBookingAttempt.requestedService ?? t("callCenter.noService")}`
                        : t("callCenter.bookingAttemptsEmpty")}
                    </p>
                  </div>
                </div>
                <div className="inline-actions">
                  <button type="button" className="button-primary" onClick={() => void acceptQueueItem()}>
                    {t("callCenter.accept")}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => void completeQueueItem()}>
                    {t("callCenter.complete")}
                  </button>
                </div>
              </div>
            ) : (
              <EmptyBlock message={t("callCenter.selectedEmpty")} />
            )}
          </article>

          <article className="card">
            <h3>{t("callCenter.queueTitle")}</h3>
            {selectedSalonQueue.length ? (
              <div className="compact-queue-list">
                {selectedSalonQueue.slice(0, 6).map((item) => {
                  const waitingSince = item.connectedAt ?? item.closedAt ?? new Date().toISOString();
                  const waitingMinutes = Math.max(
                    0,
                    Math.round(
                      (new Date(waitingSince).getTime() - new Date(item.requestedAt).getTime()) / 60000
                    )
                  );
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={item.id === selectedEscalationId ? "queue-row active" : "queue-row"}
                      onClick={() => setSelectedEscalationId(item.id)}
                    >
                      <strong>{item.callSession.callerPhone ?? t("common.none")}</strong>
                      <span>{statusLabelKey(item.status) ? t(statusLabelKey(item.status)!) : item.status}</span>
                      <small>{t("callCenter.waitingMinutes", { count: waitingMinutes })}</small>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyBlock message={t("callCenter.queueEmpty")} />
            )}
          </article>
        </section>

        {selectedEscalation ? (
          <section className="card">
            <div className="section-header compact-header">
              <div>
                <h3>{t("callCenter.customerLookup")}</h3>
                <p className="muted">{t("callCenter.customerLookupHint")}</p>
              </div>
              <span className="summary-badge">{selectedEscalation.customerMatches.length}</span>
            </div>
            {selectedEscalation.customerMatches.length ? (
              <div className="mobile-list">
                {selectedEscalation.customerMatches.slice(0, 3).map((customer) => (
                  <article key={customer.id} className="mobile-item">
                    <strong>{customer.firstName} {customer.lastName}</strong>
                    <span>{customer.phone}</span>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyBlock message={t("callCenter.customerLookupEmpty")} />
            )}
          </section>
        ) : null}

        {selectedEscalation ? (
          <section className="card">
            <h3>{t("callCenter.notesTitle")}</h3>
            <div className="form-grid two-columns">
              <label className="field">
                <span>{t("callCenter.operatorNotes")}</span>
                <textarea
                  rows={3}
                  value={notesForm.operatorNotes}
                  onChange={(event) => setNotesForm((prev) => ({ ...prev, operatorNotes: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>{t("callCenter.resolution")}</span>
                <textarea
                  rows={3}
                  value={notesForm.resolution}
                  onChange={(event) => setNotesForm((prev) => ({ ...prev, resolution: event.target.value }))}
                />
              </label>
            </div>
            <div className="inline-actions">
              <button type="button" className="button-secondary" onClick={() => void saveNotes()}>
                {t("callCenter.saveNotes")}
              </button>
              <button type="button" className="button-secondary" onClick={() => void requestCallback()}>
                {t("callCenter.callbackRequest")}
              </button>
            </div>
          </section>
        ) : null}

        <section className="card-grid operator-booking-grid">
          <article className="card">
            <h3>{t("callCenter.createCustomer")}</h3>
            <form className="form-grid two-columns" onSubmit={createCustomer}>
              <label className="field">
                <span>{t("customers.firstName")}</span>
                <input
                  disabled={!hasSelectedSalon}
                  value={customerForm.firstName}
                  onChange={(event) => setCustomerForm((prev) => ({ ...prev, firstName: event.target.value }))}
                  required
                />
              </label>
              <label className="field">
                <span>{t("customers.lastName")}</span>
                <input
                  disabled={!hasSelectedSalon}
                  value={customerForm.lastName}
                  onChange={(event) => setCustomerForm((prev) => ({ ...prev, lastName: event.target.value }))}
                  required
                />
              </label>
              <label className="field">
                <span>{t("common.phone")}</span>
                <input
                  type="tel"
                  inputMode="tel"
                  disabled={!hasSelectedSalon}
                  value={customerForm.phone}
                  onChange={(event) =>
                    setCustomerForm((prev) => ({
                      ...prev,
                      phone: formatUsPhoneInput(event.target.value)
                    }))
                  }
                  required
                />
              </label>
              <button type="submit" className="button-primary" disabled={!hasSelectedSalon}>
                {t("callCenter.createCustomer")}
              </button>
            </form>
          </article>

          <article className="card">
            <h3>{t("callCenter.createBooking")}</h3>
            <form className="form-grid two-columns" onSubmit={createBooking}>
              <label className="field">
                <span>{t("appointments.customer")}</span>
                <select
                  disabled={!hasSelectedSalon}
                  value={bookingForm.customerId}
                  onChange={(event) => setBookingForm((prev) => ({ ...prev, customerId: event.target.value }))}
                  required
                >
                  <option value="">{t("appointments.selectCustomer")}</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.firstName} {customer.lastName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("appointments.staff")}</span>
                <select
                  disabled={!hasSelectedSalon}
                  value={bookingForm.staffId}
                  onChange={(event) => setBookingForm((prev) => ({ ...prev, staffId: event.target.value }))}
                  required
                >
                  <option value="">{t("appointments.selectStaff")}</option>
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("appointments.service")}</span>
                <select
                  disabled={!hasSelectedSalon}
                  value={bookingForm.serviceId}
                  onChange={(event) => setBookingForm((prev) => ({ ...prev, serviceId: event.target.value }))}
                  required
                >
                  <option value="">{t("appointments.selectService")}</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("appointments.start")}</span>
                <input
                  type="datetime-local"
                  disabled={!hasSelectedSalon}
                  value={bookingForm.startTime}
                  onChange={(event) => setBookingForm((prev) => ({ ...prev, startTime: event.target.value }))}
                  required
                />
              </label>
              <button type="submit" className="button-primary" disabled={!hasSelectedSalon}>
                {t("callCenter.createBooking")}
              </button>
            </form>
          </article>
        </section>

        <section className="card">
          <div className="section-header compact-header">
            <div>
              <h2>Current schedule</h2>
              <p className="muted">{selectedSalonName}</p>
            </div>
            <span className="summary-badge">{visibleAppointments.length} appointments</span>
          </div>
          {visibleAppointments.length ? (
            <div className="table-wrap compact-table">
              <table>
                <thead>
                  <tr>
                    <th>{t("appointments.time")}</th>
                    <th>{t("appointments.customer")}</th>
                    <th>{t("appointments.staff")}</th>
                    <th>{t("appointments.service")}</th>
                    <th>{t("common.status")}</th>
                    <th>{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAppointments.map((appointment) => (
                    <tr key={appointment.id}>
                      <td>{formatDateTime(appointment.startTime)}</td>
                      <td>{appointment.customer.firstName} {appointment.customer.lastName}</td>
                      <td>{appointment.staff.fullName}</td>
                      <td>{appointment.service.name}</td>
                      <td>{statusLabelKey(appointment.status) ? t(statusLabelKey(appointment.status)!) : appointment.status}</td>
                      <td>
                        <div className="inline-actions compact-actions">
                          <button type="button" className="button-secondary" onClick={() => void reschedule(appointment)}>
                            {t("appointments.reschedule")}
                          </button>
                          <button type="button" className="button-secondary" onClick={() => void updateStatus(appointment.id, appointment.status)}>
                            {t("appointments.updateStatus")}
                          </button>
                          <button type="button" className="button-secondary" onClick={() => void cancel(appointment)}>
                            {t("appointments.cancel")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyBlock message={t("callCenter.appointmentsEmpty")} />
          )}
        </section>
      </main>
    </div>
  );
};
