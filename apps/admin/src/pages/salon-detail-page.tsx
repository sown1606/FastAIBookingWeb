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
import {
  getCountryOptions,
  getCurrencyOptions,
  getLocalePreferenceOptions,
  getTimezoneOptions
} from "../lib/form-options";
import { formatUsPhoneInput, validateOptionalUsPhone } from "../lib/phone";
import { getStatusLabel, useI18n } from "../lib/i18n";

interface SalonSettings {
  currency: string;
  locale: string;
  bookingLeadTimeMinutes: number;
  cancellationPolicy: string | null;
  aiReceptionEnabled: boolean;
  aiTransferRingCount: number;
  callCenterEnabled: boolean;
  voicemailEnabled: boolean;
  callbackRequestEnabled: boolean;
  smsFallbackEnabled: boolean;
  aiGreetingPrompt: string | null;
  callerLanguage: string;
  callLogVisibility: "OWNER_ONLY" | "OWNER_AND_STAFF" | "OWNER_STAFF_OPERATOR";
  notificationRecipients: string[];
  callCenterRoutingNumber: string | null;
  callCenterRoutingNote: string | null;
  routingSummary: {
    mode:
      | "SALON_PHONE_ONLY"
      | "AI_RECEPTION_ONLY"
      | "CALL_CENTER_ONLY"
      | "AI_RECEPTION_WITH_CALL_CENTER";
    ringCountBeforeAi: number;
  };
}

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
  settings: SalonSettings | null;
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
  integrationStatuses: {
    callRail: {
      configured: boolean;
      missing: string[];
      activeConfigCount: number;
    };
    vertex: {
      configured: boolean;
      missing: string[];
      activeConfigCount: number;
    };
    amazonConnect: {
      configured: boolean;
      missing: string[];
      activeConfigCount: number;
    };
  };
  callCenterAssignmentStatus: {
    assignedAgentCount: number;
    hasAssignedAgents: boolean;
  };
  recentEscalations: Array<{
    id: string;
    status: string;
    routingOutcome: string | null;
    requestedAt: string;
    resolution: string | null;
    callSession: {
      id: string;
      callerPhone: string | null;
      routingOutcome: string | null;
    };
  }>;
  recentCallFailures: Array<{
    id: string;
    providerCallId: string;
    status: string;
    routingOutcome: string | null;
    finalResolution: string | null;
    callerPhone: string | null;
    createdAt: string;
  }>;
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

interface AiReceptionConfig {
  id: string | null;
  salonId: string;
  salonName: string;
  provider: "amazon_connect" | "callrail";
  carrier: "tmobile";
  carrierLabel: string;
  originalPhoneNumber: string | null;
  originalPhoneNumberFormatted: string | null;
  forwardToNumber: string;
  forwardToNumberFormatted: string | null;
  forwardingPhoneNumber: string;
  forwardingPhoneNumberFormatted: string | null;
  forwardingType: "no_answer";
  activationCode: string;
  fallbackActivationCode: string;
  activationCodeWithoutDelay: string;
  deactivationCode: string;
  statusCheckCode: string;
  status: "not_configured" | "pending" | "active" | "failed";
  lastTestedAt: string | null;
  lastVerifiedAt: string | null;
  webhookVerificationEnabled: boolean;
  setupInstructions: string[];
}

interface AiReceptionCallLog {
  id: string;
  provider: "amazon_connect" | "callrail";
  providerCallId: string;
  trackingNumber: string | null;
  trackingNumberFormatted: string;
  originalPhoneNumber: string | null;
  originalPhoneNumberFormatted: string;
  callerNumber: string | null;
  callerNumberFormatted: string;
  direction: string;
  status: string;
  durationSeconds: number | null;
  startedAt: string | null;
  answeredAt: string | null;
  completedAt: string | null;
  recordingUrl: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AiReceptionCallLogsResponse {
  items: AiReceptionCallLog[];
}

interface CallRailHealthStatus {
  provider: "amazon_connect" | "callrail";
  status: string;
  configured: boolean;
  missing: string[];
  webhookEndpoint: string;
  webhookConfigured: boolean;
  webhookVerificationEnabled: boolean;
  webhookSecretConfigured: boolean;
  apiKeyConfigured: boolean;
  accountIdConfigured: boolean;
  companyIdConfigured: boolean;
  accountCompanyConfigured: boolean;
  trackingNumberConfigured: boolean;
  trackingNumberIdConfigured: boolean;
  defaultSalonIdConfigured: boolean;
  aiFlowIdConfigured: boolean;
  livePersonFlowIdConfigured: boolean;
  livePersonFlowOptional: boolean;
  trackingNumber: string;
  trackingNumberFormatted: string | null;
  callFlowName: string;
  demoOriginalPhoneNumber: string;
  demoOriginalPhoneNumberFormatted: string | null;
  demoForwardingPhoneNumber: string;
  demoForwardingPhoneNumberFormatted: string | null;
  activeAiReceptionSetupCount: number;
  lastReceivedWebhookAt: string | null;
  lastWebhookReceivedAt: string | null;
  lastMappedCallAt: string | null;
}

const integrationProviderOptions: Array<IntegrationConfig["provider"]> = [
  "AMAZON_CONNECT"
];

const appointmentStatusOptions = [
  { value: "SCHEDULED", label: "SCHEDULED" },
  { value: "CONFIRMED", label: "CONFIRMED" },
  { value: "CANCELED", label: "CANCELED" },
  { value: "NO_SHOW", label: "NO_SHOW" }
];

const aiReceptionStatusClasses: Record<AiReceptionConfig["status"], string> = {
  not_configured: "status-pill warning",
  pending: "status-pill info",
  active: "status-pill success",
  failed: "status-pill danger"
};

const formatDuration = (value: number | null) => {
  if (value === null || value === undefined) {
    return "-";
  }

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
};

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
  const { t } = useI18n();

  const weekdayLabels = useMemo<Record<number, string>>(
    () => ({
      0: t("weekday.0"),
      1: t("weekday.1"),
      2: t("weekday.2"),
      3: t("weekday.3"),
      4: t("weekday.4"),
      5: t("weekday.5"),
      6: t("weekday.6")
    }),
    [t]
  );

  const routingModeLabels = useMemo<Record<SalonSettings["routingSummary"]["mode"], string>>(
    () => ({
      SALON_PHONE_ONLY: t("salonDetail.routingSalonOnly"),
      AI_RECEPTION_ONLY: t("salonDetail.routingAiOnly"),
      CALL_CENTER_ONLY: t("salonDetail.routingCallCenterOnly"),
      AI_RECEPTION_WITH_CALL_CENTER: t("salonDetail.routingAiWithCallCenter")
    }),
    [t]
  );

