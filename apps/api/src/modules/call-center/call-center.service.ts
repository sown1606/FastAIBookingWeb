import {
  AppointmentSource,
  AppointmentStatus,
  CallEscalationStatus,
  CallRoutingOutcome,
  CallSessionStatus,
  ExternalProvider,
  Prisma,
  Role
} from "@prisma/client";
import { ConnectClient, GetCurrentMetricDataCommand } from "@aws-sdk/client-connect";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { sendSms } from "../../lib/sms";
import { createSalonAlert } from "../alerts/alerts.service";
import {
  cancelAppointment,
  createAppointment,
  listAppointments,
  rescheduleAppointment,
  updateAppointment
} from "../appointments/appointments.service";
import { normalizePhoneForMatching } from "../calls/providers/callrail.provider";
import { createCustomer, searchCustomers } from "../customers/customers.service";
import { sendPushToAssignedCallCenterAgentsOrOperators } from "../notifications/notifications.service";
import { listServices } from "../services/services.service";
import { listStaff } from "../staff/staff.service";

const toJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
};

const AMAZON_CONNECT_OPERATOR_QUEUE_NAME = "FastAIBooking Operator Queue";
const OPERATOR_TRANSFER_PROMPT = "Let me check for an available operator.";
const OPERATOR_BUSY_PROMPT = "All of our operators are currently busy. Please call back later.";

type OperatorQueueMetrics = {
  staffedAgents: number;
  availableAgents: number;
  onlineAgents?: number;
  source: "amazon_connect_current_metrics" | "test_override" | "not_configured" | "error";
  errorMessage?: string;
};

const readMetricOverride = (name: string): number | undefined => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readMetricCollectionValue = (
  collections: Array<{ Metric?: { Name?: string }; Value?: number }> | undefined,
  metricName: string
): number => {
  const value = collections?.find((entry) => entry.Metric?.Name === metricName)?.Value;
  return Number.isFinite(value) ? Number(value) : 0;
};

const getOperatorQueueMetrics = async (): Promise<OperatorQueueMetrics> => {
  const staffedOverride = readMetricOverride("AMAZON_CONNECT_STAFFED_AGENTS_OVERRIDE");
  const availableOverride = readMetricOverride("AMAZON_CONNECT_AVAILABLE_AGENTS_OVERRIDE");
  if (staffedOverride !== undefined || availableOverride !== undefined) {
    return {
      staffedAgents: staffedOverride ?? 0,
      availableAgents: availableOverride ?? 0,
      source: "test_override"
    };
  }

  const instanceId = env.AMAZON_CONNECT_INSTANCE_ID;
  const queueId = env.AMAZON_CONNECT_QUEUE_ID_DEFAULT;
  const region = env.AWS_REGION ?? "us-east-1";
  if (!instanceId || !queueId) {
    return {
      staffedAgents: 0,
      availableAgents: 0,
      source: "not_configured",
      errorMessage: "Amazon Connect instance or queue id is not configured."
    };
  }

  try {
    const client = new ConnectClient({ region });
    const output = await client.send(
      new GetCurrentMetricDataCommand({
        InstanceId: instanceId,
        Filters: {
          Queues: [queueId],
          Channels: ["VOICE"]
        },
        CurrentMetrics: [
          { Name: "AGENTS_STAFFED", Unit: "COUNT" },
          { Name: "AGENTS_AVAILABLE", Unit: "COUNT" },
          { Name: "AGENTS_ONLINE", Unit: "COUNT" }
        ] as never
      })
    );
    const collections = output.MetricResults?.[0]?.Collections;
    return {
      staffedAgents: readMetricCollectionValue(collections, "AGENTS_STAFFED"),
      availableAgents: readMetricCollectionValue(collections, "AGENTS_AVAILABLE"),
      onlineAgents: readMetricCollectionValue(collections, "AGENTS_ONLINE"),
      source: "amazon_connect_current_metrics"
    };
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        instanceId,
        queueId
      },
      "Amazon Connect operator queue metrics check failed."
    );
    return {
      staffedAgents: 0,
      availableAgents: 0,
      source: "error",
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
};

