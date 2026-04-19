import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPatch, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatDateTime } from "../lib/format";
import { toDateTimeLocalValue, useFormDialog } from "../components/form-dialog";

interface RuntimeResponse {
  assignedSalonCount: number;
  amazonConnect: {
    region: string | null;
    instanceId: string | null;
    instanceUrl: string | null;
    ccpUrl: string | null;
    queueIdDefault: string | null;
    routingProfileId: string | null;
    configured: boolean;
    missing: string[];
  };
}

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

const appointmentStatusOptions = [
  { value: "SCHEDULED", label: "SCHEDULED" },
  { value: "CONFIRMED", label: "CONFIRMED" },
  { value: "CANCELED", label: "CANCELED" },
  { value: "NO_SHOW", label: "NO_SHOW" }
];

const loadAmazonConnectScript = async () => {
  const win = window as Window & {
    connect?: any;
    __amazonConnectScriptPromise?: Promise<void>;
  };

  if (win.connect?.core) {
    return;
  }

  if (!win.__amazonConnectScriptPromise) {
    win.__amazonConnectScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://connect-cdn.amazonaws.com/amazon-connect-streams.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load the Amazon Connect Streams library."));
      document.head.appendChild(script);
    });
  }

  await win.__amazonConnectScriptPromise;
};

