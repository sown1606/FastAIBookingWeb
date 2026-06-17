import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { requireUsPhone } from "../../utils/phone";
import {
  sendPushToActiveSalonStaff,
  sendPushToAssignedCallCenterAgentsOrOperators
} from "../notifications/notifications.service";
import { buildSalonRoutingSummary } from "./routing-summary";

interface UpdateSalonProfileInput {
  name?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  originalPhoneNumber?: string | null;
  customerIncomingPhoneNumber?: string | null;
  notificationPhoneNumber?: string | null;
  timezone?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string;
}

interface UpdateSalonSettingsInput {
  currency?: string;
  locale?: string;
  bookingLeadTimeMinutes?: number;
  cancellationPolicy?: string | null;
  aiReceptionEnabled?: boolean;
  aiTransferRingCount?: number;
  callCenterEnabled?: boolean;
  voicemailEnabled?: boolean;
  callbackRequestEnabled?: boolean;
  smsFallbackEnabled?: boolean;
  aiGreetingPrompt?: string | null;
  callerLanguage?: string;
  callLogVisibility?: "OWNER_ONLY" | "OWNER_AND_STAFF" | "OWNER_STAFF_OPERATOR";
  notificationRecipients?: string[];
  callCenterRoutingNumber?: string | null;
  callCenterRoutingNote?: string | null;
}

const normalizeOptionalPhone = (
  value: string | null | undefined,
  label: string
): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value.trim().length === 0) {
    return null;
  }
  return requireUsPhone(value, label);
};

const normalizeNotificationRecipients = (
  value: string[] | undefined
): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return Array.from(
    new Set(
      value
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  );
};

const normalizeOptionalTextForCompare = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const sendCallCenterRoutingNotePush = async (salonId: string): Promise<void> => {
  try {
    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        name: true
      }
    });

    const salonName = salon?.name ?? "A salon";
    await Promise.all([
      sendPushToAssignedCallCenterAgentsOrOperators(salonId, {
        title: "Operator note updated",
        body: `${salonName} updated call center routing notes.`,
        type: "call_center_routing_note_updated",
        salonId,
        url: `/call-center?salonId=${encodeURIComponent(salonId)}`,
        data: {
          type: "call_center_routing_note_updated",
          salonId
        }
      }),
      sendPushToActiveSalonStaff(salonId, {
        title: "Ghi chú từ chủ tiệm đã cập nhật",
        body: `${salonName} vừa cập nhật ghi chú hôm nay.`,
        type: "salon_owner_note_updated",
        salonId,
        url: "/dashboard",
        data: {
          type: "salon_owner_note_updated",
          salonId
        }
      })
    ]);
  } catch (error) {
    logger.warn(
      {
        salonId,
        error: error instanceof Error ? error.message : String(error)
      },
      "Call center routing-note push notification failed."
    );
  }
};

export const getSalonProfile = async (salonId: string) => {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    include: {
      owner: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true
        }
      },
      subscription: true
    }
  });
  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }
  return salon;
};

export const getSalonOperatorNote = async (salonId: string) => {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      id: true,
      name: true,
      timezone: true,
      settings: {
        select: {
          callCenterRoutingNote: true
        }
      }
    }
  });

  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  return {
    salonId: salon.id,
    salonName: salon.name,
    timezone: salon.timezone,
    callCenterRoutingNote: salon.settings?.callCenterRoutingNote ?? null
  };
};

export const updateSalonProfile = async (
  salonId: string,
  actorUserId: string,
  input: UpdateSalonProfileInput
) => {
  const data = {
    ...input,
    contactPhone: normalizeOptionalPhone(input.contactPhone, "Contact phone"),
    originalPhoneNumber: normalizeOptionalPhone(input.originalPhoneNumber, "Original salon phone"),
    customerIncomingPhoneNumber: normalizeOptionalPhone(
      input.customerIncomingPhoneNumber,
      "Customer incoming phone"
    ),
    notificationPhoneNumber: normalizeOptionalPhone(
      input.notificationPhoneNumber,
      "Notification phone"
    )
  };

  const salon = await prisma.salon.update({
    where: { id: salonId },
    data
  });

  await createAuditLog({
    salonId,
    actorUserId,
    action: "SALON_PROFILE_UPDATED",
    entityType: "Salon",
    entityId: salon.id,
    metadata: data
  });

  return salon;
};

export const getSalonSettings = async (salonId: string) => {
  const settings = await prisma.salonSetting.findUnique({
    where: { salonId }
  });

  if (!settings) {
    throw new AppError("Salon settings not found.", 404, "SALON_SETTINGS_NOT_FOUND");
  }
  return {
    ...settings,
    routingSummary: buildSalonRoutingSummary(settings)
  };
};

export const updateSalonSettings = async (
  salonId: string,
  actorUserId: string,
  input: UpdateSalonSettingsInput
) => {
  const previousSettings = await prisma.salonSetting.findUnique({
    where: { salonId },
    select: {
      callCenterRoutingNote: true
    }
  });
  const hasRoutingNoteInput = Object.prototype.hasOwnProperty.call(
    input,
    "callCenterRoutingNote"
  );
  const data = {
    ...input,
    aiForwardingEnabled: input.aiReceptionEnabled,
    aiReceptionEnabled: input.aiReceptionEnabled,
    notificationRecipients: normalizeNotificationRecipients(input.notificationRecipients),
    callCenterRoutingNumber: normalizeOptionalPhone(
      input.callCenterRoutingNumber,
      "Call center routing phone"
    )
  };

  const settings = await prisma.salonSetting.upsert({
    where: { salonId },
    create: {
      salonId,
      currency: data.currency,
      locale: data.locale,
      bookingLeadTimeMinutes: data.bookingLeadTimeMinutes ?? 0,
      cancellationPolicy: data.cancellationPolicy,
      aiForwardingEnabled: data.aiReceptionEnabled ?? false,
      aiReceptionEnabled: data.aiReceptionEnabled ?? false,
      aiTransferRingCount: data.aiTransferRingCount ?? 3,
      callCenterEnabled: data.callCenterEnabled ?? false,
      voicemailEnabled: data.voicemailEnabled ?? true,
      callbackRequestEnabled: data.callbackRequestEnabled ?? true,
      smsFallbackEnabled: data.smsFallbackEnabled ?? false,
      aiGreetingPrompt: data.aiGreetingPrompt,
      callerLanguage: data.callerLanguage ?? "en",
      callLogVisibility: data.callLogVisibility ?? "OWNER_STAFF_OPERATOR",
      notificationRecipients: data.notificationRecipients,
      callCenterRoutingNumber: data.callCenterRoutingNumber,
      callCenterRoutingNote: data.callCenterRoutingNote
    },
    update: {
      ...data
    }
  });

  await createAuditLog({
    salonId,
    actorUserId,
    action: "SALON_SETTINGS_UPDATED",
    entityType: "SalonSetting",
    entityId: settings.id,
    metadata: data
  });

  if (
    hasRoutingNoteInput &&
    normalizeOptionalTextForCompare(previousSettings?.callCenterRoutingNote) !==
      normalizeOptionalTextForCompare(settings.callCenterRoutingNote)
  ) {
    await sendCallCenterRoutingNotePush(salonId);
  }

  return {
    ...settings,
    routingSummary: buildSalonRoutingSummary(settings)
  };
};
