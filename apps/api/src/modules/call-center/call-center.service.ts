import {
  AppointmentSource,
  AppointmentStatus,
  CallEscalationStatus,
  CallRoutingOutcome,
  ExternalProvider,
  Prisma
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { AppError } from "../../lib/errors";
import { sendSms } from "../../lib/sms";
import { createSalonAlert } from "../alerts/alerts.service";
import {
  cancelAppointment,
  createAppointment,
  listAppointments,
  rescheduleAppointment,
  updateAppointment
} from "../appointments/appointments.service";
import { createCustomer, searchCustomers } from "../customers/customers.service";
import { listServices } from "../services/services.service";
import { listStaff } from "../staff/staff.service";

const toJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
};

export const assertCallCenterSalonAccess = async (agentUserId: string, salonId: string) => {
  const assignment = await prisma.callCenterSalonAssignment.findUnique({
    where: {
      salonId_agentUserId: {
        salonId,
        agentUserId
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

export const listAssignedSalons = async (agentUserId: string) => {
  const assignments = await prisma.callCenterSalonAssignment.findMany({
    where: {
      agentUserId
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      salon: {
        include: {
          settings: true,
          staff: {
            orderBy: {
              fullName: "asc"
            }
          }
        }
      }
    }
  });

  return assignments.map((assignment) => assignment.salon);
};

export const getAssignedSalonDetail = async (agentUserId: string, salonId: string) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return prisma.salon.findUniqueOrThrow({
    where: {
      id: salonId
    },
    include: {
      settings: true,
      staff: {
        orderBy: {
          fullName: "asc"
        }
      }
    }
  });
};

export const listAssignedSalonStaff = async (agentUserId: string, salonId: string) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return listStaff(salonId, false);
};

export const listAssignedSalonServices = async (agentUserId: string, salonId: string) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return listServices(salonId, false);
};

export const listAssignedSalonCustomers = async (
  agentUserId: string,
  salonId: string,
  input: { q?: string; page: number; limit: number }
) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return searchCustomers(salonId, input);
};

export const createAssignedSalonCustomer = async (
  agentUserId: string,
  salonId: string,
  input: {
    firstName: string;
    lastName: string;
    email?: string;
    phone: string;
    notes?: string;
  }
) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return createCustomer(salonId, agentUserId, input);
};

export const listAssignedSalonAppointments = async (
  agentUserId: string,
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
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return listAppointments(salonId, input);
};

export const createAssignedSalonAppointment = async (
  agentUserId: string,
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
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return createAppointment(salonId, agentUserId, {
    ...input,
    source: AppointmentSource.CALL_CENTER
  });
};

export const updateAssignedSalonAppointment = async (
  agentUserId: string,
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
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return updateAppointment(salonId, appointmentId, agentUserId, {
    ...input,
    source: AppointmentSource.CALL_CENTER
  });
};

export const rescheduleAssignedSalonAppointment = async (
  agentUserId: string,
  salonId: string,
  appointmentId: string,
  input: {
    staffId?: string;
    startTime: Date;
  }
) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return rescheduleAppointment(salonId, appointmentId, agentUserId, input);
};

export const cancelAssignedSalonAppointment = async (
  agentUserId: string,
  salonId: string,
  appointmentId: string,
  reason?: string
) => {
  await assertCallCenterSalonAccess(agentUserId, salonId);
  return cancelAppointment(salonId, appointmentId, agentUserId, reason);
};

