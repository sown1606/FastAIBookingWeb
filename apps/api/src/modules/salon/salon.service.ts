import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { requireUsPhone } from "../../utils/phone";
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
  aiForwardingEnabled?: boolean;
  aiTransferRingCount?: number;
  callCenterEnabled?: boolean;
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
  const data = {
    ...input,
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
      aiForwardingEnabled: data.aiForwardingEnabled ?? false,
      aiTransferRingCount: data.aiTransferRingCount ?? 3,
      callCenterEnabled: data.callCenterEnabled ?? false,
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

  return {
    ...settings,
    routingSummary: buildSalonRoutingSummary(settings)
  };
};
