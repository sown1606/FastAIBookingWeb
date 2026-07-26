import { randomUUID } from "crypto";
import {
  AssociatePhoneNumberContactFlowCommand,
  ClaimPhoneNumberCommand,
  ConnectClient,
  DescribePhoneNumberCommand,
  PhoneNumberCountryCode,
  PhoneNumberType,
  SearchAvailablePhoneNumbersCommand
} from "@aws-sdk/client-connect";
import {
  AiReceptionForwardingType,
  AiReceptionSetupStatus,
  ExternalProvider,
  PhoneProvisioningStatus,
  Prisma
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { normalizeUsPhone } from "../../utils/phone";
import { BillingPlanCode, getBillingPlan, isBillingPlanCode } from "./billing.plans";

const activeProvisioning = new Map<string, Promise<PhoneProvisioningResult>>();

const delay = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const normalizePhoneDigits = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const normalized = normalizeUsPhone(value);
  if (!normalized) {
    return null;
  }
  return normalized.replace(/\D/g, "");
};

const areaCodeFromPhone = (value: string | null | undefined): string | null => {
  const digits = normalizePhoneDigits(value);
  return digits?.length === 11 && digits.startsWith("1") ? digits.slice(1, 4) : null;
};

export const requireAmazonConnectProvisioningConfig = (planCode: BillingPlanCode) => {
  getBillingPlan(planCode);
  const contactFlowId = env.AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION;
  const missing = [
    !env.AWS_REGION ? "AWS_REGION" : null,
    !env.AMAZON_CONNECT_INSTANCE_ID ? "AMAZON_CONNECT_INSTANCE_ID" : null,
    !contactFlowId ? "AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION" : null
  ].filter((value): value is string => Boolean(value));

  if (missing.length) {
    throw new AppError(
      "Amazon Connect phone provisioning is not configured.",
      503,
      "AMAZON_CONNECT_PROVISIONING_NOT_CONFIGURED",
      { missing }
    );
  }

  return {
    region: env.AWS_REGION!,
    instanceId: env.AMAZON_CONNECT_INSTANCE_ID!,
    contactFlowId: contactFlowId!
  };
};

export const isAmazonConnectProvisioningConfigured = (
  planCode: BillingPlanCode
): boolean => {
  try {
    requireAmazonConnectProvisioningConfig(planCode);
    return true;
  } catch {
    return false;
  }
};

const provisioningSelect = {
  id: true,
  salonId: true,
  status: true,
  areaCode: true,
  phoneNumber: true,
  phoneNumberId: true,
  phoneNumberArn: true,
  contactFlowId: true,
  claimClientToken: true,
  attemptCount: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  startedAt: true,
  completedAt: true,
  lastAttemptAt: true,
  updatedAt: true
} as const;

type ProvisioningRecord = Prisma.PhoneProvisioningGetPayload<{
  select: typeof provisioningSelect;
}>;

export interface PhoneProvisioningResult {
  status: PhoneProvisioningStatus;
  phoneNumber: string | null;
  phoneNumberId: string | null;
  contactFlowId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  completedAt: Date | null;
}

const toResult = (record: ProvisioningRecord): PhoneProvisioningResult => ({
  status: record.status,
  phoneNumber: record.phoneNumber,
  phoneNumberId: record.phoneNumberId,
  contactFlowId: record.contactFlowId,
  lastErrorCode: record.lastErrorCode,
  lastErrorMessage: record.lastErrorMessage,
  completedAt: record.completedAt
});

const safeAwsError = (error: unknown): { code: string; message: string } => {
  if (error instanceof AppError) {
    return {
      code: error.code.slice(0, 120),
      message: error.message.slice(0, 500)
    };
  }
  const candidate = error as {
    name?: string;
    Code?: string;
    code?: string;
    message?: string;
  };
  return {
    code: (candidate.name ?? candidate.Code ?? candidate.code ?? "AWS_CONNECT_ERROR").slice(0, 120),
    message: (candidate.message ?? "Amazon Connect phone provisioning failed.").slice(0, 500)
  };
};

