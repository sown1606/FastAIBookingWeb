import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatCurrencyCents, formatDateTime } from "../lib/format";
import { useFormDialog } from "../components/form-dialog";
import { formatUsPhoneInput, validateOptionalUsPhone } from "../lib/phone";
import { useAuth } from "../auth/auth-context";
import { statusLabelKey, useI18n } from "../lib/i18n";
import { useUiMode } from "../lib/ui-mode";
import { utcToDateTimeLocalInTimeZone } from "../lib/timezone";

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
  endTime?: string | null;
  notes?: string | null;
  status: string;
  customer: CustomerItem;
  staff: StaffItem;
  service: ServiceItem;
}

interface AppointmentsResponse {
  items: AppointmentItem[];
}

interface StaffScheduleSummary {
  staff: StaffItem;
  appointments: AppointmentItem[];
  currentAppointment: AppointmentItem | null;
  nextAppointment: AppointmentItem | null;
}

interface QueueItem {
  id: string;
  status: string;
  routingOutcome: string | null;
  requestedAt: string;
  connectedAt: string | null;
  closedAt: string | null;
  escalationReason?: string | null;
  messageToCaller?: string | null;
  customerPhone?: string | null;
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

type AmazonConnectState = {
  name?: string;
  type?: string;
};

type AmazonConnectStateChange = {
  newState?: AmazonConnectState;
};

type AmazonConnectEndpoint = {
  phoneNumber?: string;
};

type AmazonConnectConnection = {
  getEndpoint?: () => AmazonConnectEndpoint | null;
};

type AmazonConnectContact = {
  getContactId?: () => string;
  getStatus?: () => AmazonConnectState;
  getState?: () => AmazonConnectState;
  getConnections?: () => AmazonConnectConnection[];
  onConnected?: (callback: (contact: AmazonConnectContact) => void) => unknown;
  onEnded?: (callback: (contact: AmazonConnectContact) => void) => unknown;
  onRefresh?: (callback: (contact: AmazonConnectContact) => void) => unknown;
};

type AmazonConnectAgent = {
  getStatus?: () => AmazonConnectState;
  getState?: () => AmazonConnectState;
  onStateChange?: (callback: (stateChange: AmazonConnectStateChange) => void) => unknown;
  onRefresh?: (callback: (agent: AmazonConnectAgent) => void) => unknown;
};

type AmazonConnectGlobal = {
  core?: {
    initCCP?: (
      container: HTMLElement,
      options: {
        ccpUrl: string;
        region?: string;
        loginPopup: boolean;
        loginPopupAutoClose: boolean;
        loginOptions?: {
          autoClose: boolean;
          height: number;
          width: number;
          top: number;
          left: number;
        };
        softphone: {
          allowFramedSoftphone: boolean;
          allowEarlyGum?: boolean;
        };
        pageOptions?: {
          enableAudioDeviceSettings?: boolean;
          enablePhoneTypeSettings?: boolean;
        };
        ccpAckTimeout?: number;
        ccpSynTimeout?: number;
        ccpLoadTimeout?: number;
      }
    ) => void;
  };
  agent?: (callback: (agent: AmazonConnectAgent) => void) => unknown;
  contact?: (callback: (contact: AmazonConnectContact) => void) => unknown;
};

const FALLBACK_SALON_TIMEZONE = "America/New_York";
const ACTIVE_APPOINTMENT_STATUSES = new Set(["SCHEDULED", "CONFIRMED", "IN_PROGRESS"]);
const CCP_FRAME_BLOCKED_ERROR = "frame-ancestors 'self'";

const getAmazonConnect = (): AmazonConnectGlobal | undefined => {
  return (globalThis as typeof globalThis & { connect?: AmazonConnectGlobal }).connect;
};

const validateCcpUrl = (
  value: string | null | undefined
): { url: string | null; error: string | null } => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return { url: null, error: "missing" };
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.includes("app-new-nail.kendemo.com")) {
    return { url: null, error: "app-url" };
  }
  if (!lowered.includes("/ccp-v2")) {
    return { url: null, error: "missing-ccp-v2" };
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      return { url: null, error: "invalid" };
    }
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return { url: `${url.toString()}/`, error: null };
  } catch {
    return { url: null, error: "invalid" };
  }
};

const getDateKeyInTimezone = (date: Date, timezone = FALLBACK_SALON_TIMEZONE): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? String(date.getFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? String(date.getMonth() + 1).padStart(2, "0");
  const day = parts.find((part) => part.type === "day")?.value ?? String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDaysToDateKey = (dateKey: string, days: number): string => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
};

const buildAppointmentDateQuery = (dateKey: string): string => {
  const dateFrom = new Date(`${addDaysToDateKey(dateKey, -1)}T00:00:00.000Z`);
  const dateTo = new Date(`${addDaysToDateKey(dateKey, 2)}T00:00:00.000Z`);
  const params = new URLSearchParams({
    page: "1",
    limit: "100",
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString()
  });
  return params.toString();
};

const formatTimeRange = (appointment: AppointmentItem, timezone: string): string => {
  const start = new Date(appointment.startTime);
  const durationMinutes = appointment.service.durationMinutes ?? 0;
  const end = appointment.endTime
    ? new Date(appointment.endTime)
    : new Date(start.getTime() + durationMinutes * 60000);
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone
  });
  if (Number.isNaN(start.getTime())) {
    return "-";
  }
  return Number.isNaN(end.getTime()) ? formatter.format(start) : `${formatter.format(start)} - ${formatter.format(end)}`;
};

const formatDateKeyLabel = (dateKey: string): string => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
};

const getStateName = (state: AmazonConnectState | undefined): string | null => {
  return state?.name ?? state?.type ?? null;
};

const getCallerPhoneFromContact = (contact: AmazonConnectContact): string | null => {
  const connections = contact.getConnections?.() ?? [];
  for (const connection of connections) {
    const phoneNumber = connection.getEndpoint?.()?.phoneNumber;
    if (phoneNumber) {
      return phoneNumber;
    }
  }
  return null;
};

const getQueueCallerPhone = (item: QueueItem | EscalationDetail | null): string | null => {
  if (!item) {
    return null;
  }
  return item.callSession.callerPhone ?? item.customerPhone ?? null;
};

const getWaitingMinutes = (item: QueueItem | EscalationDetail): number => {
  const reference =
    item.status === "CLOSED"
      ? item.closedAt ?? new Date().toISOString()
      : new Date().toISOString();
  return Math.max(0, Math.round((new Date(reference).getTime() - new Date(item.requestedAt).getTime()) / 60000));
};

const isStaleWait = (minutes: number): boolean => minutes > 24 * 60;

const getWaitBadgeKey = (minutes: number): "callCenter.urgentWait" | "callCenter.longWait" | null => {
  if (minutes > 60) {
    return "callCenter.urgentWait";
  }
  if (minutes > 30) {
    return "callCenter.longWait";
  }
  return null;
};

interface AmazonConnectCcpPanelProps {
  ccpUrl: string | null;
  region: string | null | undefined;
  enabled: boolean;
  showTechnicalDetails: boolean;
  onQueueMatch: (item: QueueItem) => void;
}