const extractPhoneFromContact = (contact: any): string | null => {
  const connections = contact?.getConnections?.() ?? [];
  for (const connection of connections) {
    const endpoint = connection?.getEndpoint?.();
    const candidate =
      endpoint?.phoneNumber ??
      endpoint?.address ??
      endpoint?.endpoint ??
      endpoint?.name ??
      null;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  const initialEndpoint = contact?.getInitialConnection?.()?.getEndpoint?.();
  const fallback =
    initialEndpoint?.phoneNumber ??
    initialEndpoint?.address ??
    initialEndpoint?.endpoint ??
    null;

  return typeof fallback === "string" && fallback.trim().length > 0 ? fallback : null;
};

export const CallCenterPage = () => {
  const { notify } = useToast();
  const { openFormDialog, FormDialog } = useFormDialog();
  const ccpContainerRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runtime, setRuntime] = useState<RuntimeResponse | null>(null);
  const [salons, setSalons] = useState<SalonItem[]>([]);
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
  const [ccpError, setCcpError] = useState("");
  const [agentState, setAgentState] = useState("Not initialized");
  const [contactState, setContactState] = useState("Idle");
  const [activeCallerPhone, setActiveCallerPhone] = useState<string | null>(null);

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

  const loadQueue = async (preserveSelected = true) => {
    const items = await apiGet<QueueItem[]>("/api/v1/call-center/queue?limit=50");
    setQueue(items);
    const nextId =
      preserveSelected && selectedEscalationId
        ? items.find((item) => item.id === selectedEscalationId)?.id
        : items[0]?.id ?? "";
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

  useEffect(() => {
    if (!runtime?.amazonConnect.configured || !runtime.amazonConnect.ccpUrl || !ccpContainerRef.current) {
      return;
    }

    let disposed = false;

    const initCcp = async () => {
      try {
        setCcpError("");
        await loadAmazonConnectScript();
        if (disposed || !ccpContainerRef.current) {
          return;
        }

        const win = window as Window & { connect?: any };
        const connectApi = win.connect;
        if (!connectApi?.core?.initCCP) {
          throw new Error("Amazon Connect Streams is available, but CCP initialization could not start.");
        }

        connectApi.core.initCCP(ccpContainerRef.current, {
          ccpUrl: runtime.amazonConnect.ccpUrl,
          loginPopup: true,
          loginPopupAutoClose: true,
          region: runtime.amazonConnect.region ?? undefined,
          softphone: {
            allowFramedSoftphone: true
          }
        });

        connectApi.agent((agent: any) => {
          if (disposed) {
            return;
          }
          const nextState = agent?.getState?.()?.name ?? "Ready";
          setAgentState(nextState);
        });

        connectApi.contact((contact: any) => {
          if (disposed) {
            return;
          }

          const updateContact = () => {
            const nextState = contact?.getStatus?.()?.type ?? "Unknown";
            setContactState(nextState);
            setActiveCallerPhone(extractPhoneFromContact(contact));
          };

          updateContact();
          contact?.onIncoming?.(updateContact);
          contact?.onConnected?.(updateContact);
          contact?.onEnded?.(() => {
            setContactState("Ended");
            setActiveCallerPhone(null);
          });
        });
      } catch (initError) {
        if (!disposed) {
          setCcpError(extractErrorMessage(initError));
        }
      }
    };

    void initCcp();

    return () => {
      disposed = true;
    };
  }, [runtime]);

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
      notify("error", "Select a salon first.");
      return;
    }

    try {
      await apiPost(`/api/v1/call-center/salons/${selectedSalonId}/customers`, customerForm);
      setCustomerForm({ firstName: "", lastName: "", phone: "" });
      await loadSalonData(selectedSalonId);
      notify("success", "Customer created.");
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const createBooking = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSalonId) {
      notify("error", "Select a salon first.");
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
      notify("success", "Appointment created.");
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const reschedule = async (appointment: AppointmentItem) => {
    const values = await openFormDialog({
      title: "Reschedule appointment",
      description: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      fields: [{ name: "startTime", label: "New time", type: "datetime-local", required: true }],
      initialValues: {
        startTime: toDateTimeLocalValue(appointment.startTime)
      },
      confirmLabel: "Reschedule"
    });

    if (!values?.startTime || !selectedSalonId) {
      return;
    }

    try {
      await apiPatch(`/api/v1/call-center/salons/${selectedSalonId}/appointments/${appointment.id}/reschedule`, {
        startTime: new Date(values.startTime).toISOString()
      });
      await loadSalonData(selectedSalonId);
      notify("success", "Appointment rescheduled.");
    } catch (rescheduleError) {
      notify("error", extractErrorMessage(rescheduleError));
    }
  };

  const updateStatus = async (appointmentId: string, status: string) => {
    const values = await openFormDialog({
      title: "Update appointment status",
      fields: [
        {
          name: "status",
          label: "Status",
          type: "select",
          required: true,
          options: appointmentStatusOptions
        }
      ],
      initialValues: {
        status
      },
      confirmLabel: "Update"
    });

    if (!values?.status || !selectedSalonId) {
      return;
    }

    try {
      await apiPatch(`/api/v1/call-center/salons/${selectedSalonId}/appointments/${appointmentId}`, {
        status: values.status
      });
      await loadSalonData(selectedSalonId);
      notify("success", "Appointment updated.");
    } catch (updateError) {
      notify("error", extractErrorMessage(updateError));
    }
  };

  const cancel = async (appointment: AppointmentItem) => {
    const values = await openFormDialog({
      title: "Cancel appointment",
      description: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      fields: [{ name: "reason", label: "Reason", type: "textarea", rows: 3 }],
      initialValues: {
        reason: "Customer requested cancellation"
      },
      confirmLabel: "Cancel appointment"
    });

    if (!values || !selectedSalonId) {
      return;
    }

    try {
      await apiPatch(`/api/v1/call-center/salons/${selectedSalonId}/appointments/${appointment.id}/cancel`, {
        reason: values.reason || undefined
      });
      await loadSalonData(selectedSalonId);
      notify("success", "Appointment canceled.");
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
      notify("success", "Escalation accepted.");
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
      notify("success", "Notes updated.");
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
        resolution: notesForm.resolution || "Handled by operator",
        operatorNotes: notesForm.operatorNotes || null,
        qaNotes: notesForm.qaNotes || null
      });
      await Promise.all([loadQueue(), loadEscalationDetail(selectedEscalationId)]);
      notify("success", "Escalation completed.");
    } catch (completeError) {
      notify("error", extractErrorMessage(completeError));
    }
  };

  const requestCallback = async () => {
    if (!selectedEscalationId || !selectedEscalation) {
      return;
    }

    const values = await openFormDialog({
      title: "Create callback request",
      fields: [
        {
          name: "callbackPhone",
          label: "Callback phone",
          required: true
        },
        {
          name: "notes",
          label: "Notes",
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
      confirmLabel: "Create callback"
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
      notify("success", "Callback request created.");
    } catch (callbackError) {
      notify("error", extractErrorMessage(callbackError));
    }
  };

  const captureVoicemail = async () => {
    if (!selectedEscalationId) {
      return;
    }

    const values = await openFormDialog({
      title: "Capture voicemail metadata",
      fields: [
        {
          name: "voicemailRecordingUrl",
          label: "Recording URL",
          type: "text"
        },
        {
          name: "notes",
          label: "Notes",
          type: "textarea",
          rows: 3
        }
      ],
      initialValues: {
        voicemailRecordingUrl: selectedEscalation?.voicemailRecordingUrl ?? "",
        notes: ""
      },
      confirmLabel: "Save voicemail"
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
      notify("success", "Voicemail captured.");
    } catch (voicemailError) {
      notify("error", extractErrorMessage(voicemailError));
    }
  };

  const sendSmsFallback = async () => {
    if (!selectedEscalationId || !selectedEscalation) {
      return;
    }

    const values = await openFormDialog({
      title: "Send SMS fallback",
      fields: [
        {
          name: "recipientPhone",
          label: "Recipient phone",
          required: true
        },
        {
          name: "message",
          label: "Message",
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
        message: "We missed your call. Reply with your preferred time and we will call you back."
      },
      confirmLabel: "Send SMS"
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
      notify("success", "SMS fallback sent.");
    } catch (smsError) {
      notify("error", extractErrorMessage(smsError));
    }
  };

  const openRequests = queue.filter((item) => item.status !== "CLOSED").length;
  const availableStaffCount = staff.filter((member) => member.currentWorkStatus === "AVAILABLE").length;

  const visibleAppointments = useMemo(() => {
    return appointments.slice().sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [appointments]);

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
            <h2>Human Call Center</h2>
            <p className="muted">Browser softphone, shared queue, and operator booking tools.</p>
          </div>
          <span className={runtime?.amazonConnect.configured ? "status-pill success" : "status-pill"}>
            Amazon Connect {runtime?.amazonConnect.configured ? "ready" : "not configured"}
          </span>
        </div>
        {!runtime?.amazonConnect.configured ? (
          <div className="form-error">
            Amazon Connect is missing: {runtime?.amazonConnect.missing.join(", ") || "unknown configuration"}
          </div>
        ) : null}
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
          <EmptyBlock message="No salons are assigned to this operator." />
        )}
      </section>

      <section className="card-grid">
        <article className="card stat-card">
          <h3>Queued items</h3>
          <strong>{openRequests}</strong>
        </article>
        <article className="card stat-card">
          <h3>Available staff</h3>
          <strong>{availableStaffCount}</strong>
        </article>
        <article className="card stat-card">
          <h3>Agent state</h3>
          <strong>{agentState}</strong>
        </article>
        <article className="card stat-card">
          <h3>Active contact</h3>
          <strong>{activeCallerPhone ?? contactState}</strong>
        </article>
      </section>

      <section className="card-grid">
        <article className="card">
          <h3>Browser softphone</h3>
          {ccpError ? <div className="form-error">{ccpError}</div> : null}
          <div ref={ccpContainerRef} style={{ minHeight: 560 }} />
        </article>

        <article className="card">
          <h3>Active operator context</h3>
          <div className="mobile-list">
            <article className="mobile-item">
              <strong>Contact state</strong>
              <span>{contactState}</span>
            </article>
            <article className="mobile-item">
              <strong>Caller phone</strong>
              <span>{activeCallerPhone ?? selectedEscalation?.callSession.callerPhone ?? "-"}</span>
            </article>
            <article className="mobile-item">
              <strong>Assigned salon</strong>
              <span>{selectedEscalation?.salon.name ?? salons.find((item) => item.id === selectedSalonId)?.name ?? "-"}</span>
            </article>
            <article className="mobile-item">
              <strong>Queue status</strong>
              <span>{selectedEscalation?.status ?? "-"}</span>
            </article>
          </div>
        </article>
      </section>

      <section className="card">
        <h2>Escalation queue</h2>
        {queue.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Salon</th>
                  <th>Caller</th>
                  <th>Status</th>
                  <th>Routing</th>
                  <th>Waiting time</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => {
                  const waitingSince = item.connectedAt ?? item.closedAt ?? new Date().toISOString();
                  const waitingMinutes = Math.max(
                    0,
                    Math.round(
                      (new Date(waitingSince).getTime() - new Date(item.requestedAt).getTime()) / 60000
                    )
                  );

                  return (
                    <tr key={item.id}>
                      <td>{formatDateTime(item.requestedAt)}</td>
                      <td>{item.salon.name}</td>
                      <td>{item.callSession.callerPhone ?? "-"}</td>
                      <td>{item.status}</td>
                      <td>{item.routingOutcome ?? item.callSession.routingOutcome ?? "-"}</td>
                      <td>{waitingMinutes} min</td>
                      <td>
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => setSelectedEscalationId(item.id)}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message="No queued escalations." />
        )}
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>Selected escalation</h2>
            <p className="muted">
              {selectedEscalation
                ? `${selectedEscalation.salon.name} · ${selectedEscalation.callSession.callerPhone ?? "Unknown caller"}`
                : "Select a queue item to inspect the transcript, AI summary, and operator actions."}
            </p>
          </div>
          <div className="inline-actions">
            <button type="button" className="button-secondary" onClick={() => void loadQueue()}>
              Refresh queue
            </button>
            <button
              type="button"
              className="button-primary"
              onClick={() => void acceptQueueItem()}
              disabled={!selectedEscalationId}
            >
              Accept
            </button>
          </div>
        </div>

        {selectedEscalation ? (
          <div className="stack">
            <div className="metrics-grid">
              <div>
                <span className="muted">Status</span>
                <strong>{selectedEscalation.status}</strong>
              </div>
              <div>
                <span className="muted">Caller phone</span>
                <strong>{selectedEscalation.callSession.callerPhone ?? "-"}</strong>
              </div>
              <div>
                <span className="muted">Routing outcome</span>
                <strong>{selectedEscalation.routingOutcome ?? "-"}</strong>
              </div>
              <div>
                <span className="muted">Final resolution</span>
                <strong>{selectedEscalation.callSession.finalResolution ?? "-"}</strong>
              </div>
            </div>

            <section className="card">
              <h3>Operator notes and QA</h3>
              <div className="form-grid two-columns">
                <label className="field">
                  <span>Operator notes</span>
                  <textarea
                    rows={4}
                    value={notesForm.operatorNotes}
                    onChange={(event) =>
                      setNotesForm((prev) => ({ ...prev, operatorNotes: event.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  <span>QA notes</span>
                  <textarea
                    rows={4}
                    value={notesForm.qaNotes}
                    onChange={(event) =>
                      setNotesForm((prev) => ({ ...prev, qaNotes: event.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Resolution</span>
                  <textarea
                    rows={3}
                    value={notesForm.resolution}
                    onChange={(event) =>
                      setNotesForm((prev) => ({ ...prev, resolution: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="inline-actions">
                <button type="button" className="button-secondary" onClick={() => void saveNotes()}>
                  Save notes
                </button>
                <button type="button" className="button-primary" onClick={() => void completeQueueItem()}>
                  Complete
                </button>
                <button type="button" className="button-secondary" onClick={() => void requestCallback()}>
                  Callback request
                </button>
                <button type="button" className="button-secondary" onClick={() => void captureVoicemail()}>
                  Save voicemail
                </button>
                <button type="button" className="button-secondary" onClick={() => void sendSmsFallback()}>
                  Send SMS fallback
                </button>
              </div>
            </section>

            <section className="card-grid">
              <article className="card">
                <h3>Transcript</h3>
                {selectedEscalation.callSession.transcripts.length ? (
                  <div className="stack">
                    {selectedEscalation.callSession.transcripts.map((transcript) => (
                      <article key={transcript.id} className="inspection-box">
                        <h4>
                          {transcript.transcriptSource} · {formatDateTime(transcript.createdAt)}
                        </h4>
                        {transcript.transcriptSummary ? <p>{transcript.transcriptSummary}</p> : null}
                        <pre>{transcript.transcriptText}</pre>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock message="No transcript stored for this call." />
                )}
              </article>

              <article className="card">
                <h3>AI summary</h3>
                <pre>{JSON.stringify(selectedEscalation.callSession.aiSummary ?? null, null, 2)}</pre>
                <h4>Recent AI interactions</h4>
                {selectedEscalation.callSession.aiInteractions.length ? (
                  <div className="mobile-list">
                    {selectedEscalation.callSession.aiInteractions.map((item) => (
                      <article key={item.id} className="mobile-item">
                        <strong>{item.taskType}</strong>
                        <span>{item.model ?? "unknown-model"}</span>
                        <small>{formatDateTime(item.createdAt)}</small>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock message="No AI interactions linked to this call." />
                )}
              </article>
            </section>

            <section className="card-grid">
              <article className="card">
                <h3>Customer lookup</h3>
                {selectedEscalation.customerMatches.length ? (
                  <div className="mobile-list">
                    {selectedEscalation.customerMatches.map((customer) => (
                      <article key={customer.id} className="mobile-item">
                        <strong>
                          {customer.firstName} {customer.lastName}
                        </strong>
                        <span>{customer.phone}</span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock message="No matching customer found from the caller phone." />
                )}
              </article>

              <article className="card">
                <h3>Booking attempts</h3>
                {selectedEscalation.callSession.bookingAttempts.length ? (
                  <div className="mobile-list">
                    {selectedEscalation.callSession.bookingAttempts.map((attempt) => (
                      <article key={attempt.id} className="mobile-item">
                        <strong>{attempt.status}</strong>
                        <span>{attempt.requestedService ?? "No service"}</span>
                        <small>{attempt.failureReason ?? "No failure reason"}</small>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyBlock message="No AI booking attempts linked to this call." />
                )}
              </article>
            </section>
          </div>
        ) : (
          <EmptyBlock message="Select a queued escalation." />
        )}
      </section>

      <section className="card-grid">
        <article className="card">
          <h2>Create customer</h2>
          <form className="form-grid two-columns" onSubmit={createCustomer}>
            <label className="field">
              <span>First name</span>
              <input
                value={customerForm.firstName}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, firstName: event.target.value }))}
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
              <span>Phone</span>
              <input
                type="tel"
                inputMode="tel"
                value={customerForm.phone}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, phone: event.target.value }))}
                required
              />
            </label>
            <button type="submit" className="button-primary">
              Create customer
            </button>
          </form>
        </article>

        <article className="card">
          <h2>Create booking</h2>
          <form className="form-grid two-columns" onSubmit={createBooking}>
            <label className="field">
              <span>Customer</span>
              <select
                value={bookingForm.customerId}
                onChange={(event) => setBookingForm((prev) => ({ ...prev, customerId: event.target.value }))}
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
                value={bookingForm.staffId}
                onChange={(event) => setBookingForm((prev) => ({ ...prev, staffId: event.target.value }))}
                required
              >
                <option value="">Select staff</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Service</span>
              <select
                value={bookingForm.serviceId}
                onChange={(event) => setBookingForm((prev) => ({ ...prev, serviceId: event.target.value }))}
                required
              >
                <option value="">Select service</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Start time</span>
              <input
                type="datetime-local"
                value={bookingForm.startTime}
                onChange={(event) => setBookingForm((prev) => ({ ...prev, startTime: event.target.value }))}
                required
              />
            </label>
            <button type="submit" className="button-primary">
              Create booking
            </button>
          </form>
        </article>
      </section>

      <section className="card">
        <h2>Appointments</h2>
        {visibleAppointments.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Customer</th>
                  <th>Staff</th>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleAppointments.map((appointment) => (
                  <tr key={appointment.id}>
                    <td>{formatDateTime(appointment.startTime)}</td>
                    <td>
                      {appointment.customer.firstName} {appointment.customer.lastName}
                    </td>
                    <td>{appointment.staff.fullName}</td>
                    <td>{appointment.service.name}</td>
                    <td>{appointment.status}</td>
                    <td>
                      <div className="inline-actions">
                        <button type="button" className="button-secondary" onClick={() => void reschedule(appointment)}>
                          Reschedule
                        </button>
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => void updateStatus(appointment.id, appointment.status)}
                        >
                          Status
                        </button>
                        <button type="button" className="button-secondary" onClick={() => void cancel(appointment)}>
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message="No appointments available for the selected salon." />
        )}
      </section>
    </div>
  );
};
