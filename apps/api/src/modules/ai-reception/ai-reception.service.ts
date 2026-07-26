import {
  AiReceptionForwardingType,
  AiReceptionSetupStatus,
  CallSessionStatus,
  ExternalProvider,
  PhoneProvisioningStatus,
  StaffStatus
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { formatUsPhone, normalizeUsPhone } from "../../utils/phone";
import { hasOperatorTransferEntitlement } from "../billing/billing.plans";

const DEFAULT_PROVIDER = "amazon_connect" as const;
export const AI_RECEPTION_CARRIERS = [
  "tmobile",
  "att",
  "verizon",
  "uscellular",
  "other"
] as const;
export type AiReceptionCarrier = (typeof AI_RECEPTION_CARRIERS)[number];

const isAiReceptionCarrier = (value: string | null | undefined): value is AiReceptionCarrier =>
  Boolean(value && AI_RECEPTION_CARRIERS.includes(value as AiReceptionCarrier));

const DEFAULT_CARRIER: AiReceptionCarrier = isAiReceptionCarrier(env.DEMO_CARRIER?.toLowerCase())
  ? env.DEMO_CARRIER!.toLowerCase() as AiReceptionCarrier
  : "tmobile";
const DEFAULT_FORWARDING_TYPE = (env.DEMO_FORWARDING_TYPE?.toLowerCase() ?? "no_answer") as "no_answer";
const DEFAULT_CALL_DIRECTION = "inbound" as const;
const STATUS_CHECK_CODE = env.DEMO_FORWARDING_STATUS_CODE;
const DEACTIVATION_CODE = env.DEMO_FORWARDING_DEACTIVATION_CODE;

const CARRIER_LABELS: Record<AiReceptionCarrier, string> = {
  tmobile: "T-Mobile",
  att: "AT&T Wireless",
  verizon: "Verizon Wireless",
  uscellular: "UScellular",
  other: "Other / MVNO"
};

const CARRIER_SOURCE_URLS: Record<AiReceptionCarrier, string> = {
  tmobile: "https://www.t-mobile.com/support/plans-features/self-service-short-codes",
  att: "https://www.att.com/support/article/wireless/KM1011513/",
  verizon: "https://www.verizon.com/support/knowledge-base-181139/",
  uscellular: "https://www.uscellular.com/support/contact-us",
  other: ""
};

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

const resolveForwardingDigits = (value?: string | null): string => {
  return requirePhoneDigits(
    value ?? env.AMAZON_CONNECT_PHONE_NUMBER ?? env.DEMO_FORWARDING_PHONE_NUMBER,
    "Forward-to AI number"
  );
};

const buildForwardingCodes = (
  carrier: AiReceptionCarrier,
  forwardingDigits: string
) => {
  const tenDigits = forwardingDigits.startsWith("1")
    ? forwardingDigits.slice(1)
    : forwardingDigits;
  if (carrier === "verizon") {
    return {
      activationCode: `*71${tenDigits}`,
      fallbackActivationCode: `*72${tenDigits}`,
      activationCodeWithoutDelay: `*71${tenDigits}`,
      deactivationCode: "*73",
      statusCheckCode: null
    };
  }
  if (carrier !== "tmobile") {
    return {
      activationCode: null,
      fallbackActivationCode: null,
      activationCodeWithoutDelay: null,
      deactivationCode: null,
      statusCheckCode: null
    };
  }

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
    deactivationCode: DEACTIVATION_CODE || "##61#",
    statusCheckCode: STATUS_CHECK_CODE || "*#61#"
  };
};