interface CallCenterWorkspaceActor {
  userId: string;
  role: Role;
  salonId?: string | null;
}

const buildAgentActor = (agentUserId: string): CallCenterWorkspaceActor => ({
  userId: agentUserId,
  role: Role.CALL_CENTER_AGENT
});

const sendCallEscalationQueuePush = async (input: {
  salonId: string;
  escalationId: string;
  callSessionId: string;
  customerPhone?: string | null;
}): Promise<void> => {
  try {
    const salon = await prisma.salon.findUnique({
      where: {
        id: input.salonId
      },
      select: {
        name: true
      }
    });

    await sendPushToAssignedCallCenterAgentsOrOperators(input.salonId, {
      title: "Caller waiting for operator",
      body: `${salon?.name ?? "A salon"} has a caller in the operator queue${input.customerPhone ? ` from ${input.customerPhone}` : ""}.`,
      type: "call_escalation_queued",
      priority: "URGENT",
      salonId: input.salonId,
      url: `/call-center?escalationId=${encodeURIComponent(input.escalationId)}`,
      data: {
        type: "call_escalation_queued",
        salonId: input.salonId,
        escalationId: input.escalationId,
        callSessionId: input.callSessionId
      }
    });
  } catch (error) {
    logger.warn(
      {
        salonId: input.salonId,
        escalationId: input.escalationId,
        error: error instanceof Error ? error.message : String(error)
      },
      "Call escalation push notification failed."
    );
  }
};

const getAccessibleSalonIds = async (actor: CallCenterWorkspaceActor): Promise<string[]> => {
  if (actor.role === Role.SALON_OWNER) {
    return actor.salonId ? [actor.salonId] : [];
  }

  const assignments = await prisma.callCenterSalonAssignment.findMany({
    where: {
      agentUserId: actor.userId
    },
    select: {
      salonId: true
    }
  });

  return assignments.map((item) => item.salonId);
};

export const assertCallCenterSalonAccess = async (
  actor: CallCenterWorkspaceActor,
  salonId: string
) => {
  if (actor.role === Role.SALON_OWNER) {
    if (!actor.salonId || actor.salonId !== salonId) {
      throw new AppError("Salon is not available in this owner workspace.", 403, "FORBIDDEN");
    }
    return prisma.salon.findUniqueOrThrow({
      where: {
        id: salonId
      }
    });
  }

  const assignment = await prisma.callCenterSalonAssignment.findUnique({
    where: {
      salonId_agentUserId: {
        salonId,
        agentUserId: actor.userId
      }
    },
    include: {
      salon: true
    }
  });
  if (!assignment) {
    throw new AppError("Salon is not assigned to this call center agent.", 403, "FORBIDDEN");
  }
  return assignment.salon;
};

const salonWorkspaceInclude = {
  settings: true,
  owner: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true
    }
  },
  businessHours: {
    orderBy: {
      dayOfWeek: "asc" as const
    }
  },
  staff: {
    orderBy: {
      fullName: "asc" as const
    }
  },
  services: {
    where: {
      isActive: true
    },
    orderBy: {
      name: "asc" as const
    }
  },
  callCenterAssignments: {
    orderBy: {
      createdAt: "asc" as const
    },
    include: {
      agent: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          isActive: true
        }
      }
    }
  }
};

const escalationQueueInclude = {
  salon: {
    select: {
      id: true,
      name: true
    }
  },
  callSession: {
    select: {
      id: true,
      callerPhone: true,
      providerCallId: true,
      status: true,
      routingOutcome: true,
      aiSummary: true,
      createdAt: true
    }
  }
};

const buildPhoneLookupValues = (phone?: string): string[] => {
  const normalized = normalizePhoneForMatching(phone);
  const digits = phone?.replace(/\D/g, "");
  const values = new Set<string>();

  [phone?.trim(), normalized, digits].forEach((candidate) => {
    if (candidate) {
      values.add(candidate);
    }
  });
  if (digits?.length === 10) {
    values.add(`1${digits}`);
    values.add(`+1${digits}`);
  }
  if (digits?.length === 11 && digits.startsWith("1")) {
    values.add(digits.slice(1));
    values.add(`+${digits}`);
  }

  return Array.from(values.values());
};

