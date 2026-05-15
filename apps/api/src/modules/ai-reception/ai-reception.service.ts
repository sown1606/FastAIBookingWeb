import {
  AiReceptionForwardingType,
  AiReceptionSetupStatus,
  CallSessionStatus,
  ExternalProvider
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { formatUsPhone, normalizeUsPhone } from "../../utils/phone";

const DEFAULT_PROVIDER = "amazon_connect" as const;
const DEFAULT_CARRIER = (env.DEMO_CARRIER?.toLowerCase() ?? "tmobile") as "tmobile";
const DEFAULT_CARRIER_LABEL = "T-Mobile";
const DEFAULT_FORWARDING_TYPE = (env.DEMO_FORWARDING_TYPE?.toLowerCase() ?? "no_answer") as "no_answer";
const DEFAULT_CALL_DIRECTION = "inbound" as const;
const STATUS_CHECK_CODE = env.DEMO_FORWARDING_STATUS_CODE;
const DEACTIVATION_CODE = env.DEMO_FORWARDING_DEACTIVATION_CODE;

const normalizePhoneDigits = (value: string | null | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalizedUsPhone = normalizeUsPhone(value);
  if (normalizedUsPhone) {
    return normalizedUsPhone.replace(/\D/g, "");
  }

  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) {
    return `1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits;
  }

  return undefined;
};

const requirePhoneDigits = (value: string | null | undefined, label: string): string => {
  const normalized = normalizePhoneDigits(value);
  if (!normalized) {
    throw new AppError(`${label} must be a valid US phone number.`, 400, "INVALID_US_PHONE");
  }
  return normalized;
};

const formatPhoneDigits = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  if (value.length === 11 && value.startsWith("1")) {
    return formatUsPhone(`+${value}`);
  }

  if (value.length === 10) {
    return formatUsPhone(`+1${value}`);
  }

  return value;
};

const getConfiguredTrackingDigits = (): string | undefined => {
  return normalizePhoneDigits(env.AMAZON_CONNECT_PHONE_NUMBER ?? env.DEMO_FORWARDING_PHONE_NUMBER);
};

const getDemoOriginalPhoneDigits = (): string | undefined => {
  return normalizePhoneDigits(env.DEMO_ORIGINAL_PHONE_NUMBER);
};

const getDemoForwardingDigits = (): string | undefined => {
  return normalizePhoneDigits(env.DEMO_FORWARDING_PHONE_NUMBER);
};

const mapStatusToApi = (status: AiReceptionSetupStatus | null | undefined) => {
  switch (status) {
    case AiReceptionSetupStatus.PENDING:
      return "pending" as const;
    case AiReceptionSetupStatus.ACTIVE:
      return "active" as const;
    case AiReceptionSetupStatus.FAILED:
      return "failed" as const;
    case AiReceptionSetupStatus.NOT_CONFIGURED:
    default:
      return "not_configured" as const;
  }
};

const mapApiStatusToDb = (
  status: "not_configured" | "pending" | "active" | "failed"
): AiReceptionSetupStatus => {
  switch (status) {
    case "pending":
      return AiReceptionSetupStatus.PENDING;
    case "active":
      return AiReceptionSetupStatus.ACTIVE;
    case "failed":
      return AiReceptionSetupStatus.FAILED;
    case "not_configured":
    default:
      return AiReceptionSetupStatus.NOT_CONFIGURED;
  }
};

const resolveForwardingDigits = (value?: string | null): string => {
  return requirePhoneDigits(
    value ?? env.AMAZON_CONNECT_PHONE_NUMBER ?? env.DEMO_FORWARDING_PHONE_NUMBER,
    "Forward-to AI number"
  );
};

const buildForwardingCodes = (forwardingDigits: string) => {
  const demoForwardingDigits = getDemoForwardingDigits();
  const activationCode =
    demoForwardingDigits && forwardingDigits === demoForwardingDigits
      ? env.DEMO_FORWARDING_ACTIVATION_CODE
      : `**61*${forwardingDigits}**10#`;
  const fallbackActivationCode =
    demoForwardingDigits && forwardingDigits === demoForwardingDigits
      ? `**61*${forwardingDigits}#`
      : `**61*${forwardingDigits}#`;
  return {
    activationCode,
    fallbackActivationCode,
    activationCodeWithoutDelay: fallbackActivationCode,
    deactivationCode: DEACTIVATION_CODE,
    statusCheckCode: STATUS_CHECK_CODE
  };
};

const buildSetupInstructions = (codes: {
  activationCode: string;
  fallbackActivationCode: string;
  deactivationCode: string;
  originalPhoneNumberFormatted: string;
  forwardToNumberFormatted: string;
}) => {
  return [
    `Use this setup only on the line that owns ${codes.originalPhoneNumberFormatted}.`,
    `Dial ${codes.activationCode} to enable T-Mobile no-answer forwarding.`,
    `If the delayed code does not work on the device, try ${codes.fallbackActivationCode}.`,
    `The phone rings first. If unanswered, T-Mobile forwards the call to ${codes.forwardToNumberFormatted}.`,
    "Do not enable the full iPhone Call Forwarding toggle for this flow.",
    `Dial ${codes.deactivationCode} to disable forwarding.`,
    "Forward directly to the Amazon Connect phone number for this flow."
  ];
};

const getSalonAiReceptionContext = async (salonId: string) => {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    include: {
      aiReceptionSetup: true
    }
  });

  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  return salon;
};