const buildCarrierGuide = (input: {
  carrier: AiReceptionCarrier;
  activationCode: string | null;
  fallbackActivationCode: string | null;
  deactivationCode: string | null;
  statusCheckCode: string | null;
  originalPhoneNumberFormatted: string;
  forwardToNumberFormatted: string;
}) => {
  const commonVerifySteps = [
    `Use a different phone to call ${input.originalPhoneNumberFormatted}.`,
    "Do not answer the salon phone. Let it ring until the call reaches FastAIBooking.",
    "Complete a short AI interaction, then return here and select Check test call.",
    `If the call never reaches FastAIBooking, call ${input.forwardToNumberFormatted} directly to separate carrier forwarding from AWS routing.`
  ];
  const commonTroubleshooting = [
    "Set forwarding from the device and SIM that own the salon number.",
    "Disable iPhone Live Voicemail or carrier voicemail temporarily if it answers before forwarding.",
    "Wi-Fi Calling, prepaid plans, MVNOs, and business PBX lines can use different controls; contact the carrier if the option or code is rejected.",
    "Call forwarding moves voice calls only. It does not forward SMS messages."
  ];

  if (input.carrier === "tmobile") {
    return {
      summary: "Conditional no-answer forwarding: the salon phone rings first, then FastAIBooking answers.",
      steps: [
        `On the T-Mobile phone that owns ${input.originalPhoneNumberFormatted}, open the Phone keypad.`,
        `Dial ${input.activationCode} and press Call. This uses a 10-second no-answer delay.`,
        `If the delay form is rejected, dial ${input.fallbackActivationCode} and press Call.`,
        `Confirm the phone reports forwarding enabled to ${input.forwardToNumberFormatted}.`,
        `To stop no-answer forwarding, dial ${input.deactivationCode}.`
      ],
      verifySteps: commonVerifySteps,
      troubleshooting: [
        ...commonTroubleshooting,
        "For busy or unreachable calls too, T-Mobile separately supports **67*1+number# and **62*1+number#."
      ]
    };
  }

  if (input.carrier === "verizon") {
    return {
      summary: "Verizon Conditional Call Forwarding sends busy or unanswered calls after the phone rings.",
      steps: [
        `On the Verizon phone that owns ${input.originalPhoneNumberFormatted}, dial ${input.activationCode} and press Call.`,
        "Wait for the confirmation beeps or message, then let the call end.",
        `The destination must be the 10-digit FastAIBooking number ${input.forwardToNumberFormatted}.`,
        `To stop forwarding, dial ${input.deactivationCode}.`,
        `Only if you want every call forwarded immediately, use ${input.fallbackActivationCode}; that mode does not ring the salon phone first.`
      ],
      verifySteps: commonVerifySteps,
      troubleshooting: commonTroubleshooting
    };
  }

  if (input.carrier === "att") {
    return {
      summary: "AT&T forwarding controls vary by phone. Use the device menu and choose the no-answer condition when available.",
      steps: [
        `On the AT&T phone that owns ${input.originalPhoneNumberFormatted}, open Phone settings.`,
        "Android: Phone app > Settings > Supplementary services or Calling accounts > Call forwarding > Voice calls > When unanswered.",
        "iPhone: Settings > Apps > Phone > Call Forwarding generally forwards every call; for ring-first conditional forwarding, contact AT&T and request Conditional Call Forwarding / No Answer.",
        `Enter ${input.forwardToNumberFormatted} as the destination and save.`,
        "AT&T requires forwarding changes to be made from the wireless phone. If the conditional option is missing, use AT&T support rather than guessing a star code."
      ],
      verifySteps: commonVerifySteps,
      troubleshooting: commonTroubleshooting
    };
  }

  if (input.carrier === "uscellular") {
    return {
      summary: "UScellular forwarding availability depends on the device and plan.",
      steps: [
        `On the UScellular phone that owns ${input.originalPhoneNumberFormatted}, open Phone > Settings > Calling accounts or Supplementary services > Call forwarding.`,
        `Choose When unanswered / No answer and enter ${input.forwardToNumberFormatted}.`,
        "If conditional forwarding is missing, contact UScellular support and request no-answer forwarding to the FastAIBooking number.",
        "Do not ask to port or transfer ownership of the salon number; this is call forwarding only."
      ],
      verifySteps: commonVerifySteps,
      troubleshooting: commonTroubleshooting
    };
  }

  return {
    summary: "Ask the carrier or PBX provider for conditional no-answer forwarding so the salon phone rings first.",
    steps: [
      `Tell the provider: “Enable conditional / no-answer call forwarding from ${input.originalPhoneNumberFormatted} to ${input.forwardToNumberFormatted}.”`,
      "Ask how many rings or seconds occur before forwarding and set approximately 10-20 seconds.",
      "Confirm voicemail does not answer before the forwarding timer.",
      "For an MVNO, name the underlying network and plan because the parent carrier's star codes may be blocked."
    ],
    verifySteps: commonVerifySteps,
    troubleshooting: commonTroubleshooting
  };
};

const getSalonAiReceptionContext = async (salonId: string) => {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    include: {
      aiReceptionSetup: true,
      phoneProvisioning: true,
      subscription: {
        select: {
          planCode: true,
          status: true
        }
      },
      settings: {
        select: {
          aiReceptionEnabled: true,
          callCenterEnabled: true
        }
      },
      integrationConfigs: {
        where: {
          provider: ExternalProvider.AMAZON_CONNECT,
          isActive: true,
          configKey: {
            in: ["phone_number", "contact_flow_id_ai_reception"]
          }
        },
        select: {
          configKey: true,
          configValue: true
        }
      }
    }
  });

  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  return salon;
};