export const listAssignedSalons = async (actor: CallCenterWorkspaceActor) => {
  if (actor.role === Role.SALON_OWNER) {
    if (!actor.salonId) {
      return [];
    }

    return prisma.salon.findMany({
      where: {
        id: actor.salonId
      },
      include: salonWorkspaceInclude
    });
  }

  const assignments = await prisma.callCenterSalonAssignment.findMany({
    where: {
      agentUserId: actor.userId
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      salon: {
        include: salonWorkspaceInclude
      }
    }
  });

  return assignments.map((assignment) => assignment.salon);
};

export const getAssignedSalonDetail = async (actor: CallCenterWorkspaceActor, salonId: string) => {
  await assertCallCenterSalonAccess(actor, salonId);
  return prisma.salon.findUniqueOrThrow({
    where: {
      id: salonId
    },
    include: salonWorkspaceInclude
  });
};

export const listAssignedSalonStaff = async (actor: CallCenterWorkspaceActor, salonId: string) => {
  await assertCallCenterSalonAccess(actor, salonId);
  return listStaff(salonId, false);
};

export const listAssignedSalonServices = async (
  actor: CallCenterWorkspaceActor,
  salonId: string
) => {
  await assertCallCenterSalonAccess(actor, salonId);
  return listServices(salonId, false);
};

export const listAssignedSalonCustomers = async (
  actor: CallCenterWorkspaceActor,
  salonId: string,
  input: { q?: string; page: number; limit: number }
) => {
  await assertCallCenterSalonAccess(actor, salonId);
  return searchCustomers(salonId, input);
};

export const createAssignedSalonCustomer = async (
  actor: CallCenterWorkspaceActor,
  salonId: string,
  input: {
    firstName: string;
    lastName?: string;
    email?: string;
    phone: string;
    notes?: string;
  }
) => {
  await assertCallCenterSalonAccess(actor, salonId);
  return createCustomer(salonId, actor.userId, input);
};

export const listAssignedSalonAppointments = async (
  actor: CallCenterWorkspaceActor,
  salonId: string,
  input: {
    page: number;
    limit: number;
    staffId?: string;
    customerId?: string;
    status?: AppointmentStatus;
    dateFrom?: Date;
    dateTo?: Date;
  }
) => {
  await assertCallCenterSalonAccess(actor, salonId);
  return listAppointments(salonId, input);
};

export const createAssignedSalonAppointment = async (
  actor: CallCenterWorkspaceActor,
  salonId: string,
  input: {
    customerId: string;
    staffId: string;
    serviceId: string;
    serviceIds?: string[];
    startTime: Date;
    notes?: string;
    status?: AppointmentStatus;
  }
) => {
  await assertCallCenterSalonAccess(actor, salonId);
  return createAppointment(salonId, actor.userId, {
    ...input,
    source: AppointmentSource.CALL_CENTER
  });
};

export const updateAssignedSalonAppointment = async (
  actor: CallCenterWorkspaceActor,
  salonId: string,
  appointmentId: string,
  input: {
    customerId?: string;
    staffId?: string;
    serviceId?: string;
    serviceIds?: string[];
    startTime?: Date;
    notes?: string | null;
    status?: AppointmentStatus;
  }
) => {
  await assertCallCenterSalonAccess(actor, salonId);
  return updateAppointment(salonId, appointmentId, actor.userId, {
    ...input,
    source: AppointmentSource.CALL_CENTER
  });
};

export const rescheduleAssignedSalonAppointment = async (
  actor: CallCenterWorkspaceActor,
  salonId: string,
  appointmentId: string,
  input: {
    staffId?: string;
    startTime: Date;
  }
) => {
  await assertCallCenterSalonAccess(actor, salonId);
  return rescheduleAppointment(salonId, appointmentId, actor.userId, input);
};

export const cancelAssignedSalonAppointment = async (
  actor: CallCenterWorkspaceActor,
  salonId: string,
  appointmentId: string,
  reason?: string
) => {
  await assertCallCenterSalonAccess(actor, salonId);
  return cancelAppointment(salonId, appointmentId, actor.userId, reason);
};