const buildAiReceptionResponse = (input: Awaited<ReturnType<typeof getSalonAiReceptionContext>>) => {
  const setup = input.aiReceptionSetup;
  const forwardingDigits = setup?.forwardingPhoneNumber ?? resolveForwardingDigits();
  const originalPhoneDigits =
    setup?.originalPhoneNumber ??
    normalizePhoneDigits(input.originalPhoneNumber) ??
    normalizePhoneDigits(input.contactPhone) ??
    getDemoOriginalPhoneDigits() ??
    null;
  const codes = buildForwardingCodes(forwardingDigits);
  const originalPhoneNumberFormatted = formatPhoneDigits(originalPhoneDigits);
  const forwardToNumberFormatted = formatPhoneDigits(forwardingDigits);

  return {
    id: setup?.id ?? null,
    salonId: input.id,
    salonName: input.name,
    provider: DEFAULT_PROVIDER,
    carrier: setup?.carrier ?? DEFAULT_CARRIER,
    carrierLabel: DEFAULT_CARRIER_LABEL,
    originalPhoneNumber: originalPhoneDigits,
    originalPhoneNumberFormatted,
    forwardToNumber: forwardingDigits,
    forwardToNumberFormatted,
    forwardingPhoneNumber: forwardingDigits,
    forwardingPhoneNumberFormatted: forwardToNumberFormatted,
    forwardingType: DEFAULT_FORWARDING_TYPE,
    activationCode: setup?.activationCode ?? codes.activationCode,
    fallbackActivationCode: codes.fallbackActivationCode,
    activationCodeWithoutDelay: codes.activationCodeWithoutDelay,
    deactivationCode: setup?.deactivationCode ?? codes.deactivationCode,
    statusCheckCode: codes.statusCheckCode,
    status: mapStatusToApi(setup?.status),
    lastTestedAt: setup?.lastTestedAt ?? null,
    lastVerifiedAt: setup?.lastVerifiedAt ?? null,
    webhookVerificationEnabled: Boolean(env.FASTAIBOOKING_API_INTERNAL_TOKEN?.trim()),
    setupInstructions: buildSetupInstructions({
      ...codes,
      originalPhoneNumberFormatted: originalPhoneNumberFormatted ?? "the original salon line",
      forwardToNumberFormatted: forwardToNumberFormatted ?? "the AI forwarding line"
    })
  };
};