const buildAiReceptionResponse = async (
  input: Awaited<ReturnType<typeof getSalonAiReceptionContext>>
) => {
  const setup = input.aiReceptionSetup;
  const forwardingDigits = setup?.forwardingPhoneNumber ?? resolveForwardingDigits();
  const originalPhoneDigits =
    setup?.originalPhoneNumber ??
    normalizePhoneDigits(input.originalPhoneNumber) ??
    normalizePhoneDigits(input.contactPhone) ??
    getDemoOriginalPhoneDigits() ??
    null;
  const carrier = isAiReceptionCarrier(setup?.carrier) ? setup.carrier : DEFAULT_CARRIER;
  const codes = buildForwardingCodes(carrier, forwardingDigits);
  const originalPhoneNumberFormatted = formatPhoneDigits(originalPhoneDigits);
  const forwardToNumberFormatted = formatPhoneDigits(forwardingDigits);
  const [activeBookableStaffCount, activeServiceCount] = await Promise.all([
    prisma.staff.count({
      where: {
        salonId: input.id,
        status: StaffStatus.ACTIVE,
        isBookable: true,
        deletedAt: null
      }
    }),
    prisma.service.count({
      where: {
        salonId: input.id,
        isActive: true,
        deletedAt: null
      }
    })
  ]);
  const operatorTransferIncluded = hasOperatorTransferEntitlement(
    input.subscription?.planCode,
    input.subscription?.status
  );
  const legacyPhoneNumber = input.integrationConfigs?.find(
    (item) => item.configKey === "phone_number"
  )?.configValue;
  const legacyContactFlowId = input.integrationConfigs?.find(
    (item) => item.configKey === "contact_flow_id_ai_reception"
  )?.configValue;
  const legacyAwsPhoneReady = Boolean(
    legacyPhoneNumber &&
    normalizePhoneDigits(legacyPhoneNumber) ===
      normalizePhoneDigits(input.customerIncomingPhoneNumber)
  );
  const awsPhoneReady =
    (input.phoneProvisioning?.status === PhoneProvisioningStatus.ACTIVE &&
      Boolean(input.phoneProvisioning.phoneNumber)) ||
    legacyAwsPhoneReady;
  const lexFlowReady =
    awsPhoneReady &&
    (input.phoneProvisioning?.contactFlowId ===
      env.AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION ||
      legacyContactFlowId === env.AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION);
  const forwardingVerified = Boolean(setup?.lastVerifiedAt);
  const guide = buildCarrierGuide({
    carrier,
    ...codes,
    originalPhoneNumberFormatted: originalPhoneNumberFormatted ?? "the original salon line",
    forwardToNumberFormatted: forwardToNumberFormatted ?? "the FastAIBooking line"
  });

  return {
    id: setup?.id ?? null,
    salonId: input.id,
    salonName: input.name,
    provider: DEFAULT_PROVIDER,
    carrier,
    carrierLabel: CARRIER_LABELS[carrier],
    carrierOptions: AI_RECEPTION_CARRIERS.map((value) => ({
      value,
      label: CARRIER_LABELS[value]
    })),
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
    setupInstructions: guide.steps,
    carrierGuide: {
      ...guide,
      sourceUrl: CARRIER_SOURCE_URLS[carrier]
    },
    forwardingVerification: {
      status: forwardingVerified
        ? "verified"
        : setup?.lastTestedAt
          ? "test_not_observed"
          : "awaiting_test",
      verified: forwardingVerified,
      detail: forwardingVerified
        ? "A real inbound Amazon Connect call was observed for this salon."
        : setup?.lastTestedAt
          ? "No matching inbound Amazon Connect call has been observed since the test was recorded."
          : "Complete a forwarded test call, then use Check test call."
    },
    operatorTransferIncluded,
    operatorTransferActive: Boolean(
      operatorTransferIncluded && input.settings?.callCenterEnabled
    ),
    readiness: {
      awsPhoneReady,
      lexFlowReady,
      forwardingVerified,
      staffReady: activeBookableStaffCount > 0,
      servicesReady: activeServiceCount > 0,
      activeBookableStaffCount,
      activeServiceCount,
      readyForCalls:
        awsPhoneReady &&
        lexFlowReady &&
        forwardingVerified &&
        activeBookableStaffCount > 0 &&
        activeServiceCount > 0
    }
  };
};

export const assertOwnerSalonAccess = (actorSalonId: string | null | undefined, salonId: string) => {
  if (!actorSalonId || actorSalonId !== salonId) {
    throw new AppError("Forbidden.", 403, "FORBIDDEN");
  }
};