const getEscalationAccessContext = async (
  actor: CallCenterWorkspaceActor,
  escalationId: string
) => {
  const escalation = await prisma.callEscalation.findUnique({
    where: { id: escalationId },
    include: {
      salon: {
        include: {
          settings: true
        }
      },
      callSession: {
        include: {
          transcripts: {
            orderBy: {
              createdAt: "asc"
            }
          },
          bookingAttempts: {
            orderBy: {
              createdAt: "desc"
            },
            include: {
              appointment: true
            }
          },
          aiInteractions: {
            orderBy: {
              createdAt: "desc"
            }
          }
        }
      }
    }
  });

  if (!escalation) {
    throw new AppError("Call escalation not found.", 404, "CALL_ESCALATION_NOT_FOUND");
  }

  await assertCallCenterSalonAccess(actor, escalation.salonId);
  return escalation;
};

const updateCallSessionResolution = async (
  callSessionId: string,
  input: {
    routingOutcome?: CallRoutingOutcome;
    finalResolution?: string;
    recordingUrl?: string | null;
  }
) => {
  await prisma.callSession.update({
    where: { id: callSessionId },
    data: {
      routingOutcome: input.routingOutcome,
      finalResolution: input.finalResolution,
      recordingUrl: input.recordingUrl === undefined ? undefined : input.recordingUrl
    }
  });
};