export const assertOwnerSalonAccess = (actorSalonId: string | null | undefined, salonId: string) => {
  if (!actorSalonId || actorSalonId !== salonId) {
    throw new AppError("Forbidden.", 403, "FORBIDDEN");
  }
};

export const getAiReceptionConfigForSalon = async (salonId: string) => {
  const context = await getSalonAiReceptionContext(salonId);
  return buildAiReceptionResponse(context);
};

export const updateAiReceptionConfigForSalon = async (
  salonId: string,
  actorUserId: string,
  input: {
    carrier?: "tmobile";
    originalPhoneNumber?: string | null;
    forwardingPhoneNumber?: string | null;
    status?: "not_configured" | "pending" | "active" | "failed";
  }
) => {
  const context = await getSalonAiReceptionContext(salonId);
  const nextOriginalPhoneDigits =
    input.originalPhoneNumber === undefined
      ? context.aiReceptionSetup?.originalPhoneNumber ??
        normalizePhoneDigits(context.originalPhoneNumber) ??
        normalizePhoneDigits(context.contactPhone) ??
        getDemoOriginalPhoneDigits() ??
        null
      : input.originalPhoneNumber === null
        ? null
        : requirePhoneDigits(input.originalPhoneNumber, "Original salon phone number");
  const forwardingDigits = resolveForwardingDigits(
    input.forwardingPhoneNumber ?? context.aiReceptionSetup?.forwardingPhoneNumber ?? undefined
  );
  const codes = buildForwardingCodes(forwardingDigits);
  const carrier = input.carrier ?? ((context.aiReceptionSetup?.carrier as "tmobile" | undefined) ?? DEFAULT_CARRIER);
  const status = input.status
    ? mapApiStatusToDb(input.status)
    : context.aiReceptionSetup?.status ?? AiReceptionSetupStatus.NOT_CONFIGURED;

  if (input.originalPhoneNumber !== undefined) {
    await prisma.salon.update({
      where: { id: salonId },
      data: {
        originalPhoneNumber:
          input.originalPhoneNumber === null ? null : normalizeUsPhone(input.originalPhoneNumber)
      }
    });
  }

  const setup = await prisma.salonAiReceptionSetup.upsert({
    where: { salonId },
    create: {
      salonId,
      provider: ExternalProvider.AMAZON_CONNECT,
      carrier,
      originalPhoneNumber: nextOriginalPhoneDigits,
      forwardingPhoneNumber: forwardingDigits,
      forwardingType: AiReceptionForwardingType.NO_ANSWER,
      activationCode: codes.activationCode,
      deactivationCode: codes.deactivationCode,
      status
    },
    update: {
      provider: ExternalProvider.AMAZON_CONNECT,
      carrier,
      originalPhoneNumber: nextOriginalPhoneDigits,
      forwardingPhoneNumber: forwardingDigits,
      activationCode: codes.activationCode,
      deactivationCode: codes.deactivationCode,
      status
    }
  });

  await createAuditLog({
    salonId,
    actorUserId,
    action: "AI_RECEPTION_CONFIG_UPDATED",
    entityType: "SalonAiReceptionSetup",
    entityId: setup.id,
    metadata: {
      carrier,
      forwardingPhoneNumber: forwardingDigits,
      status
    }
  });

  return getAiReceptionConfigForSalon(salonId);
};