const getEscalationAccessContext = async (agentUserId: string, escalationId: string) => {
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

  await assertCallCenterSalonAccess(agentUserId, escalation.salonId);
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
  const callbackRequestEnabled = settings?.callbackRequestEnabled ?? true;
  const smsFallbackEnabled = settings?.smsFallbackEnabled ?? false;
  const voicemailEnabled = settings?.voicemailEnabled ?? true;

  let status: CallEscalationStatus = CallEscalationStatus.PENDING;
  let routingOutcome: CallRoutingOutcome = CallRoutingOutcome.CALL_CENTER_ESCALATION;
  let finalResolution = "Escalation created.";
  let queuedAt: Date | null = null;
  let callbackPhone: string | null = null;
  let smsRecipientPhone: string | null = null;

  if (callCenterEnabled && hasAssignedAgents) {
    status = CallEscalationStatus.QUEUED;
    routingOutcome = CallRoutingOutcome.QUEUED;
    finalResolution = "Waiting in the human operator queue.";
    queuedAt = new Date();
  } else if (callbackRequestEnabled && input.customerPhone) {
    status = CallEscalationStatus.CALLBACK_REQUESTED;
    routingOutcome = CallRoutingOutcome.CALLBACK_REQUEST;
    finalResolution = "Callback request created because no operator was available.";
    callbackPhone = input.customerPhone;
  } else if (smsFallbackEnabled && input.customerPhone) {
    status = CallEscalationStatus.SMS_SENT;
    routingOutcome = CallRoutingOutcome.SMS_FALLBACK;
    finalResolution = "SMS fallback sent because no operator was available.";
    smsRecipientPhone = input.customerPhone;
    await sendSms({
      to: input.customerPhone,
      body: "We missed your call. Reply with your preferred time and we will call you back.",
      reason: "CALL_CENTER_SMS_FALLBACK"
    });
  } else if (voicemailEnabled) {
    status = CallEscalationStatus.PENDING;
    routingOutcome = CallRoutingOutcome.VOICEMAIL;
    finalResolution = "Voicemail fallback is enabled for this salon.";
  }

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
      queueName: env.AMAZON_CONNECT_QUEUE_ID_DEFAULT ? "Amazon Connect Shared Queue" : null,
      messageToCaller: input.messageToCaller ?? "Please wait while I connect you.",
      callbackPhone,
      smsRecipientPhone,
      queuedAt,
      metadata: input.metadata === undefined ? undefined : toJson(input.metadata)
    },
    update: {
      status,
      routingOutcome,
      escalationReason: input.escalationReason,
      requestedBy: input.requestedBy,
      customerPhone: input.customerPhone ?? undefined,
      queueId: env.AMAZON_CONNECT_QUEUE_ID_DEFAULT ?? undefined,
      queueName: env.AMAZON_CONNECT_QUEUE_ID_DEFAULT
        ? "Amazon Connect Shared Queue"
        : undefined,
      messageToCaller: input.messageToCaller ?? "Please wait while I connect you.",
      callbackPhone,
      smsRecipientPhone,
      queuedAt,
      metadata: input.metadata === undefined ? undefined : toJson(input.metadata)
    }
  });

  await updateCallSessionResolution(input.callSessionId, {
    routingOutcome,
    finalResolution
  });

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
      customerPhone: input.customerPhone
    },
    sendSms: status !== CallEscalationStatus.SMS_SENT
  });

  return escalation;
};

export const getCallCenterRuntime = async (agentUserId: string) => {
  const [assignmentCount, activeAmazonConnectConfigCount] = await Promise.all([
    prisma.callCenterSalonAssignment.count({
      where: {
        agentUserId
      }
    }),
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
    assignedSalonCount: assignmentCount,
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
  agentUserId: string,
  input: {
    status?: CallEscalationStatus;
    limit: number;
  }
) => {
  const assignments = await prisma.callCenterSalonAssignment.findMany({
    where: {
      agentUserId
    },
    select: {
      salonId: true
    }
  });

  const salonIds = assignments.map((item) => item.salonId);
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
    include: {
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
          status: true,
          routingOutcome: true,
          aiSummary: true,
          createdAt: true
        }
      }
    }
  });
};

export const getEscalationDetail = async (agentUserId: string, escalationId: string) => {
  const escalation = await getEscalationAccessContext(agentUserId, escalationId);
  const callerPhone = escalation.callSession.callerPhone ?? escalation.customerPhone ?? undefined;
  const customers = callerPhone
    ? await prisma.customer.findMany({
        where: {
          salonId: escalation.salonId,
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
  const escalation = await getEscalationAccessContext(agentUserId, escalationId);

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
  const escalation = await getEscalationAccessContext(agentUserId, escalationId);

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
  const escalation = await getEscalationAccessContext(agentUserId, escalationId);

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
  const escalation = await getEscalationAccessContext(agentUserId, escalationId);
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
  const escalation = await getEscalationAccessContext(agentUserId, escalationId);

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
  const escalation = await getEscalationAccessContext(agentUserId, escalationId);
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