const AmazonConnectCcpPanel = ({
  ccpUrl,
  region,
  enabled,
  showTechnicalDetails,
  onQueueMatch
}: AmazonConnectCcpPanelProps) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastMatchKeyRef = useRef("");
  const initializedCcpKeyRef = useRef("");
  const [ccpStatus, setCcpStatus] = useState<"disabled" | "loading" | "ready" | "blocked" | "error">("disabled");
  const [ccpWarning, setCcpWarning] = useState("");
  const [ccpDebugDetails, setCcpDebugDetails] = useState("");
  const [ccpErrorSignature, setCcpErrorSignature] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [agentStatus, setAgentStatus] = useState("");
  const [contactStatus, setContactStatus] = useState("");
  const [activeContactId, setActiveContactId] = useState("");
  const [activeCallerPhone, setActiveCallerPhone] = useState("");

  const ccpValidation = useMemo(() => validateCcpUrl(ccpUrl), [ccpUrl]);
  const appOrigin = typeof window === "undefined" ? "" : window.location.origin;
  const approvedOrigin = appOrigin || "https://app-new-nail.kendemo.com";
  const ccpConfigError =
    ccpValidation.error === "missing"
      ? t("callCenter.ccpConfigMissing")
      : ccpValidation.error === "app-url"
        ? t("callCenter.ccpConfigAppUrl")
        : ccpValidation.error === "missing-ccp-v2"
          ? t("callCenter.ccpConfigMissingCcpV2")
          : ccpValidation.error === "invalid"
            ? t("callCenter.ccpConfigInvalid")
            : "";

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info("[Amazon Connect CCP]", {
        origin: appOrigin,
        ccpUrl: ccpValidation.url ?? ccpUrl ?? null
      });
    }
  }, [appOrigin, ccpUrl, ccpValidation.url]);

  const clearCcpContainer = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }
    initializedCcpKeyRef.current = "";
  }, []);

  const openCcpWindow = useCallback(() => {
    if (!ccpValidation.url) {
      return;
    }
    window.open(ccpValidation.url, "_blank", "noopener,noreferrer");
  }, [ccpValidation.url]);

  const showFrameBlockedError = useCallback(
    (details?: string) => {
      setCcpStatus("blocked");
      setCcpWarning(t("callCenter.ccpFrameBlocked"));
      setCcpErrorSignature(CCP_FRAME_BLOCKED_ERROR);
      setCcpDebugDetails(details ?? t("callCenter.ccpFrameBlockedDetails", { ccpUrl: ccpValidation.url ?? "" }));
    },
    [ccpValidation.url, t]
  );

  const retryCcp = useCallback(() => {
    clearCcpContainer();
    setCcpStatus("loading");
    setCcpWarning("");
    setCcpDebugDetails("");
    setCcpErrorSignature("");
    setRetryNonce((value) => value + 1);
  }, [clearCcpContainer]);

  const matchActiveContact = useCallback(
    async (callerPhone: string | null, amazonConnectContactId: string | null) => {
      if (!callerPhone && !amazonConnectContactId) {
        return;
      }
      const matchKey = `${callerPhone ?? ""}:${amazonConnectContactId ?? ""}`;
      if (lastMatchKeyRef.current === matchKey) {
        return;
      }
      lastMatchKeyRef.current = matchKey;

      const params = new URLSearchParams();
      if (callerPhone) {
        params.set("callerPhone", callerPhone);
      }
      if (amazonConnectContactId) {
        params.set("amazonConnectContactId", amazonConnectContactId);
      }

      try {
        const match = await apiGet<QueueItem | null>(`/api/v1/call-center/queue/match?${params.toString()}`);
        if (match?.id) {
          onQueueMatch(match);
        }
      } catch {
        lastMatchKeyRef.current = "";
      }
    },
    [onQueueMatch]
  );

  useEffect(() => {
    if (!enabled) {
      clearCcpContainer();
      setCcpStatus("disabled");
      setCcpWarning("");
      setCcpDebugDetails("");
      setCcpErrorSignature("");
      return;
    }

    if (!ccpValidation.url) {
      clearCcpContainer();
      setCcpStatus("error");
      setCcpWarning(ccpConfigError);
      setCcpDebugDetails(ccpUrl?.trim() || t("common.none"));
      setCcpErrorSignature("");
      return;
    }

    if (!containerRef.current) {
      return;
    }

    let cancelled = false;
    let ready = false;
    const validatedCcpUrl = ccpValidation.url;
    const initKey = `${validatedCcpUrl}:${retryNonce}`;
    if (initializedCcpKeyRef.current === initKey) {
      return;
    }
    containerRef.current.innerHTML = "";
    setCcpStatus("loading");
    setCcpWarning("");
    setCcpDebugDetails("");
    setCcpErrorSignature("");
    const handleSecurityPolicyViolation = (event: SecurityPolicyViolationEvent) => {
      const directive = event.effectiveDirective || event.violatedDirective || "";
      if (!directive.toLowerCase().includes("frame-ancestors")) {
        return;
      }
      showFrameBlockedError(
        `${CCP_FRAME_BLOCKED_ERROR}; blockedURI=${event.blockedURI || validatedCcpUrl}; appOrigin=${appOrigin || "unknown"}`
      );
    };
    window.addEventListener("securitypolicyviolation", handleSecurityPolicyViolation);
    const slowLoadTimer = window.setTimeout(() => {
      if (cancelled || ready) {
        return;
      }
      showFrameBlockedError(t("callCenter.ccpFrameBlockedDetails", { ccpUrl: validatedCcpUrl }));
    }, 30000);

    const init = async () => {
      try {
        await import("amazon-connect-streams");
        const amazonConnect = getAmazonConnect();
        if (!amazonConnect?.core?.initCCP) {
          throw new Error("Amazon Connect Streams global is unavailable.");
        }
        if (cancelled || !containerRef.current) {
          return;
        }
        initializedCcpKeyRef.current = initKey;

        amazonConnect.core.initCCP(containerRef.current, {
          ccpUrl: validatedCcpUrl,
          region: region ?? undefined,
          loginPopup: true,
          loginPopupAutoClose: true,
          loginOptions: {
            autoClose: true,
            height: 700,
            width: 600,
            top: 0,
            left: 0
          },
          softphone: {
            allowFramedSoftphone: true,
            allowEarlyGum: true
          },
          pageOptions: {
            enableAudioDeviceSettings: true,
            enablePhoneTypeSettings: true
          },
          ccpAckTimeout: 10000,
          ccpSynTimeout: 5000,
          ccpLoadTimeout: 30000
        });

        amazonConnect.agent?.((agent) => {
          const updateAgentStatus = (state?: AmazonConnectState) => {
            ready = true;
            window.clearTimeout(slowLoadTimer);
            setCcpStatus("ready");
            setCcpWarning("");
            setCcpDebugDetails("");
            setCcpErrorSignature("");
            setAgentStatus(getStateName(state ?? agent.getStatus?.() ?? agent.getState?.()) ?? "");
          };
          updateAgentStatus();
          agent.onStateChange?.((stateChange) => updateAgentStatus(stateChange.newState));
          agent.onRefresh?.((nextAgent) => updateAgentStatus(nextAgent.getStatus?.() ?? nextAgent.getState?.()));
        });

        amazonConnect.contact?.((contact) => {
          const updateContact = (nextContact: AmazonConnectContact) => {
            const contactId = nextContact.getContactId?.() ?? "";
            const callerPhone = getCallerPhoneFromContact(nextContact);
            setActiveContactId(contactId);
            setActiveCallerPhone(callerPhone ?? "");
            setContactStatus(getStateName(nextContact.getStatus?.() ?? nextContact.getState?.()) ?? "");
            void matchActiveContact(callerPhone, contactId || null);
          };
          updateContact(contact);
          contact.onConnected?.(updateContact);
          contact.onRefresh?.(updateContact);
          contact.onEnded?.(updateContact);
        });
      } catch (initError) {
        if (!cancelled) {
          setCcpStatus("error");
          setCcpWarning(t("callCenter.ccpHelpText"));
          setCcpDebugDetails(
            initError instanceof Error ? initError.message : t("callCenter.errorCcpInit")
          );
          setCcpErrorSignature("");
        }
      }
    };

    void init();
    return () => {
      cancelled = true;
      window.clearTimeout(slowLoadTimer);
      window.removeEventListener("securitypolicyviolation", handleSecurityPolicyViolation);
    };
  }, [
    ccpConfigError,
    ccpUrl,
    ccpValidation.url,
    clearCcpContainer,
    enabled,
    matchActiveContact,
    region,
    retryNonce,
    showFrameBlockedError,
    t
  ]);

  const statusLabel =
    ccpStatus === "ready"
      ? t("callCenter.ccpStatusReady")
      : ccpStatus === "loading"
        ? t("callCenter.ccpStatusLoading")
        : ccpStatus === "blocked"
          ? t("callCenter.ccpStatusFrameBlocked")
        : ccpStatus === "error"
          ? t("callCenter.ccpStatusError")
          : t("callCenter.ccpStatusDisabled");
  const isFrameBlocked = ccpStatus === "blocked";

  return (
    <article className="card ccp-panel">
      <div className="section-header compact-header">
        <div>
          <h3>{t("callCenter.softphoneTitle")}</h3>
          <p className="muted">{t("callCenter.ccpApprovedOriginHint")}</p>
        </div>
        <span className={ccpStatus === "ready" ? "status-pill success" : ccpStatus === "error" || ccpStatus === "blocked" ? "status-pill warning" : "status-pill info"}>
          {statusLabel}
        </span>
      </div>

      <div className="ccp-frame" ref={containerRef}>
        {!enabled || !ccpValidation.url ? (
          <div className="ccp-frame-placeholder">
            <strong>{t("callCenter.softphoneDisabled")}</strong>
            <span>{ccpConfigError || t("callCenter.softphoneMissingRuntimeInfo")}</span>
          </div>
        ) : null}
      </div>

      {ccpWarning ? (
        <div className="ccp-help-box">
          <strong>{ccpWarning}</strong>
          <ul className="ccp-checklist">
            {isFrameBlocked ? (
              <>
                <li>{t("callCenter.ccpCspChecklistCli")}</li>
                <li>{t("callCenter.ccpCspChecklistReapply")}</li>
                <li>{t("callCenter.ccpCspChecklistReload")}</li>
              </>
            ) : (
              <>
                <li>{t("callCenter.ccpChecklistLogin")}</li>
                <li>{t("callCenter.ccpChecklistPopups")}</li>
                <li>{t("callCenter.ccpChecklistCookies")}</li>
                <li>{t("callCenter.ccpChecklistOrigin")}</li>
              </>
            )}
          </ul>
          <div className="ccp-diagnostics">
            <div>
              <span>{t("callCenter.ccpDiagnosticOrigin")}</span>
              <strong>{appOrigin || t("common.none")}</strong>
            </div>
            <div>
              <span>{t("callCenter.ccpDiagnosticUrl")}</span>
              <strong>{ccpValidation.url ?? ccpUrl ?? t("common.none")}</strong>
            </div>
            <div>
              <span>{t("callCenter.ccpDiagnosticApprovedOrigin")}</span>
              <strong>{approvedOrigin}</strong>
            </div>
            {ccpErrorSignature ? (
              <>
                <div>
                  <span>{t("callCenter.ccpDiagnosticError")}</span>
                  <strong>{ccpErrorSignature}</strong>
                </div>
                <div>
                  <span>{t("callCenter.ccpDiagnosticCli")}</span>
                  <strong>aws connect list-approved-origins --instance-id &lt;id&gt; --region us-east-1</strong>
                </div>
              </>
            ) : null}
          </div>
          <div className="ccp-help-actions">
            {ccpValidation.url ? (
              <>
                <button type="button" className="button-secondary" onClick={openCcpWindow}>
                  {t("callCenter.openConnectCcp")}
                </button>
                <button type="button" className="button-secondary" onClick={retryCcp}>
                  {t("callCenter.retryCcp")}
                </button>
              </>
            ) : null}
          </div>
          {ccpDebugDetails ? (
            <details className="ccp-technical-details" open={showTechnicalDetails}>
              <summary>{t("callCenter.technicalDetails")}</summary>
              <p>{ccpDebugDetails}</p>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="operator-info-list ccp-status-grid">
        <div>
          <span className="muted">{t("callCenter.agentState")}</span>
          <strong>{agentStatus || t("common.none")}</strong>
        </div>
        <div>
          <span className="muted">{t("callCenter.contactState")}</span>
          <strong>{contactStatus || t("common.none")}</strong>
        </div>
        {showTechnicalDetails ? (
          <div>
            <span className="muted">{t("callCenter.contactId")}</span>
            <strong>{activeContactId || t("common.none")}</strong>
          </div>
        ) : null}
        <div>
          <span className="muted">{t("callCenter.callerPhone")}</span>
          <strong>{activeCallerPhone || t("common.none")}</strong>
        </div>
      </div>

      {ccpValidation.url ? (
        <a href={ccpValidation.url} target="_blank" rel="noreferrer" className="button-secondary">
          {t("callCenter.openConnectNewTab")}
        </a>
      ) : null}
    </article>
  );
};

export const CallCenterPage = () => {
  const { session } = useAuth();
  const { notify } = useToast();
  const { openFormDialog, FormDialog } = useFormDialog();
  const { t } = useI18n();
  const { isBasicMode } = useUiMode();
  const [searchParams] = useSearchParams();

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
  const [scheduleDateKey, setScheduleDateKey] = useState(() => getDateKeyInTimezone(new Date()));
  const [customerForm, setCustomerForm] = useState({
    firstName: "",
    lastName: "",
    phone: ""
  });
  const [bookingForm, setBookingForm] = useState({
    customerId: "",
    staffId: "",
    serviceId: "",
    startTime: "",
    notes: ""
  });
  const [notesForm, setNotesForm] = useState({
    operatorNotes: "",
    qaNotes: "",
    resolution: ""
  });
  const isOwner = session?.user.role === "SALON_OWNER";
  const configuredCcpUrl = import.meta.env.VITE_AMAZON_CONNECT_CCP_URL?.trim();
  const ccpUrl = configuredCcpUrl || runtime?.amazonConnect.ccpUrl || null;
  const targetSalonId = searchParams.get("salonId") ?? "";
  const targetEscalationId = searchParams.get("escalationId") ?? "";

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

  const getBusinessDayLabel = (dayOfWeek: number) => {
    const key = `callCenter.weekday.${dayOfWeek}` as Parameters<typeof t>[0];
    return t(key);
  };

  const formatBusinessHour = (hour: SalonDetailResponse["businessHours"][number]) => {
    const day = getBusinessDayLabel(hour.dayOfWeek);
    return hour.isOpen && hour.openTime && hour.closeTime
      ? `${day}: ${hour.openTime} - ${hour.closeTime}`
      : `${day}: ${t("callCenter.closed")}`;
  };

  const getTodayDayOfWeek = (timezone: string) => {
    const todayKey = getDateKeyInTimezone(new Date(), timezone);
    return new Date(`${todayKey}T12:00:00.000Z`).getUTCDay();
  };

  const formatAiSummary = (value: unknown, allowJsonFallback = false): string => {
    if (!value) {
      return t("common.none");
    }
    if (typeof value === "string") {
      return value.length > 360 ? `${value.slice(0, 360)}...` : value;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const fields: Array<[string, Parameters<typeof t>[0]]> = [
        ["summary", "callCenter.summary"],
        ["aiSummary", "callCenter.summary"],
        ["transcriptSummary", "calls.transcriptSummary"],
        ["intent", "callCenter.intent"],
        ["customerIntent", "callCenter.intent"],
        ["requestedService", "appointments.service"],
        ["requestedStaff", "appointments.staff"],
        ["requestedTime", "appointments.time"],
        ["message", "callCenter.message"],
        ["result", "callCenter.result"]
      ];
      const readableParts = fields
        .map(([field, labelKey]) => {
          const fieldValue = record[field];
          if (typeof fieldValue === "string" && fieldValue.trim()) {
            return `${t(labelKey)}: ${fieldValue}`;
          }
          if (typeof fieldValue === "number" || typeof fieldValue === "boolean") {
            return `${t(labelKey)}: ${String(fieldValue)}`;
          }
          return null;
        })
        .filter((item): item is string => Boolean(item));

      if (readableParts.length) {
        return readableParts.join(" · ");
      }

      if (!allowJsonFallback) {
        return t("callCenter.aiSummaryUnavailable");
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

  const loadSalonData = async (salonId: string, dateKey = scheduleDateKey) => {
    const appointmentQuery = buildAppointmentDateQuery(dateKey);
    const [salonDetail, staffItems, serviceItems, customerItems, appointmentItems] = await Promise.all([
      apiGet<SalonDetailResponse>(`/api/v1/call-center/salons/${salonId}`),
      apiGet<StaffItem[]>(`/api/v1/call-center/salons/${salonId}/staff`),
      apiGet<ServiceItem[]>(`/api/v1/call-center/salons/${salonId}/services`),
      apiGet<CustomersResponse>(`/api/v1/call-center/salons/${salonId}/customers?page=1&limit=100`),
      apiGet<AppointmentsResponse>(`/api/v1/call-center/salons/${salonId}/appointments?${appointmentQuery}`)
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
    const callerPhone = detail.customerPhone ?? detail.callSession.callerPhone ?? detail.callbackPhone ?? "";
    setBookingForm((prev) => ({
      ...prev,
      customerId: detail.customerMatches[0]?.id ?? prev.customerId
    }));
    if (!detail.customerMatches.length && callerPhone) {
      setCustomerForm((prev) => ({
        ...prev,
        phone: prev.phone || formatUsPhoneInput(callerPhone)
      }));
    }
    await loadSalonData(detail.salon.id, scheduleDateKey);
    if (detail.customerMatches.length) {
      setCustomers((prev) => {
        const existingIds = new Set(prev.map((customer) => customer.id));
        const missingMatches = detail.customerMatches.filter((customer) => !existingIds.has(customer.id));
        return missingMatches.length ? [...missingMatches, ...prev] : prev;
      });
    }
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
      const initialSalonId =
        targetSalonId && salonItems.some((item) => item.id === targetSalonId)
          ? targetSalonId
          : salonItems[0]?.id ?? "";
      if (initialSalonId) {
        setSelectedSalonId(initialSalonId);
        await loadSalonData(initialSalonId);
      }
      await loadQueue(false);
      if (targetEscalationId) {
        setSelectedEscalationId(targetEscalationId);
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
      await loadSalonData(salonId, scheduleDateKey);
    } catch (changeError) {
      notify("error", extractErrorMessage(changeError));
    }
  };

  const changeScheduleDate = async (dateKey: string) => {
    setScheduleDateKey(dateKey);
    if (!selectedSalonId) {
      return;
    }
    try {
      await loadSalonData(selectedSalonId, dateKey);
    } catch (changeError) {
      notify("error", extractErrorMessage(changeError));
    }
  };

  useEffect(() => {
    if (
      loading ||
      !targetSalonId ||
      targetSalonId === selectedSalonId ||
      !salons.some((salon) => salon.id === targetSalonId)
    ) {
      return;
    }
    void changeSalon(targetSalonId);
  }, [loading, salons, selectedSalonId, targetSalonId]);

  useEffect(() => {
    if (loading || !targetEscalationId || targetEscalationId === selectedEscalationId) {
      return;
    }
    setSelectedEscalationId(targetEscalationId);
  }, [loading, selectedEscalationId, targetEscalationId]);

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
    if (!bookingForm.customerId || !bookingForm.staffId || !bookingForm.serviceId || !bookingForm.startTime) {
      notify("error", t("form.requiredAll"));
      return;
    }
    try {
      const { startTime, ...bookingDetails } = bookingForm;
      await apiPost(`/api/v1/call-center/salons/${selectedSalonId}/appointments`, {
        ...bookingDetails,
        startTimeLocal: startTime,
        status: "CONFIRMED"
      });
      setBookingForm({ customerId: "", staffId: "", serviceId: "", startTime: "", notes: "" });
      await loadSalonData(selectedSalonId, scheduleDateKey);
      if (selectedEscalationId) {
        await loadEscalationDetail(selectedEscalationId);
      }
      notify("success", t("callCenter.bookingCreated"));
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const reschedule = async (appointment: AppointmentItem) => {
    const appointmentTimezone = selectedSalonDetail?.timezone || FALLBACK_SALON_TIMEZONE;
    const values = await openFormDialog({
      title: t("callCenter.rescheduleTitle"),
      description: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      fields: [
        {
          name: "startTime",
          label: t("callCenter.newTime"),
          type: "datetime-local",
          required: true,
          helpText: `${t("appointments.startTimezoneHint")} ${t("common.timezone")}: ${appointmentTimezone}`
        }
      ],
      initialValues: {
        startTime: utcToDateTimeLocalInTimeZone(appointment.startTime, appointmentTimezone)
      },
      confirmLabel: t("appointments.reschedule")
    });

    if (!values?.startTime || !selectedSalonId) {
      return;
    }

    try {
      await apiPatch(`/api/v1/call-center/salons/${selectedSalonId}/appointments/${appointment.id}/reschedule`, {
        startTimeLocal: values.startTime
      });
      await loadSalonData(selectedSalonId, scheduleDateKey);
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
      await loadSalonData(selectedSalonId, scheduleDateKey);
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
      await loadSalonData(selectedSalonId, scheduleDateKey);
      notify("success", t("callCenter.canceled"));
    } catch (cancelError) {
      notify("error", extractErrorMessage(cancelError));
    }
  };

  const acceptQueueItem = async (queueItemId = selectedEscalationId) => {
    if (!queueItemId) {
      return;
    }

    try {
      await apiPost(`/api/v1/call-center/queue/${queueItemId}/accept`, {});
      setSelectedEscalationId(queueItemId);
      await Promise.all([loadQueue(), loadEscalationDetail(queueItemId)]);
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

  const completeQueueItem = async (queueItemId = selectedEscalationId) => {
    if (!queueItemId) {
      return;
    }
    const isSelectedItem = queueItemId === selectedEscalationId;

    try {
      await apiPost(`/api/v1/call-center/queue/${queueItemId}/complete`, {
        resolution: isSelectedItem && notesForm.resolution ? notesForm.resolution : t("callCenter.completeDefaultResolution"),
        operatorNotes: isSelectedItem && notesForm.operatorNotes ? notesForm.operatorNotes : null,
        qaNotes: isSelectedItem && notesForm.qaNotes ? notesForm.qaNotes : null
      });
      setSelectedEscalationId(queueItemId);
      await Promise.all([loadQueue(), loadEscalationDetail(queueItemId)]);
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

  const handleQueueMatch = useCallback((item: QueueItem) => {
    setQueue((prev) => {
      const existingIndex = prev.findIndex((queueItem) => queueItem.id === item.id);
      if (existingIndex === -1) {
        return [item, ...prev];
      }
      return prev.map((queueItem) => (queueItem.id === item.id ? item : queueItem));
    });
    setSelectedSalonId(item.salon.id);
    setSelectedEscalationId(item.id);
  }, []);

  const salonTimezone = selectedSalonDetail?.timezone || FALLBACK_SALON_TIMEZONE;
  const todayDateKey = getDateKeyInTimezone(new Date(), salonTimezone);
  const selectedSalonQueue = selectedSalonId ? queue.filter((item) => item.salon.id === selectedSalonId) : queue;
  const openRequests = selectedSalonQueue.filter((item) => item.status !== "CLOSED").length;
  const amazonConnectRuntimeReady = Boolean(runtime?.amazonConnect.configured);
  const amazonConnectPlatformReady = Boolean(runtime?.amazonConnect.adminConfigured);
  const amazonConnectReady = Boolean(amazonConnectRuntimeReady && ccpUrl);
  const missingAmazonConnectItems = runtime?.amazonConnect.missing ?? [];
  const missingPlatformItems = runtime?.amazonConnect.adminMissing ?? [];
  const selectedSalonName =
    selectedEscalation?.salon.name ?? salons.find((item) => item.id === selectedSalonId)?.name ?? t("common.none");
  const hasSelectedSalon = Boolean(selectedSalonId);
  const ownerRoutingNote = selectedSalonDetail?.settings?.callCenterRoutingNote?.trim() ?? "";
  const canCreateBooking = Boolean(
    hasSelectedSalon &&
      bookingForm.customerId &&
      bookingForm.staffId &&
      bookingForm.serviceId &&
      bookingForm.startTime
  );
  const contextStaff = selectedSalonDetail?.staff.length ? selectedSalonDetail.staff : staff;
  const contextServices = selectedSalonDetail?.services.length ? selectedSalonDetail.services : services;
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
    return appointments
      .filter((appointment) => getDateKeyInTimezone(new Date(appointment.startTime), salonTimezone) === scheduleDateKey)
      .slice()
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [appointments, salonTimezone, scheduleDateKey]);
  const getAppointmentEndDate = (appointment: AppointmentItem) => {
    const start = new Date(appointment.startTime);
    if (appointment.endTime) {
      return new Date(appointment.endTime);
    }
    return new Date(start.getTime() + (appointment.service.durationMinutes ?? 0) * 60000);
  };
  const isAppointmentCurrent = (appointment: AppointmentItem) => {
    if (appointment.status === "IN_PROGRESS") {
      return true;
    }
    if (!ACTIVE_APPOINTMENT_STATUSES.has(appointment.status)) {
      return false;
    }
    const now = new Date();
    const start = new Date(appointment.startTime);
    const end = getAppointmentEndDate(appointment);
    return start.getTime() <= now.getTime() && end.getTime() >= now.getTime();
  };
  const isAppointmentUpcoming = (appointment: AppointmentItem) => {
    return ACTIVE_APPOINTMENT_STATUSES.has(appointment.status) && new Date(appointment.startTime).getTime() > Date.now();
  };
  const formatCustomerName = (customer: CustomerItem) => {
    return `${customer.firstName} ${customer.lastName}`.trim() || customer.phone || t("common.none");
  };
  const staffScheduleSummaries = useMemo<StaffScheduleSummary[]>(() => {
    return contextStaff.map((member) => {
      const memberAppointments = visibleAppointments.filter((appointment) => appointment.staff.id === member.id);
      const currentAppointment = memberAppointments.find(isAppointmentCurrent) ?? null;
      const nextAppointment = memberAppointments.find(isAppointmentUpcoming) ?? null;
      return {
        staff: member,
        appointments: memberAppointments,
        currentAppointment,
        nextAppointment
      };
    });
  }, [contextStaff, visibleAppointments]);
  const getStaffAvailabilityLabel = (summary: StaffScheduleSummary) => {
    if ((summary.staff.status ?? "ACTIVE") !== "ACTIVE") {
      return t("callCenter.staffInactive");
    }
    if (summary.staff.isBookable === false || summary.staff.currentWorkStatus === "OFFLINE") {
      return t("callCenter.staffNotTakingBookings");
    }
    if (summary.currentAppointment) {
      return t("callCenter.staffWithCustomer");
    }
    return t("callCenter.staffAvailable");
  };
  const getStaffNextFreeHint = (summary: StaffScheduleSummary) => {
    if (summary.currentAppointment) {
      const end = getAppointmentEndDate(summary.currentAppointment);
      const time = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: salonTimezone
      }).format(end);
      return t("callCenter.freeAfter", { time });
    }
    if (summary.nextAppointment) {
      return t("callCenter.nextAppointmentHint", {
        timeRange: formatTimeRange(summary.nextAppointment, salonTimezone)
      });
    }
    return t("callCenter.staffCanTakeToday");
  };
  const availableStaffSummaries = staffScheduleSummaries.filter((summary) => {
    return (
      (summary.staff.status ?? "ACTIVE") === "ACTIVE" &&
      summary.staff.isBookable !== false &&
      summary.staff.currentWorkStatus !== "OFFLINE" &&
      !summary.currentAppointment
    );
  });
  const availableStaffCount = availableStaffSummaries.length;
  const nextAvailableStaffSummary = availableStaffSummaries[0] ?? null;
  const scheduleGroups = staffScheduleSummaries.filter((summary) => summary.appointments.length);
  const selectedService = services.find((service) => service.id === bookingForm.serviceId) ?? null;
  const selectedStaffSchedule = staffScheduleSummaries.find((summary) => summary.staff.id === bookingForm.staffId) ?? null;
  const selectedStaffNextAvailability = selectedStaffSchedule
    ? getStaffNextFreeHint(selectedStaffSchedule)
    : t("callCenter.noMoreAppointmentsToday");
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
  const selectedCallerPhone = getQueueCallerPhone(selectedEscalation);
  const selectedWaitingMinutes = selectedEscalation ? getWaitingMinutes(selectedEscalation) : 0;
  const formatWaitingTime = (minutes: number) =>
    isStaleWait(minutes) ? t("callCenter.staleWaitTime") : t("callCenter.waitingMinutes", { count: minutes });

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
            <article className={ownerRoutingNote ? "operator-routing-note has-note" : "operator-routing-note is-empty"}>
              <span>{t("callCenter.routingNote")}</span>
              <strong>{ownerRoutingNote || t("callCenter.noRoutingNote")}</strong>
              <Link to="/salon-profile" className="button-secondary">
                {t("callCenter.editRoutingNote")}
              </Link>
            </article>
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
          <article className={ownerRoutingNote ? "operator-routing-note has-note" : "operator-routing-note is-empty"}>
            <span>{t("callCenter.routingNote")}</span>
            <strong>{ownerRoutingNote || t("callCenter.noRoutingNote")}</strong>
            <Link to="/salon-profile" className="button-secondary">
              {t("callCenter.editRoutingNote")}
            </Link>
          </article>
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
                        <td>{formatWaitingTime(waitingMinutes)}</td>
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
                <p>{formatAiSummary(selectedEscalation.callSession.aiSummary)}</p>
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

      <aside className="operator-context-panel">
        <section className="card operator-active-call-banner">
          <div className="section-header compact-header">
            <div>
              <span className="eyebrow">{t("callCenter.activeCall")}</span>
              <h2>
                {selectedEscalation
                  ? t("callCenter.handlingCallFor", { salonName: selectedEscalation.salon.name })
                  : t("callCenter.noActiveCall")}
              </h2>
            </div>
            <span className={amazonConnectReady ? "status-pill success" : "status-pill warning"}>
              {amazonConnectReady ? t("callCenter.amazonReady") : t("callCenter.amazonPending")}
            </span>
          </div>

          <div className="operator-label-list compact">
            <div className="operator-label-row">
              <span>{t("profile.salonName")}</span>
              <strong>{selectedSalonDetail?.name ?? selectedSalonName}</strong>
            </div>
            <div className="operator-label-row">
              <span>{t("callCenter.callerPhone")}</span>
              <strong>{selectedCallerPhone ?? t("callCenter.unknownCaller")}</strong>
            </div>
            <div className="operator-label-row">
              <span>{t("common.status")}</span>
              <strong>
                {selectedEscalation
                  ? statusLabelKey(selectedEscalation.status)
                    ? t(statusLabelKey(selectedEscalation.status)!)
                    : selectedEscalation.status
                  : t("common.none")}
              </strong>
            </div>
            <div className="operator-label-row">
              <span>{t("callCenter.waitingTime")}</span>
              <strong>{selectedEscalation ? formatWaitingTime(selectedWaitingMinutes) : t("common.none")}</strong>
            </div>
          </div>

          <label className="field compact manual-salon-selector">
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
            <small className="muted">{t("callCenter.selectSalonHint")}</small>
          </label>
        </section>

        <section className={ownerRoutingNote ? "card operator-routing-note has-note" : "card operator-routing-note is-empty"}>
          <span>{t("callCenter.routingNote")}</span>
          <strong>{ownerRoutingNote || t("callCenter.noRoutingNote")}</strong>
        </section>

        <section className="card operator-context-section">
          <h3>{t("callCenter.salonInformation")}</h3>
          <div className="operator-label-list">
            <div className="operator-label-row">
              <span>{t("profile.salonName")}</span>
              <strong>{selectedSalonDetail?.name ?? t("common.none")}</strong>
            </div>
            <div className="operator-label-row">
              <span>{t("common.addressLine1")}</span>
              <strong>{formatSalonAddress(selectedSalonDetail)}</strong>
            </div>
            <div className="operator-label-row">
              <span>{t("common.timezone")}</span>
              <strong>{selectedSalonDetail?.timezone ?? t("common.none")}</strong>
            </div>
            <div className="operator-label-row">
              <span>{t("callCenter.businessPhone")}</span>
              <strong>{originalSalonPhone}</strong>
            </div>
            <div className="operator-label-row">
              <span>{t("callCenter.customerIncomingPhone")}</span>
              <strong>{customerIncomingPhone}</strong>
            </div>
            <div className="operator-label-row">
              <span>{t("callCenter.contactPhone")}</span>
              <strong>{selectedSalonDetail?.contactPhone ?? t("common.none")}</strong>
            </div>
            <div className="operator-label-row">
              <span>{t("callCenter.ownerContact")}</span>
              <strong>{ownerContact}</strong>
            </div>
            <div className="operator-label-row">
              <span>{t("callCenter.notificationPhone")}</span>
              <strong>{selectedSalonDetail?.notificationPhoneNumber ?? t("common.none")}</strong>
            </div>
            <div className="operator-label-row">
              <span>{t("callCenter.routingNumber")}</span>
              <strong>{selectedSalonDetail?.settings?.callCenterRoutingNumber || t("common.none")}</strong>
            </div>
          </div>
        </section>

        <section className="card operator-context-section">
          <h3>{t("callCenter.businessHours")}</h3>
          <div className="business-hours-list">
            <div className="business-hour-row today">
              <span>{t("callCenter.todayBusinessHours")}</span>
              <strong>{todayBusinessHour ? formatBusinessHour(todayBusinessHour) : t("common.none")}</strong>
            </div>
            {selectedSalonDetail?.businessHours.length
              ? selectedSalonDetail.businessHours.map((hour) => (
                  <div key={hour.dayOfWeek} className="business-hour-row">
                    <span>{getBusinessDayLabel(hour.dayOfWeek)}</span>
                    <strong>{hour.isOpen && hour.openTime && hour.closeTime ? `${hour.openTime} - ${hour.closeTime}` : t("callCenter.closed")}</strong>
                  </div>
                ))
              : null}
          </div>
          {!selectedSalonDetail?.businessHours.length ? (
            <p className="muted">{t("common.none")}</p>
          ) : null}
        </section>

        <section className="card operator-context-section">
          <div className="section-header compact-header">
            <h3>{t("callCenter.staffToday")}</h3>
            <span className="summary-badge">{t("callCenter.staffAvailableNowCount", { count: availableStaffCount })}</span>
          </div>

          <div className="operator-staff-group">
            {staffScheduleSummaries.length ? (
              staffScheduleSummaries.map((summary) => {
                const isAvailableNow = availableStaffSummaries.some((item) => item.staff.id === summary.staff.id);
                return (
                  <article key={summary.staff.id} className={isAvailableNow ? "operator-staff-card ready" : "operator-staff-card"}>
                    <div>
                      <strong>{summary.staff.fullName}</strong>
                      <span>{summary.staff.title || t("common.none")}</span>
                    </div>
                    <div className="staff-card-meta">
                      <span className="staff-availability-label">{getStaffAvailabilityLabel(summary)}</span>
                      <span>{summary.staff.isBookable === false ? t("callCenter.bookableOff") : t("callCenter.bookableOn")}</span>
                      <span>{t("callCenter.totalAppointmentsToday", { count: summary.appointments.length })}</span>
                    </div>
                    <small>{getStaffNextFreeHint(summary)}</small>
                    <small>
                      {t("callCenter.currentAppointment")}:{" "}
                      {summary.currentAppointment
                        ? `${formatTimeRange(summary.currentAppointment, salonTimezone)} · ${formatCustomerName(summary.currentAppointment.customer)} · ${summary.currentAppointment.service.name}`
                        : t("common.none")}
                    </small>
                    <small>
                      {t("callCenter.nextAppointment")}:{" "}
                      {summary.nextAppointment
                        ? `${formatTimeRange(summary.nextAppointment, salonTimezone)} · ${formatCustomerName(summary.nextAppointment.customer)} · ${summary.nextAppointment.service.name}`
                        : t("common.none")}
                    </small>
                  </article>
                );
              })
            ) : (
              <p className="muted">{t("callCenter.noStaffToday")}</p>
            )}
          </div>
        </section>

        <section className="card operator-context-section">
          <h3>{t("callCenter.activeServices")}</h3>
          {contextServices.length ? (
            <div className="service-row-list">
              {contextServices.map((service) => (
                <div key={service.id} className="service-row">
                  <strong>{service.name}</strong>
                  <small>
                    {service.durationMinutes ? t("callCenter.durationMinutes", { count: service.durationMinutes }) : t("common.none")}
                    {typeof service.priceCents === "number" ? ` · ${formatCurrencyCents(service.priceCents)}` : ""}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{t("common.none")}</p>
          )}
        </section>
      </aside>

      <main className="operator-main-panel">
        <section className="operator-top-grid">
          <AmazonConnectCcpPanel
            ccpUrl={ccpUrl}
            region={runtime?.amazonConnect.region}
            enabled={amazonConnectRuntimeReady}
            showTechnicalDetails={!isBasicMode}
            onQueueMatch={handleQueueMatch}
          />

          <article className="card selected-call-card">
            <div className="section-header compact-header">
              <div>
                <h3>{t("callCenter.selectedTitle")}</h3>
                <p className="muted">
                  {selectedEscalation
                    ? `${selectedEscalation.salon.name} · ${selectedCallerPhone ?? t("callCenter.unknownCaller")}`
                    : t("callCenter.selectedEmpty")}
                </p>
              </div>
              <span className="status-pill info">{t("callCenter.openRequestsCount", { count: openRequests })}</span>
            </div>

            {selectedEscalation ? (
              <div className="operator-call-card">
                <div className="metrics-grid compact-metrics">
                  <div>
                    <span className="muted">{t("callCenter.callerPhone")}</span>
                    <strong>{selectedCallerPhone ?? t("common.none")}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("profile.salonName")}</span>
                    <strong>{selectedEscalation.salon.name}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("common.status")}</span>
                    <strong>{statusLabelKey(selectedEscalation.status) ? t(statusLabelKey(selectedEscalation.status)!) : selectedEscalation.status}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("callCenter.waitingTime")}</span>
                    <strong>{formatWaitingTime(selectedWaitingMinutes)}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("callCenter.escalationReason")}</span>
                    <strong className="text-clamp-3">{selectedEscalation.escalationReason ?? t("common.none")}</strong>
                  </div>
                </div>

                <div className="operator-call-summary">
                  <div>
                    <span className="muted">{t("callCenter.messageToCaller")}</span>
                    <p>{selectedEscalation.messageToCaller ?? t("common.none")}</p>
                  </div>
                  <div>
                    <span className="muted">{t("callCenter.aiSummary")}</span>
                    <p>{formatAiSummary(selectedEscalation.callSession.aiSummary)}</p>
                  </div>
                  <div>
                    <span className="muted">{t("calls.transcriptSummary")}</span>
                    <p>{latestTranscript?.transcriptSummary || t("common.none")}</p>
                  </div>
                  <div>
                    <span className="muted">{t("callCenter.bookingAttempts")}</span>
                    <p>
                      {latestBookingAttempt
                        ? `${statusLabelKey(latestBookingAttempt.status) ? t(statusLabelKey(latestBookingAttempt.status)!) : latestBookingAttempt.status} · ${latestBookingAttempt.requestedService ?? t("callCenter.noService")} · ${latestBookingAttempt.failureReason ?? t("callCenter.noFailureReason")}`
                        : t("callCenter.bookingAttemptsEmpty")}
                    </p>
                  </div>
                </div>

                <div className="operator-customer-matches">
                  <strong>{t("callCenter.customerMatches")}</strong>
                  {selectedEscalation.customerMatches.length ? (
                    selectedEscalation.customerMatches.slice(0, 3).map((customer) => (
                      <button
                        type="button"
                        key={customer.id}
                        className="customer-match-pill"
                        onClick={() => setBookingForm((prev) => ({ ...prev, customerId: customer.id }))}
                      >
                        {formatCustomerName(customer)} · {customer.phone}
                      </button>
                    ))
                  ) : (
                    <span className="muted">{t("callCenter.customerLookupEmpty")}</span>
                  )}
                </div>

                <div className="form-grid two-columns compact-note-form">
                  <label className="field">
                    <span>{t("callCenter.operatorNotes")}</span>
                    <textarea
                      rows={3}
                      value={notesForm.operatorNotes}
                      onChange={(event) => setNotesForm((prev) => ({ ...prev, operatorNotes: event.target.value }))}
                      placeholder={t("callCenter.operatorNotesPlaceholder")}
                    />
                  </label>
                  <label className="field">
                    <span>{t("callCenter.resolution")}</span>
                    <textarea
                      rows={3}
                      value={notesForm.resolution}
                      onChange={(event) => setNotesForm((prev) => ({ ...prev, resolution: event.target.value }))}
                      placeholder={t("callCenter.resolutionPlaceholder")}
                    />
                  </label>
                </div>

                <div className="inline-actions compact-actions">
                  <button type="button" className="button-primary" onClick={() => void acceptQueueItem()}>
                    {t("callCenter.accept")}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => void saveNotes()}>
                    {t("callCenter.saveNotes")}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => void requestCallback()}>
                    {t("callCenter.callBackAction")}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => void sendSmsFallback()}>
                    {t("callCenter.sendSmsAction")}
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
        </section>

        <section className="card operator-booking-card">
          <div className="section-header compact-header">
            <div>
              <h3>{t("callCenter.customerAndBooking")}</h3>
              <p className="muted">{t("callCenter.customerAndBookingHint")}</p>
            </div>
          </div>

          <div className="operator-booking-grid">
            {selectedEscalation?.customerMatches.length ? (
              <div className="operator-customer-matches booking-customer-matches">
                <strong>{t("callCenter.customerMatches")}</strong>
                {selectedEscalation.customerMatches.slice(0, 3).map((customer) => (
                  <button
                    type="button"
                    key={customer.id}
                    className="customer-match-pill"
                    onClick={() => setBookingForm((prev) => ({ ...prev, customerId: customer.id }))}
                  >
                    {formatCustomerName(customer)} · {customer.phone}
                  </button>
                ))}
              </div>
            ) : null}

            <form className="form-grid two-columns" onSubmit={createCustomer}>
              <h4>{t("callCenter.createCustomer")}</h4>
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

            <form className="form-grid two-columns" onSubmit={createBooking}>
              <h4>{t("callCenter.createBooking")}</h4>
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
                      {formatCustomerName(customer)} · {customer.phone}
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
                <small>
                  {t("appointments.startTimezoneHint")} {t("common.timezone")}: {salonTimezone}
                </small>
              </label>
              <label className="field span-two">
                <span>{t("appointments.notes")}</span>
                <textarea
                  rows={3}
                  disabled={!hasSelectedSalon}
                  value={bookingForm.notes}
                  onChange={(event) => setBookingForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </label>
              <div className="operator-booking-hints span-two">
                <span>
                  {selectedService
                    ? `${selectedService.name} · ${selectedService.durationMinutes ? t("callCenter.durationMinutes", { count: selectedService.durationMinutes }) : t("common.none")}${typeof selectedService.priceCents === "number" ? ` · ${formatCurrencyCents(selectedService.priceCents)}` : ""}`
                    : t("callCenter.selectServiceForDetails")}
                </span>
                <span>{bookingForm.staffId ? selectedStaffNextAvailability : t("callCenter.selectStaffForAvailability")}</span>
              </div>
              <button type="submit" className="button-primary" disabled={!canCreateBooking}>
                {t("callCenter.createBooking")}
              </button>
            </form>
          </div>
        </section>

        <section className="card queue-card">
          <div className="section-header compact-header">
            <div>
              <h3>{t("callCenter.queueTitle")}</h3>
              <p className="muted">{t("callCenter.queueHint")}</p>
            </div>
            <button type="button" className="button-secondary" onClick={() => void loadQueue()}>
              {t("callCenter.refreshQueue")}
            </button>
          </div>

          {selectedSalonQueue.length ? (
            <div className="compact-queue-list">
              {selectedSalonQueue.map((item) => {
                const waitingMinutes = getWaitingMinutes(item);
                const waitingBadgeKey = getWaitBadgeKey(waitingMinutes);
                const callerPhone = getQueueCallerPhone(item) ?? t("common.none");
                const hasQueueDetails = Boolean(item.escalationReason || item.messageToCaller);
                return (
                  <article
                    key={item.id}
                    className={item.id === selectedEscalationId ? "queue-row active" : "queue-row"}
                    onClick={() => setSelectedEscalationId(item.id)}
                  >
                    <div className="queue-row-main">
                      <strong>{callerPhone}</strong>
                      <span>{item.salon.name}</span>
                      <small>{formatDateTime(item.requestedAt, salonTimezone)}</small>
                    </div>
                    <span className="status-pill info">
                      {statusLabelKey(item.status) ? t(statusLabelKey(item.status)!) : item.status}
                    </span>
                    <small>{formatWaitingTime(waitingMinutes)}</small>
                    {waitingBadgeKey ? <span className="status-pill warning">{t(waitingBadgeKey)}</span> : null}
                    {hasQueueDetails ? (
                      <details className="queue-row-details" onClick={(event) => event.stopPropagation()}>
                        <summary>{t("callCenter.callDetails")}</summary>
                        <p>
                          <strong>{t("callCenter.escalationReason")}:</strong> {item.escalationReason ?? t("common.none")}
                        </p>
                        <p>
                          <strong>{t("callCenter.messageToCaller")}:</strong> {item.messageToCaller ?? t("common.none")}
                        </p>
                      </details>
                    ) : null}
                    <div className="inline-actions compact-actions">
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedEscalationId(item.id);
                        }}
                      >
                        {t("callCenter.openAction")}
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          void acceptQueueItem(item.id);
                        }}
                      >
                        {t("callCenter.accept")}
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          void completeQueueItem(item.id);
                        }}
                      >
                        {t("callCenter.complete")}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyBlock message={t("callCenter.queueEmpty")} />
          )}
        </section>

        <section className="card operator-schedule-card">
          <div className="section-header compact-header">
            <div>
              <h2>{t("callCenter.todayScheduleTitle")}</h2>
              <p className="muted">{selectedSalonName} · {formatDateKeyLabel(scheduleDateKey)}</p>
            </div>
            <span className="summary-badge">{t("callCenter.appointmentCount", { count: visibleAppointments.length })}</span>
          </div>

          <div className="date-control-row">
            <button type="button" className="button-secondary" onClick={() => void changeScheduleDate(addDaysToDateKey(scheduleDateKey, -1))}>
              {t("callCenter.previousDay")}
            </button>
            <button type="button" className="button-primary" onClick={() => void changeScheduleDate(todayDateKey)}>
              {t("common.today")}
            </button>
            <button type="button" className="button-secondary" onClick={() => void changeScheduleDate(addDaysToDateKey(scheduleDateKey, 1))}>
              {t("callCenter.nextDay")}
            </button>
            <label className="field compact date-input-field">
              <span>{t("callCenter.dateInput")}</span>
              <input
                type="date"
                value={scheduleDateKey}
                onChange={(event) => {
                  if (event.target.value) {
                    void changeScheduleDate(event.target.value);
                  }
                }}
              />
            </label>
          </div>

          <div className="schedule-summary-grid">
            <div>
              <span className="muted">{t("callCenter.totalAppointments")}</span>
              <strong>{visibleAppointments.length}</strong>
            </div>
            <div>
              <span className="muted">{t("callCenter.staffAvailableNow")}</span>
              <strong>{availableStaffCount}</strong>
            </div>
            <div>
              <span className="muted">{t("callCenter.nextAvailableStaff")}</span>
              <strong>
                {nextAvailableStaffSummary
                  ? `${nextAvailableStaffSummary.staff.fullName} · ${getStaffNextFreeHint(nextAvailableStaffSummary)}`
                  : t("common.none")}
              </strong>
            </div>
          </div>

          <section className="available-staff-card">
            <div className="section-header compact-header">
              <h3>{t("callCenter.whoIsAvailable")}</h3>
              <span className="summary-badge">{availableStaffCount}</span>
            </div>
            {availableStaffSummaries.length ? (
              <div className="available-staff-list">
                {availableStaffSummaries.map((summary) => (
                  <div key={summary.staff.id} className="available-staff-row">
                    <strong>{summary.staff.fullName}</strong>
                    <span>{getStaffNextFreeHint(summary)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">{t("callCenter.noAvailableStaffNow")}</p>
            )}
          </section>

          {scheduleGroups.length ? (
            <div className="staff-schedule-list">
              {scheduleGroups.map((group) => (
                <article key={group.staff.id} className="staff-schedule-group">
                  <div className="section-header compact-header">
                    <div>
                      <h3>{group.staff.fullName}</h3>
                      <p className="muted">
                        {group.staff.title || t("common.none")} · {getStaffAvailabilityLabel(group)} · {getStaffNextFreeHint(group)}
                      </p>
                    </div>
                    <span className="summary-badge">{t("callCenter.appointmentCount", { count: group.appointments.length })}</span>
                  </div>
                  <div className="schedule-highlight-row">
                    <span>
                      <strong>{t("callCenter.currentAppointment")}</strong>
                      {group.currentAppointment ? formatTimeRange(group.currentAppointment, salonTimezone) : t("common.none")}
                    </span>
                    <span>
                      <strong>{t("callCenter.nextAppointment")}</strong>
                      {group.nextAppointment ? formatTimeRange(group.nextAppointment, salonTimezone) : t("common.none")}
                    </span>
                  </div>
                  <div className="appointment-card-list">
                    {group.appointments.map((appointment) => (
                      <article key={appointment.id} className={isAppointmentCurrent(appointment) ? "appointment-operator-card current" : "appointment-operator-card"}>
                        <div>
                          <strong>{formatTimeRange(appointment, salonTimezone)}</strong>
                          <span>{formatCustomerName(appointment.customer)} · {appointment.customer.phone}</span>
                        </div>
                        <div>
                          <span>{appointment.service.name}</span>
                          <span className="status-pill info">
                            {statusLabelKey(appointment.status) ? t(statusLabelKey(appointment.status)!) : appointment.status}
                          </span>
                        </div>
                        {appointment.notes ? <p>{appointment.notes}</p> : null}
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
                      </article>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyBlock message={t("callCenter.scheduleEmptyForDay")} />
          )}
        </section>

        {!isBasicMode ? (
          <details className="advanced-config operator-advanced-details">
            <summary>{t("callCenter.advancedCallDetails")}</summary>
            <div className="card stack">
              {selectedEscalation ? (
                <>
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
                              {attempt.requestedService ?? t("callCenter.noService")} · {attempt.requestedStaff ?? t("common.unassigned")}
                            </span>
                            <small>{attempt.failureReason ?? t("callCenter.noFailureReason")}</small>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyBlock message={t("callCenter.bookingAttemptsEmpty")} />
                    )}
                  </article>

                  <article className="inspection-box">
                    <h3>{t("callCenter.recentAiInteractions")}</h3>
                    {selectedEscalation.callSession.aiInteractions.length ? (
                      <div className="mobile-list">
                        {selectedEscalation.callSession.aiInteractions.map((interaction) => (
                          <article key={interaction.id} className="mobile-item">
                            <strong>{interaction.taskType}</strong>
                            <span>{interaction.model ?? t("callCenter.unknownModel")}</span>
                            <small>{formatDateTime(interaction.createdAt, salonTimezone)}</small>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyBlock message={t("callCenter.aiInteractionsEmpty")} />
                    )}
                  </article>
                </>
              ) : (
                <EmptyBlock message={t("callCenter.selectedEmpty")} />
              )}

              <article className="inspection-box">
                <h3>{t("callCenter.advancedConfig")}</h3>
                <div className="table-wrap compact-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("callCenter.envItem")}</th>
                        <th>{t("callCenter.envValue")}</th>
                        <th>{t("callCenter.envUsage")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {amazonConnectRuntimeRows.map((row) => (
                        <tr key={row.key}>
                          <td>{row.key}</td>
                          <td>{row.value}</td>
                          <td>{row.usage}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {missingAmazonConnectItems.length || missingPlatformItems.length ? (
                  <p className="muted">
                    {[...missingAmazonConnectItems, ...missingPlatformItems].join(", ")}
                  </p>
                ) : null}
              </article>
            </div>
          </details>
        ) : null}
      </main>
    </div>
  );
};