export const generateAiReceptionForwardingCodeForSalon = async (
  salonId: string,
  actorUserId: string,
  input?: {
    carrier?: "tmobile";
    originalPhoneNumber?: string | null;
    forwardingPhoneNumber?: string | null;
  }
) => {
  const context = await getSalonAiReceptionContext(salonId);
  const originalPhoneDigits =
    input?.originalPhoneNumber === undefined
      ? context.aiReceptionSetup?.originalPhoneNumber ??
        normalizePhoneDigits(context.originalPhoneNumber) ??
        normalizePhoneDigits(context.contactPhone) ??
        getDemoOriginalPhoneDigits() ??
        null
      : input.originalPhoneNumber === null
        ? null
        : requirePhoneDigits(input.originalPhoneNumber, "Original salon phone number");

  if (!originalPhoneDigits) {
    throw new AppError(
      "Original salon phone number is required before generating the forwarding code.",
      400,
      "AI_RECEPTION_ORIGINAL_PHONE_REQUIRED"
    );
  }

  const forwardingDigits = resolveForwardingDigits(
    input?.forwardingPhoneNumber ?? context.aiReceptionSetup?.forwardingPhoneNumber ?? undefined
  );
  const codes = buildForwardingCodes(forwardingDigits);
  const carrier = input?.carrier ?? ((context.aiReceptionSetup?.carrier as "tmobile" | undefined) ?? DEFAULT_CARRIER);
  const nextStatus =
    context.aiReceptionSetup?.status === AiReceptionSetupStatus.ACTIVE
      ? AiReceptionSetupStatus.ACTIVE
      : AiReceptionSetupStatus.PENDING;

  if (input?.originalPhoneNumber !== undefined) {
    await prisma.salon.update({
      where: { id: salonId },
      data: {
        originalPhoneNumber:
          input.originalPhoneNumber === null ? null : normalizeUsPhone(input.originalPhoneNumber)
      }
    });
  }

  const setup = await prisma.salonAiReceptionSetup.upsert({
    where: { salonId },
    create: {
      salonId,
      provider: ExternalProvider.AMAZON_CONNECT,
      carrier,
      originalPhoneNumber: originalPhoneDigits,
      forwardingPhoneNumber: forwardingDigits,
      forwardingType: AiReceptionForwardingType.NO_ANSWER,
      activationCode: codes.activationCode,
      deactivationCode: codes.deactivationCode,
      status: nextStatus
    },
    update: {
      provider: ExternalProvider.AMAZON_CONNECT,
      carrier,
      originalPhoneNumber: originalPhoneDigits,
      forwardingPhoneNumber: forwardingDigits,
      activationCode: codes.activationCode,
      deactivationCode: codes.deactivationCode,
      status: nextStatus
    }
  });

  await createAuditLog({
    salonId,
    actorUserId,
    action: "AI_RECEPTION_FORWARDING_CODE_GENERATED",
    entityType: "SalonAiReceptionSetup",
    entityId: setup.id,
    metadata: {
      carrier,
      forwardingPhoneNumber: forwardingDigits,
      status: nextStatus
    }
  });

  return getAiReceptionConfigForSalon(salonId);
};

export const markAiReceptionForwardingTestedForSalon = async (
  salonId: string,
  actorUserId: string
) => {
  const context = await getSalonAiReceptionContext(salonId);
  const originalPhoneDigits =
    context.aiReceptionSetup?.originalPhoneNumber ??
    normalizePhoneDigits(context.originalPhoneNumber) ??
    normalizePhoneDigits(context.contactPhone) ??
    getDemoOriginalPhoneDigits();

  if (!originalPhoneDigits) {
    throw new AppError(
      "Original salon phone number is required before marking forwarding as tested.",
      400,
      "AI_RECEPTION_ORIGINAL_PHONE_REQUIRED"
    );
  }

  const forwardingDigits = resolveForwardingDigits(context.aiReceptionSetup?.forwardingPhoneNumber);
  const codes = buildForwardingCodes(forwardingDigits);
  const now = new Date();

  const setup = await prisma.salonAiReceptionSetup.upsert({
    where: { salonId },
    create: {
      salonId,
      provider: ExternalProvider.AMAZON_CONNECT,
      carrier: DEFAULT_CARRIER,
      originalPhoneNumber: originalPhoneDigits,
      forwardingPhoneNumber: forwardingDigits,
      forwardingType: AiReceptionForwardingType.NO_ANSWER,
      activationCode: codes.activationCode,
      deactivationCode: codes.deactivationCode,
      status: AiReceptionSetupStatus.ACTIVE,
      lastTestedAt: now,
      lastVerifiedAt: now
    },
    update: {
      provider: ExternalProvider.AMAZON_CONNECT,
      originalPhoneNumber: originalPhoneDigits,
      forwardingPhoneNumber: forwardingDigits,
      activationCode: codes.activationCode,
      deactivationCode: codes.deactivationCode,
      status: AiReceptionSetupStatus.ACTIVE,
      lastTestedAt: now,
      lastVerifiedAt: now
    }
  });

  await createAuditLog({
    salonId,
    actorUserId,
    action: "AI_RECEPTION_FORWARDING_TEST_COMPLETED",
    entityType: "SalonAiReceptionSetup",
    entityId: setup.id,
    metadata: {
      lastTestedAt: now.toISOString(),
      lastVerifiedAt: now.toISOString()
    }
  });

  return getAiReceptionConfigForSalon(salonId);
};