const searchAvailableNumber = async (
  client: ConnectClient,
  instanceId: string,
  areaCode: string | null
): Promise<string> => {
  const baseInput = {
    InstanceId: instanceId,
    PhoneNumberCountryCode: PhoneNumberCountryCode.US,
    PhoneNumberType:
      env.AMAZON_CONNECT_PROVISION_PHONE_TYPE === "TOLL_FREE"
        ? PhoneNumberType.TOLL_FREE
        : PhoneNumberType.DID,
    MaxResults: 5
  };
  const withAreaCode = areaCode
    ? await client.send(
        new SearchAvailablePhoneNumbersCommand({
          ...baseInput,
          PhoneNumberPrefix: `+1${areaCode}`
        })
      )
    : null;
  const preferred = withAreaCode?.AvailableNumbersList?.find((item) => item.PhoneNumber)?.PhoneNumber;
  if (preferred) {
    return preferred;
  }

  const fallback = await client.send(new SearchAvailablePhoneNumbersCommand(baseInput));
  const phoneNumber = fallback.AvailableNumbersList?.find((item) => item.PhoneNumber)?.PhoneNumber;
  if (!phoneNumber) {
    throw new AppError(
      "No Amazon Connect phone number is currently available.",
      503,
      "AMAZON_CONNECT_PHONE_NUMBER_UNAVAILABLE"
    );
  }
  return phoneNumber;
};

const waitForClaim = async (
  client: ConnectClient,
  phoneNumberId: string,
  maxWaitMilliseconds: number
) => {
  const startedAt = Date.now();
  let summary = (
    await client.send(new DescribePhoneNumberCommand({ PhoneNumberId: phoneNumberId }))
  ).ClaimedPhoneNumberSummary;

  while (
    summary?.PhoneNumberStatus?.Status === "IN_PROGRESS" &&
    Date.now() - startedAt < maxWaitMilliseconds
  ) {
    await delay(1_000);
    summary = (
      await client.send(new DescribePhoneNumberCommand({ PhoneNumberId: phoneNumberId }))
    ).ClaimedPhoneNumberSummary;
  }
  return summary;
};

const persistActivePhone = async (input: {
  salonId: string;
  actorUserId?: string;
  phoneNumber: string;
  phoneNumberId: string;
  phoneNumberArn: string | null;
  contactFlowId: string;
  planCode: BillingPlanCode;
}) => {
  const forwardingDigits = normalizePhoneDigits(input.phoneNumber);
  if (!forwardingDigits) {
    throw new AppError(
      "Amazon Connect returned an invalid phone number.",
      502,
      "AMAZON_CONNECT_PHONE_NUMBER_INVALID"
    );
  }

  const salon = await prisma.salon.findUnique({
    where: { id: input.salonId },
    select: {
      originalPhoneNumber: true,
      contactPhone: true
    }
  });
  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }
  const originalPhoneDigits =
    normalizePhoneDigits(salon.originalPhoneNumber) ?? normalizePhoneDigits(salon.contactPhone);
  const plan = getBillingPlan(input.planCode);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: input.salonId },
      data: {
        customerIncomingPhoneNumber: input.phoneNumber,
        status: "ACTIVE"
      }
    });
    await tx.salonSetting.update({
      where: { salonId: input.salonId },
      data: {
        aiForwardingEnabled: true,
        aiReceptionEnabled: true,
        callCenterEnabled: plan.operatorTransferIncluded
      }
    });
    await tx.salonAiReceptionSetup.upsert({
      where: { salonId: input.salonId },
      create: {
        salonId: input.salonId,
        provider: ExternalProvider.AMAZON_CONNECT,
        originalPhoneNumber: originalPhoneDigits,
        forwardingPhoneNumber: forwardingDigits,
        forwardingType: AiReceptionForwardingType.NO_ANSWER,
        status: AiReceptionSetupStatus.PENDING
      },
      update: {
        provider: ExternalProvider.AMAZON_CONNECT,
        originalPhoneNumber: originalPhoneDigits,
        forwardingPhoneNumber: forwardingDigits,
        status: AiReceptionSetupStatus.PENDING,
        lastVerifiedAt: null
      }
    });
    await tx.integrationConfig.createMany({
      data: [
        "phone_number",
        "amazon_connect_phone_number",
        "called_number"
      ].map((configKey) => ({
        salonId: input.salonId,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey,
        configValue: input.phoneNumber,
        metadata: {
          phoneNumberId: input.phoneNumberId,
          ...(input.phoneNumberArn ? { phoneNumberArn: input.phoneNumberArn } : {}),
          contactFlowId: input.contactFlowId,
          managedBy: "registration_phone_provisioning"
        },
        isActive: true
      })),
      skipDuplicates: true
    });
    await tx.phoneProvisioning.update({
      where: { salonId: input.salonId },
      data: {
        status: PhoneProvisioningStatus.ACTIVE,
        phoneNumber: input.phoneNumber,
        phoneNumberId: input.phoneNumberId,
        phoneNumberArn: input.phoneNumberArn,
        contactFlowId: input.contactFlowId,
        lastErrorCode: null,
        lastErrorMessage: null,
        completedAt: now
      }
    });
    await createAuditLog(
      {
        salonId: input.salonId,
        actorUserId: input.actorUserId,
        action: "AMAZON_CONNECT_PHONE_PROVISIONED",
        entityType: "PhoneProvisioning",
        entityId: input.phoneNumberId,
        metadata: {
          phoneNumber: input.phoneNumber,
          contactFlowId: input.contactFlowId,
          planCode: input.planCode
        }
      },
      tx
    );
  });
};