export const getAiReceptionConfigForSalon = async (salonId: string) => {
  const context = await getSalonAiReceptionContext(salonId);
  return await buildAiReceptionResponse(context);
};

export const updateAiReceptionConfigForSalon = async (
  salonId: string,
  actorUserId: string,
  input: {
    carrier?: AiReceptionCarrier;
    originalPhoneNumber?: string | null;
    forwardingPhoneNumber?: string | null;
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
  const carrier =
    input.carrier ??
    (isAiReceptionCarrier(context.aiReceptionSetup?.carrier)
      ? context.aiReceptionSetup.carrier
      : DEFAULT_CARRIER);
  const codes = buildForwardingCodes(carrier, forwardingDigits);
  const setupChanged =
    carrier !== context.aiReceptionSetup?.carrier ||
    forwardingDigits !== context.aiReceptionSetup?.forwardingPhoneNumber ||
    nextOriginalPhoneDigits !== context.aiReceptionSetup?.originalPhoneNumber;
  const status = setupChanged
    ? AiReceptionSetupStatus.PENDING
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
      status,
      ...(setupChanged
        ? {
            lastTestedAt: null,
            lastVerifiedAt: null
          }
        : {})
    },
    update: {
      provider: ExternalProvider.AMAZON_CONNECT,
      carrier,
      originalPhoneNumber: nextOriginalPhoneDigits,
      forwardingPhoneNumber: forwardingDigits,
      activationCode: codes.activationCode,
      deactivationCode: codes.deactivationCode,
      status,
      ...(setupChanged
        ? {
            lastTestedAt: null,
            lastVerifiedAt: null
          }
        : {})
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
    carrier?: AiReceptionCarrier;
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
  const carrier =
    input?.carrier ??
    (isAiReceptionCarrier(context.aiReceptionSetup?.carrier)
      ? context.aiReceptionSetup.carrier
      : DEFAULT_CARRIER);
  const codes = buildForwardingCodes(carrier, forwardingDigits);
  const nextStatus = AiReceptionSetupStatus.PENDING;

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
      status: nextStatus,
      lastTestedAt: null,
      lastVerifiedAt: null
    },
    update: {
      provider: ExternalProvider.AMAZON_CONNECT,
      carrier,
      originalPhoneNumber: originalPhoneDigits,
      forwardingPhoneNumber: forwardingDigits,
      activationCode: codes.activationCode,
      deactivationCode: codes.deactivationCode,
      status: nextStatus,
      lastTestedAt: null,
      lastVerifiedAt: null
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
  const carrier = isAiReceptionCarrier(context.aiReceptionSetup?.carrier)
    ? context.aiReceptionSetup.carrier
    : DEFAULT_CARRIER;
  const codes = buildForwardingCodes(carrier, forwardingDigits);
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 30 * 60 * 1000);
  const recentInboundCall = await prisma.callSession.findFirst({
    where: {
      salonId,
      provider: ExternalProvider.AMAZON_CONNECT,
      createdAt: {
        gte: recentCutoff
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
      createdAt: "desc"
    },
    select: {
      id: true,
      startedAt: true,
      createdAt: true
    }
  });
  const verifiedAt =
    context.aiReceptionSetup?.lastVerifiedAt ??
    recentInboundCall?.startedAt ??
    recentInboundCall?.createdAt ??
    null;
  const nextStatus = verifiedAt
    ? AiReceptionSetupStatus.ACTIVE
    : AiReceptionSetupStatus.PENDING;

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
      status: nextStatus,
      lastTestedAt: now,
      lastVerifiedAt: verifiedAt
    },
    update: {
      provider: ExternalProvider.AMAZON_CONNECT,
      originalPhoneNumber: originalPhoneDigits,
      forwardingPhoneNumber: forwardingDigits,
      activationCode: codes.activationCode,
      deactivationCode: codes.deactivationCode,
      status: nextStatus,
      lastTestedAt: now,
      lastVerifiedAt: verifiedAt
    }
  });

  await createAuditLog({
    salonId,
    actorUserId,
    action: verifiedAt
      ? "AI_RECEPTION_FORWARDING_TEST_VERIFIED"
      : "AI_RECEPTION_FORWARDING_TEST_REQUESTED",
    entityType: "SalonAiReceptionSetup",
    entityId: setup.id,
    metadata: {
      lastTestedAt: now.toISOString(),
      lastVerifiedAt: verifiedAt?.toISOString() ?? null,
      inboundCallObserved: Boolean(recentInboundCall),
      callSessionId: recentInboundCall?.id ?? null
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
