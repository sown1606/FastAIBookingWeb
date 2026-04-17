export type RoutingSummaryMode =
  | "SALON_PHONE_ONLY"
  | "AI_FORWARDING_ACTIVE"
  | "CALL_CENTER_ENABLED"
  | "AI_WITH_CALL_CENTER_ESCALATION";

interface SalonRoutingSettings {
  aiForwardingEnabled?: boolean | null;
  aiTransferRingCount?: number | null;
  callCenterEnabled?: boolean | null;
  callCenterRoutingNumber?: string | null;
  callCenterRoutingNote?: string | null;
}

export const buildSalonRoutingSummary = (settings: SalonRoutingSettings | null | undefined) => {
  const aiForwardingEnabled = settings?.aiForwardingEnabled ?? false;
  const callCenterEnabled = settings?.callCenterEnabled ?? false;
  const mode: RoutingSummaryMode =
    aiForwardingEnabled && callCenterEnabled
      ? "AI_WITH_CALL_CENTER_ESCALATION"
      : callCenterEnabled
        ? "CALL_CENTER_ENABLED"
        : aiForwardingEnabled
          ? "AI_FORWARDING_ACTIVE"
          : "SALON_PHONE_ONLY";

  return {
    mode,
    aiForwardingEnabled,
    aiTransferRingCount: settings?.aiTransferRingCount ?? 3,
    callCenterEnabled,
    callCenterRoutingNumber: settings?.callCenterRoutingNumber ?? null,
    callCenterRoutingNote: settings?.callCenterRoutingNote ?? null
  };
};