export const createOrUpdateCallEscalation = async (input: {
  salonId: string;
  callSessionId: string;
  requestedBy: string;
  escalationReason: string;
  customerPhone?: string | null;
  messageToCaller?: string;
  operatorQueueOutcome?: string | null;
  suppressAlert?: boolean;
  metadata?: unknown;
}) => {
  const salon = await prisma.salon.findUnique({
    where: { id: input.salonId },
    include: {
      settings: true,
      callCenterAssignments: {
        select: {
          agentUserId: true
        }
      }
    }
  });

  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  const settings = salon.settings;
  const callCenterEnabled = settings?.callCenterEnabled ?? false;
  const hasAssignedAgents = salon.callCenterAssignments.length > 0;

  let status: CallEscalationStatus = CallEscalationStatus.PENDING;
  let routingOutcome: CallRoutingOutcome = CallRoutingOutcome.CALL_CENTER_ESCALATION;
  let finalResolution = "Escalation created.";
  let queuedAt: Date | null = null;
  let closedAt: Date | null = null;
  let callbackPhone: string | null = null;
  let smsRecipientPhone: string | null = null;
  let operatorQueueOutcome = "CONFIG_UNAVAILABLE";
  let connectMetrics: OperatorQueueMetrics | null = null;

  if (input.operatorQueueOutcome) {
    operatorQueueOutcome = input.operatorQueueOutcome;
  } else if (callCenterEnabled && hasAssignedAgents) {
    connectMetrics = await getOperatorQueueMetrics();
    if (connectMetrics.source === "error") {
      operatorQueueOutcome = "CONNECT_METRICS_DEFERRED_TO_CONNECT_FLOW";
    } else if (connectMetrics.source === "not_configured") {
      operatorQueueOutcome = "CONNECT_METRICS_NOT_CONFIGURED";
    } else if (connectMetrics.staffedAgents > 0 && connectMetrics.availableAgents > 0) {
      operatorQueueOutcome = "AGENT_AVAILABLE";
    } else if (connectMetrics.staffedAgents <= 0) {
      operatorQueueOutcome = "AGENTS_UNAVAILABLE";
    } else if (connectMetrics.availableAgents <= 0) {
      operatorQueueOutcome = "AGENTS_BUSY";
    } else {
      operatorQueueOutcome = "CONNECT_METRICS_ERROR";
    }
  } else if (!callCenterEnabled) {
    operatorQueueOutcome = "CALL_CENTER_DISABLED";
  } else if (!hasAssignedAgents) {
    operatorQueueOutcome = "NO_ASSIGNED_AGENTS";
  }

  if (
    operatorQueueOutcome === "AGENT_AVAILABLE" ||
    operatorQueueOutcome === "CONNECT_METRICS_DEFERRED_TO_CONNECT_FLOW"
  ) {
    status = CallEscalationStatus.QUEUED;
    routingOutcome = CallRoutingOutcome.QUEUED;
    finalResolution = "Waiting in the human operator queue.";
    queuedAt = new Date();
  } else {
    status = CallEscalationStatus.CLOSED;
    routingOutcome = CallRoutingOutcome.CALL_CENTER_ESCALATION;
    finalResolution = OPERATOR_BUSY_PROMPT;
    closedAt = new Date();
  }
  const messageToCaller =
    routingOutcome === CallRoutingOutcome.QUEUED
      ? input.messageToCaller ?? OPERATOR_TRANSFER_PROMPT
      : OPERATOR_BUSY_PROMPT;
  const metadata =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? {
          ...(input.metadata as Record<string, unknown>),
          operatorQueueOutcome,
          connectMetrics,
          callCenterEnabled,
          assignedAgentCount: salon.callCenterAssignments.length
        }
      : {
          operatorQueueOutcome,
          connectMetrics,
          callCenterEnabled,
          assignedAgentCount: salon.callCenterAssignments.length,
          originalMetadata: input.metadata
        };
  const previousEscalation = await prisma.callEscalation.findUnique({
    where: {
      callSessionId: input.callSessionId
    },
    select: {
      status: true
    }
  });

  const escalation = await prisma.callEscalation.upsert({
    where: {
      callSessionId: input.callSessionId
    },
    create: {
      salonId: input.salonId,
      callSessionId: input.callSessionId,
      status,
      routingOutcome,
      escalationReason: input.escalationReason,
      requestedBy: input.requestedBy,
      customerPhone: input.customerPhone ?? null,
      queueId: env.AMAZON_CONNECT_QUEUE_ID_DEFAULT ?? null,
      queueName: env.AMAZON_CONNECT_QUEUE_ID_DEFAULT ? AMAZON_CONNECT_OPERATOR_QUEUE_NAME : null,
      messageToCaller,
      callbackPhone,
      smsRecipientPhone,
      queuedAt,
      closedAt,
      metadata: toJson(metadata)
    },
    update: {
      status,
      routingOutcome,
      escalationReason: input.escalationReason,
      requestedBy: input.requestedBy,
      customerPhone: input.customerPhone ?? undefined,
      queueId: env.AMAZON_CONNECT_QUEUE_ID_DEFAULT ?? undefined,
      queueName: env.AMAZON_CONNECT_QUEUE_ID_DEFAULT
        ? AMAZON_CONNECT_OPERATOR_QUEUE_NAME
        : undefined,
      messageToCaller,
      callbackPhone,
      smsRecipientPhone,
      queuedAt,
      closedAt,
      metadata: toJson(metadata)
    }
  });

  await updateCallSessionResolution(input.callSessionId, {
    routingOutcome,
    finalResolution
  });

  if (!input.suppressAlert) {
    await createSalonAlert({
      salonId: input.salonId,
      alertType: "CALL_ESCALATION_CREATED",
      title: "Human escalation created",
      message:
        status === CallEscalationStatus.QUEUED
          ? "A caller requested a human. The call is waiting in the operator queue."
          : finalResolution,
      priority: "URGENT",
      metadata: {
        callSessionId: input.callSessionId,
        escalationId: escalation.id,
        status,
        routingOutcome,
        customerPhone: input.customerPhone,
        requestedBy: input.requestedBy,
        escalationReason: input.escalationReason,
        messageToCaller,
        salonName: salon.name
      },
      sendSms: false
    });
  }

  if (
    status === CallEscalationStatus.QUEUED &&
    previousEscalation?.status !== CallEscalationStatus.QUEUED
  ) {
    await sendCallEscalationQueuePush({
      salonId: input.salonId,
      escalationId: escalation.id,
      callSessionId: input.callSessionId,
      customerPhone: input.customerPhone
    });
  }

  return escalation;
};