  const aiReceptionStatusLabels = useMemo<Record<AiReceptionConfig["status"], string>>(
    () => ({
      not_configured: t("common.notConfigured"),
      pending: t("status.PENDING"),
      active: t("status.ACTIVE"),
      failed: t("status.FAILED")
    }),
    [t]
  );

  const callLogVisibilityOptions = useMemo(
    () => [
      { value: "OWNER_ONLY", label: t("salonDetail.ownerOnly") },
      { value: "OWNER_AND_STAFF", label: t("salonDetail.ownerAndStaff") },
      { value: "OWNER_STAFF_OPERATOR", label: t("salonDetail.ownerStaffOperator") }
    ],
    [t]
  );

  const formatStatusLabel = (value: string) => {
    const translationKey = getStatusLabel(value);
    return translationKey ? t(translationKey) : value;
  };

  const formatYesNo = (value: boolean) => (value ? t("common.yes") : t("common.no"));
  const formatOnOff = (value: boolean) => (value ? t("status.ON") : t("status.OFF"));

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
  const [settingsForm, setSettingsForm] = useState({
    currency: "USD",
    locale: "en-US",
    bookingLeadTimeMinutes: "0",
    cancellationPolicy: "",
    aiReceptionEnabled: false,
    aiTransferRingCount: "3",
    callCenterEnabled: false,
    voicemailEnabled: true,
    callbackRequestEnabled: true,
    smsFallbackEnabled: false,
    aiGreetingPrompt: "",
    callerLanguage: "en",
    callLogVisibility: "OWNER_STAFF_OPERATOR" as SalonSettings["callLogVisibility"],
    notificationRecipientsText: "",
    callCenterRoutingNumber: "",
    callCenterRoutingNote: ""
  });
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [hours, setHours] = useState<BusinessHour[]>(createDefaultHours());
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [billing, setBilling] = useState<BillingUsageResponse | null>(null);
  const [aiReception, setAiReception] = useState<AiReceptionConfig | null>(null);
  const [aiReceptionCallLogs, setAiReceptionCallLogs] = useState<AiReceptionCallLog[]>([]);
  const [callRailHealth, setCallRailHealth] = useState<CallRailHealthStatus | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentItem | null>(null);
  const [callCenterAgents, setCallCenterAgents] = useState<CallCenterAgent[]>([]);
  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingIntegrations, setSavingIntegrations] = useState(false);
  const [savingAssignments, setSavingAssignments] = useState(false);

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
  const assignedAgents = useMemo(
    () => callCenterAgents.filter((agent) => assignedAgentIds.includes(agent.id)),
    [assignedAgentIds, callCenterAgents]
  );
  const timezoneOptions = getTimezoneOptions(t);
  const countryOptions = getCountryOptions(t);
  const currencyOptions = getCurrencyOptions(t);
  const localePreferenceOptions = getLocalePreferenceOptions(t);

  const load = async () => {
    if (!salonId) {
      setError(t("salonDetail.missingId"));
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
        aiReceptionConfig,
        aiReceptionCallLogResult,
        callRailHealthResult,
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
        apiGet<AiReceptionConfig>(`/api/v1/admin/salons/${salonId}/ai-reception`),
        apiGet<AiReceptionCallLogsResponse>(`/api/v1/admin/salons/${salonId}/call-logs?page=1&limit=10`),
        apiGet<CallRailHealthStatus>("/api/v1/integrations/amazon-connect/health"),
        apiGet<CallCenterAgent[]>("/api/v1/admin/call-center/agents"),
        apiGet<CallCenterAssignment[]>(`/api/v1/admin/salons/${salonId}/call-center-assignments`)
      ]);

      setSalon(salonDetail);
      setProfileForm({
        name: salonDetail.name,
        contactEmail: salonDetail.contactEmail ?? "",
        contactPhone: formatUsPhoneInput(salonDetail.contactPhone ?? ""),
        originalPhoneNumber: formatUsPhoneInput(salonDetail.originalPhoneNumber ?? ""),
        customerIncomingPhoneNumber: formatUsPhoneInput(salonDetail.customerIncomingPhoneNumber ?? ""),
        notificationPhoneNumber: formatUsPhoneInput(salonDetail.notificationPhoneNumber ?? ""),
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
      setSettingsForm({
        currency: salonDetail.settings?.currency ?? "USD",
        locale: salonDetail.settings?.locale ?? "en-US",
        bookingLeadTimeMinutes: String(salonDetail.settings?.bookingLeadTimeMinutes ?? 0),
        cancellationPolicy: salonDetail.settings?.cancellationPolicy ?? "",
        aiReceptionEnabled: salonDetail.settings?.aiReceptionEnabled ?? false,
        aiTransferRingCount: String(salonDetail.settings?.aiTransferRingCount ?? 3),
        callCenterEnabled: salonDetail.settings?.callCenterEnabled ?? false,
        voicemailEnabled: salonDetail.settings?.voicemailEnabled ?? true,
        callbackRequestEnabled: salonDetail.settings?.callbackRequestEnabled ?? true,
        smsFallbackEnabled: salonDetail.settings?.smsFallbackEnabled ?? false,
        aiGreetingPrompt: salonDetail.settings?.aiGreetingPrompt ?? "",
        callerLanguage: salonDetail.settings?.callerLanguage ?? "en",
        callLogVisibility: salonDetail.settings?.callLogVisibility ?? "OWNER_STAFF_OPERATOR",
        notificationRecipientsText: salonDetail.settings?.notificationRecipients.join("\n") ?? "",
        callCenterRoutingNumber: formatUsPhoneInput(salonDetail.settings?.callCenterRoutingNumber ?? ""),
        callCenterRoutingNote: salonDetail.settings?.callCenterRoutingNote ?? ""
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
      setAiReception(aiReceptionConfig);
      setAiReceptionCallLogs(aiReceptionCallLogResult.items);
      setCallRailHealth(callRailHealthResult);
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
    const phoneValues = [
      profileForm.contactPhone,
      profileForm.originalPhoneNumber,
      profileForm.customerIncomingPhoneNumber,
      profileForm.notificationPhoneNumber
    ];
    if (!phoneValues.every(validateOptionalUsPhone)) {
      notify("error", t("salonDetail.phoneInvalid"));
      return;
    }
    setSavingProfile(true);
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
      notify("success", t("salonDetail.profileUpdated"));
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    } finally {
      setSavingProfile(false);
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!salonId) {
      return;
    }
    if (!validateOptionalUsPhone(settingsForm.callCenterRoutingNumber)) {
      notify("error", t("salonDetail.callCenterPhoneInvalid"));
      return;
    }
    setSavingSettings(true);
    try {
      const updated = await apiPut<SalonSettings, unknown>(`/api/v1/admin/salons/${salonId}/settings`, {
        currency: settingsForm.currency,
        locale: settingsForm.locale,
        bookingLeadTimeMinutes: Number(settingsForm.bookingLeadTimeMinutes),
        cancellationPolicy: settingsForm.cancellationPolicy || null,
        aiReceptionEnabled: settingsForm.aiReceptionEnabled,
        aiTransferRingCount: Number(settingsForm.aiTransferRingCount),
        callCenterEnabled: settingsForm.callCenterEnabled,
        voicemailEnabled: settingsForm.voicemailEnabled,
        callbackRequestEnabled: settingsForm.callbackRequestEnabled,
        smsFallbackEnabled: settingsForm.smsFallbackEnabled,
        aiGreetingPrompt: settingsForm.aiGreetingPrompt || null,
        callerLanguage: settingsForm.callerLanguage,
        callLogVisibility: settingsForm.callLogVisibility,
        notificationRecipients: settingsForm.notificationRecipientsText
          .split(/\n|,/)
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
        callCenterRoutingNumber: settingsForm.callCenterRoutingNumber || null,
        callCenterRoutingNote: settingsForm.callCenterRoutingNote || null
      });
      setSalon((prev) => (prev ? { ...prev, settings: updated } : prev));
      notify("success", t("salonDetail.settingsUpdated"));
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    } finally {
      setSavingSettings(false);
    }
  };

  const addIntegration = () => {
    setIntegrations((prev) => [
      ...prev,
      {
        provider: "AMAZON_CONNECT",
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
    setSavingIntegrations(true);
    try {
      const result = await apiPut<IntegrationConfig[], { items: IntegrationConfig[] }>(
        `/api/v1/admin/salons/${salonId}/integrations`,
        {
          items: validItems
        }
      );
      setIntegrations(result);
      notify("success", t("salonDetail.integrationsUpdated"));
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    } finally {
      setSavingIntegrations(false);
    }
  };

  const saveCallCenterAssignments = async () => {
    if (!salonId) {
      return;
    }
    setSavingAssignments(true);
    try {
      const assignments = await apiPut<CallCenterAssignment[], { agentUserIds: string[] }>(
        `/api/v1/admin/salons/${salonId}/call-center-assignments`,
        {
          agentUserIds: assignedAgentIds
        }
      );
      setAssignedAgentIds(assignments.map((assignment) => assignment.agent.id));
      notify("success", t("salonDetail.assignmentsUpdated"));
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    } finally {
      setSavingAssignments(false);
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
      notify("success", t("salonDetail.staffCreated"));
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
      notify("success", t("salonDetail.staffUpdated"));
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
      notify("success", action === "deactivate" ? t("status.INACTIVE") : t("status.ACTIVE"));
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
      notify("success", t("salonDetail.staffReset"));
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
      notify("success", t("salonDetail.serviceCreated"));
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
      notify("success", t("salonDetail.serviceUpdated"));
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
      notify("success", t("salonDetail.businessHoursUpdated"));
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
      notify("success", t("salonDetail.customerCreated"));
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
      notify("error", t("salonDetail.appointmentRequired"));
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
      notify("success", t("salonDetail.appointmentCreated"));
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
      notify("success", t("salonDetail.appointmentCanceled"));
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
      notify("success", t("salonDetail.appointmentRescheduled"));
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
      title: t("salonDetail.updateStatus"),
      fields: [
        {
          name: "status",
          label: t("common.status"),
          type: "select",
          required: true,
          options: appointmentStatusOptions.map((option) => ({
            ...option,
            label: formatStatusLabel(option.value)
          }))
        }
      ],
      initialValues: {
        status: currentStatus
      },
      confirmLabel: t("salonDetail.updateStatus")
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
      notify("success", t("salonDetail.appointmentUpdated"));
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
    return <EmptyBlock message={t("salonDetail.notFound")} />;
  }

  return (
    <div className="stack">
      <FormDialog />
      <section className="card">
        <div className="section-header">
          <div>
            <p className="eyebrow">{t("nav.salons")}</p>
            <h2>{salon.name}</h2>
            <p className="muted">
              {t("layout.subtitle")}
            </p>
          </div>
          <div className="summary-badges">
            <span className={profileForm.status === "ACTIVE" ? "status-pill success" : "status-pill warning"}>
              {getStatusLabel(profileForm.status) ? t(getStatusLabel(profileForm.status)!) : profileForm.status}
            </span>
            <span
              className={
                profileForm.subscriptionStatus === "ACTIVE"
                  ? "status-pill info"
                  : profileForm.subscriptionStatus === "PAST_DUE"
                    ? "status-pill warning"
                    : "status-pill"
              }
            >
              {getStatusLabel(profileForm.subscriptionStatus)
                ? t(getStatusLabel(profileForm.subscriptionStatus)!)
                : profileForm.subscriptionStatus}
            </span>
          </div>
        </div>
        <div className="metrics-grid">
          <div>
            <span className="muted">{t("common.owner")}</span>
            <strong>{salon.owner.fullName}</strong>
          </div>
          <div>
            <span className="muted">{t("salons.activeStaff")}</span>
            <strong>{salon.staffUsage.activeStaffCount}</strong>
          </div>
          <div>
            <span className="muted">{t("common.freeLimit")}</span>
            <strong>{salon.staffUsage.freeStaffLimit}</strong>
          </div>
          <div>
            <span className="muted">{t("salons.billableExtra")}</span>
            <strong>{salon.staffUsage.billableExtraStaffCount}</strong>
          </div>
        </div>
        <div className="summary-badges">
          <span className={settingsForm.aiReceptionEnabled ? "status-pill success" : "status-pill warning"}>
            AI Reception {formatOnOff(settingsForm.aiReceptionEnabled)}
          </span>
          <span className={settingsForm.callCenterEnabled ? "status-pill success" : "status-pill warning"}>
            {t("salonDetail.humanCallCenter")} {formatOnOff(settingsForm.callCenterEnabled)}
          </span>
          <span className={settingsForm.voicemailEnabled ? "status-pill info" : "status-pill"}>
            Voicemail {formatOnOff(settingsForm.voicemailEnabled)}
          </span>
          <span className={settingsForm.smsFallbackEnabled ? "status-pill info" : "status-pill"}>
            SMS fallback {formatOnOff(settingsForm.smsFallbackEnabled)}
          </span>
        </div>
      </section>

      <section className="control-center-grid">
        <article className="control-tile">
          <div className="section-header">
            <strong>AI Reception</strong>
            <span className={settingsForm.aiReceptionEnabled ? "status-pill success" : "status-pill warning"}>
              {settingsForm.aiReceptionEnabled ? t("common.enabled") : t("common.disabled")}
            </span>
          </div>
          <span className="muted">{t("salonDetail.ringCountBeforeAi")}: {settingsForm.aiTransferRingCount}</span>
          <span className="muted">
            {t("salonDetail.aiGreetingPrompt")}:{" "}
            {settingsForm.aiGreetingPrompt?.trim()
              ? t("salonDetail.greetingConfigured")
              : t("salonDetail.greetingMissing")}
          </span>
        </article>
        <article className="control-tile">
          <div className="section-header">
            <strong>{t("salonDetail.humanCallCenter")}</strong>
            <span className={settingsForm.callCenterEnabled ? "status-pill success" : "status-pill warning"}>
              {settingsForm.callCenterEnabled ? t("common.enabled") : t("common.disabled")}
            </span>
          </div>
          <span className="muted">{t("salonDetail.assignedAgents")}: {assignedAgents.length}</span>
          <span className="muted">
            {t("salonDetail.routingNumber")}: {settingsForm.callCenterRoutingNumber || t("common.notConfigured")}
          </span>
        </article>
        <article className="control-tile">
          <div className="section-header">
            <strong>{t("salonDetail.fallbackStack")}</strong>
            <span className="status-pill info">{t("salonDetail.demoReady")}</span>
          </div>
          <span className="muted">Voicemail: {formatOnOff(settingsForm.voicemailEnabled)}</span>
          <span className="muted">{t("routing.CALLBACK_REQUEST")}: {formatOnOff(settingsForm.callbackRequestEnabled)}</span>
          <span className="muted">{t("routing.SMS_FALLBACK")}: {formatOnOff(settingsForm.smsFallbackEnabled)}</span>
        </article>
        <article className="control-tile">
          <div className="section-header">
            <strong>{t("salonDetail.integrationReadiness")}</strong>
            <span
              className={
                salon.integrationStatuses.amazonConnect.configured
                  ? "status-pill success"
                  : "status-pill warning"
              }
            >
              {salon.integrationStatuses.amazonConnect.configured
                ? t("status.READY")
                : t("status.NEEDS_SETUP")}
            </span>
          </div>
          <span className="muted">
            Amazon Connect {t("salonDetail.activeConfigCount")}: {salon.integrationStatuses.amazonConnect.activeConfigCount}
          </span>
        </article>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>{t("salonDetail.salonProfileTitle")}</h3>
          <span className={savingProfile ? "status-pill info" : "status-pill"}>
            {savingProfile ? t("common.saving") : t("common.ready")}
          </span>
        </div>
        <form className="form-grid two-columns" onSubmit={saveProfile}>
          <label className="field">
            <span>{t("salonCreate.salonName")}</span>
            <input
              value={profileForm.name}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{t("common.timezone")}</span>
            <select
              value={profileForm.timezone}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, timezone: event.target.value }))
              }
            >
              {timezoneOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("salonDetail.contactEmail")}</span>
            <input
              type="email"
              value={profileForm.contactEmail}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, contactEmail: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("salonDetail.contactPhone")}</span>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(212) 555-0100"
              value={profileForm.contactPhone}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, contactPhone: formatUsPhoneInput(event.target.value) }))
              }
            />
          </label>
          <label className="field">
            <span>{t("salonDetail.originalSalonPhone")}</span>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(212) 555-0100"
              value={profileForm.originalPhoneNumber}
              onChange={(event) =>
                setProfileForm((prev) => ({
                  ...prev,
                  originalPhoneNumber: formatUsPhoneInput(event.target.value)
                }))
              }
            />
          </label>
          <label className="field">
            <span>{t("salonDetail.customerIncomingPhone")}</span>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(212) 555-0100"
              value={profileForm.customerIncomingPhoneNumber}
              onChange={(event) =>
                setProfileForm((prev) => ({
                  ...prev,
                  customerIncomingPhoneNumber: formatUsPhoneInput(event.target.value)
                }))
              }
            />
          </label>
          <label className="field">
            <span>{t("salonDetail.notificationPhone")}</span>
            <input
              type="tel"
              inputMode="tel"
              placeholder="(212) 555-0100"
              value={profileForm.notificationPhoneNumber}
              onChange={(event) =>
                setProfileForm((prev) => ({
                  ...prev,
                  notificationPhoneNumber: formatUsPhoneInput(event.target.value)
                }))
              }
            />
          </label>
          <label className="field">
            <span>{t("common.status")}</span>
            <select
              value={profileForm.status}
              onChange={(event) =>
                setProfileForm((prev) => ({
                  ...prev,
                  status: event.target.value as "PENDING" | "ACTIVE" | "SUSPENDED"
                }))
              }
            >
              <option value="PENDING">{t("status.PENDING")}</option>
              <option value="ACTIVE">{t("status.ACTIVE")}</option>
              <option value="SUSPENDED">{t("status.SUSPENDED")}</option>
            </select>
          </label>
          <label className="field">
            <span>{t("salonDetail.subscriptionStatus")}</span>
            <select
              value={profileForm.subscriptionStatus}
              onChange={(event) =>
                setProfileForm((prev) => ({
                  ...prev,
                  subscriptionStatus: event.target.value as "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED"
                }))
              }
            >
              <option value="TRIAL">{t("status.TRIAL")}</option>
              <option value="ACTIVE">{t("status.ACTIVE")}</option>
              <option value="PAST_DUE">{t("status.PAST_DUE")}</option>
              <option value="CANCELED">{t("status.CANCELED")}</option>
            </select>
          </label>
          <label className="field">
            <span>{t("common.addressLine1")}</span>
            <input
              value={profileForm.addressLine1}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, addressLine1: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("common.addressLine2")}</span>
            <input
              value={profileForm.addressLine2}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, addressLine2: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("common.city")}</span>
            <input
              value={profileForm.city}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, city: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>{t("common.state")}</span>
            <input
              value={profileForm.state}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, state: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>{t("common.postalCode")}</span>
            <input
              value={profileForm.postalCode}
              onChange={(event) =>
                setProfileForm((prev) => ({ ...prev, postalCode: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("common.country")}</span>
            <select
              value={profileForm.country}
              onChange={(event) => setProfileForm((prev) => ({ ...prev, country: event.target.value }))}
            >
              {countryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={savingProfile}>
              {savingProfile ? t("salonDetail.savingProfile") : t("salonDetail.saveProfile")}
            </button>
          </div>
        </form>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>{t("salonDetail.integrationStatusTitle")}</h3>
          <div className="mobile-list">
            <article className="mobile-item">
              <strong>Amazon Connect</strong>
              <span>
                {salon.integrationStatuses.amazonConnect.configured
                  ? t("salonDetail.configured")
                  : t("salonDetail.attentionRequired")}
              </span>
              <small>
                {t("salonDetail.activeConfigCount")}: {salon.integrationStatuses.amazonConnect.activeConfigCount}
                {salon.integrationStatuses.amazonConnect.missing.length
                  ? ` · ${t("dashboard.integrationMissing", { items: salon.integrationStatuses.amazonConnect.missing.join(", ") })}`
                  : ""}
              </small>
            </article>
          </div>
        </article>

        <article className="card">
          <h3>{t("salonDetail.callCenterAssignmentStatus")}</h3>
          <div className="metrics-grid">
            <div>
              <span className="muted">{t("salonDetail.assignedAgents")}</span>
              <strong>{salon.callCenterAssignmentStatus.assignedAgentCount}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.queueReady")}</span>
              <strong>{formatYesNo(salon.callCenterAssignmentStatus.hasAssignedAgents)}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.routingSummary")}</span>
              <strong>{salon.settings?.routingSummary.mode ? routingModeLabels[salon.settings.routingSummary.mode] : "-"}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.ringCountBeforeAi")}</span>
              <strong>{salon.settings?.routingSummary.ringCountBeforeAi ?? 3}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>{t("salonDetail.recentEscalations")}</h3>
          {salon.recentEscalations.length ? (
            <div className="mobile-list">
              {salon.recentEscalations.map((item) => (
                <article key={item.id} className="mobile-item">
                  <strong>{formatStatusLabel(item.status)}</strong>
                  <span>{item.callSession.callerPhone ?? "-"}</span>
                  <small>
                    {formatDateTime(item.requestedAt)} · {item.routingOutcome ?? item.callSession.routingOutcome ?? "-"}
                  </small>
                  <small>{item.resolution ?? t("salonDetail.noResolutionYet")}</small>
                </article>
              ))}
            </div>
          ) : (
            <EmptyBlock message={t("salonDetail.noRecentEscalations")} />
          )}
        </article>

        <article className="card">
          <h3>{t("salonDetail.failuresAndFallbackStates")}</h3>
          {salon.recentCallFailures.length ? (
            <div className="mobile-list">
              {salon.recentCallFailures.map((item) => (
                <article key={item.id} className="mobile-item">
                  <strong>{formatStatusLabel(item.status)}</strong>
                  <span>{item.routingOutcome ?? "-"}</span>
                  <small>{item.callerPhone ?? "-"}</small>
                  <small>{item.finalResolution ?? t("salonDetail.noFinalResolution")}</small>
                </article>
              ))}
            </div>
          ) : (
            <EmptyBlock message={t("salonDetail.noRecentFailures")} />
          )}
        </article>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h3>{t("salonDetail.aiReceptionForwardingTitle")}</h3>
            <p className="muted">{t("salonDetail.aiReceptionForwardingHint")}</p>
          </div>
          <span className={aiReception ? aiReceptionStatusClasses[aiReception.status] : "status-pill warning"}>
            {aiReception ? aiReceptionStatusLabels[aiReception.status] : t("common.notConfigured")}
          </span>
        </div>

        <div className="metrics-grid">
          <div>
            <span className="muted">{t("nav.salons")}</span>
            <strong>{aiReception?.salonName ?? salon.name}</strong>
          </div>
          <div>
            <span className="muted">{t("common.owner")}</span>
            <strong>{salon.owner.fullName}</strong>
          </div>
          <div>
            <span className="muted">{t("salonDetail.originalPhoneNumber")}</span>
            <strong>{aiReception?.originalPhoneNumberFormatted ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">{t("salonDetail.callRailNumber")}</span>
            <strong>{aiReception?.forwardToNumberFormatted ?? "-"}</strong>
          </div>
          <div>
            <span className="muted">{t("salonDetail.carrier")}</span>
            <strong>{aiReception?.carrierLabel ?? "T-Mobile"}</strong>
          </div>
          <div>
            <span className="muted">{t("salonDetail.aiReceptionStatus")}</span>
            <strong>{aiReception ? aiReceptionStatusLabels[aiReception.status] : t("common.notConfigured")}</strong>
          </div>
          <div>
            <span className="muted">{t("salonDetail.lastTested")}</span>
            <strong>{aiReception?.lastTestedAt ? formatDateTime(aiReception.lastTestedAt) : "-"}</strong>
          </div>
          <div>
            <span className="muted">{t("salonDetail.lastVerified")}</span>
            <strong>{aiReception?.lastVerifiedAt ? formatDateTime(aiReception.lastVerifiedAt) : "-"}</strong>
          </div>
          <div>
            <span className="muted">{t("salonDetail.lastCallRailWebhook")}</span>
            <strong>
              {callRailHealth?.lastReceivedWebhookAt
                ? formatDateTime(callRailHealth.lastReceivedWebhookAt)
                : "-"}
            </strong>
          </div>
          <div>
            <span className="muted">{t("salonDetail.webhookHealth")}</span>
            <strong>{callRailHealth?.status?.toUpperCase() ?? "UNKNOWN"}</strong>
          </div>
        </div>

        <article className="inspection-box">
          <h4>{t("salonDetail.callRailWebhookHealth")}</h4>
          <div className="metrics-grid">
            <div>
              <span className="muted">{t("salonDetail.webhookConfigured")}</span>
              <strong>{formatYesNo(Boolean(callRailHealth?.webhookConfigured))}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.integrationReady")}</span>
              <strong>{formatYesNo(Boolean(callRailHealth?.configured))}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.verificationEnabled")}</span>
              <strong>{formatYesNo(Boolean(callRailHealth?.webhookVerificationEnabled))}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.webhookSecretConfigured")}</span>
              <strong>{formatYesNo(Boolean(callRailHealth?.webhookSecretConfigured))}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.apiKeyConfigured")}</span>
              <strong>{formatYesNo(Boolean(callRailHealth?.apiKeyConfigured))}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.accountCompanyConfigured")}</span>
              <strong>{formatYesNo(Boolean(callRailHealth?.accountCompanyConfigured))}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.trackingNumberConfigured")}</span>
              <strong>{formatYesNo(Boolean(callRailHealth?.trackingNumberConfigured))}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.trackingNumberIdConfigured")}</span>
              <strong>{formatYesNo(Boolean(callRailHealth?.trackingNumberIdConfigured))}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.defaultSalonIdConfigured")}</span>
              <strong>{formatYesNo(Boolean(callRailHealth?.defaultSalonIdConfigured))}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.aiFlowIdConfigured")}</span>
              <strong>{formatYesNo(Boolean(callRailHealth?.aiFlowIdConfigured))}</strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.livePersonFlowId")}</span>
              <strong>
                {callRailHealth?.livePersonFlowIdConfigured
                  ? t("salonDetail.configured")
                  : t("salonDetail.optional")}
              </strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.callFlowName")}</span>
              <strong>{callRailHealth?.callFlowName || "-"}</strong>
            </div>
            <div>
              <span className="muted">{t("calls.trackingNumber")}</span>
              <strong>
                {callRailHealth?.trackingNumberFormatted ?? callRailHealth?.trackingNumber ?? "-"}
              </strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.demoOriginalNumber")}</span>
              <strong>
                {callRailHealth?.demoOriginalPhoneNumberFormatted ??
                  callRailHealth?.demoOriginalPhoneNumber ??
                  "-"}
              </strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.demoForwardingNumber")}</span>
              <strong>
                {callRailHealth?.demoForwardingPhoneNumberFormatted ??
                  callRailHealth?.demoForwardingPhoneNumber ??
                  "-"}
              </strong>
            </div>
            <div>
              <span className="muted">{t("salonDetail.lastWebhookReceived")}</span>
              <strong>
                {callRailHealth?.lastReceivedWebhookAt
                  ? formatDateTime(callRailHealth.lastReceivedWebhookAt)
                  : "-"}
              </strong>
            </div>
          </div>
          <p className="muted">
            {callRailHealth?.missing?.length
              ? t("dashboard.integrationMissing", { items: callRailHealth.missing.join(", ") })
              : t("salonDetail.noMissingCallRailConfig")}
          </p>
        </article>

        <div className="stack">
          <h4>{t("salonDetail.recentCallRailLogs")}</h4>
          {aiReceptionCallLogs.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("calls.started")}</th>
                    <th>{t("calls.caller")}</th>
                    <th>{t("common.status")}</th>
                    <th>{t("salonDetail.summary")}</th>
                    <th>{t("calls.duration")}</th>
                    <th>{t("calls.recording")}</th>
                  </tr>
                </thead>
                <tbody>
                  {aiReceptionCallLogs.map((item) => (
                    <tr key={item.id}>
                      <td>{item.startedAt ? formatDateTime(item.startedAt) : "-"}</td>
                      <td>{item.callerNumberFormatted || item.callerNumber || "-"}</td>
                      <td>{formatStatusLabel(item.status)}</td>
                      <td>{item.summary ?? "-"}</td>
                      <td>{formatDuration(item.durationSeconds)}</td>
                      <td>
                        {item.recordingUrl ? (
                          <a href={item.recordingUrl} target="_blank" rel="noreferrer">
                            {t("common.open")}
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyBlock message={t("salonDetail.noCallRailLogs")} />
          )}
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h3>{t("salonDetail.salonSettingsTitle")}</h3>
            <p className="muted">
              {salon.settings?.routingSummary.mode
                ? routingModeLabels[salon.settings.routingSummary.mode]
                : t("salonDetail.settingsNotConfiguredYet")}
            </p>
          </div>
          <span className={settingsForm.callCenterEnabled ? "status-pill success" : "status-pill"}>
            {t("salonDetail.humanCallCenter")}{" "}
            {settingsForm.callCenterEnabled ? t("common.enabled") : t("common.disabled")}
          </span>
        </div>
        <form className="form-grid two-columns" onSubmit={saveSettings}>
          <div className="form-panel">
            <div>
              <h4>{t("salonDetail.businessRules")}</h4>
              <p className="muted">{t("salonDetail.businessRulesHint")}</p>
            </div>
            <label className="field">
              <span>{t("salonDetail.currency")}</span>
              <select
                value={settingsForm.currency}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, currency: event.target.value }))}
              >
                {currencyOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("salonDetail.defaultLanguage")}</span>
              <select
                value={settingsForm.locale}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, locale: event.target.value }))}
              >
                {localePreferenceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("salonDetail.minimumLeadTimeMinutes")}</span>
              <input
                type="number"
                min={0}
                value={settingsForm.bookingLeadTimeMinutes}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    bookingLeadTimeMinutes: event.target.value
                  }))
                }
              />
            </label>
            <label className="field">
              <span>{t("salonDetail.cancellationPolicy")}</span>
              <textarea
                rows={3}
                value={settingsForm.cancellationPolicy}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, cancellationPolicy: event.target.value }))
                }
              />
            </label>
          </div>

          <div className="form-panel">
            <div>
              <h4>{t("salonDetail.aiReceptionFallbackTitle")}</h4>
              <p className="muted">{t("salonDetail.aiReceptionFallbackHint")}</p>
            </div>
            <label className="field checkbox-row">
              <span>{t("salonDetail.aiReceptionOn")}</span>
              <input
                type="checkbox"
                checked={settingsForm.aiReceptionEnabled}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, aiReceptionEnabled: event.target.checked }))
                }
              />
            </label>
            <label className="field">
              <span>{t("salonDetail.ringCountBeforeAi")}</span>
              <input
                type="number"
                min={1}
                max={10}
                value={settingsForm.aiTransferRingCount}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, aiTransferRingCount: event.target.value }))
                }
              />
            </label>
            <label className="field checkbox-row">
              <span>{t("salonDetail.humanCallCenterOn")}</span>
              <input
                type="checkbox"
                checked={settingsForm.callCenterEnabled}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, callCenterEnabled: event.target.checked }))
                }
              />
            </label>
            <label className="field checkbox-row">
              <span>{t("salonDetail.voicemailFallbackOn")}</span>
              <input
                type="checkbox"
                checked={settingsForm.voicemailEnabled}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, voicemailEnabled: event.target.checked }))
                }
              />
            </label>
            <label className="field checkbox-row">
              <span>{t("salonDetail.callbackRequestOn")}</span>
              <input
                type="checkbox"
                checked={settingsForm.callbackRequestEnabled}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, callbackRequestEnabled: event.target.checked }))
                }
              />
            </label>
            <label className="field checkbox-row">
              <span>{t("salonDetail.smsFallbackOn")}</span>
              <input
                type="checkbox"
                checked={settingsForm.smsFallbackEnabled}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, smsFallbackEnabled: event.target.checked }))
                }
              />
            </label>
            <label className="field">
              <span>{t("salonDetail.aiGreetingPrompt")}</span>
              <textarea
                rows={4}
                value={settingsForm.aiGreetingPrompt}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, aiGreetingPrompt: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>{t("salonDetail.callerLanguage")}</span>
              <select
                value={settingsForm.callerLanguage}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, callerLanguage: event.target.value }))
                }
              >
                <option value="en">{t("language.en")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("salonDetail.callCenterRoutingNumber")}</span>
              <input
                type="tel"
                inputMode="tel"
                placeholder="(212) 555-0100"
                value={settingsForm.callCenterRoutingNumber}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    callCenterRoutingNumber: formatUsPhoneInput(event.target.value)
                  }))
                }
              />
              <small>{t("salonDetail.callCenterRoutingNumberHint")}</small>
            </label>
            <label className="field">
              <span>{t("salonDetail.callCenterNote")}</span>
              <textarea
                rows={3}
                value={settingsForm.callCenterRoutingNote}
                onChange={(event) =>
                  setSettingsForm((prev) => ({ ...prev, callCenterRoutingNote: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>{t("salonDetail.notificationRecipients")}</span>
              <textarea
                rows={3}
                value={settingsForm.notificationRecipientsText}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    notificationRecipientsText: event.target.value
                  }))
                }
                placeholder={"ops@salon.com\n+12125550100"}
              />
            </label>
            <label className="field">
              <span>{t("salonDetail.callLogVisibility")}</span>
              <select
                value={settingsForm.callLogVisibility}
                onChange={(event) =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    callLogVisibility: event.target.value as SalonSettings["callLogVisibility"]
                  }))
                }
              >
                {callLogVisibilityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={savingSettings}>
              {savingSettings ? t("salonDetail.savingSettings") : t("salonDetail.saveSettings")}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="section-header">
          <h3>{t("salonDetail.integrationConfig")}</h3>
          <div className="inline-actions">
            <button type="button" className="button-secondary" onClick={addIntegration}>
              {t("salonDetail.addRow")}
            </button>
            <button
              type="button"
              className="button-primary"
              onClick={saveIntegrations}
              disabled={savingIntegrations}
            >
              {savingIntegrations ? t("common.saving") : t("salonDetail.saveIntegrations")}
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("salonDetail.provider")}</th>
                <th>{t("salonDetail.key")}</th>
                <th>{t("salonDetail.value")}</th>
                <th>{t("salonDetail.active")}</th>
                <th>{t("salonDetail.remove")}</th>
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
                      {t("salonDetail.delete")}
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
          <h3>{t("salonDetail.callCenterAssignment")}</h3>
          <button
            type="button"
            className="button-primary"
            onClick={saveCallCenterAssignments}
            disabled={savingAssignments}
          >
            {savingAssignments ? t("common.saving") : t("salonDetail.saveAssignments")}
          </button>
        </div>
        <div className="summary-badges">
          <span className="summary-badge">{t("salonDetail.assignedAgents")}: {assignedAgents.length}</span>
          <span className="summary-badge">
            {t("salonDetail.queueReady")}:{" "}
            {formatYesNo(assignedAgents.length > 0 && settingsForm.callCenterEnabled)}
          </span>
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
          <h3>{t("common.staff")}</h3>
          <span className="muted">
            {t("salonDetail.activeStaff")}: {salon.staffUsage.activeStaffCount} / {t("common.freeLimit")}: {salon.staffUsage.freeStaffLimit} / {t("salonDetail.extraStaff")}{" "}
            {salon.staffUsage.billableExtraStaffCount}
          </span>
        </div>
        <form className="form-grid two-columns" onSubmit={createStaffMember}>
          <label className="field">
            <span>{t("salonDetail.fullName")}</span>
            <input
              value={staffForm.fullName}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, fullName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{t("common.email")}</span>
            <input
              type="email"
              value={staffForm.email}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, email: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{t("common.phone")}</span>
            <input
              type="tel"
              inputMode="numeric"
              value={staffForm.phone}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, phone: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{t("salonDetail.title")}</span>
            <input
              value={staffForm.title}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>{t("salonDetail.temporaryPassword")}</span>
            <input
              type="password"
              minLength={8}
              value={staffForm.password}
              onChange={(event) => setStaffForm((prev) => ({ ...prev, password: event.target.value }))}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={creatingStaff}>
              {creatingStaff ? t("salonDetail.creating") : t("salonDetail.addStaff")}
            </button>
          </div>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("salonCreate.ownerName")}</th>
                <th>{t("salonDetail.title")}</th>
                <th>{t("common.status")}</th>
                <th>{t("salonDetail.login")}</th>
                <th>{t("common.actions")}</th>
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
                  <td>{formatStatusLabel(item.status)}</td>
                  <td>
                    {item.user
                      ? item.user.isActive
                        ? t("salonDetail.enabled")
                        : t("salonDetail.disabled")
                      : t("salonDetail.notCreated")}
                  </td>
                  <td>
                    <div className="inline-actions">
                      <button type="button" className="button-secondary" onClick={() => editStaffMember(item)}>
                        {t("common.edit")}
                      </button>
                      <button type="button" className="button-secondary" onClick={() => toggleStaffStatus(item)}>
                        {item.status === "ACTIVE" ? t("salonDetail.deactivate") : t("salonDetail.reactivate")}
                      </button>
                      <button type="button" className="button-secondary" onClick={() => resetStaffLogin(item)}>
                        {t("salonDetail.resetAccess")}
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
        <h3>{t("salonDetail.servicesTitle")}</h3>
        <form className="form-grid two-columns" onSubmit={createServiceItem}>
          <label className="field">
            <span>{t("salonCreate.salonName")}</span>
            <input
              value={serviceForm.name}
              onChange={(event) => setServiceForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{t("salonDetail.description")}</span>
            <input
              value={serviceForm.description}
              onChange={(event) =>
                setServiceForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>{t("salonDetail.durationMinutes")}</span>
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
            <span>{t("salonDetail.priceCents")}</span>
            <input
              type="number"
              min={0}
              value={serviceForm.priceCents}
              onChange={(event) => setServiceForm((prev) => ({ ...prev, priceCents: event.target.value }))}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              {t("salonDetail.addService")}
            </button>
          </div>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("salonCreate.salonName")}</th>
                <th>{t("salonDetail.duration")}</th>
                <th>{t("salonDetail.price")}</th>
                <th>{t("common.status")}</th>
                <th>{t("salonDetail.mappedStaff")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {services.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.durationMinutes} min</td>
                  <td>{formatCurrencyCents(item.priceCents)}</td>
                  <td>{item.isActive ? t("status.ACTIVE") : t("status.INACTIVE")}</td>
                  <td>{item.staffServices.length}</td>
                  <td>
                    <div className="inline-actions">
                      <button type="button" className="button-secondary" onClick={() => editServiceItem(item)}>
                        {t("common.edit")}
                      </button>
                      <button type="button" className="button-secondary" onClick={() => toggleServiceState(item)}>
                        {item.isActive ? t("salonDetail.deactivate") : t("salonDetail.activate")}
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
          <h3>{t("salonDetail.businessHoursTitle")}</h3>
          <button type="button" className="button-primary" onClick={saveBusinessHours}>
            {t("salonDetail.saveHours")}
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("salonDetail.day")}</th>
                <th>{t("common.open")}</th>
                <th>{t("salonDetail.openTime")}</th>
                <th>{t("salonDetail.closeTime")}</th>
              </tr>
            </thead>
            <tbody>
              {hours.map((item, index) => (
                <tr key={item.dayOfWeek}>
                  <td>{weekdayLabels[item.dayOfWeek]}</td>
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
        <h3>{t("salonDetail.customersTitle")}</h3>
        <form className="form-grid two-columns" onSubmit={createCustomerItem}>
          <label className="field">
            <span>{t("salonDetail.firstName")}</span>
            <input
              value={customerForm.firstName}
              onChange={(event) =>
                setCustomerForm((prev) => ({ ...prev, firstName: event.target.value }))
              }
              required
            />
          </label>
          <label className="field">
            <span>{t("salonDetail.lastName")}</span>
            <input
              value={customerForm.lastName}
              onChange={(event) => setCustomerForm((prev) => ({ ...prev, lastName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>{t("common.email")}</span>
            <input
              type="email"
              value={customerForm.email}
              onChange={(event) => setCustomerForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>{t("common.phone")}</span>
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
              {t("salonDetail.addCustomer")}
            </button>
          </div>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("salonCreate.ownerName")}</th>
                <th>{t("common.email")}</th>
                <th>{t("common.phone")}</th>
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
        <h3>{t("salonDetail.appointmentsTitle")}</h3>
        <form className="form-grid two-columns" onSubmit={createAppointmentItem}>
          <label className="field">
            <span>{t("common.customer")}</span>
            <select
              value={appointmentForm.customerId}
              onChange={(event) =>
                setAppointmentForm((prev) => ({ ...prev, customerId: event.target.value }))
              }
              required
            >
              <option value="">{t("salonDetail.selectCustomer")}</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.firstName} {customer.lastName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("common.staff")}</span>
            <select
              value={appointmentForm.staffId}
              onChange={(event) => setAppointmentForm((prev) => ({ ...prev, staffId: event.target.value }))}
              required
            >
              <option value="">{t("salonDetail.selectStaff")}</option>
              {availableStaffForSelect.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("common.service")}</span>
            <select
              value={appointmentForm.serviceId}
              onChange={(event) =>
                setAppointmentForm((prev) => ({ ...prev, serviceId: event.target.value }))
              }
              required
            >
              <option value="">{t("salonDetail.selectService")}</option>
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
            <span>{t("salonDetail.startTime")}</span>
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
              {t("salonDetail.createAppointmentCta")}
            </button>
          </div>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("salonDetail.time")}</th>
                <th>{t("common.customer")}</th>
                <th>{t("common.staff")}</th>
                <th>{t("common.service")}</th>
                <th>{t("common.status")}</th>
                <th>{t("salonDetail.source")}</th>
                <th>{t("common.actions")}</th>
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
                  <td>{formatStatusLabel(item.status)}</td>
                  <td>{item.source}</td>
                  <td>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => setSelectedAppointment(item)}
                      >
                        {t("salonDetail.inspect")}
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void setAppointmentStatus(item.id, item.status)}
                      >
                        {t("salonDetail.statusAction")}
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void rescheduleAppointmentItem(item)}
                      >
                        {t("salonDetail.reschedule")}
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
              <h4>{t("salonDetail.appointmentDetail")}</h4>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setSelectedAppointment(null)}
              >
                {t("salonDetail.close")}
              </button>
            </div>
            <pre>{JSON.stringify(selectedAppointment, null, 2)}</pre>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h3>{t("salonDetail.billingUsageTitle")}</h3>
        {billing ? (
          <>
            <div className="metrics-grid">
              <div>
                <span className="muted">{t("salonDetail.freeAllowance")}</span>
                <strong>{billing.currentUsage.freeStaffLimit}</strong>
              </div>
              <div>
                <span className="muted">{t("salonDetail.activeStaff")}</span>
                <strong>{billing.currentUsage.activeStaffCount}</strong>
              </div>
              <div>
                <span className="muted">{t("salonDetail.extraStaff")}</span>
                <strong>{billing.currentUsage.billableExtraStaffCount}</strong>
              </div>
              <div>
                <span className="muted">{t("salonDetail.estimatedExtra")}</span>
                <strong>{formatCurrencyCents(billing.currentUsage.estimatedExtraCostCents)}</strong>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("salonDetail.periodStart")}</th>
                    <th>{t("salonDetail.periodEnd")}</th>
                    <th>{t("salonDetail.extraStaff")}</th>
                    <th>{t("salonDetail.estimatedExtraCost")}</th>
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
          <EmptyBlock message={t("salonDetail.billingUnavailable")} />
        )}
      </section>
    </div>
  );
};