export const listAiReceptionCallLogsForSalon = async (
  salonId: string,
  input: {
    page: number;
    limit: number;
  }
) => {
  await getSalonAiReceptionContext(salonId);
  const skip = (input.page - 1) * input.limit;
  const where = {
    salonId,
    provider: ExternalProvider.AMAZON_CONNECT
  };

  const [items, total] = await Promise.all([
    prisma.callSession.findMany({
      where,
      skip,
      take: input.limit,
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        providerCallId: true,
        trackingNumber: true,
        originalPhoneNumber: true,
        callerPhone: true,
        direction: true,
        status: true,
        durationSeconds: true,
        startedAt: true,
        answeredAt: true,
        endedAt: true,
        recordingUrl: true,
        transcriptSummary: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.callSession.count({ where })
  ]);

  return {
    items: items.map((item) => ({
      id: item.id,
      provider: DEFAULT_PROVIDER,
      providerCallId: item.providerCallId,
      trackingNumber: item.trackingNumber,
      trackingNumberFormatted: formatUsPhone(item.trackingNumber),
      originalPhoneNumber: item.originalPhoneNumber,
      originalPhoneNumberFormatted: formatUsPhone(item.originalPhoneNumber),
      callerNumber: item.callerPhone,
      callerNumberFormatted: formatUsPhone(item.callerPhone),
      direction: item.direction ?? DEFAULT_CALL_DIRECTION,
      status: item.status,
      durationSeconds: item.durationSeconds,
      startedAt: item.startedAt,
      answeredAt: item.answeredAt,
      completedAt: item.endedAt,
      recordingUrl: item.recordingUrl,
      summary: item.transcriptSummary,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    })),
    pagination: {
      page: input.page,
      limit: input.limit,
      total
    }
  };
};

export const markAiReceptionWebhookVerifiedForSalon = async (salonId: string, verifiedAt = new Date()) => {
  const setup = await prisma.salonAiReceptionSetup.findUnique({
    where: { salonId },
    select: {
      id: true,
      status: true
    }
  });

  if (!setup) {
    return;
  }

  await prisma.salonAiReceptionSetup.update({
    where: { salonId },
    data: {
      status: AiReceptionSetupStatus.ACTIVE,
      lastVerifiedAt: verifiedAt
    }
  });
};

export const getAmazonConnectHealthStatus = async () => {
  const [latestEvent, latestMappedCall, activeSetupCount] = await Promise.all([
    prisma.callEvent.findFirst({
      where: {
        provider: ExternalProvider.AMAZON_CONNECT
      },
      orderBy: {
        receivedAt: "desc"
      },
      select: {
        receivedAt: true
      }
    }),
    prisma.callSession.findFirst({
      where: {
        provider: ExternalProvider.AMAZON_CONNECT,
        salonId: {
          not: null
        },
        status: {
          in: [
            CallSessionStatus.RECEIVED,
            CallSessionStatus.RINGING,
            CallSessionStatus.IN_PROGRESS,
            CallSessionStatus.COMPLETED,
            CallSessionStatus.MISSED,
            CallSessionStatus.VOICEMAIL
          ]
        }
      },
      orderBy: {
        updatedAt: "desc"
      },
      select: {
        updatedAt: true
      }
    }),
    prisma.salonAiReceptionSetup.count({
      where: {
        provider: ExternalProvider.AMAZON_CONNECT,
        status: {
          in: [AiReceptionSetupStatus.PENDING, AiReceptionSetupStatus.ACTIVE]
        }
      }
    })
  ]);

  const trackingDigits = getConfiguredTrackingDigits();
  const demoOriginalPhoneNumber = getDemoOriginalPhoneDigits();
  const demoForwardingPhoneNumber = getDemoForwardingDigits() ?? trackingDigits;
  const internalTokenConfigured = Boolean(env.FASTAIBOOKING_API_INTERNAL_TOKEN);
  const awsRegionConfigured = Boolean(env.AWS_REGION);
  const instanceIdConfigured = Boolean(env.AMAZON_CONNECT_INSTANCE_ID);
  const instanceUrlConfigured = Boolean(env.AMAZON_CONNECT_INSTANCE_URL);
  const trackingNumberConfigured = Boolean(trackingDigits);
  const trackingNumberIdConfigured = Boolean(env.AMAZON_CONNECT_PHONE_NUMBER_ID);
  const defaultSalonIdConfigured = Boolean(env.DEFAULT_SALON_ID);
  const aiFlowIdConfigured = Boolean(env.AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION);
  const livePersonFlowIdConfigured = Boolean(env.AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION);
  const configured = env.integrationStatuses.amazonConnect.configured;
  const status = !configured ? "missing_config" : latestEvent || latestMappedCall ? "ready" : "configured";

  return {
    provider: DEFAULT_PROVIDER,
    status,
    configured,
    missing: env.integrationStatuses.amazonConnect.missing,
    webhookEndpoint: "/api/v1/internal/ai/appointments",
    webhookConfigured: internalTokenConfigured,
    webhookVerificationEnabled: internalTokenConfigured,
    webhookSecretConfigured: internalTokenConfigured,
    apiKeyConfigured: awsRegionConfigured,
    accountIdConfigured: instanceIdConfigured,
    companyIdConfigured: instanceUrlConfigured,
    accountCompanyConfigured: instanceIdConfigured && instanceUrlConfigured,
    trackingNumberConfigured,
    trackingNumberIdConfigured,
    defaultSalonIdConfigured,
    aiFlowIdConfigured,
    livePersonFlowIdConfigured,
    livePersonFlowOptional: false,
    trackingNumber: trackingDigits ?? demoForwardingPhoneNumber ?? "",
    trackingNumberFormatted: formatPhoneDigits(trackingDigits ?? demoForwardingPhoneNumber),
    callFlowName: env.AMAZON_LEX_BOOKING_INTENT_NAME ?? "BookAppointmentIntent",
    demoOriginalPhoneNumber: demoOriginalPhoneNumber ?? "",
    demoOriginalPhoneNumberFormatted: formatPhoneDigits(demoOriginalPhoneNumber),
    demoForwardingPhoneNumber: demoForwardingPhoneNumber ?? "",
    demoForwardingPhoneNumberFormatted: formatPhoneDigits(demoForwardingPhoneNumber),
    activeAiReceptionSetupCount: activeSetupCount,
    lastReceivedWebhookAt: latestEvent?.receivedAt ?? latestMappedCall?.updatedAt ?? null,
    lastWebhookReceivedAt: latestEvent?.receivedAt ?? latestMappedCall?.updatedAt ?? null,
    lastMappedCallAt: latestMappedCall?.updatedAt ?? null
  };
};

export const getCallRailHealthStatus = getAmazonConnectHealthStatus;