export const recordOperatorQueueOutcome = async (input: {
  salonId?: string | null;
  callSessionId?: string | null;
  amazonConnectContactId?: string | null;
  callerPhone?: string | null;
  operatorQueueOutcome: "AGENTS_UNAVAILABLE" | "AGENTS_BUSY" | "QUEUE_WAIT_TIMEOUT" | "CONNECT_FLOW_ERROR";
}) => {
  const contactId = input.amazonConnectContactId?.trim();
  const callSession = input.callSessionId
    ? await prisma.callSession.findUnique({
        where: { id: input.callSessionId }
      })
    : contactId
      ? await prisma.callSession.findFirst({
          where: {
            provider: ExternalProvider.AMAZON_CONNECT,
            providerCallId: contactId
          },
          orderBy: {
            createdAt: "desc"
          }
        })
      : null;

  const salonId = input.salonId?.trim() || callSession?.salonId || env.DEFAULT_SALON_ID;
  if (!salonId) {
    throw new AppError("Salon is required for operator queue outcome.", 400, "SALON_REQUIRED");
  }

  const existingCallSession =
    callSession ??
    (contactId
      ? await prisma.callSession.create({
          data: {
            salonId,
            provider: ExternalProvider.AMAZON_CONNECT,
            providerCallId: contactId,
            callerPhone: input.callerPhone ?? null,
            status: CallSessionStatus.COMPLETED,
            routingOutcome: CallRoutingOutcome.CALL_CENTER_ESCALATION,
            finalResolution: OPERATOR_BUSY_PROMPT,
            rawPayload: toJson({
              source: "amazon_connect_operator_queue_outcome",
              operatorQueueOutcome: input.operatorQueueOutcome
            })
          }
        })
      : null);

  if (!existingCallSession) {
    throw new AppError("Call session or Amazon Connect ContactId is required.", 400, "CALL_SESSION_REQUIRED");
  }

  return createOrUpdateCallEscalation({
    salonId,
    callSessionId: existingCallSession.id,
    requestedBy: "AMAZON_CONNECT_FLOW",
    escalationReason:
      input.operatorQueueOutcome === "QUEUE_WAIT_TIMEOUT"
        ? "Operator queue wait timed out."
        : "No operator was available in Amazon Connect.",
    customerPhone: input.callerPhone ?? existingCallSession.callerPhone ?? null,
    messageToCaller: OPERATOR_BUSY_PROMPT,
    operatorQueueOutcome: input.operatorQueueOutcome,
    suppressAlert: true,
    metadata: {
      source: "amazon_connect_flow",
      contactId,
      operatorQueueOutcome: input.operatorQueueOutcome
    }
  });
};

export const getCallCenterRuntime = async (actor: CallCenterWorkspaceActor) => {
  const [accessibleSalonIds, activeAmazonConnectConfigCount] = await Promise.all([
    getAccessibleSalonIds(actor),
    prisma.integrationConfig.count({
      where: {
        provider: ExternalProvider.AMAZON_CONNECT,
        isActive: true
      }
    })
  ]);

  const adminMissing = [
    ...env.integrationStatuses.amazonConnect.missing,
    activeAmazonConnectConfigCount === 0 ? "Active AMAZON_CONNECT IntegrationConfig" : null
  ].filter((value): value is string => Boolean(value));

  return {
    accessMode: actor.role === Role.SALON_OWNER ? "owner" : "operator",
    assignedSalonCount: accessibleSalonIds.length,
    ownerSalonId: actor.salonId ?? null,
    assignedAgentCount:
      actor.role === Role.SALON_OWNER && actor.salonId
        ? await prisma.callCenterSalonAssignment.count({
            where: {
              salonId: actor.salonId
            }
          })
        : null,
    runtimeEnv: {
      ...env.runtimeEnv
    },
    amazonConnect: {
      region: env.AWS_REGION ?? null,
      instanceId: env.AMAZON_CONNECT_INSTANCE_ID ?? null,
      instanceUrl: env.AMAZON_CONNECT_INSTANCE_URL ?? null,
      ccpUrl: env.AMAZON_CONNECT_CCP_URL ?? null,
      queueIdDefault: env.AMAZON_CONNECT_QUEUE_ID_DEFAULT ?? null,
      routingProfileId: env.AMAZON_CONNECT_ROUTING_PROFILE_ID ?? null,
      configured: env.integrationStatuses.amazonConnect.configured,
      missing: env.integrationStatuses.amazonConnect.missing,
      adminConfigured:
        env.integrationStatuses.amazonConnect.configured && activeAmazonConnectConfigCount > 0,
      adminMissing,
      activeIntegrationConfigCount: activeAmazonConnectConfigCount
    }
  };
};