const runProvisioning = async (
  salonId: string,
  actorUserId?: string
): Promise<PhoneProvisioningResult> => {
  const context = await prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      id: true,
      contactPhone: true,
      originalPhoneNumber: true,
      subscription: {
        select: { planCode: true }
      },
      phoneProvisioning: {
        select: provisioningSelect
      }
    }
  });
  if (!context?.subscription || !isBillingPlanCode(context.subscription.planCode)) {
    throw new AppError(
      "Salon subscription plan is not provisionable.",
      409,
      "PHONE_PROVISIONING_PLAN_INVALID"
    );
  }
  if (context.phoneProvisioning?.status === PhoneProvisioningStatus.ACTIVE) {
    return toResult(context.phoneProvisioning);
  }

  const planCode = context.subscription.planCode;
  const areaCode =
    context.phoneProvisioning?.areaCode ??
    areaCodeFromPhone(context.originalPhoneNumber ?? context.contactPhone);
  const provisioning =
    context.phoneProvisioning ??
    (await prisma.phoneProvisioning.upsert({
      where: { salonId },
      create: {
        salonId,
        areaCode,
        claimClientToken: randomUUID()
      },
      update: {},
      select: provisioningSelect
    }));
  let client: ConnectClient | null = null;

  try {
    const config = requireAmazonConnectProvisioningConfig(planCode);
    client = new ConnectClient({ region: config.region });
    await prisma.phoneProvisioning.update({
      where: { salonId },
      data: {
        status: provisioning.phoneNumberId
          ? PhoneProvisioningStatus.CLAIMING
          : PhoneProvisioningStatus.SEARCHING,
        attemptCount: { increment: 1 },
        startedAt: provisioning.startedAt ?? new Date(),
        lastAttemptAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null
      }
    });

    let phoneNumber = provisioning.phoneNumber;
    let phoneNumberId = provisioning.phoneNumberId;
    let phoneNumberArn = provisioning.phoneNumberArn;

    if (!phoneNumberId) {
      phoneNumber = await searchAvailableNumber(client, config.instanceId, areaCode);
      await prisma.phoneProvisioning.update({
        where: { salonId },
        data: {
          status: PhoneProvisioningStatus.CLAIMING,
          phoneNumber
        }
      });
      const claim = await client.send(
        new ClaimPhoneNumberCommand({
          InstanceId: config.instanceId,
          PhoneNumber: phoneNumber,
          PhoneNumberDescription: `FastAIBooking salon ${salonId}`,
          ClientToken: provisioning.claimClientToken,
          Tags: {
            FastAIBookingSalonId: salonId,
            ManagedBy: "FastAIBooking"
          }
        })
      );
      phoneNumberId = claim.PhoneNumberId ?? null;
      phoneNumberArn = claim.PhoneNumberArn ?? null;
      if (!phoneNumberId) {
        throw new AppError(
          "Amazon Connect did not return a phone number ID.",
          502,
          "AMAZON_CONNECT_CLAIM_RESPONSE_INVALID"
        );
      }
      await prisma.phoneProvisioning.update({
        where: { salonId },
        data: {
          phoneNumberId,
          phoneNumberArn
        }
      });
    }

    let claimed = await waitForClaim(
      client,
      phoneNumberId,
      env.AMAZON_CONNECT_PHONE_CLAIM_WAIT_MS
    );
    let workflowStatus = claimed?.PhoneNumberStatus?.Status;
    phoneNumber = claimed?.PhoneNumber ?? phoneNumber;
    phoneNumberArn = claimed?.PhoneNumberArn ?? phoneNumberArn;

    if (
      workflowStatus === "FAILED" &&
      provisioning.status === PhoneProvisioningStatus.FAILED &&
      phoneNumber
    ) {
      const retryClientToken = randomUUID();
      const retriedClaim = await client.send(
        new ClaimPhoneNumberCommand({
          InstanceId: config.instanceId,
          PhoneNumber: phoneNumber,
          PhoneNumberDescription: `FastAIBooking salon ${salonId}`,
          ClientToken: retryClientToken,
          Tags: {
            FastAIBookingSalonId: salonId,
            ManagedBy: "FastAIBooking"
          }
        })
      );
      phoneNumberId = retriedClaim.PhoneNumberId ?? null;
      phoneNumberArn = retriedClaim.PhoneNumberArn ?? phoneNumberArn;
      if (!phoneNumberId) {
        throw new AppError(
          "Amazon Connect did not return a phone number ID on retry.",
          502,
          "AMAZON_CONNECT_CLAIM_RESPONSE_INVALID"
        );
      }
      await prisma.phoneProvisioning.update({
        where: { salonId },
        data: {
          claimClientToken: retryClientToken,
          phoneNumberId,
          phoneNumberArn
        }
      });
      claimed = await waitForClaim(
        client,
        phoneNumberId,
        env.AMAZON_CONNECT_PHONE_CLAIM_WAIT_MS
      );
      workflowStatus = claimed?.PhoneNumberStatus?.Status;
      phoneNumber = claimed?.PhoneNumber ?? phoneNumber;
      phoneNumberArn = claimed?.PhoneNumberArn ?? phoneNumberArn;
    }

    if (workflowStatus === "IN_PROGRESS") {
      const latest = await prisma.phoneProvisioning.findUniqueOrThrow({
        where: { salonId },
        select: provisioningSelect
      });
      return toResult(latest);
    }
    if (workflowStatus !== "CLAIMED" || !phoneNumber) {
      throw new AppError(
        claimed?.PhoneNumberStatus?.Message ?? "Amazon Connect could not claim the phone number.",
        502,
        "AMAZON_CONNECT_PHONE_CLAIM_FAILED"
      );
    }

    await prisma.phoneProvisioning.update({
      where: { salonId },
      data: {
        status: PhoneProvisioningStatus.CONFIGURING,
        phoneNumber,
        phoneNumberArn,
        contactFlowId: config.contactFlowId
      }
    });
    await client.send(
      new AssociatePhoneNumberContactFlowCommand({
        PhoneNumberId: phoneNumberId,
        InstanceId: config.instanceId,
        ContactFlowId: config.contactFlowId
      })
    );
    await persistActivePhone({
      salonId,
      actorUserId,
      phoneNumber,
      phoneNumberId,
      phoneNumberArn: phoneNumberArn ?? null,
      contactFlowId: config.contactFlowId,
      planCode
    });

    const latest = await prisma.phoneProvisioning.findUniqueOrThrow({
      where: { salonId },
      select: provisioningSelect
    });
    return toResult(latest);
  } catch (error) {
    const safeError = safeAwsError(error);
    logger.error({ salonId, code: safeError.code }, "Amazon Connect phone provisioning failed");
    const failed = await prisma.phoneProvisioning.update({
      where: { salonId },
      data: {
        status: PhoneProvisioningStatus.FAILED,
        lastErrorCode: safeError.code,
        lastErrorMessage: safeError.message
      },
      select: provisioningSelect
    });
    return toResult(failed);
  } finally {
    client?.destroy();
  }
};

export const provisionPhoneNumberForSalon = async (
  salonId: string,
  actorUserId?: string
): Promise<PhoneProvisioningResult> => {
  const current = activeProvisioning.get(salonId);
  if (current) {
    return current;
  }
  const promise = runProvisioning(salonId, actorUserId).finally(() => {
    activeProvisioning.delete(salonId);
  });
  activeProvisioning.set(salonId, promise);
  return promise;
};

export const getPhoneProvisioningForSalon = async (
  salonId: string,
  reconcile = false
): Promise<PhoneProvisioningResult | null> => {
  const existing = await prisma.phoneProvisioning.findUnique({
    where: { salonId },
    select: provisioningSelect
  });
  if (!existing) {
    return null;
  }
  if (
    reconcile &&
    (existing.status === PhoneProvisioningStatus.CLAIMING ||
      existing.status === PhoneProvisioningStatus.CONFIGURING)
  ) {
    return provisionPhoneNumberForSalon(salonId);
  }
  return toResult(existing);
};