export const listEscalationQueue = async (
  actor: CallCenterWorkspaceActor,
  input: {
    status?: CallEscalationStatus;
    limit: number;
  }
) => {
  const salonIds = await getAccessibleSalonIds(actor);
  if (!salonIds.length) {
    return [];
  }

  return prisma.callEscalation.findMany({
    where: {
      salonId: {
        in: salonIds
      },
      ...(input.status ? { status: input.status } : {})
    },
    orderBy: [
      {
        requestedAt: "asc"
      }
    ],
    take: input.limit,
    include: escalationQueueInclude
  });
};

export const matchEscalationForContact = async (
  actor: CallCenterWorkspaceActor,
  input: {
    callerPhone?: string;
    amazonConnectContactId?: string;
  }
) => {
  const salonIds = await getAccessibleSalonIds(actor);
  if (!salonIds.length) {
    return null;
  }

  const contactId = input.amazonConnectContactId?.trim();
  const phoneLookupValues = buildPhoneLookupValues(input.callerPhone);
  if (!contactId && phoneLookupValues.length === 0) {
    throw new AppError("Provide callerPhone or amazonConnectContactId.", 400, "CONTACT_MATCH_INPUT_REQUIRED");
  }

  return prisma.callEscalation.findFirst({
    where: {
      salonId: {
        in: salonIds
      },
      status: {
        not: CallEscalationStatus.CLOSED
      },
      OR: [
        ...(contactId
          ? [
              {
                amazonConnectContactId: contactId
              },
              {
                callSession: {
                  providerCallId: contactId
                }
              }
            ]
          : []),
        ...(phoneLookupValues.length
          ? [
              {
                customerPhone: {
                  in: phoneLookupValues
                }
              },
              {
                callSession: {
                  callerPhone: {
                    in: phoneLookupValues
                  }
                }
              }
            ]
          : [])
      ]
    },
    orderBy: {
      requestedAt: "desc"
    },
    include: escalationQueueInclude
  });
};

export const getEscalationDetail = async (actor: CallCenterWorkspaceActor, escalationId: string) => {
  const escalation = await getEscalationAccessContext(actor, escalationId);
  const callerPhone = escalation.callSession.callerPhone ?? escalation.customerPhone ?? undefined;
  const customers = callerPhone
    ? await prisma.customer.findMany({
        where: {
          salonId: escalation.salonId,
          deletedAt: null,
          phone: {
            contains: callerPhone.replace(/[^\d]/g, "")
          }
        },
        take: 5,
        orderBy: {
          createdAt: "desc"
        }
      })
    : [];

  return {
    ...escalation,
    customerMatches: customers
  };
};

export const acceptEscalation = async (
  agentUserId: string,
  escalationId: string,
  input: { amazonConnectContactId?: string }
) => {
  const escalation = await getEscalationAccessContext(buildAgentActor(agentUserId), escalationId);

  const updated = await prisma.callEscalation.update({
    where: { id: escalation.id },
    data: {
      status: CallEscalationStatus.CONNECTED,
      routingOutcome: CallRoutingOutcome.CALL_CENTER_ESCALATION,
      assignedAgentUserId: agentUserId,
      amazonConnectContactId: input.amazonConnectContactId,
      connectedAt: new Date()
    }
  });

  await updateCallSessionResolution(escalation.callSessionId, {
    routingOutcome: CallRoutingOutcome.CALL_CENTER_ESCALATION,
    finalResolution: "Connected to a human operator."
  });

  return updated;
};

export const updateEscalation = async (
  agentUserId: string,
  escalationId: string,
  input: {
    operatorNotes?: string | null;
    qaNotes?: string | null;
    resolution?: string | null;
  }
) => {
  const escalation = await getEscalationAccessContext(buildAgentActor(agentUserId), escalationId);

  return prisma.callEscalation.update({
    where: { id: escalation.id },
    data: {
      operatorNotes: input.operatorNotes,
      qaNotes: input.qaNotes,
      resolution: input.resolution
    }
  });
};

export const completeEscalation = async (
  agentUserId: string,
  escalationId: string,
  input: {
    resolution: string;
    operatorNotes?: string | null;
    qaNotes?: string | null;
  }
) => {
  const escalation = await getEscalationAccessContext(buildAgentActor(agentUserId), escalationId);

  const updated = await prisma.callEscalation.update({
    where: { id: escalation.id },
    data: {
      status: CallEscalationStatus.CLOSED,
      routingOutcome: CallRoutingOutcome.CALL_CENTER_ESCALATION,
      assignedAgentUserId: agentUserId,
      resolution: input.resolution,
      operatorNotes: input.operatorNotes,
      qaNotes: input.qaNotes,
      closedAt: new Date()
    }
  });

  await updateCallSessionResolution(escalation.callSessionId, {
    routingOutcome: CallRoutingOutcome.CALL_CENTER_ESCALATION,
    finalResolution: input.resolution
  });

  return updated;
};

export const createCallbackRequestForEscalation = async (
  agentUserId: string,
  escalationId: string,
  input: {
    callbackPhone?: string | null;
    notes?: string | null;
  }
) => {
  const escalation = await getEscalationAccessContext(buildAgentActor(agentUserId), escalationId);
  const callbackPhone =
    input.callbackPhone ?? escalation.customerPhone ?? escalation.callSession.callerPhone ?? null;

  const updated = await prisma.callEscalation.update({
    where: { id: escalation.id },
    data: {
      status: CallEscalationStatus.CALLBACK_REQUESTED,
      routingOutcome: CallRoutingOutcome.CALLBACK_REQUEST,
      assignedAgentUserId: agentUserId,
      callbackPhone,
      operatorNotes: input.notes ?? escalation.operatorNotes
    }
  });

  await updateCallSessionResolution(escalation.callSessionId, {
    routingOutcome: CallRoutingOutcome.CALLBACK_REQUEST,
    finalResolution: "Callback request created."
  });

  return updated;
};

export const captureVoicemailForEscalation = async (
  agentUserId: string,
  escalationId: string,
  input: {
    voicemailRecordingUrl?: string | null;
    notes?: string | null;
  }
) => {
  const escalation = await getEscalationAccessContext(buildAgentActor(agentUserId), escalationId);

  const updated = await prisma.callEscalation.update({
    where: { id: escalation.id },
    data: {
      status: CallEscalationStatus.VOICEMAIL_LEFT,
      routingOutcome: CallRoutingOutcome.VOICEMAIL,
      voicemailRecordingUrl: input.voicemailRecordingUrl,
      operatorNotes: input.notes ?? escalation.operatorNotes
    }
  });

  await updateCallSessionResolution(escalation.callSessionId, {
    routingOutcome: CallRoutingOutcome.VOICEMAIL,
    finalResolution: "Voicemail left.",
    recordingUrl: input.voicemailRecordingUrl
  });

  return updated;
};

export const sendSmsFallbackForEscalation = async (
  agentUserId: string,
  escalationId: string,
  input: {
    recipientPhone?: string | null;
    message: string;
  }
) => {
  const escalation = await getEscalationAccessContext(buildAgentActor(agentUserId), escalationId);
  const recipientPhone =
    input.recipientPhone ?? escalation.customerPhone ?? escalation.callSession.callerPhone ?? null;

  await sendSms({
    to: recipientPhone,
    body: input.message,
    reason: "CALL_CENTER_SMS_FALLBACK"
  });

  const updated = await prisma.callEscalation.update({
    where: { id: escalation.id },
    data: {
      status: CallEscalationStatus.SMS_SENT,
      routingOutcome: CallRoutingOutcome.SMS_FALLBACK,
      smsRecipientPhone: recipientPhone
    }
  });

  await updateCallSessionResolution(escalation.callSessionId, {
    routingOutcome: CallRoutingOutcome.SMS_FALLBACK,
    finalResolution: "SMS fallback sent."
  });

  return updated;
};
